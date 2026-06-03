use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::process::Stdio;
use std::sync::{Arc, OnceLock};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, ChildStdout, Command as TokioCommand};
use tokio::sync::Mutex;
use tokio::task::JoinHandle;
use tokio::time::{timeout, Duration};

type McpStdoutLines = tokio::io::Lines<BufReader<ChildStdout>>;

#[derive(Debug, Clone, Deserialize)]
pub struct McpCommandServer {
    pub id: String,
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env: HashMap<String, String>,
}

#[derive(Debug, Clone)]
struct SanitizedMcpServer {
    id: String,
    command: String,
    args: Vec<String>,
    env: HashMap<String, String>,
    signature: String,
}

struct McpSession {
    signature: String,
    server_name: String,
    child: Child,
    stdin: Option<ChildStdin>,
    stdout_lines: Option<McpStdoutLines>,
    stderr_lines: Arc<Mutex<Vec<String>>>,
    stderr_task: Option<JoinHandle<()>>,
    next_request_id: i64,
}

#[derive(Debug, Deserialize)]
pub struct McpListToolsArgs {
    pub server: McpCommandServer,
}

#[derive(Debug, Deserialize)]
pub struct McpCallToolArgs {
    pub server: McpCommandServer,
    #[serde(rename = "toolName")]
    pub tool_name: String,
    #[serde(default)]
    pub arguments: Value,
}

#[derive(Debug, Deserialize)]
pub struct McpServerLifecycleArgs {
    pub server: McpCommandServer,
}

#[derive(Debug, Serialize)]
pub struct McpToolDescriptor {
    pub name: String,
    pub description: Option<String>,
    #[serde(rename = "inputSchema")]
    pub input_schema: Option<Value>,
}

#[derive(Debug, Serialize)]
pub struct McpListToolsResult {
    #[serde(rename = "serverName")]
    pub server_name: String,
    pub tools: Vec<McpToolDescriptor>,
}

#[derive(Debug, Serialize)]
pub struct McpToolCallResult {
    pub text: String,
}

#[derive(Debug, Serialize)]
pub struct McpServerStatusResult {
    #[serde(rename = "serverId")]
    pub server_id: String,
    #[serde(rename = "serverName")]
    pub server_name: Option<String>,
    pub running: bool,
}

fn sanitize_server(server: &McpCommandServer) -> Result<SanitizedMcpServer, String> {
    let id = server.id.trim();
    if id.is_empty() {
        return Err("MCP server id is empty.".to_string());
    }

    let command = server.command.trim();
    if command.is_empty() {
        return Err("MCP command is empty.".to_string());
    }

    let args = server
        .args
        .iter()
        .map(|arg| arg.trim())
        .filter(|arg| !arg.is_empty())
        .map(ToOwned::to_owned)
        .collect::<Vec<_>>();

    let env = server
        .env
        .iter()
        .filter_map(|(key, value)| {
            let clean_key = key.trim();
            if clean_key.is_empty() {
                None
            } else {
                Some((clean_key.to_string(), value.clone()))
            }
        })
        .collect::<HashMap<_, _>>();

    let mut env_entries = env.iter().collect::<Vec<_>>();
    env_entries.sort_by(|(left, _), (right, _)| left.cmp(right));
    let signature = serde_json::to_string(&json!({
        "command": command,
        "args": args,
        "env": env_entries
            .into_iter()
            .map(|(key, value)| json!({ "key": key, "value": value }))
            .collect::<Vec<_>>(),
    }))
    .map_err(|e| e.to_string())?;

    Ok(SanitizedMcpServer {
        id: id.to_string(),
        command: command.to_string(),
        args,
        env,
        signature,
    })
}

#[cfg(windows)]
fn apply_hidden_window_tokio(cmd: &mut TokioCommand) {
    const CREATE_NO_WINDOW: u32 = 0x08000000;
    cmd.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
fn apply_hidden_window_tokio(_cmd: &mut TokioCommand) {}

fn session_registry() -> &'static Mutex<HashMap<String, Arc<Mutex<McpSession>>>> {
    static SESSION_REGISTRY: OnceLock<Mutex<HashMap<String, Arc<Mutex<McpSession>>>>> = OnceLock::new();
    SESSION_REGISTRY.get_or_init(|| Mutex::new(HashMap::new()))
}

async fn send_json_line(stdin: &mut ChildStdin, value: Value) -> Result<(), String> {
    let raw = serde_json::to_vec(&value).map_err(|e| e.to_string())?;
    stdin.write_all(&raw).await.map_err(|e| e.to_string())?;
    stdin.write_all(b"\n").await.map_err(|e| e.to_string())?;
    stdin.flush().await.map_err(|e| e.to_string())
}

async fn read_response_line(reader: &mut McpStdoutLines, request_id: i64) -> Result<Value, String> {
    loop {
        let maybe_line = timeout(Duration::from_secs(60), reader.next_line())
            .await
            .map_err(|_| "Timed out waiting for MCP server response.".to_string())?
            .map_err(|e| e.to_string())?;

        let Some(line) = maybe_line else {
            return Err("MCP server closed stdout before sending a response.".to_string());
        };

        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        let parsed = serde_json::from_str::<Value>(trimmed).map_err(|e| format!("Invalid MCP response JSON: {e}"))?;
        if parsed.get("id").and_then(Value::as_i64) != Some(request_id) {
            continue;
        }

        if let Some(err) = parsed.get("error") {
            let msg = err
                .get("message")
                .and_then(Value::as_str)
                .unwrap_or("Unknown MCP error");
            return Err(msg.to_string());
        }

        return Ok(parsed);
    }
}

fn extract_tools(value: &Value) -> Vec<McpToolDescriptor> {
    value
        .get("result")
        .and_then(|result| result.get("tools"))
        .and_then(Value::as_array)
        .map(|tools| {
            tools
                .iter()
                .filter_map(|tool| {
                    let name = tool.get("name").and_then(Value::as_str)?.trim().to_string();
                    if name.is_empty() {
                        return None;
                    }
                    let description = tool
                        .get("description")
                        .and_then(Value::as_str)
                        .map(|text| text.to_string());
                    let input_schema = tool.get("inputSchema").cloned();
                    Some(McpToolDescriptor {
                        name,
                        description,
                        input_schema,
                    })
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default()
}

fn stringify_tool_result(value: &Value) -> String {
    let Some(result) = value.get("result") else {
        return serde_json::to_string_pretty(value).unwrap_or_else(|_| "Tool call succeeded.".to_string());
    };

    let content = result.get("content").and_then(Value::as_array);
    if let Some(content) = content {
        let parts = content
            .iter()
            .map(|item| {
                if item.get("type").and_then(Value::as_str) == Some("text") {
                    item.get("text")
                        .and_then(Value::as_str)
                        .map(|text| text.to_string())
                        .unwrap_or_else(|| serde_json::to_string_pretty(item).unwrap_or_default())
                } else {
                    serde_json::to_string_pretty(item).unwrap_or_default()
                }
            })
            .filter(|text| !text.trim().is_empty())
            .collect::<Vec<_>>();
        if !parts.is_empty() {
            return parts.join("\n\n");
        }
    }

    serde_json::to_string_pretty(result).unwrap_or_else(|_| "Tool call succeeded.".to_string())
}

async fn append_stderr_line(stderr_lines: &Arc<Mutex<Vec<String>>>, line: String) {
    const MAX_STDERR_LINES: usize = 120;
    let mut guard = stderr_lines.lock().await;
    guard.push(line);
    if guard.len() > MAX_STDERR_LINES {
        let extra = guard.len() - MAX_STDERR_LINES;
        guard.drain(0..extra);
    }
}

async fn collect_stderr_text(stderr_lines: &Arc<Mutex<Vec<String>>>) -> String {
    stderr_lines.lock().await.join("\n")
}

fn format_error_with_stderr(base_error: String, stderr_text: String) -> String {
    if stderr_text.trim().is_empty() {
        base_error
    } else {
        format!("{base_error}\n{stderr_text}")
    }
}

async fn session_request(session: &mut McpSession, method: &str, params: Value) -> Result<Value, String> {
    let request_id = session.next_request_id;
    session.next_request_id += 1;

    let stdin = session
        .stdin
        .as_mut()
        .ok_or_else(|| "MCP stdin is not available.".to_string())?;
    send_json_line(
        stdin,
        json!({
            "jsonrpc": "2.0",
            "id": request_id,
            "method": method,
            "params": params,
        }),
    )
    .await?;

    let stdout_lines = session
        .stdout_lines
        .as_mut()
        .ok_or_else(|| "MCP stdout is not available.".to_string())?;
    read_response_line(stdout_lines, request_id).await
}

async fn shutdown_session_locked(session: &mut McpSession) {
    if let Some(mut stdin) = session.stdin.take() {
        let _ = stdin.shutdown().await;
    }

    if timeout(Duration::from_secs(2), session.child.wait()).await.is_err() {
        let _ = session.child.kill().await;
        let _ = session.child.wait().await;
    }

    if let Some(stderr_task) = session.stderr_task.take() {
        let _ = stderr_task.await;
    }
}

async fn shutdown_session_handle(session_handle: Arc<Mutex<McpSession>>) {
    let mut session = session_handle.lock().await;
    shutdown_session_locked(&mut session).await;
}

async fn spawn_mcp_session(server: SanitizedMcpServer) -> Result<McpSession, String> {
    let mut proc = TokioCommand::new(&server.command);
    proc.args(&server.args)
        .envs(&server.env)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    apply_hidden_window_tokio(&mut proc);

    let mut child = proc
        .spawn()
        .map_err(|e| format!("Failed to start MCP server: {e}"))?;

    let stderr = child.stderr.take().ok_or_else(|| "Failed to capture MCP stderr.".to_string())?;
    let stderr_lines = Arc::new(Mutex::new(Vec::new()));
    let stderr_lines_for_task = Arc::clone(&stderr_lines);
    let stderr_task = tokio::spawn(async move {
        let mut reader = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = reader.next_line().await {
            let trimmed = line.trim();
            if !trimmed.is_empty() {
                append_stderr_line(&stderr_lines_for_task, trimmed.to_string()).await;
            }
        }
    });

    let stdin = child.stdin.take().ok_or_else(|| "Failed to open MCP stdin.".to_string())?;
    let stdout = child.stdout.take().ok_or_else(|| "Failed to open MCP stdout.".to_string())?;
    let mut session = McpSession {
        signature: server.signature,
        server_name: "MCP Server".to_string(),
        child,
        stdin: Some(stdin),
        stdout_lines: Some(BufReader::new(stdout).lines()),
        stderr_lines,
        stderr_task: Some(stderr_task),
        next_request_id: 1,
    };

    let init_response = session_request(
        &mut session,
        "initialize",
        json!({
            "protocolVersion": "2024-11-05",
            "capabilities": {},
            "clientInfo": {
                "name": "ruf-desktop",
                "version": env!("CARGO_PKG_VERSION")
            }
        }),
    )
    .await;

    let init_response = match init_response {
        Ok(response) => response,
        Err(err) => {
            let stderr_text = collect_stderr_text(&session.stderr_lines).await;
            shutdown_session_locked(&mut session).await;
            return Err(format_error_with_stderr(err, stderr_text));
        }
    };

    session.server_name = init_response
        .get("result")
        .and_then(|result| result.get("serverInfo"))
        .and_then(|info| info.get("name"))
        .and_then(Value::as_str)
        .unwrap_or("MCP Server")
        .to_string();

    if let Some(stdin) = session.stdin.as_mut() {
        let initialized_result = send_json_line(
            stdin,
            json!({
                "jsonrpc": "2.0",
                "method": "notifications/initialized"
            }),
        )
        .await;

        if let Err(err) = initialized_result {
            let stderr_text = collect_stderr_text(&session.stderr_lines).await;
            shutdown_session_locked(&mut session).await;
            return Err(format_error_with_stderr(err, stderr_text));
        }
    }

    Ok(session)
}

async fn remove_session(server_id: &str) -> Option<Arc<Mutex<McpSession>>> {
    let mut registry = session_registry().lock().await;
    registry.remove(server_id)
}

async fn ensure_mcp_session(server: McpCommandServer, force_restart: bool) -> Result<Arc<Mutex<McpSession>>, String> {
    let sanitized = sanitize_server(&server)?;
    let server_id = sanitized.id.clone();
    let signature = sanitized.signature.clone();

    let existing = {
        let registry = session_registry().lock().await;
        registry.get(&server_id).cloned()
    };

    if let Some(existing_handle) = existing {
        let has_same_signature = {
            let session = existing_handle.lock().await;
            session.signature == signature
        };

        if !force_restart && has_same_signature {
            return Ok(existing_handle);
        }

        if let Some(stale_handle) = remove_session(&server_id).await {
            shutdown_session_handle(stale_handle).await;
        }
    }

    let session_handle = Arc::new(Mutex::new(spawn_mcp_session(sanitized).await?));
    let mut registry = session_registry().lock().await;
    registry.insert(server_id, Arc::clone(&session_handle));
    Ok(session_handle)
}

async fn with_session_request<T>(
    server: McpCommandServer,
    force_restart: bool,
    operation: impl FnOnce(&mut McpSession) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<T, String>> + Send + '_>>,
) -> Result<T, String> {
    let server_id = server.id.trim().to_string();
    let session_handle = ensure_mcp_session(server, force_restart).await?;
    let mut session = session_handle.lock().await;
    let result = operation(&mut session).await;
    if result.is_err() {
        let stderr_text = collect_stderr_text(&session.stderr_lines).await;
        if !stderr_text.trim().is_empty() {
            return Err(format_error_with_stderr(result.err().unwrap_or_default(), stderr_text));
        }
    }

    match result {
        Ok(value) => Ok(value),
        Err(err) => {
            let should_drop = err.contains("closed stdout")
                || err.contains("stdin is not available")
                || err.contains("stdout is not available")
                || err.contains("Timed out waiting for MCP server response");
            drop(session);
            if should_drop {
                let current = {
                    let registry = session_registry().lock().await;
                    registry.get(&server_id).cloned()
                };
                if let Some(current_handle) = current {
                    if Arc::ptr_eq(&current_handle, &session_handle) {
                        let _ = remove_session(&server_id).await;
                    }
                }
            }
            Err(err)
        }
    }
}

async fn session_tools_result(server: McpCommandServer, force_restart: bool) -> Result<McpListToolsResult, String> {
    with_session_request(server, force_restart, |session| {
        Box::pin(async move {
            let response = session_request(session, "tools/list", json!({})).await?;
            Ok(McpListToolsResult {
                server_name: session.server_name.clone(),
                tools: extract_tools(&response),
            })
        })
    })
    .await
}

#[tauri::command]
pub async fn mcp_start_server(args: McpServerLifecycleArgs) -> Result<McpListToolsResult, String> {
    session_tools_result(args.server, false).await
}

#[tauri::command]
pub async fn mcp_reconnect_server(args: McpServerLifecycleArgs) -> Result<McpListToolsResult, String> {
    session_tools_result(args.server, true).await
}

#[tauri::command]
pub async fn mcp_stop_server(args: McpServerLifecycleArgs) -> Result<McpServerStatusResult, String> {
    let server_id = sanitize_server(&args.server)?.id;
    if let Some(session_handle) = remove_session(&server_id).await {
        shutdown_session_handle(session_handle).await;
    }

    Ok(McpServerStatusResult {
        server_id,
        server_name: None,
        running: false,
    })
}

#[tauri::command]
pub async fn mcp_get_server_status(args: McpServerLifecycleArgs) -> Result<McpServerStatusResult, String> {
    let sanitized = sanitize_server(&args.server)?;
    let session_handle = {
        let registry = session_registry().lock().await;
        registry.get(&sanitized.id).cloned()
    };

    if let Some(session_handle) = session_handle {
        let session = session_handle.lock().await;
        return Ok(McpServerStatusResult {
            server_id: sanitized.id,
            server_name: Some(session.server_name.clone()),
            running: true,
        });
    }

    Ok(McpServerStatusResult {
        server_id: sanitized.id,
        server_name: None,
        running: false,
    })
}

#[tauri::command]
pub async fn mcp_list_tools(args: McpListToolsArgs) -> Result<McpListToolsResult, String> {
    session_tools_result(args.server, false).await
}

#[tauri::command]
pub async fn mcp_call_tool(args: McpCallToolArgs) -> Result<McpToolCallResult, String> {
    with_session_request(args.server, false, |session| {
        let tool_name = args.tool_name.clone();
        let tool_args = args.arguments.clone();
        Box::pin(async move {
            let response = session_request(
                session,
                "tools/call",
                json!({
                    "name": tool_name,
                    "arguments": tool_args,
                }),
            )
            .await?;

            Ok(McpToolCallResult {
                text: stringify_tool_result(&response),
            })
        })
    })
    .await
}

pub async fn shutdown_mcp_runtime() {
    let sessions = {
        let mut registry = session_registry().lock().await;
        registry.drain().map(|(_, session)| session).collect::<Vec<_>>()
    };

    for session in sessions {
        shutdown_session_handle(session).await;
    }
}

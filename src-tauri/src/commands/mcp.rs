use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::env;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{Arc, OnceLock};
use tauri::{AppHandle, Manager};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, ChildStdout, Command as TokioCommand};
use tokio::sync::Mutex;
use tokio::task::JoinHandle;
use tokio::time::{timeout, Duration};

type McpStdoutLines = tokio::io::Lines<BufReader<ChildStdout>>;
const ATLASSIAN_MCP_SIDECAR_NAME: &str = "atlassian-mcp";
const POSTGRES_MCP_SIDECAR_NAME: &str = "postgres-mcp";
const ATLASSIAN_LEGACY_REMOTE_URL: &str = "https://mcp.atlassian.com/v1/mcp/authv2";

fn current_target_triple() -> &'static str {
    option_env!("TARGET").unwrap_or("unknown-target")
}

#[derive(Debug, Clone, Deserialize)]
pub struct McpCommandServer {
    pub id: String,
    #[serde(default)]
    pub template: Option<String>,
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env: HashMap<String, String>,
}

#[derive(Debug, Clone)]
struct SanitizedMcpServer {
    id: String,
    template: Option<String>,
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

    let template = server.template.as_ref().map(|value| value.trim().to_ascii_lowercase());
    let command = server.command.trim();
    if command.is_empty() && !matches!(template.as_deref(), Some("postgres" | "atlassian")) {
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
        "template": template,
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
        template,
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

fn is_executable_file(path: &Path) -> bool {
    path.is_file()
}

fn resolve_executable_path(command: &str) -> Option<PathBuf> {
    let trimmed = command.trim();
    if trimmed.is_empty() {
        return None;
    }

    let direct = PathBuf::from(trimmed);
    if direct.components().count() > 1 || direct.is_absolute() {
        return is_executable_file(&direct).then_some(direct);
    }

    let mut candidates = Vec::new();
    if let Some(home) = env::var_os("HOME") {
        candidates.push(PathBuf::from(home).join(".local/bin").join(trimmed));
    }

    if let Some(path_var) = env::var_os("PATH") {
        candidates.extend(env::split_paths(&path_var).map(|dir| dir.join(trimmed)));
    }

    candidates.into_iter().find(|path| is_executable_file(path))
}

fn bundled_sidecar_path(app: &AppHandle, sidecar_name: &str) -> Option<PathBuf> {
    let extension = if cfg!(windows) { ".exe" } else { "" };
    let resource_dir = app.path().resource_dir().ok()?;
    let candidate = resource_dir
        .join("binaries")
        .join(format!("{sidecar_name}-{}{extension}", current_target_triple()));

    is_executable_file(&candidate).then_some(candidate)
}

fn normalize_postgres_spawn_args(args: &[String]) -> Vec<String> {
    args.iter()
        .enumerate()
        .filter_map(|(index, arg)| {
            if index == 0 && arg.trim().eq_ignore_ascii_case(POSTGRES_MCP_SIDECAR_NAME) {
                None
            } else {
                Some(arg.clone())
            }
        })
        .collect()
}

fn normalize_atlassian_spawn_args(args: &[String]) -> Vec<String> {
    args
        .iter()
        .filter(|arg| {
            let trimmed = arg.trim();
            !trimmed.eq_ignore_ascii_case("-y")
                && !trimmed.eq_ignore_ascii_case("mcp-remote")
                && !trimmed
                    .strip_prefix("mcp-remote")
                    .is_some_and(|suffix| suffix.starts_with('@'))
                && !trimmed.eq_ignore_ascii_case(ATLASSIAN_LEGACY_REMOTE_URL)
        })
        .cloned()
        .collect::<Vec<_>>()
}

fn resolve_spawn_command(server: &SanitizedMcpServer, app: &AppHandle) -> (String, Vec<String>) {
    if server.template.as_deref() == Some("postgres") {
        if let Some(sidecar_path) = bundled_sidecar_path(app, POSTGRES_MCP_SIDECAR_NAME) {
            return (
                sidecar_path.to_string_lossy().to_string(),
                normalize_postgres_spawn_args(&server.args),
            );
        }
    }

    if server.template.as_deref() == Some("atlassian") {
        if let Some(sidecar_path) = bundled_sidecar_path(app, ATLASSIAN_MCP_SIDECAR_NAME) {
            return (
                sidecar_path.to_string_lossy().to_string(),
                normalize_atlassian_spawn_args(&server.args),
            );
        }
    }

    let command = match server.template.as_deref() {
        Some("postgres") if server.command.trim().is_empty() => POSTGRES_MCP_SIDECAR_NAME,
        Some("atlassian") if server.command.trim().is_empty() => ATLASSIAN_MCP_SIDECAR_NAME,
        _ => server.command.as_str(),
    };
    let trimmed = command.trim();
    let normalized = trimmed.to_ascii_lowercase();

    if normalized == "uvx"
        && server
            .args
            .first()
            .map(|arg| arg.trim().eq_ignore_ascii_case(POSTGRES_MCP_SIDECAR_NAME))
            .unwrap_or(false)
    {
        if let Some(resolved) = resolve_executable_path(POSTGRES_MCP_SIDECAR_NAME) {
            return (
                resolved.to_string_lossy().to_string(),
                server.args.iter().skip(1).cloned().collect::<Vec<_>>(),
            );
        }
    }

    if normalized == POSTGRES_MCP_SIDECAR_NAME {
        if let Some(resolved) = resolve_executable_path(trimmed) {
            return (
                resolved.to_string_lossy().to_string(),
                normalize_postgres_spawn_args(&server.args),
            );
        }
    }

    (trimmed.to_string(), server.args.to_vec())
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

async fn spawn_mcp_session(server: SanitizedMcpServer, app: &AppHandle) -> Result<McpSession, String> {
    let (resolved_command, resolved_args) = resolve_spawn_command(&server, app);
    let mut proc = TokioCommand::new(&resolved_command);
    proc.args(&resolved_args)
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

async fn ensure_mcp_session(server: McpCommandServer, force_restart: bool, app: &AppHandle) -> Result<Arc<Mutex<McpSession>>, String> {
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

    let session_handle = Arc::new(Mutex::new(spawn_mcp_session(sanitized, app).await?));
    let mut registry = session_registry().lock().await;
    registry.insert(server_id, Arc::clone(&session_handle));
    Ok(session_handle)
}

async fn with_session_request<T>(
    server: McpCommandServer,
    force_restart: bool,
    app: AppHandle,
    operation: impl FnOnce(&mut McpSession) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<T, String>> + Send + '_>>,
) -> Result<T, String> {
    let server_id = server.id.trim().to_string();
    let session_handle = ensure_mcp_session(server, force_restart, &app).await?;
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

async fn session_tools_result(server: McpCommandServer, force_restart: bool, app: AppHandle) -> Result<McpListToolsResult, String> {
    with_session_request(server, force_restart, app, |session| {
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
pub async fn mcp_start_server(app: AppHandle, args: McpServerLifecycleArgs) -> Result<McpListToolsResult, String> {
    session_tools_result(args.server, false, app).await
}

#[tauri::command]
pub async fn mcp_reconnect_server(app: AppHandle, args: McpServerLifecycleArgs) -> Result<McpListToolsResult, String> {
    session_tools_result(args.server, true, app).await
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
pub async fn mcp_list_tools(app: AppHandle, args: McpListToolsArgs) -> Result<McpListToolsResult, String> {
    session_tools_result(args.server, false, app).await
}

#[tauri::command]
pub async fn mcp_call_tool(app: AppHandle, args: McpCallToolArgs) -> Result<McpToolCallResult, String> {
    with_session_request(args.server, false, app, |session| {
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

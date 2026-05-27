use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::process::Stdio;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command as TokioCommand;
use tokio::time::{timeout, Duration};

#[derive(Debug, Deserialize)]
pub struct McpCommandServer {
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env: HashMap<String, String>,
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
pub struct McpCallToolResult {
    pub text: String,
}

fn sanitize_server(server: &McpCommandServer) -> Result<(&str, Vec<&str>, HashMap<String, String>), String> {
    let command = server.command.trim();
    if command.is_empty() {
        return Err("MCP command is empty.".to_string());
    }

    let args = server
        .args
        .iter()
        .map(|arg| arg.trim())
        .filter(|arg| !arg.is_empty())
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

    Ok((command, args, env))
}

async fn send_json_line(stdin: &mut tokio::process::ChildStdin, value: Value) -> Result<(), String> {
    let raw = serde_json::to_vec(&value).map_err(|e| e.to_string())?;
    stdin.write_all(&raw).await.map_err(|e| e.to_string())?;
    stdin.write_all(b"\n").await.map_err(|e| e.to_string())?;
    stdin.flush().await.map_err(|e| e.to_string())
}

async fn read_response_line(
    reader: &mut tokio::io::Lines<BufReader<tokio::process::ChildStdout>>,
    request_id: i64,
) -> Result<Value, String> {
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

async fn with_mcp_server<T>(
    server: McpCommandServer,
    operation: impl for<'a> FnOnce(
        String,
        &'a mut tokio::process::ChildStdin,
        &'a mut tokio::io::Lines<BufReader<tokio::process::ChildStdout>>,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<T, String>> + Send + 'a>>,
) -> Result<T, String> {
    let (command, args, env) = sanitize_server(&server)?;

    let mut child = TokioCommand::new(command)
        .args(args)
        .envs(env)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to start MCP server: {e}"))?;

    let stderr = child.stderr.take().ok_or_else(|| "Failed to capture MCP stderr.".to_string())?;
    let stderr_task = tokio::spawn(async move {
        let mut reader = BufReader::new(stderr).lines();
        let mut parts: Vec<String> = Vec::new();
        while let Ok(Some(line)) = reader.next_line().await {
            let trimmed = line.trim();
            if !trimmed.is_empty() {
                parts.push(trimmed.to_string());
            }
        }
        parts.join("\n")
    });

    let mut stdin = child.stdin.take().ok_or_else(|| "Failed to open MCP stdin.".to_string())?;
    let stdout = child.stdout.take().ok_or_else(|| "Failed to open MCP stdout.".to_string())?;
    let mut stdout_lines = BufReader::new(stdout).lines();

    let result = async {
        send_json_line(
            &mut stdin,
            json!({
                "jsonrpc": "2.0",
                "id": 1,
                "method": "initialize",
                "params": {
                    "protocolVersion": "2024-11-05",
                    "capabilities": {},
                    "clientInfo": {
                        "name": "ruf-desktop",
                        "version": env!("CARGO_PKG_VERSION")
                    }
                }
            }),
        )
        .await?;

        let init_response = read_response_line(&mut stdout_lines, 1).await?;
        let server_name = init_response
            .get("result")
            .and_then(|result| result.get("serverInfo"))
            .and_then(|info| info.get("name"))
            .and_then(Value::as_str)
            .unwrap_or("MCP Server")
            .to_string();

        send_json_line(
            &mut stdin,
            json!({
                "jsonrpc": "2.0",
                "method": "notifications/initialized"
            }),
        )
        .await?;

        operation(server_name, &mut stdin, &mut stdout_lines).await
    }
    .await;

    let _ = stdin.shutdown().await;
    if timeout(Duration::from_secs(2), child.wait()).await.is_err() {
        let _ = child.kill().await;
    }
    let stderr_text = match stderr_task.await {
        Ok(text) => text,
        Err(_) => String::new(),
    };

    match result {
        Ok(value) => Ok(value),
        Err(err) if stderr_text.trim().is_empty() => Err(err),
        Err(err) => Err(format!("{err}\n{stderr_text}")),
    }
}

#[tauri::command]
pub async fn mcp_list_tools(args: McpListToolsArgs) -> Result<McpListToolsResult, String> {
    with_mcp_server(args.server, |server_name, stdin, stdout_lines| {
        Box::pin(async move {
            send_json_line(
                stdin,
                json!({
                    "jsonrpc": "2.0",
                    "id": 2,
                    "method": "tools/list",
                    "params": {}
                }),
            )
            .await?;

            let response = read_response_line(stdout_lines, 2).await?;
            Ok(McpListToolsResult {
                server_name,
                tools: extract_tools(&response),
            })
        })
    })
    .await
}

#[tauri::command]
pub async fn mcp_call_tool(args: McpCallToolArgs) -> Result<McpCallToolResult, String> {
    with_mcp_server(args.server, |_server_name, stdin, stdout_lines| {
        let tool_name = args.tool_name.clone();
        let tool_args = args.arguments.clone();
        Box::pin(async move {
            send_json_line(
                stdin,
                json!({
                    "jsonrpc": "2.0",
                    "id": 2,
                    "method": "tools/call",
                    "params": {
                        "name": tool_name,
                        "arguments": tool_args
                    }
                }),
            )
            .await?;

            let response = read_response_line(stdout_lines, 2).await?;
            Ok(McpCallToolResult {
                text: stringify_tool_result(&response),
            })
        })
    })
    .await
}

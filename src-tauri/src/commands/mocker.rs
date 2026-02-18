use base64::Engine;
use serde::{Deserialize, Serialize};
use std::io::{Read, Write};
use std::net::TcpStream;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tiny_http::{Header, Method, Response, Server, StatusCode};
use tokio::process::Command as TokioCommand;
use tokio::time::timeout;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[derive(Debug, Deserialize)]
pub struct MockerRunJavaArgs {
    #[serde(rename = "sourceCode")]
    pub source_code: String,
    #[serde(rename = "inputJson")]
    pub input_json: String,
    #[serde(rename = "timeoutMs")]
    pub timeout_ms: Option<u64>,
}

#[derive(Debug, Serialize)]
pub struct MockerRunJavaResult {
    pub stdout: String,
    pub stderr: String,
    pub status: i32,
    #[serde(rename = "compileStdout")]
    pub compile_stdout: String,
    #[serde(rename = "compileStderr")]
    pub compile_stderr: String,
    #[serde(rename = "compileStatus")]
    pub compile_status: i32,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct LocalRoute {
    method: String,
    path: String,
    status: u16,
    headers: Vec<(String, String)>,
    body: String,
}

#[derive(Debug, Deserialize)]
pub struct MockerServerStartArgs {
    pub port: Option<u16>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct MockerServerSetRouteArgs {
    pub method: String,
    pub path: String,
    pub port: Option<u16>,
    pub status: u16,
    pub headers: Option<Vec<(String, String)>>,
    pub body: String,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct MockerServerDeleteRouteArgs {
    pub method: String,
    pub path: String,
}

#[derive(Debug, Deserialize)]
pub struct MockerServerPortArgs {
    pub port: u16,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct MockerServerRouteItem {
    pub method: String,
    pub path: String,
    pub status: u16,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct MockerServerStatus {
    pub running: bool,
    pub port: u16,
    #[serde(rename = "baseUrl")]
    pub base_url: String,
    #[serde(rename = "routesCount")]
    pub routes_count: usize,
}

#[derive(Debug, Serialize, Deserialize)]
struct ChildHealth {
    ok: bool,
    #[serde(rename = "routesCount")]
    routes_count: usize,
}

#[derive(Debug, Serialize, Deserialize)]
struct ChildRoutesResponse {
    routes: Vec<MockerServerRouteItem>,
}

#[derive(Debug, Serialize, Deserialize)]
struct ChildLogsResponse {
    logs: Vec<String>,
}

struct MockServerRuntime {
    child: std::process::Child,
    port: u16,
    routes_count: usize,
}

static MOCK_SERVER_STATE: OnceLock<Mutex<Option<MockServerRuntime>>> = OnceLock::new();
static MOCK_SERVER_ADDITIONAL_STATE: OnceLock<Mutex<Vec<MockServerRuntime>>> = OnceLock::new();

fn server_state() -> &'static Mutex<Option<MockServerRuntime>> {
    MOCK_SERVER_STATE.get_or_init(|| Mutex::new(None))
}

fn additional_server_state() -> &'static Mutex<Vec<MockServerRuntime>> {
    MOCK_SERVER_ADDITIONAL_STATE.get_or_init(|| Mutex::new(Vec::new()))
}

fn clamp_timeout_ms(timeout_ms: Option<u64>) -> u64 {
    timeout_ms.unwrap_or(5_000).clamp(250, 120_000)
}

fn build_java_source(user_code: &str) -> String {
    format!(
        "import java.util.Base64;\n\
import java.nio.charset.StandardCharsets;\n\
\n\
public class MockRunner {{\n\
  public static void main(String[] args) throws Exception {{\n\
    String inputBase64 = args.length > 0 ? args[0] : \"\";\n\
    String inputJson = new String(Base64.getDecoder().decode(inputBase64), StandardCharsets.UTF_8);\n\
    String outputJson = handle(inputJson);\n\
    if (outputJson == null || outputJson.trim().isEmpty()) {{\n\
      System.out.print(\"{{\\\"passThrough\\\":true}}\");\n\
      return;\n\
    }}\n\
    System.out.print(outputJson);\n\
  }}\n\
\n\
  public static String handle(String inputJson) throws Exception {{\n\
{user_code}\n\
  }}\n\
}}\n"
    )
}

fn new_temp_dir() -> Result<PathBuf, String> {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| format!("Failed to get current time: {e}"))?
        .as_millis();
    let pid = std::process::id();
    let dir = std::env::temp_dir().join(format!("ruf-java-mock-{pid}-{now}"));
    std::fs::create_dir_all(&dir).map_err(|e| format!("Failed to create temp dir: {e}"))?;
    Ok(dir)
}

#[cfg(windows)]
fn apply_hidden_window_tokio(cmd: &mut TokioCommand) {
    const CREATE_NO_WINDOW: u32 = 0x08000000;
    cmd.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
fn apply_hidden_window_tokio(_cmd: &mut TokioCommand) {}

async fn run_with_timeout(cmd: &mut TokioCommand, timeout_ms: u64) -> Result<std::process::Output, String> {
    let out = timeout(Duration::from_millis(timeout_ms), cmd.output())
        .await
        .map_err(|_| format!("Command timeout after {timeout_ms}ms"))?
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                "Java runtime not found. Install a JDK/JRE and ensure `java`/`javac` are on PATH."
                    .to_string()
            } else {
                e.to_string()
            }
        })?;
    Ok(out)
}

fn default_local_routes() -> Vec<LocalRoute> {
    Vec::new()
}

fn normalize_method(method: &str) -> String {
    let m = method.trim().to_uppercase();
    if m.is_empty() { "GET".to_string() } else { m }
}

fn normalize_path(path: &str) -> String {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return "/".to_string();
    }
    let decoded = trimmed
        .replace("%7B", "{")
        .replace("%7b", "{")
        .replace("%7D", "}")
        .replace("%7d", "}");
    if decoded.starts_with('/') {
        decoded
    } else {
        format!("/{}", decoded)
    }
}

fn push_header(headers: &mut Vec<Header>, name: &str, value: &str) {
    if let Ok(h) = Header::from_bytes(name.as_bytes(), value.as_bytes()) {
        headers.push(h);
    }
}

fn add_cors_headers(headers: &mut Vec<Header>) {
    push_header(headers, "Access-Control-Allow-Origin", "*");
    push_header(headers, "Access-Control-Allow-Headers", "*");
    push_header(headers, "Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,HEAD,OPTIONS");
}

fn send_response(req: tiny_http::Request, status: u16, body: String, mut headers: Vec<Header>) {
    add_cors_headers(&mut headers);
    let mut response = Response::from_string(body).with_status_code(StatusCode(status));
    for h in headers {
        response = response.with_header(h);
    }
    let _ = req.respond(response);
}

fn is_path_param_segment(segment: &str) -> bool {
    segment.starts_with('{') && segment.ends_with('}') && segment.len() > 2
}

fn path_match_specificity(pattern_raw: &str, actual_raw: &str) -> Option<u8> {
    let pattern = normalize_path(pattern_raw);
    let actual = normalize_path(actual_raw);

    if pattern == actual {
        return Some(3);
    }

    // Prefix mode: "/api/v3/pet/" matches "/api/v3/pet/1", "/api/v3/pet/2", etc.
    if pattern.len() > 1 && pattern.ends_with('/') && actual.starts_with(&pattern) {
        return Some(1);
    }

    // Template mode: "/api/v3/pet/{petId}" matches "/api/v3/pet/1".
    let pattern_segments: Vec<&str> = pattern
        .trim_matches('/')
        .split('/')
        .filter(|x| !x.is_empty())
        .collect();
    let actual_segments: Vec<&str> = actual
        .trim_matches('/')
        .split('/')
        .filter(|x| !x.is_empty())
        .collect();

    if pattern_segments.len() != actual_segments.len() {
        return None;
    }

    let ok = pattern_segments
        .iter()
        .zip(actual_segments.iter())
        .all(|(p, a)| (*p == *a) || is_path_param_segment(p));

    if ok { Some(2) } else { None }
}

fn route_match_score(route: &LocalRoute, method: &str, path: &str) -> Option<(u8, u8, usize)> {
    if route.method != "*" && route.method != method {
        return None;
    }

    let path_specificity = path_match_specificity(&route.path, path)?;
    let method_specificity = if route.method == "*" { 0 } else { 1 };
    Some((method_specificity, path_specificity, route.path.len()))
}

fn to_route_item(route: &LocalRoute) -> MockerServerRouteItem {
    MockerServerRouteItem {
        method: route.method.clone(),
        path: route.path.clone(),
        status: route.status,
    }
}

fn append_log(logs: &mut Vec<String>, message: String) {
    let ts = format_log_time_utc();
    if logs.len() >= 400 {
        let drop_count = logs.len().saturating_sub(399);
        logs.drain(0..drop_count);
    }
    logs.push(format!("[{ts}] {message}"));
}

fn format_log_time_utc() -> String {
    let now_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    let total_seconds = now_ms / 1000;
    let ms = now_ms % 1000;
    let h = (total_seconds / 3600) % 24;
    let m = (total_seconds / 60) % 60;
    let s = total_seconds % 60;
    format!("{:02}:{:02}:{:02}.{:03}Z", h, m, s, ms)
}

fn match_kind(path_specificity: u8) -> &'static str {
    match path_specificity {
        3 => "exact",
        2 => "template",
        1 => "prefix",
        _ => "unknown",
    }
}

fn summarize_routes(routes: &[LocalRoute], limit: usize) -> String {
    if routes.is_empty() {
        return "none".to_string();
    }
    let mut parts: Vec<String> = routes
        .iter()
        .take(limit)
        .map(|r| format!("{} {}", r.method, r.path))
        .collect();
    if routes.len() > limit {
        parts.push(format!("+{} more", routes.len() - limit));
    }
    parts.join(", ")
}

fn run_local_mock_server(port: u16) -> Result<(), String> {
    let server = Server::http(("127.0.0.1", port)).map_err(|e| e.to_string())?;
    let mut routes = default_local_routes();
    let mut stop = false;
    let mut logs: Vec<String> = Vec::new();
    append_log(&mut logs, format!("server started on http://127.0.0.1:{port}"));

    while !stop {
        let mut req = match server.recv() {
            Ok(r) => r,
            Err(e) => return Err(e.to_string()),
        };

        let method = match req.method() {
            Method::Get => "GET",
            Method::Post => "POST",
            Method::Put => "PUT",
            Method::Patch => "PATCH",
            Method::Delete => "DELETE",
            Method::Head => "HEAD",
            Method::Options => "OPTIONS",
            Method::Connect => "CONNECT",
            Method::Trace => "TRACE",
            _ => "*",
        }
        .to_string();

        let req_url = req.url().to_string();
        let path_only = req_url.split('?').next().unwrap_or("/").to_string();

        if method == "OPTIONS" {
            send_response(req, 204, String::new(), Vec::new());
            continue;
        }

        if path_only == "/__health" {
            let body = serde_json::to_string(&ChildHealth {
                ok: true,
                routes_count: routes.len(),
            })
            .unwrap_or_else(|_| "{\"ok\":true,\"routesCount\":0}".to_string());
            let mut headers = Vec::new();
            push_header(&mut headers, "Content-Type", "application/json");
            send_response(req, 200, body, headers);
            continue;
        }

        if path_only == "/__stop" {
            stop = true;
            let mut headers = Vec::new();
            push_header(&mut headers, "Content-Type", "application/json");
            append_log(&mut logs, "server stopping".to_string());
            send_response(req, 200, "{\"stopping\":true}".to_string(), headers);
            continue;
        }

        if path_only == "/__control/route" && method == "POST" {
            let mut raw = String::new();
            let _ = req.as_reader().read_to_string(&mut raw);
            let parsed = serde_json::from_str::<MockerServerSetRouteArgs>(&raw);
            match parsed {
                Ok(args) => {
                    let method = normalize_method(&args.method);
                    let path = normalize_path(&args.path);
                    let status = args.status.clamp(100, 599);
                    let headers = args.headers.unwrap_or_default();
                    if let Some(existing) = routes
                        .iter_mut()
                        .find(|r| r.method == method && r.path == path)
                    {
                        existing.status = status;
                        existing.headers = headers;
                        existing.body = args.body;
                    } else {
                        routes.push(LocalRoute {
                            method: method.clone(),
                            path: path.clone(),
                            status,
                            headers,
                            body: args.body,
                        });
                    }
                    append_log(
                        &mut logs,
                        format!("route upserted: {} {} -> {}", method, path, status),
                    );
                    let mut headers = Vec::new();
                    push_header(&mut headers, "Content-Type", "application/json");
                    send_response(req, 200, "{\"ok\":true}".to_string(), headers);
                }
                Err(e) => {
                    append_log(
                        &mut logs,
                        format!("route upsert failed: {e}"),
                    );
                    let mut headers = Vec::new();
                    push_header(&mut headers, "Content-Type", "application/json");
                    send_response(
                        req,
                        400,
                        format!("{{\"error\":\"invalid route payload: {}\"}}", e),
                        headers,
                    );
                }
            }
            continue;
        }

        if path_only == "/__control/routes" && method == "GET" {
            let mut items: Vec<MockerServerRouteItem> = routes.iter().map(to_route_item).collect();
            items.sort_by(|a, b| a.path.cmp(&b.path).then(a.method.cmp(&b.method)));
            let body = serde_json::to_string(&ChildRoutesResponse { routes: items })
                .unwrap_or_else(|_| "{\"routes\":[]}".to_string());
            let mut headers = Vec::new();
            push_header(&mut headers, "Content-Type", "application/json");
            send_response(req, 200, body, headers);
            continue;
        }

        if path_only == "/__control/logs" && method == "GET" {
            let body = serde_json::to_string(&ChildLogsResponse {
                logs: logs.clone(),
            })
            .unwrap_or_else(|_| "{\"logs\":[]}".to_string());
            let mut headers = Vec::new();
            push_header(&mut headers, "Content-Type", "application/json");
            send_response(req, 200, body, headers);
            continue;
        }

        if path_only == "/__control/route" && method == "DELETE" {
            let mut raw = String::new();
            let _ = req.as_reader().read_to_string(&mut raw);
            let parsed = serde_json::from_str::<MockerServerDeleteRouteArgs>(&raw);
            match parsed {
                Ok(args) => {
                    let method = normalize_method(&args.method);
                    let path = normalize_path(&args.path);
                    let before = routes.len();
                    routes.retain(|r| !(r.method == method && r.path == path));
                    let deleted = before.saturating_sub(routes.len());
                    let mut headers = Vec::new();
                    push_header(&mut headers, "Content-Type", "application/json");
                    if deleted > 0 {
                        append_log(&mut logs, format!("route deleted: {} {}", method, path));
                        send_response(req, 200, format!("{{\"ok\":true,\"deleted\":{deleted}}}"), headers);
                    } else {
                        append_log(&mut logs, format!("route delete missed: {} {}", method, path));
                        send_response(req, 404, "{\"error\":\"route not found\"}".to_string(), headers);
                    }
                }
                Err(e) => {
                    append_log(
                        &mut logs,
                        format!("route delete failed: {e}"),
                    );
                    let mut headers = Vec::new();
                    push_header(&mut headers, "Content-Type", "application/json");
                    send_response(
                        req,
                        400,
                        format!("{{\"error\":\"invalid delete payload: {}\"}}", e),
                        headers,
                    );
                }
            }
            continue;
        }

        let found = routes
            .iter()
            .filter_map(|r| route_match_score(r, &method, &path_only).map(|score| (score, r)))
            .max_by_key(|(score, _)| *score)
            .map(|(score, route)| (score, route.clone()));

        match found {
            Some((score, route)) => {
                append_log(
                    &mut logs,
                    format!(
                        "{} {} -> {} (mock, match={}, route={} {})",
                        method,
                        path_only,
                        route.status,
                        match_kind(score.1),
                        route.method,
                        route.path
                    ),
                );
                append_log(
                    &mut logs,
                    format!("response bytes: {}", route.body.as_bytes().len()),
                );
                let mut headers = Vec::<Header>::new();
                for (k, v) in route.headers {
                    push_header(&mut headers, &k, &v);
                }
                push_header(&mut headers, "x-ruf-local-mock", "1");
                send_response(req, route.status, route.body, headers);
            }
            None => {
                append_log(
                    &mut logs,
                    format!(
                        "{} {} -> mock-miss (pass-through expected); routes={}",
                        method,
                        path_only,
                        summarize_routes(&routes, 4)
                    ),
                );
                let mut headers = Vec::new();
                push_header(&mut headers, "Content-Type", "application/json");
                push_header(&mut headers, "x-ruf-local-mock-miss", "1");
                send_response(
                    req,
                    404,
                    format!(
                        "{{\"error\":\"mock route not found\",\"method\":\"{}\",\"path\":\"{}\"}}",
                        method, path_only
                    ),
                    headers,
                );
            }
        }
    }

    Ok(())
}

fn http_local_request(port: u16, method: &str, path: &str, body: Option<&str>) -> Result<(u16, String), String> {
    let mut stream = TcpStream::connect(("127.0.0.1", port)).map_err(|e| e.to_string())?;
    stream
        .set_read_timeout(Some(Duration::from_millis(1000)))
        .map_err(|e| e.to_string())?;

    let payload = body.unwrap_or("");
    let mut request = format!(
        "{} {} HTTP/1.1\r\nHost: 127.0.0.1:{}\r\nConnection: close\r\n",
        method, path, port
    );

    if !payload.is_empty() {
        request.push_str("Content-Type: application/json\r\n");
    }
    request.push_str(&format!("Content-Length: {}\r\n\r\n{}", payload.as_bytes().len(), payload));

    stream.write_all(request.as_bytes()).map_err(|e| e.to_string())?;

    let mut out = Vec::<u8>::new();
    stream.read_to_end(&mut out).map_err(|e| e.to_string())?;
    let text = String::from_utf8_lossy(&out).to_string();

    let mut lines = text.split("\r\n");
    let status_line = lines.next().unwrap_or("HTTP/1.1 500");
    let status = status_line
        .split_whitespace()
        .nth(1)
        .and_then(|x| x.parse::<u16>().ok())
        .unwrap_or(500);

    let body_text = if let Some(idx) = text.find("\r\n\r\n") {
        text[idx + 4..].to_string()
    } else {
        String::new()
    };

    Ok((status, body_text))
}

#[cfg(windows)]
fn apply_hidden_window_std(cmd: &mut std::process::Command) {
    const CREATE_NO_WINDOW: u32 = 0x08000000;
    cmd.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
fn apply_hidden_window_std(_cmd: &mut std::process::Command) {}

fn cleanup_stale_runtime(state: &mut Option<MockServerRuntime>) {
    let mut remove = false;
    if let Some(runtime) = state.as_mut() {
        if let Ok(Some(_)) = runtime.child.try_wait() {
            remove = true;
        }
    }
    if remove {
        *state = None;
    }
}

fn cleanup_stale_runtimes(state: &mut Vec<MockServerRuntime>) {
    state.retain_mut(|runtime| !matches!(runtime.child.try_wait(), Ok(Some(_))));
}

fn refresh_runtime_routes_count(runtime: &mut MockServerRuntime) {
    if let Ok((status, body)) = http_local_request(runtime.port, "GET", "/__health", None) {
        if status == 200 {
            if let Ok(parsed) = serde_json::from_str::<ChildHealth>(&body) {
                runtime.routes_count = parsed.routes_count;
            }
        }
    }
}

fn runtime_status(runtime: &MockServerRuntime) -> MockerServerStatus {
    MockerServerStatus {
        running: true,
        port: runtime.port,
        base_url: format!("http://127.0.0.1:{}", runtime.port),
        routes_count: runtime.routes_count,
    }
}

fn shutdown_runtime(mut runtime: MockServerRuntime) {
    let _ = http_local_request(runtime.port, "GET", "/__stop", None);
    for _ in 0..20 {
        if let Ok(Some(_)) = runtime.child.try_wait() {
            break;
        }
        thread::sleep(Duration::from_millis(100));
    }
    if let Ok(None) = runtime.child.try_wait() {
        let _ = runtime.child.kill();
    }
    let _ = runtime.child.wait();
}

fn spawn_local_mock_runtime(port: u16) -> Result<MockServerRuntime, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let mut cmd = std::process::Command::new(exe);
    cmd.arg("--ruf-local-mock-server")
        .arg("--port")
        .arg(port.to_string())
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    apply_hidden_window_std(&mut cmd);

    let child = cmd.spawn().map_err(|e| e.to_string())?;

    let mut ready = false;
    for _ in 0..20 {
        if let Ok((status, _)) = http_local_request(port, "GET", "/__health", None) {
            if status == 200 {
                ready = true;
                break;
            }
        }
        thread::sleep(Duration::from_millis(100));
    }

    if !ready {
        let mut child = child;
        let _ = child.kill();
        let _ = child.wait();
        return Err("local mock server failed to start".to_string());
    }

    Ok(MockServerRuntime {
        child,
        port,
        routes_count: 0,
    })
}

pub fn shutdown_local_mock_server_runtime() -> Result<(), String> {
    let primary_runtime = {
        let mut guard = server_state()
            .lock()
            .map_err(|_| "server state lock failed".to_string())?;
        guard.take()
    };
    if let Some(runtime) = primary_runtime {
        shutdown_runtime(runtime);
    }

    let additional_runtimes = {
        let mut guard = additional_server_state()
            .lock()
            .map_err(|_| "additional server state lock failed".to_string())?;
        std::mem::take(&mut *guard)
    };
    for runtime in additional_runtimes {
        shutdown_runtime(runtime);
    }

    Ok(())
}

#[tauri::command]
pub fn mocker_server_additional_list() -> Result<Vec<MockerServerStatus>, String> {
    let mut guard = additional_server_state()
        .lock()
        .map_err(|_| "additional server state lock failed".to_string())?;
    cleanup_stale_runtimes(&mut guard);
    for runtime in guard.iter_mut() {
        refresh_runtime_routes_count(runtime);
    }
    let mut out: Vec<MockerServerStatus> = guard.iter().map(runtime_status).collect();
    out.sort_by_key(|x| x.port);
    Ok(out)
}

#[tauri::command]
pub fn mocker_server_status() -> Result<MockerServerStatus, String> {
    let mut guard = server_state()
        .lock()
        .map_err(|_| "server state lock failed".to_string())?;
    cleanup_stale_runtime(&mut guard);

    if let Some(runtime) = guard.as_mut() {
        refresh_runtime_routes_count(runtime);
        return Ok(runtime_status(runtime));
    }

    Ok(MockerServerStatus {
        running: false,
        port: 0,
        base_url: String::new(),
        routes_count: 0,
    })
}

#[tauri::command]
pub fn mocker_server_start(args: Option<MockerServerStartArgs>) -> Result<MockerServerStatus, String> {
    let port = args.and_then(|x| x.port).unwrap_or(7777).clamp(1024, 65535);

    let mut guard = server_state()
        .lock()
        .map_err(|_| "server state lock failed".to_string())?;
    cleanup_stale_runtime(&mut guard);

    if let Some(runtime) = guard.as_mut() {
        refresh_runtime_routes_count(runtime);
        return Ok(runtime_status(runtime));
    }

    {
        let mut additional_guard = additional_server_state()
            .lock()
            .map_err(|_| "additional server state lock failed".to_string())?;
        cleanup_stale_runtimes(&mut additional_guard);
        if additional_guard.iter().any(|x| x.port == port) {
            return Err(format!("port {port} is already used by an additional mock server"));
        }
    }

    let runtime = spawn_local_mock_runtime(port)?;
    *guard = Some(runtime);

    if let Some(runtime) = guard.as_ref() {
        Ok(runtime_status(runtime))
    } else {
        Err("local mock server failed to initialize state".to_string())
    }
}

#[tauri::command]
pub fn mocker_server_additional_start(
    args: Option<MockerServerStartArgs>,
) -> Result<MockerServerStatus, String> {
    let port = args.and_then(|x| x.port).unwrap_or(7778).clamp(1024, 65535);

    {
        let mut primary_guard = server_state()
            .lock()
            .map_err(|_| "server state lock failed".to_string())?;
        cleanup_stale_runtime(&mut primary_guard);
        if let Some(runtime) = primary_guard.as_ref() {
            if runtime.port == port {
                return Err(format!("port {port} is already used by the primary mock server"));
            }
        }
    }

    let mut additional_guard = additional_server_state()
        .lock()
        .map_err(|_| "additional server state lock failed".to_string())?;
    cleanup_stale_runtimes(&mut additional_guard);

    if additional_guard.iter().any(|x| x.port == port) {
        return Err(format!("additional mock server on port {port} already exists"));
    }

    let runtime = spawn_local_mock_runtime(port)?;
    additional_guard.push(runtime);
    additional_guard.sort_by_key(|x| x.port);

    if let Some(runtime) = additional_guard.iter().find(|x| x.port == port) {
        Ok(runtime_status(runtime))
    } else {
        Err("failed to store additional mock server runtime".to_string())
    }
}

#[tauri::command]
pub fn mocker_server_stop() -> Result<MockerServerStatus, String> {
    let mut guard = server_state()
        .lock()
        .map_err(|_| "server state lock failed".to_string())?;
    cleanup_stale_runtime(&mut guard);
    if let Some(runtime) = guard.take() {
        drop(guard);
        shutdown_runtime(runtime);
    }

    Ok(MockerServerStatus {
        running: false,
        port: 0,
        base_url: String::new(),
        routes_count: 0,
    })
}

#[tauri::command]
pub fn mocker_server_additional_stop(
    args: MockerServerPortArgs,
) -> Result<Vec<MockerServerStatus>, String> {
    let mut additional_guard = additional_server_state()
        .lock()
        .map_err(|_| "additional server state lock failed".to_string())?;
    cleanup_stale_runtimes(&mut additional_guard);

    let idx = additional_guard
        .iter()
        .position(|x| x.port == args.port)
        .ok_or_else(|| format!("additional mock server on port {} is not running", args.port))?;
    let runtime = additional_guard.remove(idx);
    drop(additional_guard);
    shutdown_runtime(runtime);

    mocker_server_additional_list()
}

#[tauri::command]
pub fn mocker_server_set_route(args: MockerServerSetRouteArgs) -> Result<MockerServerStatus, String> {
    let target_port = args.port.unwrap_or(7777);
    let payload = serde_json::to_string(&args).map_err(|e| e.to_string())?;

    {
        let mut guard = server_state()
            .lock()
            .map_err(|_| "server state lock failed".to_string())?;
        cleanup_stale_runtime(&mut guard);
        if let Some(runtime) = guard.as_mut() {
            if runtime.port == target_port {
                let (status, _body) = http_local_request(runtime.port, "POST", "/__control/route", Some(&payload))?;
                if status != 200 {
                    return Err(format!("failed to publish route, status {status}"));
                }
                refresh_runtime_routes_count(runtime);
                return Ok(runtime_status(runtime));
            }
        }
    }

    {
        let mut additional_guard = additional_server_state()
            .lock()
            .map_err(|_| "additional server state lock failed".to_string())?;
        cleanup_stale_runtimes(&mut additional_guard);
        if let Some(runtime) = additional_guard.iter_mut().find(|x| x.port == target_port) {
            let (status, _body) = http_local_request(runtime.port, "POST", "/__control/route", Some(&payload))?;
            if status != 200 {
                return Err(format!("failed to publish route, status {status}"));
            }
            refresh_runtime_routes_count(runtime);
            return Ok(runtime_status(runtime));
        }
    }

    Err(format!("local mock server on port {target_port} is not running"))
}

#[tauri::command]
pub fn mocker_server_list_routes() -> Result<Vec<MockerServerRouteItem>, String> {
    let mut guard = server_state()
        .lock()
        .map_err(|_| "server state lock failed".to_string())?;
    cleanup_stale_runtime(&mut guard);

    let runtime = guard
        .as_mut()
        .ok_or_else(|| "local mock server is not running".to_string())?;

    let (status, body) = http_local_request(runtime.port, "GET", "/__control/routes", None)?;
    if status != 200 {
        return Err(format!("failed to fetch routes, status {status}"));
    }

    let parsed = serde_json::from_str::<ChildRoutesResponse>(&body)
        .map_err(|e| format!("failed to parse routes response: {e}"))?;
    runtime.routes_count = parsed.routes.len();
    Ok(parsed.routes)
}

#[tauri::command]
pub fn mocker_server_delete_route(args: MockerServerDeleteRouteArgs) -> Result<MockerServerStatus, String> {
    let mut guard = server_state()
        .lock()
        .map_err(|_| "server state lock failed".to_string())?;
    cleanup_stale_runtime(&mut guard);

    let runtime = guard
        .as_mut()
        .ok_or_else(|| "local mock server is not running".to_string())?;

    let payload = serde_json::to_string(&args).map_err(|e| e.to_string())?;
    let (status, body) = http_local_request(runtime.port, "DELETE", "/__control/route", Some(&payload))?;
    if status != 200 {
        return Err(format!(
            "failed to delete route, status {status}: {}",
            body.trim()
        ));
    }

    refresh_runtime_routes_count(runtime);

    {
        let mut additional_guard = additional_server_state()
            .lock()
            .map_err(|_| "additional server state lock failed".to_string())?;
        cleanup_stale_runtimes(&mut additional_guard);
        let payload = serde_json::to_string(&args).map_err(|e| e.to_string())?;
        for additional_runtime in additional_guard.iter_mut() {
            if let Ok((additional_status, _)) = http_local_request(
                additional_runtime.port,
                "DELETE",
                "/__control/route",
                Some(&payload),
            ) {
                if additional_status == 200 || additional_status == 404 {
                    refresh_runtime_routes_count(additional_runtime);
                }
            }
        }
    }

    Ok(runtime_status(runtime))
}

#[tauri::command]
pub fn mocker_server_logs() -> Result<Vec<String>, String> {
    let mut guard = server_state()
        .lock()
        .map_err(|_| "server state lock failed".to_string())?;
    cleanup_stale_runtime(&mut guard);

    let runtime = guard
        .as_mut()
        .ok_or_else(|| "local mock server is not running".to_string())?;

    let (status, body) = http_local_request(runtime.port, "GET", "/__control/logs", None)?;
    if status != 200 {
        return Err(format!("failed to fetch logs, status {status}"));
    }

    let parsed = serde_json::from_str::<ChildLogsResponse>(&body)
        .map_err(|e| format!("failed to parse logs response: {e}"))?;
    Ok(parsed.logs)
}

pub fn run_local_mock_server_process_from_args(args: &[String]) -> Result<bool, String> {
    let has_flag = args.iter().any(|a| a == "--ruf-local-mock-server");
    if !has_flag {
        return Ok(false);
    }

    let mut port: u16 = 7777;
    let mut i = 0usize;
    while i < args.len() {
        if args[i] == "--port" {
            if let Some(next) = args.get(i + 1) {
                if let Ok(parsed) = next.parse::<u16>() {
                    port = parsed.clamp(1024, 65535);
                }
            }
            i += 1;
        }
        i += 1;
    }

    run_local_mock_server(port)?;
    Ok(true)
}

#[tauri::command]
pub async fn mocker_run_java(args: MockerRunJavaArgs) -> Result<MockerRunJavaResult, String> {
    let timeout_ms = clamp_timeout_ms(args.timeout_ms);
    let temp_dir = new_temp_dir()?;
    let java_path = temp_dir.join("MockRunner.java");

    let cleanup = |path: &PathBuf| {
        let _ = std::fs::remove_dir_all(path);
    };

    std::fs::write(&java_path, build_java_source(&args.source_code))
        .map_err(|e| format!("Failed to write Java source: {e}"))?;

    let mut compile = TokioCommand::new("javac");
    compile
        .arg("-encoding")
        .arg("UTF-8")
        .arg("MockRunner.java")
        .current_dir(&temp_dir);
    apply_hidden_window_tokio(&mut compile);

    let compile_out = match run_with_timeout(&mut compile, timeout_ms).await {
        Ok(out) => out,
        Err(err) => {
            cleanup(&temp_dir);
            return Err(err);
        }
    };

    let compile_status = compile_out.status.code().unwrap_or(-1);
    let compile_stdout = String::from_utf8_lossy(&compile_out.stdout).to_string();
    let compile_stderr = String::from_utf8_lossy(&compile_out.stderr).to_string();

    if !compile_out.status.success() {
        cleanup(&temp_dir);
        return Ok(MockerRunJavaResult {
            stdout: String::new(),
            stderr: String::new(),
            status: -1,
            compile_stdout,
            compile_stderr,
            compile_status,
        });
    }

    let input_base64 = base64::engine::general_purpose::STANDARD.encode(args.input_json.as_bytes());
    let mut run = TokioCommand::new("java");
    run.arg("-cp")
        .arg(&temp_dir)
        .arg("MockRunner")
        .arg(input_base64)
        .current_dir(&temp_dir);
    apply_hidden_window_tokio(&mut run);

    let run_out = match run_with_timeout(&mut run, timeout_ms).await {
        Ok(out) => out,
        Err(err) => {
            cleanup(&temp_dir);
            return Err(err);
        }
    };

    let status = run_out.status.code().unwrap_or(-1);
    let stdout = String::from_utf8_lossy(&run_out.stdout).to_string();
    let stderr = String::from_utf8_lossy(&run_out.stderr).to_string();

    cleanup(&temp_dir);

    Ok(MockerRunJavaResult {
        stdout,
        stderr,
        status,
        compile_stdout,
        compile_stderr,
        compile_status,
    })
}

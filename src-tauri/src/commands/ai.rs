use serde::{Deserialize, Serialize};
use std::env;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::io::AsyncWriteExt;
use tokio::process::Command as TokioCommand;
use tokio::time::timeout;

#[derive(Debug, Deserialize)]
pub struct AiLocalCliExecArgs {
    pub command: String,
    pub args: Vec<String>,
    pub prompt: String,
    pub timeout_ms: Option<u64>,
    pub cwd: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct AiLocalCliExecResult {
    pub stdout: String,
    pub stderr: String,
    pub status: i32,
}

#[cfg(windows)]
fn home_dir_guess() -> Option<PathBuf> {
    if let Ok(p) = std::env::var("USERPROFILE") {
        let trimmed = p.trim();
        if !trimmed.is_empty() {
            return Some(PathBuf::from(trimmed));
        }
    }
    None
}

#[cfg(not(windows))]
fn home_dir_guess() -> Option<PathBuf> {
    if let Ok(p) = std::env::var("HOME") {
        let trimmed = p.trim();
        if !trimmed.is_empty() {
            return Some(PathBuf::from(trimmed));
        }
    }
    None
}

fn expand_home_path(raw: &str) -> PathBuf {
    let trimmed = raw.trim();
    if trimmed == "~" {
        return home_dir_guess().unwrap_or_else(|| PathBuf::from(trimmed));
    }
    if let Some(rest) = trimmed
        .strip_prefix("~/")
        .or_else(|| trimmed.strip_prefix("~\\"))
    {
        if let Some(home) = home_dir_guess() {
            return home.join(rest);
        }
    }
    PathBuf::from(trimmed)
}

fn current_dir_from_args(cwd: Option<String>) -> Result<Option<PathBuf>, String> {
    let Some(cwd) = cwd else {
        return Ok(None);
    };
    let trimmed = cwd.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }
    let dir = expand_home_path(trimmed);
    if dir.exists() {
        return Ok(Some(dir));
    }
    Err("cwd does not exist".to_string())
}

fn make_prompt_file_path() -> PathBuf {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or(Duration::from_secs(0))
        .as_nanos();
    std::env::temp_dir().join(format!(
        "ruf-ai-prompt-{}-{stamp}.txt",
        std::process::id()
    ))
}

fn replace_prompt_placeholders(value: &str, prompt: &str, prompt_file: Option<&Path>) -> String {
    let with_prompt = value.replace("{{prompt}}", prompt);
    if let Some(path) = prompt_file {
        return with_prompt.replace("{{promptFile}}", &path.to_string_lossy());
    }
    with_prompt
}

#[cfg(windows)]
fn windows_command_extensions() -> [&'static str; 4] {
    [".exe", ".cmd", ".bat", ".com"]
}

#[cfg(not(windows))]
fn is_windows_shell_script(_path: &Path) -> bool {
    false
}

#[cfg(windows)]
fn is_windows_shell_script(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| {
            let lowered = ext.to_ascii_lowercase();
            lowered == "cmd" || lowered == "bat"
        })
        .unwrap_or(false)
}

fn existing_file(path: &Path) -> bool {
    std::fs::metadata(path)
        .map(|meta| meta.is_file())
        .unwrap_or(false)
}

#[cfg(windows)]
fn expand_windows_command_candidates(path: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    out.push(path.to_path_buf());
    if path.extension().is_none() {
        for ext in windows_command_extensions() {
            let mut candidate = path.to_path_buf();
            candidate.set_extension(ext.trim_start_matches('.'));
            out.push(candidate);
        }
    }
    out
}

#[cfg(not(windows))]
fn expand_windows_command_candidates(path: &Path) -> Vec<PathBuf> {
    vec![path.to_path_buf()]
}

fn resolve_local_cli_command(command: &str) -> Option<PathBuf> {
    let trimmed = command.trim();
    if trimmed.is_empty() {
        return None;
    }

    let direct = expand_home_path(trimmed);
    if direct.components().count() > 1 || direct.is_absolute() {
        return expand_windows_command_candidates(&direct)
            .into_iter()
            .find(|candidate| existing_file(candidate));
    }

    let mut candidates = Vec::new();
    #[cfg(windows)]
    if let Some(home) = env::var_os("USERPROFILE") {
        candidates.push(PathBuf::from(&home).join(".gigacode").join("bin").join(trimmed));
    }
    #[cfg(not(windows))]
    if let Some(home) = env::var_os("HOME") {
        candidates.push(PathBuf::from(&home).join(".gigacode").join("bin").join(trimmed));
        candidates.push(PathBuf::from(&home).join(".local").join("bin").join(trimmed));
    }

    if let Some(path_var) = env::var_os("PATH") {
        candidates.extend(env::split_paths(&path_var).map(|dir| dir.join(trimmed)));
    }

    candidates
        .into_iter()
        .flat_map(|candidate| expand_windows_command_candidates(&candidate))
        .find(|candidate| existing_file(candidate))
}

#[tauri::command]
pub async fn ai_local_cli_exec(args: AiLocalCliExecArgs) -> Result<AiLocalCliExecResult, String> {
    let command = args.command.trim();
    if command.is_empty() {
        return Err("Local CLI command is empty.".to_string());
    }

    let current_dir = current_dir_from_args(args.cwd)?;
    let timeout_ms = args.timeout_ms.unwrap_or(120_000).clamp(1_000, 300_000);
    let resolved_command = resolve_local_cli_command(command)
        .unwrap_or_else(|| expand_home_path(command));
    let uses_prompt_file = args.args.iter().any(|arg| arg.contains("{{promptFile}}"));
    let uses_prompt_arg = args.args.iter().any(|arg| arg.contains("{{prompt}}"));

    let prompt_file_path = if uses_prompt_file {
        let path = make_prompt_file_path();
        tokio::fs::write(&path, args.prompt.as_bytes())
            .await
            .map_err(|e| format!("Failed to write prompt file: {e}"))?;
        Some(path)
    } else {
        None
    };

    let resolved_args = args
        .args
        .iter()
        .map(|arg| replace_prompt_placeholders(arg, &args.prompt, prompt_file_path.as_deref()))
        .collect::<Vec<_>>();

    let mut proc = if is_windows_shell_script(&resolved_command) {
        let mut cmd = TokioCommand::new("cmd.exe");
        cmd.arg("/C").arg(&resolved_command).args(&resolved_args);
        cmd
    } else {
        let mut cmd = TokioCommand::new(&resolved_command);
        cmd.args(&resolved_args);
        cmd
    };
    if let Some(dir) = current_dir {
        proc.current_dir(dir);
    }
    proc.stdout(std::process::Stdio::piped());
    proc.stderr(std::process::Stdio::piped());
    if uses_prompt_file || uses_prompt_arg {
        proc.stdin(std::process::Stdio::null());
    } else {
        proc.stdin(std::process::Stdio::piped());
    }

    let mut child = proc.spawn().map_err(|e| format!("Failed to start local CLI: {e}"))?;

    if !uses_prompt_file && !uses_prompt_arg {
        let Some(mut stdin) = child.stdin.take() else {
            let _ = prompt_file_path
                .as_ref()
                .map(|path| std::fs::remove_file(path));
            return Err("Failed to open local CLI stdin.".to_string());
        };
        stdin
            .write_all(args.prompt.as_bytes())
            .await
            .map_err(|e| format!("Failed to write local CLI prompt: {e}"))?;
        let _ = stdin.shutdown().await;
    }

    let output = match timeout(Duration::from_millis(timeout_ms), child.wait_with_output()).await {
        Ok(result) => result.map_err(|e| format!("Failed to read local CLI output: {e}"))?,
        Err(_) => {
            let _ = prompt_file_path
                .as_ref()
                .map(|path| std::fs::remove_file(path));
            return Err("Local CLI timeout.".to_string());
        }
    };

    if let Some(path) = prompt_file_path.as_ref() {
        let _ = std::fs::remove_file(path);
    }

    Ok(AiLocalCliExecResult {
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        status: output.status.code().unwrap_or(-1),
    })
}

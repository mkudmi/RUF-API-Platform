use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::Command as StdCommand;
use std::time::Duration;
use tokio::time::timeout;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[derive(Debug, Deserialize)]
pub struct TerminalExecArgs {
    pub command: String,
    pub cwd: Option<String>,
    #[serde(rename = "shellId")]
    pub shell_id: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct TerminalResolveCwdArgs {
    pub cwd: Option<String>,
    pub target: String,
}

#[derive(Debug, Serialize)]
pub struct TerminalExecResult {
    pub stdout: String,
    pub stderr: String,
    pub status: i32,
}

#[derive(Debug, Serialize)]
pub struct TerminalShellInfo {
    pub id: String,
    pub label: String,
    pub available: bool,
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
    None
}

fn resolve_dir(cwd: Option<String>, target: String) -> Result<PathBuf, String> {
    let base = if let Some(cwd) = cwd {
        let t = cwd.trim();
        if t.is_empty() {
            std::env::current_dir().map_err(|e| e.to_string())?
        } else {
            PathBuf::from(t)
        }
    } else {
        std::env::current_dir().map_err(|e| e.to_string())?
    };

    let raw = target.trim();
    let out = if raw.is_empty() || raw == "~" {
        home_dir_guess().unwrap_or(base)
    } else if let Some(rest) = raw.strip_prefix("~/").or_else(|| raw.strip_prefix("~\\")) {
        let home = home_dir_guess().unwrap_or(base.clone());
        home.join(rest)
    } else {
        let p = Path::new(raw);
        if p.is_absolute() {
            p.to_path_buf()
        } else {
            base.join(p)
        }
    };

    let canon = std::fs::canonicalize(&out).map_err(|e| format!("Invalid directory: {e}"))?;
    let meta = std::fs::metadata(&canon).map_err(|e| format!("Invalid directory: {e}"))?;
    if !meta.is_dir() {
        return Err("Not a directory".to_string());
    }
    Ok(canon)
}

#[cfg(windows)]
fn has_on_path(exe: &str) -> bool {
    const CREATE_NO_WINDOW: u32 = 0x08000000;
    StdCommand::new("where")
        .creation_flags(CREATE_NO_WINDOW)
        .arg(exe)
        .output()
        .map(|o| o.status.success() && !o.stdout.is_empty())
        .unwrap_or(false)
}

#[cfg(windows)]
fn parse_where_first_path(exe: &str) -> Option<PathBuf> {
    const CREATE_NO_WINDOW: u32 = 0x08000000;
    let out = StdCommand::new("where")
        .creation_flags(CREATE_NO_WINDOW)
        .arg(exe)
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&out.stdout);
    let first = text.lines().next()?.trim();
    if first.is_empty() {
        return None;
    }
    Some(PathBuf::from(first))
}

#[cfg(windows)]
fn existing_file(path: &Path) -> bool {
    std::fs::metadata(path)
        .map(|m| m.is_file())
        .unwrap_or(false)
}

#[cfg(windows)]
fn find_git_bash() -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();

    if let Some(git_exe) = parse_where_first_path("git.exe") {
        // Usually ...\Git\cmd\git.exe or ...\Git\bin\git.exe
        if let Some(parent) = git_exe.parent() {
            if let Some(root) = parent.parent() {
                candidates.push(root.join("bin").join("bash.exe"));
                candidates.push(root.join("usr").join("bin").join("bash.exe"));
            }
        }
    }

    for var in ["ProgramFiles", "ProgramFiles(x86)", "LocalAppData"] {
        if let Ok(v) = std::env::var(var) {
            let base = PathBuf::from(v.trim());
            if base.as_os_str().is_empty() {
                continue;
            }
            candidates.push(base.join("Git").join("bin").join("bash.exe"));
            candidates.push(base.join("Git").join("usr").join("bin").join("bash.exe"));
            candidates.push(
                base.join("Programs")
                    .join("Git")
                    .join("bin")
                    .join("bash.exe"),
            );
            candidates.push(
                base.join("Programs")
                    .join("Git")
                    .join("usr")
                    .join("bin")
                    .join("bash.exe"),
            );
        }
    }

    for p in candidates {
        if existing_file(&p) {
            return Some(p);
        }
    }

    if has_on_path("bash.exe") {
        parse_where_first_path("bash.exe")
    } else {
        None
    }
}

#[tauri::command]
pub async fn terminal_list_shells() -> Vec<TerminalShellInfo> {
    #[cfg(windows)]
    {
        let mut out: Vec<TerminalShellInfo> = Vec::new();
        out.push(TerminalShellInfo {
            id: "powershell".to_string(),
            label: "PowerShell".to_string(),
            available: true,
        });
        out.push(TerminalShellInfo {
            id: "gitbash".to_string(),
            label: "Git Bash".to_string(),
            available: find_git_bash().is_some(),
        });
        out
    }

    #[cfg(not(windows))]
    {
        Vec::new()
    }
}

#[tauri::command]
pub async fn terminal_resolve_cwd(args: TerminalResolveCwdArgs) -> Result<String, String> {
    let path = resolve_dir(args.cwd, args.target)?;
    Ok(path.to_string_lossy().to_string())
}

#[cfg(windows)]
fn current_dir_from_args(cwd: Option<String>) -> Result<Option<PathBuf>, String> {
    if let Some(cwd) = cwd {
        let trimmed = cwd.trim();
        if trimmed.is_empty() {
            return Ok(None);
        }
        let dir = PathBuf::from(trimmed);
        if dir.exists() {
            return Ok(Some(dir));
        }
        return Err("cwd does not exist".to_string());
    }
    Ok(None)
}

#[cfg(windows)]
fn wrap_powershell_command(cmd: &str) -> String {
    format!(
        "[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new(); $OutputEncoding=[Console]::OutputEncoding; $global:LASTEXITCODE=0; try {{ Remove-Item Alias:curl -ErrorAction SilentlyContinue }} catch {{}}; try {{ if (Get-Command curl.exe -ErrorAction SilentlyContinue) {{ Set-Alias -Name curl -Value curl.exe -Scope Local -Force -ErrorAction SilentlyContinue }} }} catch {{}}; {}; if ($LASTEXITCODE -ne 0) {{ exit $LASTEXITCODE }} elseif (-not $?) {{ exit 1 }} else {{ exit 0 }}",
        cmd
    )
}

#[tauri::command]
pub async fn terminal_exec(args: TerminalExecArgs) -> Result<TerminalExecResult, String> {
    let cmd = args.command.trim();
    if cmd.is_empty() {
        return Ok(TerminalExecResult {
            stdout: "".to_string(),
            stderr: "".to_string(),
            status: 0,
        });
    }

    #[cfg(windows)]
    {
        let shell_id = args.shell_id.as_deref().unwrap_or("powershell");
        let current_dir = current_dir_from_args(args.cwd)?;

        let mut proc = match shell_id {
            "powershell" => {
                let mut p = tokio::process::Command::new("powershell.exe");
                p.arg("-NoProfile")
                    .arg("-NonInteractive")
                    .arg("-ExecutionPolicy")
                    .arg("Bypass")
                    .arg("-Command")
                    .arg(wrap_powershell_command(cmd));
                p
            }
            "gitbash" => {
                let bash = find_git_bash().ok_or_else(|| "Git Bash not found".to_string())?;
                let mut p = tokio::process::Command::new(bash);
                p.arg("-lc").arg(cmd);
                p
            }
            other => return Err(format!("unknown shellId: {other}")),
        };

        if let Some(dir) = current_dir {
            proc.current_dir(dir);
        }

        const CREATE_NO_WINDOW: u32 = 0x08000000;
        proc.creation_flags(CREATE_NO_WINDOW);

        let output = timeout(Duration::from_secs(120), proc.output())
            .await
            .map_err(|_| "command timeout".to_string())?
            .map_err(|e| e.to_string())?;

        let status = output.status.code().unwrap_or(-1);
        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();

        Ok(TerminalExecResult {
            stdout,
            stderr,
            status,
        })
    }

    #[cfg(not(windows))]
    {
        let _ = args;
        Err("terminal is only implemented for Windows".to_string())
    }
}

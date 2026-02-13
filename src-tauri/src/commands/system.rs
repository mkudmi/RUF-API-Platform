use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub struct SystemOpenUrlArgs {
    pub url: String,
}

#[tauri::command]
pub async fn system_open_url(args: SystemOpenUrlArgs) -> Result<(), String> {
    let url = args.url.trim();
    if url.is_empty() {
        return Err("empty url".to_string());
    }
    let lower = url.to_ascii_lowercase();
    if !(lower.starts_with("http://") || lower.starts_with("https://")) {
        return Err("only http/https urls are allowed".to_string());
    }

    #[cfg(target_os = "macos")]
    let status = std::process::Command::new("open")
        .arg(url)
        .status()
        .map_err(|e| e.to_string())?;

    #[cfg(target_os = "windows")]
    let status = std::process::Command::new("cmd")
        .args(["/C", "start", "", url])
        .status()
        .map_err(|e| e.to_string())?;

    #[cfg(all(unix, not(target_os = "macos")))]
    let status = std::process::Command::new("xdg-open")
        .arg(url)
        .status()
        .map_err(|e| e.to_string())?;

    if status.success() {
        Ok(())
    } else {
        Err(format!("failed to open url, status: {status}"))
    }
}

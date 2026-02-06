use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use tauri::Manager;

const STORAGE_SUBDIR: &str = "Ruf";
const STORAGE_DIR_NAME: &str = "state";
const STORAGE_FILE_NAME: &str = "localStorage.v1.json";
const STORAGE_BACKUP_FILE_NAME: &str = "localStorage.v1.backup.json";

#[derive(Debug, Serialize)]
pub struct StorageLoadResult {
    pub entries: HashMap<String, String>,
}

#[derive(Debug, Deserialize)]
pub struct StorageSaveArgs {
    pub entries: HashMap<String, String>,
}

fn resolve_storage_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    if let Ok(doc_dir) = app.path().document_dir() {
        return Ok(doc_dir.join(STORAGE_SUBDIR).join(STORAGE_DIR_NAME));
    }
    app.path()
        .app_data_dir()
        .map(|p| p.join(STORAGE_DIR_NAME))
        .map_err(|e| e.to_string())
}

fn resolve_storage_file(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(resolve_storage_dir(app)?.join(STORAGE_FILE_NAME))
}

fn resolve_backup_file(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(resolve_storage_dir(app)?.join(STORAGE_BACKUP_FILE_NAME))
}

fn parse_entries(raw: &str) -> HashMap<String, String> {
    let parsed = serde_json::from_str::<serde_json::Value>(raw).unwrap_or(serde_json::Value::Null);
    let Some(obj) = parsed.as_object() else {
        return HashMap::new();
    };

    let mut out = HashMap::<String, String>::new();
    for (k, v) in obj {
        if let Some(value) = v.as_str() {
            out.insert(k.to_string(), value.to_string());
        }
    }
    out
}

#[tauri::command]
pub fn storage_load(app: tauri::AppHandle) -> Result<StorageLoadResult, String> {
    let path = resolve_storage_file(&app)?;
    if !path.exists() {
        return Ok(StorageLoadResult {
            entries: HashMap::new(),
        });
    }
    let raw = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
    Ok(StorageLoadResult {
        entries: parse_entries(&raw),
    })
}

#[tauri::command]
pub fn storage_save(app: tauri::AppHandle, args: StorageSaveArgs) -> Result<(), String> {
    let dir = resolve_storage_dir(&app)?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let storage_file = resolve_storage_file(&app)?;
    let backup_file = resolve_backup_file(&app)?;
    let temp_file = storage_file.with_extension("json.tmp");

    if storage_file.exists() {
        let _ = std::fs::copy(&storage_file, &backup_file);
    }

    let raw = serde_json::to_string_pretty(&args.entries).map_err(|e| e.to_string())?;
    std::fs::write(&temp_file, raw).map_err(|e| e.to_string())?;
    std::fs::rename(&temp_file, &storage_file).map_err(|e| e.to_string())?;
    Ok(())
}

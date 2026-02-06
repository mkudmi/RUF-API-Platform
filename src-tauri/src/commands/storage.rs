use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::Write;
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

fn parse_entries(raw: &str) -> Result<HashMap<String, String>, String> {
    let parsed = serde_json::from_str::<serde_json::Value>(raw).map_err(|e| e.to_string())?;
    let Some(obj) = parsed.as_object() else {
        return Ok(HashMap::new());
    };

    let mut out = HashMap::<String, String>::new();
    for (k, v) in obj {
        if let Some(value) = v.as_str() {
            out.insert(k.to_string(), value.to_string());
        }
    }
    Ok(out)
}

fn load_from_path(path: &PathBuf) -> Result<HashMap<String, String>, String> {
    let raw = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
    parse_entries(&raw)
}

fn write_entries_atomic(path: &PathBuf, entries: &HashMap<String, String>) -> Result<(), String> {
    let temp_file = path.with_extension("json.tmp");
    let raw = serde_json::to_string_pretty(entries).map_err(|e| e.to_string())?;

    {
        let mut temp = std::fs::File::create(&temp_file).map_err(|e| e.to_string())?;
        temp.write_all(raw.as_bytes()).map_err(|e| e.to_string())?;
        temp.sync_all().map_err(|e| e.to_string())?;
    }

    if std::fs::rename(&temp_file, path).is_err() {
        if path.exists() {
            std::fs::remove_file(path).map_err(|e| e.to_string())?;
        }
        std::fs::rename(&temp_file, path).map_err(|e| e.to_string())?;
    }

    if let Some(dir) = path.parent() {
        if let Ok(dir_handle) = std::fs::File::open(dir) {
            let _ = dir_handle.sync_all();
        }
    }

    Ok(())
}

#[tauri::command]
pub fn storage_load(app: tauri::AppHandle) -> Result<StorageLoadResult, String> {
    let path = resolve_storage_file(&app)?;
    let backup_path = resolve_backup_file(&app)?;

    if !path.exists() && !backup_path.exists() {
        return Ok(StorageLoadResult {
            entries: HashMap::new(),
        });
    }

    match load_from_path(&path) {
        Ok(entries) => Ok(StorageLoadResult { entries }),
        Err(_) => {
            if backup_path.exists() {
                let entries = load_from_path(&backup_path)?;
                let _ = write_entries_atomic(&path, &entries);
                Ok(StorageLoadResult { entries })
            } else {
                Err("failed to load storage file and no backup found".to_string())
            }
        }
    }
}

#[tauri::command]
pub fn storage_save(app: tauri::AppHandle, args: StorageSaveArgs) -> Result<(), String> {
    let dir = resolve_storage_dir(&app)?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let storage_file = resolve_storage_file(&app)?;
    let backup_file = resolve_backup_file(&app)?;

    if storage_file.exists() {
        let current_raw = std::fs::read_to_string(&storage_file).unwrap_or_default();
        let current_entries = parse_entries(&current_raw).unwrap_or_default();
        if current_entries == args.entries {
            return Ok(());
        }
        let _ = std::fs::copy(&storage_file, &backup_file);
    }

    write_entries_atomic(&storage_file, &args.entries)?;
    Ok(())
}

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
#[cfg(target_os = "macos")]
use tauri::Manager;

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            #[cfg(desktop)]
            {
                let _ = app.handle().plugin(tauri_plugin_process::init());
                let _ = app
                    .handle()
                    .plugin(tauri_plugin_updater::Builder::new().build());
            }
            #[cfg(target_os = "macos")]
            {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.set_decorations(true);
                    let _ = window.set_title_bar_style(tauri::TitleBarStyle::Overlay);
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::db::db_test,
            commands::db::db_exec,
            commands::http::http_request,
            commands::cert::cert_inspect,
            commands::storage::storage_load,
            commands::storage::storage_save,
            commands::terminal::terminal_exec,
            commands::terminal::terminal_resolve_cwd,
            commands::terminal::terminal_list_shells,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

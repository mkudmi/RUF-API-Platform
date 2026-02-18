#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
#[cfg(target_os = "macos")]
use tauri::Manager;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    match commands::mocker::run_local_mock_server_process_from_args(&args) {
        Ok(true) => return,
        Ok(false) => {}
        Err(e) => {
            eprintln!("Failed to run local mock server process: {e}");
            std::process::exit(1);
        }
    }

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
            commands::mocker::mocker_run_java,
            commands::mocker::mocker_server_start,
            commands::mocker::mocker_server_stop,
            commands::mocker::mocker_server_status,
            commands::mocker::mocker_server_additional_list,
            commands::mocker::mocker_server_additional_start,
            commands::mocker::mocker_server_additional_stop,
            commands::mocker::mocker_server_set_route,
            commands::mocker::mocker_server_list_routes,
            commands::mocker::mocker_server_delete_route,
            commands::mocker::mocker_server_logs,
            commands::cert::cert_inspect,
            commands::storage::storage_load,
            commands::storage::storage_save,
            commands::system::system_open_url,
            commands::terminal::terminal_exec,
            commands::terminal::terminal_resolve_cwd,
            commands::terminal::terminal_list_shells,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app_handle, event| {
            if matches!(event, tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit) {
                let _ = commands::mocker::shutdown_local_mock_server_runtime();
            }
        });
}

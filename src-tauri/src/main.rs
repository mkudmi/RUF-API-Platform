#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;

fn main() {
  tauri::Builder::default()
    .setup(|app| {
      #[cfg(desktop)]
      {
        let _ = app.handle().plugin(tauri_plugin_process::init());
        let _ = app.handle().plugin(tauri_plugin_updater::Builder::new().build());
      }
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      commands::db::db_test,
      commands::db::db_exec,
      commands::http::http_request,
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}

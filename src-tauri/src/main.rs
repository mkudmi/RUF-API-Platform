#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;

fn main() {
  tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![
      commands::db::db_test,
      commands::db::db_exec,
      commands::http::http_request,
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}

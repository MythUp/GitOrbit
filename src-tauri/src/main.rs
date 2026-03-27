// Purpose: Bootstrap Tauri and register launcher commands available to the React frontend.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![commands::start_backend])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
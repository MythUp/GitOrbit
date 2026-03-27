// Purpose: Expose Tauri commands for controlling the local Go backend process.
use once_cell::sync::Lazy;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

static BACKEND_PROCESS: Lazy<Mutex<Option<Child>>> = Lazy::new(|| Mutex::new(None));

#[tauri::command]
pub fn start_backend() -> Result<(), String> {
    let mut guard = BACKEND_PROCESS
        .lock()
        .map_err(|_| "failed to acquire backend process lock".to_string())?;

    if let Some(child) = guard.as_mut() {
        if child.try_wait().map_err(|e| e.to_string())?.is_none() {
            return Ok(());
        }
    }

    let backend_dir = resolve_backend_dir()?;

    let child = Command::new("go")
        .arg("run")
        .arg("./cmd/server")
        .current_dir(backend_dir)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("failed to start backend: {}", e))?;

    *guard = Some(child);
    Ok(())
}

fn resolve_backend_dir() -> Result<PathBuf, String> {
    let src_tauri_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let candidate = src_tauri_dir.join("../backend");
    if candidate.exists() {
        return Ok(candidate);
    }

    let cwd = std::env::current_dir().map_err(|e| e.to_string())?;
    let fallback = cwd.join("backend");
    if fallback.exists() {
        return Ok(fallback);
    }

    Err("backend directory not found".to_string())
}
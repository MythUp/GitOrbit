// Purpose: Expose Tauri commands for controlling the local Go backend process.
use once_cell::sync::Lazy;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::thread;
use std::time::Duration;

static BACKEND_PROCESS: Lazy<Mutex<Option<Child>>> = Lazy::new(|| Mutex::new(None));

#[tauri::command]
pub fn start_backend() -> Result<(), String> {
    let mut guard = BACKEND_PROCESS
        .lock()
        .map_err(|_| "failed to acquire backend process lock".to_string())?;

    if let Some(child) = guard.as_mut() {
        if child.try_wait().map_err(|e| e.to_string())?.is_none() {
            child.kill().map_err(|e| format!("failed to stop backend process: {}", e))?;
            let _ = child.wait();
        }

        *guard = None;
    }

    let backend_dir = resolve_backend_dir()?;

    let backend_binary = build_backend_binary(&backend_dir)?;

    let mut child = Command::new(&backend_binary)
        .current_dir(&backend_dir)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("failed to start backend binary {}: {}", backend_binary.display(), e))?;

    thread::sleep(Duration::from_millis(400));
    if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
        return Err(format!(
            "backend exited immediately with status {}. Check if another process already uses port 3547.",
            status
        ));
    }

    *guard = Some(child);
    Ok(())
}

fn build_backend_binary(backend_dir: &PathBuf) -> Result<PathBuf, String> {
    let output_name = if cfg!(target_os = "windows") {
        "launcher-backend-dev.exe"
    } else {
        "launcher-backend-dev"
    };

    let output_path = backend_dir.join(output_name);

    let status = Command::new("go")
        .arg("build")
        .arg("-o")
        .arg(&output_path)
        .arg("./cmd/server")
        .current_dir(backend_dir)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map_err(|e| format!("failed to build backend binary: {}", e))?;

    if !status.success() {
        return Err(format!("go build failed with status {}", status));
    }

    Ok(output_path)
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
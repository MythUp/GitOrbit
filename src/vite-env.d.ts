// Purpose: Extend Vite typing support for the frontend build.
/// <reference types="vite/client" />

interface Window {
  __TAURI_IPC__?: unknown;
}
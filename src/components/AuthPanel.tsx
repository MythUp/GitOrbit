// Purpose: Handle GitHub login/logout through Device Flow and display account connection state.
import { useEffect, useRef, useState } from "react";
import { apiClient } from "../services/apiClient";

interface AuthPanelProps {
  onConnected: () => Promise<void>;
}

export default function AuthPanel({ onConnected }: AuthPanelProps) {
  const cachedConnected = apiClient.getCachedGithubAuthStatus() ?? false;
  const [deviceCode, setDeviceCode] = useState<string | null>(null);
  const [userCode, setUserCode] = useState<string | null>(null);
  const [verificationUri, setVerificationUri] = useState<string | null>(null);
  const [pollingEnabled, setPollingEnabled] = useState(false);
  const [deviceExpiresAt, setDeviceExpiresAt] = useState<number | null>(null);
  const [pollIntervalMs, setPollIntervalMs] = useState(5000);
  const [callbackPending, setCallbackPending] = useState(false);
  const [fallbackVisible, setFallbackVisible] = useState(false);
  const [manualToken, setManualToken] = useState("");
  const [connected, setConnected] = useState(cachedConnected);
  const [status, setStatus] = useState<string>(cachedConnected ? "Connected to GitHub." : "Not connected");
  const pollInProgressRef = useRef(false);
  const fallbackTimerRef = useRef<number | null>(null);

  function clearFallbackTimer(): void {
    if (fallbackTimerRef.current) {
      window.clearTimeout(fallbackTimerRef.current);
      fallbackTimerRef.current = null;
    }
  }

  function scheduleFallbackVisibility(): void {
    clearFallbackTimer();
    fallbackTimerRef.current = window.setTimeout(() => {
      setFallbackVisible(true);
    }, 15_000);
  }

  useEffect(() => {
    let cancelled = false;

    async function loadAuthStatus(): Promise<void> {
      try {
        const authStatus = await apiClient.getGithubAuthStatus();
        if (cancelled) {
          return;
        }

        setConnected(authStatus.connected);
        setStatus(authStatus.connected ? "Connected to GitHub." : "Not connected");
      } catch {
        // Keep cached connection state and message on transient failures.
      }
    }

    void loadAuthStatus();

    return () => {
      cancelled = true;
      clearFallbackTimer();
    };
  }, []);

  async function openVerificationUrl(url: string): Promise<void> {
    try {
      if (window.__TAURI_IPC__) {
        const shell = await import("@tauri-apps/api/shell");
        await shell.open(url);
        return;
      }
    } catch {
      // Fall back to browser open below.
    }

    window.open(url, "_blank", "noopener,noreferrer");
  }

  async function startLogin(): Promise<void> {
    setStatus("Starting device flow...");
    setFallbackVisible(false);
    setCallbackPending(false);
    clearFallbackTimer();

    try {
      const data = await apiClient.startGithubDeviceFlow();
      const openUri =
        data.verification_uri_complete ||
        `${data.verification_uri}?user_code=${encodeURIComponent(data.user_code)}`;
      setCallbackPending(false);
      setDeviceCode(data.device_code);
      setUserCode(data.user_code);
      setVerificationUri(openUri);
      setDeviceExpiresAt(Date.now() + data.expires_in * 1000);
      setPollIntervalMs(Math.max(1000, data.interval * 1000));
      setPollingEnabled(true);
      setStatus("Verification page opened. Waiting for approval...");
      scheduleFallbackVisibility();

      await openVerificationUrl(openUri);
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(data.user_code).catch(() => undefined);
      }
    } catch (err) {
      const message = (err instanceof Error ? err.message : "Failed to start login").toLowerCase();
      setPollingEnabled(false);
      setFallbackVisible(true);
      if (message.includes("device_flow_disabled")) {
        setStatus(
          "Device Flow is disabled for this GitHub OAuth App. Switching to browser callback login..."
        );
        await startCallbackLogin();
      } else {
        setStatus(err instanceof Error ? err.message : "Failed to start login");
      }
    }
  }

  async function startCallbackLogin(): Promise<void> {
    setStatus("Opening GitHub browser callback login...");
    setCallbackPending(true);

    try {
      const data = await apiClient.startGithubWebFlow();
      await openVerificationUrl(data.auth_url);
      setStatus("Complete login in browser. Waiting for callback confirmation...");
    } catch (err) {
      setCallbackPending(false);
      setStatus(err instanceof Error ? err.message : "Failed to start browser callback login");
    }
  }

  async function syncAuthStatusFromServer(): Promise<boolean> {
    try {
      const authStatus = await apiClient.getGithubAuthStatus();
      if (!authStatus.connected) {
        setConnected(false);
        return false;
      }

      setConnected(true);
      setPollingEnabled(false);
      setCallbackPending(false);
      clearFallbackTimer();
      setFallbackVisible(false);
      setDeviceCode(null);
      setUserCode(null);
      setVerificationUri(null);
      setDeviceExpiresAt(null);
      setStatus("Connected to GitHub.");
      await onConnected();
      return true;
    } catch {
      // Ignore transient status checks.
      return false;
    }
  }

  async function pollLogin(): Promise<void> {
    if (!deviceCode || pollInProgressRef.current) {
      return;
    }

    if (deviceExpiresAt && Date.now() > deviceExpiresAt) {
      setPollingEnabled(false);
      setStatus("Device login has expired. Start login again.");
      return;
    }

    pollInProgressRef.current = true;
    try {
      const token = await apiClient.pollGithubDeviceFlow(deviceCode);
      await apiClient.setGithubToken(token.access_token);
      await syncAuthStatusFromServer();
    } catch (err) {
      const message = (err instanceof Error ? err.message : "Authorization pending").toLowerCase();
      if (message.includes("slow_down") || message.includes("slow down")) {
        setPollIntervalMs((current) => Math.min(30000, Math.max(5000, current + 5000)));
        setStatus("GitHub asked to slow down polling. Retrying...");
        return;
      }

      if (message.includes("authorization_pending") || message.includes("pending")) {
        setStatus("Waiting for GitHub approval...");
        return;
      }

      setPollingEnabled(false);
      setStatus(err instanceof Error ? err.message : "Authorization failed");
    } finally {
      pollInProgressRef.current = false;
    }
  }

  useEffect(() => {
    if (!pollingEnabled || !deviceCode || connected) {
      return;
    }

    const firstTimeout = window.setTimeout(() => {
      void pollLogin();
    }, pollIntervalMs);

    const interval = window.setInterval(() => {
      void pollLogin();
    }, pollIntervalMs);

    return () => {
      window.clearTimeout(firstTimeout);
      window.clearInterval(interval);
    };
  }, [pollingEnabled, pollIntervalMs, deviceCode, connected, deviceExpiresAt]);

  useEffect(() => {
    if (!callbackPending || connected) {
      return;
    }

    const interval = window.setInterval(() => {
      void syncAuthStatusFromServer();
    }, 2000);

    return () => {
      window.clearInterval(interval);
    };
  }, [callbackPending, connected]);

  async function logout(): Promise<void> {
    await apiClient.setGithubToken("");
    setConnected(false);
    setPollingEnabled(false);
    setCallbackPending(false);
    clearFallbackTimer();
    setFallbackVisible(false);
    setDeviceExpiresAt(null);
    setDeviceCode(null);
    setUserCode(null);
    setVerificationUri(null);
    setStatus("Logged out.");
    await onConnected();
  }

  async function applyManualToken(): Promise<void> {
    if (!manualToken.trim()) {
      setStatus("Enter a Personal Access Token before submitting.");
      return;
    }

    try {
      await apiClient.setGithubToken(manualToken.trim());
      setManualToken("");
      setStatus("Validating token...");
      const ok = await syncAuthStatusFromServer();
      if (!ok) {
        setStatus("Token saved but GitHub validation failed. Check token scopes or try callback login.");
      }
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Invalid token");
    }
  }

  return (
    <section className="auth-panel">
      <div className="auth-avatar">AC</div>
      <div>
        <strong>{connected ? "GitHub Account" : "Account"}</strong>
        <p>{status}</p>
        {verificationUri && userCode && (
          <p>
            Open {verificationUri} and enter code: {userCode}
          </p>
        )}
      </div>
      {!connected ? (
        <div className="auth-actions">
          <button type="button" onClick={() => void startLogin()}>
            Login
          </button>
          {!fallbackVisible && deviceCode && (
            <small>Fallback options appear after 15 seconds if Device Flow does not complete.</small>
          )}
          {fallbackVisible && (
            <>
              <button type="button" className="btn-secondary" onClick={() => void startCallbackLogin()}>
                Login via Callback
              </button>
              <input
                type="password"
                value={manualToken}
                onChange={(event) => setManualToken(event.target.value)}
                placeholder="Personal Access Token"
                aria-label="Personal Access Token"
              />
              <button type="button" className="btn-secondary" onClick={() => void applyManualToken()}>
                Use Token
              </button>
            </>
          )}
        </div>
      ) : (
        <button type="button" onClick={() => void logout()}>
          Logout
        </button>
      )}
    </section>
  );
}
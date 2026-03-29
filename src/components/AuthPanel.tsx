// Purpose: Handle GitHub login/logout through Device Flow inside a compact account popup.
import { useEffect, useRef, useState } from "react";
import { apiClient } from "../services/apiClient";

interface AuthPanelProps {
  onConnected: () => Promise<void>;
  onClose: () => void;
}

export default function AuthPanel({ onConnected, onClose }: AuthPanelProps) {
  const cachedConnected = apiClient.getCachedGithubAuthStatus() ?? false;
  const [deviceCode, setDeviceCode] = useState<string | null>(null);
  const [userCode, setUserCode] = useState<string | null>(null);
  const [verificationUri, setVerificationUri] = useState<string | null>(null);
  const [pollingEnabled, setPollingEnabled] = useState(false);
  const [deviceExpiresAt, setDeviceExpiresAt] = useState<number | null>(null);
  const [pollIntervalMs, setPollIntervalMs] = useState(5000);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [callbackPending, setCallbackPending] = useState(false);
  const [manualToken, setManualToken] = useState("");
  const [connected, setConnected] = useState(cachedConnected);
  const [status, setStatus] = useState<string>(cachedConnected ? "Connected." : "Not connected.");
  const pollInProgressRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    async function loadAuthStatus(): Promise<void> {
      try {
        const authStatus = await apiClient.getGithubAuthStatus();
        if (cancelled) {
          return;
        }

        setConnected(authStatus.connected);
        setStatus(authStatus.connected ? "Connected." : "Not connected.");
      } catch {
        // Keep cached connection state and message on transient failures.
      }
    }

    void loadAuthStatus();

    return () => {
      cancelled = true;
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
    setStatus("Open GitHub and approve the request.");
    setShowAdvanced(false);
    setCallbackPending(false);

    try {
      const data = await apiClient.startGithubDeviceFlow();
      const openUri =
        data.verification_uri_complete ||
        `${data.verification_uri}?user_code=${encodeURIComponent(data.user_code)}`;
      setDeviceCode(data.device_code);
      setUserCode(data.user_code);
      setVerificationUri(openUri);
      setDeviceExpiresAt(Date.now() + data.expires_in * 1000);
      setPollIntervalMs(Math.max(1000, data.interval * 1000));
      setPollingEnabled(true);
      setStatus("Waiting for approval...");

      await openVerificationUrl(openUri);
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(data.user_code).catch(() => undefined);
      }
    } catch (err) {
      const message = (err instanceof Error ? err.message : "Failed to start login").toLowerCase();
      setPollingEnabled(false);
      if (message.includes("device_flow_disabled")) {
        setStatus("Device Flow is disabled for this OAuth app. Use advanced options.");
        setShowAdvanced(true);
      } else {
        setStatus(err instanceof Error ? err.message : "Failed to start login");
      }
    }
  }

  async function startCallbackLogin(): Promise<void> {
    setStatus("Complete browser callback login, waiting for confirmation...");
    setCallbackPending(true);

    try {
      const data = await apiClient.startGithubWebFlow();
      await openVerificationUrl(data.auth_url);
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
      setDeviceCode(null);
      setUserCode(null);
      setVerificationUri(null);
      setDeviceExpiresAt(null);
      setStatus("Connected.");
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
        return;
      }

      if (message.includes("authorization_pending") || message.includes("pending")) {
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

    let attempts = 0;
    const interval = window.setInterval(() => {
      attempts += 1;
      void syncAuthStatusFromServer();

      if (attempts < 60) {
        return;
      }

      setCallbackPending(false);
      setStatus("Callback still pending. Retry if needed.");
      window.clearInterval(interval);
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
    <section className="auth-panel-modern">
      <div className="account-top-row">
        <div className="account-header">
          <div className="auth-avatar">GH</div>
          <div>
            <h3>GitHub Account</h3>
            <p className={`account-status ${connected ? "connected" : "disconnected"}`}>{status}</p>
          </div>
        </div>
      </div>

      {!connected ? (
        <div className="account-actions-grid">
          <button type="button" className="btn-primary" onClick={() => void startLogin()}>
            Connect with Device Flow
          </button>

          {verificationUri && userCode && (
            <div className="account-code-card">
              <strong>Verification code: {userCode}</strong>
              <div className="account-inline-actions">
                <button type="button" className="btn-secondary" onClick={() => void openVerificationUrl(verificationUri)}>
                  Open GitHub page
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => {
                    if (navigator.clipboard?.writeText) {
                      void navigator.clipboard.writeText(userCode);
                    }
                  }}
                >
                  Copy code
                </button>
              </div>
            </div>
          )}

          <button type="button" className="btn-secondary" onClick={() => setShowAdvanced((current) => !current)}>
            {showAdvanced ? "Hide advanced options" : "Show advanced options"}
          </button>

          {showAdvanced && (
            <div className="account-advanced">
              <div className="account-inline-actions">
                <button type="button" className="btn-secondary" onClick={() => void startCallbackLogin()}>
                  Login via callback
                </button>
              </div>

              <div className="account-inline-actions">
                <input
                  type="password"
                  value={manualToken}
                  onChange={(event) => setManualToken(event.target.value)}
                  placeholder="Personal Access Token"
                  aria-label="Personal Access Token"
                />
                <button type="button" className="btn-secondary" onClick={() => void applyManualToken()}>
                  Use token
                </button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="account-inline-actions">
          <button type="button" onClick={() => void logout()}>
            Logout
          </button>
        </div>
      )}
    </section>
  );
}

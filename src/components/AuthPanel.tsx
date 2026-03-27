// Purpose: Handle GitHub login/logout through Device Flow and display account connection state.
import { useEffect, useRef, useState } from "react";
import { apiClient } from "../services/apiClient";

interface AuthPanelProps {
  onConnected: () => Promise<void>;
}

export default function AuthPanel({ onConnected }: AuthPanelProps) {
  const [deviceCode, setDeviceCode] = useState<string | null>(null);
  const [userCode, setUserCode] = useState<string | null>(null);
  const [verificationUri, setVerificationUri] = useState<string | null>(null);
  const [pollingEnabled, setPollingEnabled] = useState(false);
  const [deviceExpiresAt, setDeviceExpiresAt] = useState<number | null>(null);
  const [manualToken, setManualToken] = useState("");
  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState<string>("Not connected");
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
        setStatus(authStatus.connected ? "Connected to GitHub." : "Not connected");
      } catch {
        if (!cancelled) {
          setStatus("Not connected");
        }
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
    setStatus("Starting device flow...");
    try {
      const data = await apiClient.startGithubDeviceFlow();
      setDeviceCode(data.device_code);
      setUserCode(data.user_code);
      setVerificationUri(data.verification_uri);
      setDeviceExpiresAt(Date.now() + data.expires_in * 1000);
      setPollingEnabled(true);
      setStatus("Verification page opened. Waiting for approval...");

      await openVerificationUrl(data.verification_uri);
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(data.user_code).catch(() => undefined);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to start login";
      setPollingEnabled(false);
      if (message.includes("device_flow_disabled")) {
        setStatus(
          "Device Flow is disabled for this GitHub OAuth App. Enable Device Flow in GitHub OAuth settings, or use a Personal Access Token below."
        );
      } else {
        setStatus(message);
      }
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
      setConnected(true);
      setPollingEnabled(false);
      setDeviceCode(null);
      setUserCode(null);
      setVerificationUri(null);
      setDeviceExpiresAt(null);
      setStatus("Connected to GitHub.");
      await onConnected();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Authorization pending";
      if (message.includes("authorization_pending") || message.includes("pending") || message.includes("slow_down")) {
        setStatus("Waiting for GitHub approval...");
        return;
      }

      setPollingEnabled(false);
      setStatus(message);
    } finally {
      pollInProgressRef.current = false;
    }
  }

  useEffect(() => {
    if (!pollingEnabled || !deviceCode || connected) {
      return;
    }

    void pollLogin();
    const interval = window.setInterval(() => {
      void pollLogin();
    }, 2500);

    return () => {
      window.clearInterval(interval);
    };
  }, [pollingEnabled, deviceCode, connected, deviceExpiresAt]);

  async function logout(): Promise<void> {
    await apiClient.setGithubToken("");
    setConnected(false);
    setPollingEnabled(false);
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
      setConnected(true);
      setPollingEnabled(false);
      setDeviceExpiresAt(null);
      setDeviceCode(null);
      setUserCode(null);
      setVerificationUri(null);
      setManualToken("");
      setStatus("Connected using Personal Access Token.");
      await onConnected();
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
        </div>
      ) : (
        <button type="button" onClick={() => void logout()}>
          Logout
        </button>
      )}
    </section>
  );
}
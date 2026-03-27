// Purpose: Handle GitHub login/logout through Device Flow and display account connection state.
import { useState } from "react";
import { apiClient } from "../services/apiClient";

interface AuthPanelProps {
  onConnected: () => Promise<void>;
}

export default function AuthPanel({ onConnected }: AuthPanelProps) {
  const [deviceCode, setDeviceCode] = useState<string | null>(null);
  const [userCode, setUserCode] = useState<string | null>(null);
  const [verificationUri, setVerificationUri] = useState<string | null>(null);
  const [manualToken, setManualToken] = useState("");
  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState<string>("Not connected");

  async function startLogin(): Promise<void> {
    setStatus("Starting device flow...");
    try {
      const data = await apiClient.startGithubDeviceFlow();
      setDeviceCode(data.device_code);
      setUserCode(data.user_code);
      setVerificationUri(data.verification_uri);
      setStatus("Complete verification in browser, then click Check Login.");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to start login";
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
    if (!deviceCode) {
      return;
    }

    setStatus("Checking GitHub authorization...");
    try {
      const token = await apiClient.pollGithubDeviceFlow(deviceCode);
      await apiClient.setGithubToken(token.access_token);
      setConnected(true);
      setStatus("Connected to GitHub.");
      await onConnected();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Authorization pending");
    }
  }

  async function logout(): Promise<void> {
    await apiClient.setGithubToken("");
    setConnected(false);
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
          <button type="button" onClick={() => void pollLogin()} disabled={!deviceCode}>
            Check Login
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
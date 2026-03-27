// Purpose: Trigger FTP deployment requests from the desktop UI and surface deployment logs.
import { FormEvent, useState } from "react";
import { apiClient } from "../services/apiClient";
import { DeployResult, FTPDeployRequest } from "../types/models";

const EMPTY_DEPLOY_FORM: FTPDeployRequest = {
  local_path: "",
  remote_path: "/",
  host: "",
  port: 21,
  username: "",
  password: "",
  rollback_on_fail: true
};

export default function DeploymentPanel() {
  const [form, setForm] = useState<FTPDeployRequest>(EMPTY_DEPLOY_FORM);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DeployResult | null>(null);

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setRunning(true);
    setError(null);
    setResult(null);

    try {
      const response = await apiClient.deployFtp(form);
      setResult(response);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Deployment failed");
    } finally {
      setRunning(false);
    }
  }

  return (
    <section className="panel">
      <h2>FTP Deployment</h2>
      <p>Baseline deployment flow with upload/replace, local logs, and rollback on failure.</p>

      <form className="instance-form" onSubmit={handleSubmit}>
        <input
          value={form.local_path}
          onChange={(event) => setForm({ ...form, local_path: event.target.value })}
          placeholder="Local project path"
          required
        />
        <input
          value={form.remote_path}
          onChange={(event) => setForm({ ...form, remote_path: event.target.value })}
          placeholder="Remote path"
          required
        />
        <input
          value={form.host}
          onChange={(event) => setForm({ ...form, host: event.target.value })}
          placeholder="FTP host"
          required
        />
        <input
          type="number"
          value={form.port}
          onChange={(event) => setForm({ ...form, port: Number(event.target.value) })}
          placeholder="Port"
          required
        />
        <input
          value={form.username}
          onChange={(event) => setForm({ ...form, username: event.target.value })}
          placeholder="FTP username"
          required
        />
        <input
          type="password"
          value={form.password}
          onChange={(event) => setForm({ ...form, password: event.target.value })}
          placeholder="FTP password"
          required
        />
        <label>
          <input
            type="checkbox"
            checked={form.rollback_on_fail}
            onChange={(event) => setForm({ ...form, rollback_on_fail: event.target.checked })}
          />
          Rollback on fail
        </label>
        <button type="submit" disabled={running}>
          {running ? "Deploying..." : "Run Deploy"}
        </button>
      </form>

      {error && <p className="error-text">{error}</p>}

      {result && (
        <div className="deploy-result">
          <p>
            Uploaded: {result.uploaded} | Updated: {result.updated} | Deleted: {result.deleted}
          </p>
          <ul className="repo-list">
            {result.logs.map((logLine, index) => (
              <li key={`${logLine}-${index}`} className="instance-card">
                {logLine}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
// Purpose: Trigger FTP deployments by selected instance so credentials stay scoped per instance.
import { FormEvent, useState } from "react";
import { apiClient } from "../services/apiClient";
import { DeployResult, FTPDeployByInstanceRequest, InstanceRecord } from "../types/models";

interface DeploymentPanelProps {
  instances: InstanceRecord[];
}

const EMPTY_DEPLOY_FORM: FTPDeployByInstanceRequest = {
  instance_id: "",
  local_path: "",
  rollback_on_fail: true
};

export default function DeploymentPanel({ instances }: DeploymentPanelProps) {
  const [form, setForm] = useState<FTPDeployByInstanceRequest>(EMPTY_DEPLOY_FORM);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DeployResult | null>(null);

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setRunning(true);
    setError(null);
    setResult(null);

    try {
      const response = await apiClient.deployFtpByInstance(form);
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
      <p>Deploy using credentials from one selected instance.</p>

      <form className="instance-form" onSubmit={handleSubmit}>
        <select
          aria-label="Select instance"
          title="Select instance"
          value={form.instance_id}
          onChange={(event) => setForm({ ...form, instance_id: event.target.value })}
          required
        >
          <option value="">Select instance</option>
          {instances.map((instance) => (
            <option key={instance.id} value={instance.id}>
              {instance.name} ({instance.owner}/{instance.repo})
            </option>
          ))}
        </select>
        <input
          value={form.local_path}
          onChange={(event) => setForm({ ...form, local_path: event.target.value })}
          placeholder="Local project path"
          required
        />
        <label className="inline-check">
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

      <p>
        <strong>Local project path:</strong> absolute path on your computer that will be uploaded to FTP.
      </p>
      <p>
        <strong>Rollback on fail:</strong> restores overwritten files from backups if deployment fails mid-process.
      </p>

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
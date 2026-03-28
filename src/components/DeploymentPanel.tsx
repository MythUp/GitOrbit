// Purpose: Trigger FTP deployments by selected instance so credentials stay scoped per instance.
import { FormEvent, useState } from "react";
import { apiClient } from "../services/apiClient";
import {
  DeployResult,
  FTPDeployByInstanceRequest,
  InstanceRecord,
  SQLMigrationPlanResponse
} from "../types/models";

interface DeploymentPanelProps {
  instances: InstanceRecord[];
}

const EMPTY_DEPLOY_FORM: FTPDeployByInstanceRequest = {
  instance_id: "",
  git_ref: "",
  rollback_on_fail: true
};

export default function DeploymentPanel({ instances }: DeploymentPanelProps) {
  const [form, setForm] = useState<FTPDeployByInstanceRequest>(EMPTY_DEPLOY_FORM);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DeployResult | null>(null);
  const [sqlFromRef, setSqlFromRef] = useState("");
  const [sqlSchemaPath, setSqlSchemaPath] = useState("");
  const [planningSQL, setPlanningSQL] = useState(false);
  const [sqlError, setSqlError] = useState<string | null>(null);
  const [sqlPlan, setSqlPlan] = useState<SQLMigrationPlanResponse | null>(null);

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

  async function handlePlanSQL(event: FormEvent): Promise<void> {
    event.preventDefault();
    setPlanningSQL(true);
    setSqlError(null);
    setSqlPlan(null);

    try {
      if (!form.instance_id) {
        throw new Error("Select an instance first.");
      }

      if (!sqlFromRef.trim()) {
        throw new Error("Previous ref is required for SQL plan.");
      }

      if (!form.git_ref?.trim()) {
        throw new Error("Git ref target is required for SQL plan.");
      }

      const plan = await apiClient.planSQLMigration({
        instance_id: form.instance_id,
        from_ref: sqlFromRef.trim(),
        to_ref: form.git_ref.trim(),
        schema_path: sqlSchemaPath.trim() || undefined
      });

      setSqlPlan(plan);
    } catch (err) {
      setSqlError(err instanceof Error ? err.message : "SQL migration planning failed");
    } finally {
      setPlanningSQL(false);
    }
  }

  return (
    <section className="panel">
      <h2>FTP Deployment</h2>
      <p>Deploy from GitHub source archive using credentials from one selected instance.</p>

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
          value={form.git_ref || ""}
          onChange={(event) => setForm({ ...form, git_ref: event.target.value })}
          placeholder="Git ref (optional: branch, tag, commit)"
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
        <strong>Source:</strong> files are pulled from GitHub directly (default branch if Git ref is empty).
      </p>
      <p>
        <strong>Rollback on fail:</strong> restores overwritten files from backups if deployment fails mid-process.
      </p>
      <p>
        <strong>Ignore from manifest:</strong> patterns from manifest.json launcher.ignore are skipped during upload.
      </p>

      <form className="instance-form" onSubmit={handlePlanSQL}>
        <input
          value={sqlFromRef}
          onChange={(event) => setSqlFromRef(event.target.value)}
          placeholder="Previous ref for SQL diff (example: v1.2.0)"
          required
        />
        <input
          value={sqlSchemaPath}
          onChange={(event) => setSqlSchemaPath(event.target.value)}
          placeholder="Schema path (optional, fallback manifest.launcher.sql_schema_path)"
        />
        <button type="submit" className="btn-secondary" disabled={planningSQL}>
          {planningSQL ? "Analyzing SQL..." : "Plan SQL migration"}
        </button>
      </form>

      {sqlError && <p className="error-text">{sqlError}</p>}

      {sqlPlan && (
        <div className="deploy-result">
          <p>
            SQL plan from {sqlPlan.from_ref} to {sqlPlan.to_ref} ({sqlPlan.schema_path})
          </p>
          <p>
            Added tables: {sqlPlan.added_tables.length} | Removed tables: {sqlPlan.removed_tables.length} |
            Added columns: {sqlPlan.added_columns.length} | Removed columns: {sqlPlan.removed_columns.length} |
            Renames: {sqlPlan.renamed_columns.length}
          </p>
          {sqlPlan.alter_statements.length > 0 && (
            <ul className="repo-list">
              {sqlPlan.alter_statements.map((statement, index) => (
                <li key={`sql-alter-${index}`} className="instance-card">
                  {statement}
                </li>
              ))}
            </ul>
          )}
          {sqlPlan.warnings.length > 0 && (
            <ul className="repo-list">
              {sqlPlan.warnings.map((warning, index) => (
                <li key={`sql-warning-${index}`} className="instance-card">
                  {warning}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

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
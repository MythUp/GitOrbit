// Purpose: Manage project instances and collect deployment credentials in a structured form.
import { FormEvent, useState } from "react";
import { InstanceInput, InstanceRecord } from "../types/models";

interface InstanceManagerProps {
  instances: InstanceRecord[];
  onSaveInstance: (input: InstanceInput) => Promise<void>;
}

const EMPTY_FORM: InstanceInput = {
  name: "",
  owner: "",
  repo: "",
  ftpHost: "",
  ftpPort: 21,
  ftpUsername: "",
  ftpPassword: "",
  ftpRemotePath: "/"
};

export default function InstanceManager({ instances, onSaveInstance }: InstanceManagerProps) {
  const [form, setForm] = useState<InstanceInput>(EMPTY_FORM);
  const [status, setStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setSaving(true);
    setStatus(null);
    try {
      await onSaveInstance(form);
      setStatus("Instance saved successfully.");
      setForm(EMPTY_FORM);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Failed to save instance");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="panel">
      <h2>Instances</h2>
      <p>Create multiple deployment instances per repository with encrypted credentials.</p>

      <form className="instance-form" onSubmit={handleSubmit}>
        <input
          value={form.name}
          onChange={(event) => setForm({ ...form, name: event.target.value })}
          placeholder="Instance name"
          required
        />
        <input
          value={form.owner}
          onChange={(event) => setForm({ ...form, owner: event.target.value })}
          placeholder="GitHub owner"
          required
        />
        <input
          value={form.repo}
          onChange={(event) => setForm({ ...form, repo: event.target.value })}
          placeholder="Repository"
          required
        />
        <input
          value={form.ftpHost}
          onChange={(event) => setForm({ ...form, ftpHost: event.target.value })}
          placeholder="FTP host"
          required
        />
        <input
          type="number"
          value={form.ftpPort}
          onChange={(event) => setForm({ ...form, ftpPort: Number(event.target.value) })}
          placeholder="FTP port"
          required
        />
        <input
          value={form.ftpUsername}
          onChange={(event) => setForm({ ...form, ftpUsername: event.target.value })}
          placeholder="FTP username"
          required
        />
        <input
          type="password"
          value={form.ftpPassword}
          onChange={(event) => setForm({ ...form, ftpPassword: event.target.value })}
          placeholder="FTP password"
          required
        />
        <input
          value={form.ftpRemotePath}
          onChange={(event) => setForm({ ...form, ftpRemotePath: event.target.value })}
          placeholder="Remote path"
          required
        />
        <input
          value={form.sshHost || ""}
          onChange={(event) => setForm({ ...form, sshHost: event.target.value })}
          placeholder="SSH host (optional)"
        />
        <input
          type="number"
          value={form.sshPort || ""}
          onChange={(event) =>
            setForm({ ...form, sshPort: event.target.value ? Number(event.target.value) : undefined })
          }
          placeholder="SSH port (optional)"
        />
        <input
          value={form.sshUsername || ""}
          onChange={(event) => setForm({ ...form, sshUsername: event.target.value })}
          placeholder="SSH username (optional)"
        />
        <input
          type="password"
          value={form.sshPassword || ""}
          onChange={(event) => setForm({ ...form, sshPassword: event.target.value })}
          placeholder="SSH password (optional)"
        />
        <input
          value={form.sqlDsn || ""}
          onChange={(event) => setForm({ ...form, sqlDsn: event.target.value })}
          placeholder="SQL DSN (optional)"
        />
        <button type="submit" disabled={saving}>
          {saving ? "Saving..." : "Save Instance"}
        </button>
      </form>

      {status && <p>{status}</p>}

      <ul className="instance-list">
        {instances.map((instance) => (
          <li key={instance.id} className="instance-card">
            <strong>{instance.name}</strong>
            <p>
              {instance.owner}/{instance.repo}
            </p>
            <small>
              SSH: {instance.has_ssh ? "yes" : "no"} | SQL: {instance.has_sql ? "yes" : "no"}
            </small>
          </li>
        ))}
      </ul>
    </section>
  );
}
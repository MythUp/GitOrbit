// Purpose: Manage creation and modification of instances, including install-prefill from selected repositories.
import { FormEvent, useEffect, useState } from "react";
import { InstanceInput, InstanceRecord } from "../types/models";
import { useInstanceFtpVersions } from "../hooks/useInstanceFtpVersions";

interface InstanceManagerProps {
  instances: InstanceRecord[];
  onSaveInstance: (input: InstanceInput) => Promise<void>;
  onUpdateInstance: (id: string, input: InstanceInput) => Promise<void>;
  onLoadInstance: (id: string) => Promise<InstanceInput>;
  installDraft: { owner: string; repo: string } | null;
  editRequest?: { id: string; nonce: number } | null;
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

export default function InstanceManager({
  instances,
  onSaveInstance,
  onUpdateInstance,
  onLoadInstance,
  installDraft,
  editRequest
}: InstanceManagerProps) {
  const ftpVersions = useInstanceFtpVersions(instances);
  const [form, setForm] = useState<InstanceInput>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loadingDetails, setLoadingDetails] = useState(false);

  useEffect(() => {
    if (!installDraft || editingId) {
      return;
    }

    setForm((current) => ({
      ...current,
      owner: installDraft.owner,
      repo: installDraft.repo,
      name: current.name || `${installDraft.repo}-instance`
    }));
  }, [installDraft, editingId]);

  useEffect(() => {
    if (!editRequest?.id) {
      return;
    }

    void startEdit(editRequest.id);
  }, [editRequest?.id, editRequest?.nonce]);

  async function startEdit(id: string): Promise<void> {
    setLoadingDetails(true);
    setStatus(null);
    try {
      const input = await onLoadInstance(id);
      setEditingId(id);
      setForm(input);
      setStatus("Edit mode enabled.");
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Unable to load this instance.");
    } finally {
      setLoadingDetails(false);
    }
  }

  function resetEditor(): void {
    setEditingId(null);
    setForm({
      ...EMPTY_FORM,
      owner: installDraft?.owner || "",
      repo: installDraft?.repo || "",
      name: installDraft ? `${installDraft.repo}-instance` : ""
    });
  }

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setSaving(true);
    setStatus(null);
    try {
      if (editingId) {
        await onUpdateInstance(editingId, form);
        setStatus("Instance updated successfully.");
      } else {
        await onSaveInstance(form);
        setStatus("Instance created successfully.");
      }
      resetEditor();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Failed to save instance.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="panel">
      <h2>Create Instances</h2>
      <p>Create multiple deployment instances per repository with encrypted credentials.</p>

      {editingId ? (
        <p className="badge-warning">Editing existing instance</p>
      ) : (
        <p className="badge-success">Creating new instance</p>
      )}

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
          {saving ? "Saving..." : editingId ? "Update" : "Create"}
        </button>
        {editingId && (
          <button type="button" onClick={resetEditor} className="btn-secondary">
            Cancel
          </button>
        )}
      </form>

      {status && <p>{status}</p>}

      <ul className="instance-list">
        {instances.map((instance) => (
          <li key={instance.id} className="instance-card">
            <div>
              <strong>{instance.name}</strong>
              <p>
                {instance.owner}/{instance.repo}
              </p>
              <small>
                SSH: {instance.has_ssh ? "yes" : "no"} | SQL: {instance.has_sql ? "yes" : "no"}
              </small>
              <small>Installed FTP version: {ftpVersions[instance.id] || "checking..."}</small>
            </div>
            <button
              type="button"
              className="btn-secondary"
              disabled={loadingDetails}
              onClick={() => void startEdit(instance.id)}
            >
              Edit
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
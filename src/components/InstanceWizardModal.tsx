// Purpose: Provide a guided create/edit instance modal with all options on one page.
import { FormEvent, useEffect, useMemo, useState } from "react";
import { apiClient } from "../services/apiClient";
import { InstanceInput, LauncherManifest } from "../types/models";

type WizardMode = "create" | "edit";

interface InstanceWizardModalProps {
  open: boolean;
  mode: WizardMode;
  instanceID?: string | null;
  installDraft: { owner: string; repo: string } | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
  onSaveInstance: (input: InstanceInput) => Promise<void>;
  onUpdateInstance: (id: string, input: InstanceInput) => Promise<void>;
  onLoadInstance: (id: string) => Promise<InstanceInput>;
}

const EMPTY_FORM: InstanceInput = {
  name: "",
  owner: "",
  repo: "",
  ftpHost: "",
  ftpPort: 21,
  ftpUsername: "",
  ftpPassword: "",
  ftpRemotePath: "/",
  sshHost: "",
  sshPort: 22,
  sshUsername: "",
  sshPassword: "",
  sqlDsn: "",
  sqlUsername: "",
  sqlPassword: "",
  sqlDatabase: "",
  siteUrl: ""
};

function normalizeInput(input: InstanceInput): InstanceInput {
  return {
    ...EMPTY_FORM,
    ...input,
    ftpPort: input.ftpPort || 21,
    sshPort: input.sshPort || 22
  };
}

export default function InstanceWizardModal({
  open,
  mode,
  instanceID,
  installDraft,
  onClose,
  onSaved,
  onSaveInstance,
  onUpdateInstance,
  onLoadInstance
}: InstanceWizardModalProps) {
  const [form, setForm] = useState<InstanceInput>(EMPTY_FORM);
  const [manifest, setManifest] = useState<LauncherManifest | null>(null);
  const [manifestLoading, setManifestLoading] = useState(false);
  const [manifestError, setManifestError] = useState<string | null>(null);
  const [loadingInstance, setLoadingInstance] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ftpDirectories, setFtpDirectories] = useState<string[]>([]);
  const [ftpDirectoriesLoading, setFtpDirectoriesLoading] = useState(false);
  const [ftpDirectoriesError, setFtpDirectoriesError] = useState<string | null>(null);

  const requiresSQL = manifest?.launcher.requires_sql === true;
  const requiresSSH = (manifest?.launcher.connection_types || []).some(
    (connectionType) => connectionType.toLowerCase() === "ssh"
  );
  const websiteProject = manifest?.type === "php" || manifest?.type === "html";

  const manifestDatabasePath = useMemo(() => {
    const topLevelPath = manifest?.database?.trim() || "";
    if (topLevelPath) {
      return topLevelPath;
    }

    const compatibilityPath = manifest?.launcher.database_file_path?.trim() || "";
    if (compatibilityPath) {
      return compatibilityPath;
    }

    const schemaPath = manifest?.launcher.sql_schema_path?.trim() || "";
    if (schemaPath) {
      return schemaPath;
    }

    return "";
  }, [manifest]);

  useEffect(() => {
    if (!open) {
      return;
    }

    setError(null);
    setManifest(null);
    setManifestError(null);
    setFtpDirectories([]);
    setFtpDirectoriesError(null);

    async function load(): Promise<void> {
      if (mode === "edit" && instanceID) {
        setLoadingInstance(true);
        try {
          const loaded = await onLoadInstance(instanceID);
          setForm(normalizeInput(loaded));
        } catch (loadError) {
          setError(loadError instanceof Error ? loadError.message : "Unable to load instance details.");
        } finally {
          setLoadingInstance(false);
        }
        return;
      }

      const owner = installDraft?.owner || "";
      const repo = installDraft?.repo || "";
      setForm(
        normalizeInput({
          ...EMPTY_FORM,
          owner,
          repo,
          name: repo ? `${repo}-instance` : ""
        })
      );
    }

    void load();
  }, [open, mode, instanceID, installDraft, onLoadInstance]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const owner = form.owner?.trim();
    const repo = form.repo?.trim();
    if (!owner || !repo) {
      setManifest(null);
      setManifestError(null);
      return;
    }

    let cancelled = false;
    setManifestLoading(true);
    setManifestError(null);
    apiClient
      .fetchManifest(owner, repo)
      .then((repository) => {
        if (cancelled) {
          return;
        }
        setManifest(repository.manifest || null);
        setManifestError(null);
      })
      .catch((fetchError) => {
        if (!cancelled) {
          setManifest(null);
          setManifestError(fetchError instanceof Error ? fetchError.message : "Unable to load manifest from GitHub.");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setManifestLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [open, form.owner, form.repo]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const host = form.ftpHost.trim();
    const username = form.ftpUsername.trim();
    const password = form.ftpPassword.trim();
    const startPath = form.ftpRemotePath.trim() || "/";
    const port = Number(form.ftpPort);

    if (!host || !username || !password || !port || port <= 0) {
      setFtpDirectories([]);
      setFtpDirectoriesError(null);
      setFtpDirectoriesLoading(false);
      return;
    }

    let cancelled = false;
    const timeoutID = window.setTimeout(() => {
      setFtpDirectoriesLoading(true);
      setFtpDirectoriesError(null);

      apiClient
        .listFtpDirectories({
          host,
          port,
          username,
          password,
          start_path: startPath
        })
        .then((response) => {
          if (cancelled) {
            return;
          }

          const directories = [response.current_path, ...response.directories].filter(
            (path, index, all) => all.indexOf(path) === index
          );
          setFtpDirectories(directories);
        })
        .catch((browseError) => {
          if (cancelled) {
            return;
          }

          setFtpDirectories([]);
          setFtpDirectoriesError(browseError instanceof Error ? browseError.message : "Unable to list FTP folders.");
        })
        .finally(() => {
          if (!cancelled) {
            setFtpDirectoriesLoading(false);
          }
        });
    }, 500);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutID);
    };
  }, [open, form.ftpHost, form.ftpPort, form.ftpUsername, form.ftpPassword, form.ftpRemotePath]);

  function validateForm(): string | null {
    if (!form.name.trim() || !form.owner.trim() || !form.repo.trim()) {
      return "Fill instance name, owner and repository.";
    }

    if (!form.ftpHost.trim() || !form.ftpUsername.trim() || !form.ftpPassword.trim() || !form.ftpRemotePath.trim()) {
      return "Fill all required FTP fields.";
    }

    if (!form.ftpPort || form.ftpPort <= 0) {
      return "FTP port must be greater than 0.";
    }

    if (requiresSQL && (!form.sqlDsn?.trim() || !form.sqlUsername?.trim() || !form.sqlPassword?.trim())) {
      return "This project requires SQL: DSN, username and password are mandatory.";
    }

    if (requiresSSH && (!form.sshHost?.trim() || !form.sshUsername?.trim())) {
      return "This project requires SSH: host and username are mandatory.";
    }

    if (websiteProject && !form.siteUrl?.trim()) {
      return "Site URL is required for website projects so the View button can open it.";
    }

    return null;
  }

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();

    const validationError = validateForm();
    if (validationError) {
      setError(validationError);
      return;
    }

    setError(null);
    setSaving(true);
    try {
      if (mode === "edit" && instanceID) {
        await onUpdateInstance(instanceID, form);
      } else {
        await onSaveInstance(form);
      }

      await onSaved();
      onClose();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save instance.");
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return null;
  }

  return (
    <div className="wizard-overlay" role="dialog" aria-modal="true" aria-label="Instance options">
      <div className="wizard-modal">
        <header className="wizard-header">
          <div>
            <h3>{mode === "edit" ? "Instance options" : "Create instance"}</h3>
            <p>All parameters are on one page for faster navigation.</p>
          </div>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Close
          </button>
        </header>

        <form className="wizard-body" onSubmit={submit}>
          {loadingInstance ? (
            <p>Loading instance...</p>
          ) : (
            <>
              <section className="wizard-section">
                <h4>General</h4>
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
                {manifestLoading && <small>Loading manifest...</small>}
                {!manifestLoading && manifest && <small>Manifest version: {manifest.version}</small>}
                {manifestError && <small className="error-text">Manifest load failed (GitHub): {manifestError}</small>}
              </section>

              <hr className="wizard-separator" />

              <section className="wizard-section">
                <h4>FTP</h4>
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
                  type="text"
                  list="ftp-remote-path-suggestions"
                  value={form.ftpRemotePath}
                  onChange={(event) => setForm({ ...form, ftpRemotePath: event.target.value })}
                  placeholder="Remote extraction path"
                  required
                />

                <datalist id="ftp-remote-path-suggestions">
                  {ftpDirectories.map((directory) => (
                    <option key={directory} value={directory} />
                  ))}
                </datalist>

                {ftpDirectoriesLoading && <small>Checking FTP folders in background...</small>}
                {!ftpDirectoriesLoading && ftpDirectories.length > 0 && (
                  <small>{ftpDirectories.length} folder suggestions available in Remote extraction path.</small>
                )}
                {ftpDirectoriesError && <small className="error-text">{ftpDirectoriesError}</small>}
              </section>

              <>
                <hr className="wizard-separator" />

                <section className="wizard-section">
                  <h4>SQL</h4>
                  <input
                    value={form.sqlDsn || ""}
                    onChange={(event) => setForm({ ...form, sqlDsn: event.target.value })}
                    placeholder="SQL DSN"
                    required={requiresSQL}
                  />
                  <input
                    value={form.sqlUsername || ""}
                    onChange={(event) => setForm({ ...form, sqlUsername: event.target.value })}
                    placeholder="SQL username"
                    required={requiresSQL}
                  />
                  <input
                    type="password"
                    value={form.sqlPassword || ""}
                    onChange={(event) => setForm({ ...form, sqlPassword: event.target.value })}
                    placeholder="SQL password"
                    required={requiresSQL}
                  />
                  <input
                    value={form.sqlDatabase || ""}
                    onChange={(event) => setForm({ ...form, sqlDatabase: event.target.value })}
                    placeholder="Database name (optional if already created)"
                  />
                  {manifestDatabasePath ? (
                    <small>Database import file from manifest: {manifestDatabasePath}</small>
                  ) : (
                    <small>No SQL import file path in manifest (manifest.database or launcher.sql_schema_path).</small>
                  )}
                  <small>
                    {requiresSQL
                      ? "This project requires SQL credentials (from GitHub manifest)."
                      : "SQL is optional unless requires_sql=true in GitHub manifest."}
                  </small>
                </section>
              </>

              {requiresSSH && (
                <>
                  <hr className="wizard-separator" />

                  <section className="wizard-section">
                    <h4>SSH</h4>
                    <input
                      value={form.sshHost || ""}
                      onChange={(event) => setForm({ ...form, sshHost: event.target.value })}
                      placeholder="SSH host"
                      required
                    />
                    <input
                      type="number"
                      value={form.sshPort || 22}
                      onChange={(event) => setForm({ ...form, sshPort: Number(event.target.value) })}
                      placeholder="SSH port"
                    />
                    <input
                      value={form.sshUsername || ""}
                      onChange={(event) => setForm({ ...form, sshUsername: event.target.value })}
                      placeholder="SSH username"
                      required
                    />
                    <input
                      type="password"
                      value={form.sshPassword || ""}
                      onChange={(event) => setForm({ ...form, sshPassword: event.target.value })}
                      placeholder="SSH password"
                    />
                    <small>SSH command execution is supported by the backend engine.</small>
                    {manifest?.launcher.ssh_commands && manifest.launcher.ssh_commands.length > 0 && (
                      <small>Manifest SSH commands: {manifest.launcher.ssh_commands.join(" | ")}</small>
                    )}
                  </section>
                </>
              )}

              <hr className="wizard-separator" />

              <section className="wizard-section">
                <h4>Other</h4>
                {websiteProject ? (
                  <input
                    value={form.siteUrl || ""}
                    onChange={(event) => setForm({ ...form, siteUrl: event.target.value })}
                    placeholder="Website URL for View button"
                    required
                  />
                ) : (
                  <input
                    value={form.siteUrl || ""}
                    onChange={(event) => setForm({ ...form, siteUrl: event.target.value })}
                    placeholder="Optional view URL"
                  />
                )}
              </section>
            </>
          )}

          {error && <p className="error-text">{error}</p>}

          <div className="wizard-footer">
            <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={saving || loadingInstance}>
              {saving ? "Saving..." : mode === "edit" ? "Save changes" : "Create instance"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

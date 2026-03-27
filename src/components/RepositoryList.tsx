// Purpose: Display repositories for the selected profile and show launcher compatibility status.
import { useState } from "react";
import { apiClient } from "../services/apiClient";
import { RepositoryItem } from "../types/models";

interface RepositoryListProps {
  owner: string;
  repositories: RepositoryItem[];
}

function compatibilityLabel(manifest: RepositoryItem["manifest"] | null | undefined): string {
  if (!manifest) {
    return "Unknown";
  }
  return manifest.launcher.compatible ? "Compatible" : "Not compatible";
}

export default function RepositoryList({ owner, repositories }: RepositoryListProps) {
  const [loadingRepo, setLoadingRepo] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [manifestMap, setManifestMap] = useState<Record<number, RepositoryItem["manifest"] | null>>({});

  async function checkManifest(repo: RepositoryItem): Promise<void> {
    setError(null);
    setLoadingRepo(repo.id);
    try {
      const fetched = await apiClient.fetchManifest(repo.owner, repo.name);
      setManifestMap((current) => ({
        ...current,
        [repo.id]: fetched.manifest || null
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Manifest check failed");
    } finally {
      setLoadingRepo(null);
    }
  }

  return (
    <section className="panel">
      <h2>Repositories for {owner}</h2>
      <p>
        Compatible repositories expose a manifest.json with launcher compatibility metadata.
      </p>

      {error && <p className="error-text">{error}</p>}

      <ul className="repo-list">
        {repositories.map((repo) => {
          const manifest = manifestMap[repo.id] ?? repo.manifest;
          const compatible = manifest?.launcher.compatible ?? false;
          return (
            <li key={repo.id} className="repo-card">
              <div>
                <h3>{repo.full_name}</h3>
                <p>{repo.description || "No description"}</p>
                <small>{repo.private ? "Private" : "Public"}</small>
              </div>
              <div className="repo-actions">
                <button
                  type="button"
                  onClick={() => checkManifest(repo)}
                  disabled={loadingRepo === repo.id}
                >
                  {loadingRepo === repo.id ? "Checking..." : "Check Compatibility"}
                </button>
                <button type="button" disabled={!compatible}>
                  {compatible ? "Install" : "Install (Disabled)"}
                </button>
                <small>{compatibilityLabel(manifest)}</small>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
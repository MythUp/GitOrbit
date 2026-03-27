// Purpose: Display repositories for the selected profile and trigger installation for compatible projects.
import { useEffect, useState } from "react";
import { apiClient } from "../services/apiClient";
import { RepositoryItem } from "../types/models";

interface RepositoryListProps {
  owner: string;
  repositories: RepositoryItem[];
  onInstall: (owner: string, repo: string) => void;
  loading: boolean;
}

export default function RepositoryList({ owner, repositories, onInstall, loading }: RepositoryListProps) {
  const [compatibilityMap, setCompatibilityMap] = useState<Record<number, boolean>>({});

  useEffect(() => {
    let cancelled = false;

    async function resolveCompatibility(): Promise<void> {
      setCompatibilityMap({});
      const next: Record<number, boolean> = {};

      for (const repo of repositories) {
        if (cancelled) {
          return;
        }

        if (repo.manifest) {
          next[repo.id] = Boolean(repo.manifest.launcher.compatible);
          setCompatibilityMap({ ...next });
          continue;
        }

        try {
          const item = await apiClient.fetchManifest(repo.owner, repo.name);
          next[repo.id] = Boolean(item.manifest?.launcher.compatible);
        } catch (error) {
          next[repo.id] = false;
          if (error instanceof Error && error.message.includes("rate limit")) {
            setCompatibilityMap({ ...next });
            return;
          }
        }

        setCompatibilityMap({ ...next });
        await new Promise((resolve) => setTimeout(resolve, 80));
      }
    }

    void resolveCompatibility();

    return () => {
      cancelled = true;
    };
  }, [repositories]);

  return (
    <section className="panel">
      <h2>Repositories for {owner}</h2>
      <p>
        Compatibility is loaded automatically from each repository manifest.
      </p>

      {loading && <p>Loading repositories...</p>}

      <ul className="repo-list">
        {repositories.map((repo) => {
          const compatibilityResolved = compatibilityMap[repo.id] !== undefined;
          const compatible = compatibilityMap[repo.id] === true;
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
                  className="btn-primary"
                  disabled={!compatible || !compatibilityResolved}
                  onClick={() => onInstall(repo.owner, repo.name)}
                >
                  Install
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
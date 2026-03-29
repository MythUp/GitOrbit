// Purpose: Display repositories for the selected profile and trigger installation for compatible projects.
import { useEffect, useRef, useState } from "react";
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
  const compatibilityMapRef = useRef<Record<number, boolean>>({});

  useEffect(() => {
    compatibilityMapRef.current = compatibilityMap;
  }, [compatibilityMap]);

  useEffect(() => {
    let cancelled = false;

    async function resolveCompatibility(): Promise<void> {
      const validIDs = new Set(repositories.map((repo) => repo.id));
      const base: Record<number, boolean> = {};

      Object.entries(compatibilityMapRef.current).forEach(([id, compatible]) => {
        const numericID = Number(id);
        if (!Number.isNaN(numericID) && validIDs.has(numericID)) {
          base[numericID] = compatible;
        }
      });

      for (const repo of repositories) {
        if (repo.manifest) {
          base[repo.id] = Boolean(repo.manifest.launcher.compatible);
        }
      }

      if (!cancelled) {
        setCompatibilityMap(base);
      }

      const unresolved = repositories.filter((repo) => base[repo.id] === undefined);
      if (unresolved.length === 0) {
        return;
      }

      const resolved = await Promise.all(
        unresolved.map(async (repo) => {
          try {
            const item = await apiClient.fetchManifest(repo.owner, repo.name);
            return [repo.id, Boolean(item.manifest?.launcher.compatible)] as const;
          } catch {
            return [repo.id, false] as const;
          }
        })
      );

      if (cancelled) {
        return;
      }

      const next: Record<number, boolean> = { ...base };
      resolved.forEach(([id, compatible]) => {
        next[id] = compatible;
      });

      setCompatibilityMap(next);
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
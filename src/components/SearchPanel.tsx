// Purpose: Provide GitHub search UI to discover profiles, organizations, and repositories.
import { FormEvent, useState } from "react";
import { apiClient } from "../services/apiClient";
import Icon from "./Icon";
import { SearchResultItem } from "../types/models";
import { ownerFromGithubUrl } from "../utils/github";

interface SearchPanelProps {
  onSearch: (query: string) => Promise<SearchResultItem[]>;
  onAddProfileUrl: (url: string) => Promise<void>;
  onInstall: (owner: string, repo: string) => void;
  existingSidebarOwners: Set<string>;
}

export default function SearchPanel({
  onSearch,
  onAddProfileUrl,
  onInstall,
  existingSidebarOwners
}: SearchPanelProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResultItem[]>([]);
  const [compatibilityMap, setCompatibilityMap] = useState<Record<number, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const data = await onSearch(query);
      setResults(data);

      const repoItems = data.filter((item) => item.type === "repo" && item.owner && item.repo);
      const nextMap: Record<number, boolean> = {};
      for (const item of repoItems) {
        try {
          const manifestResponse = await apiClient.fetchManifest(item.owner!, item.repo!);
          nextMap[item.id] = Boolean(manifestResponse.manifest?.launcher.compatible);
        } catch (error) {
          nextMap[item.id] = false;
          if (error instanceof Error && error.message.includes("rate limit")) {
            break;
          }
        }

        await new Promise((resolve) => setTimeout(resolve, 80));
      }

      setCompatibilityMap(nextMap);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed");
      setCompatibilityMap({});
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="panel">
      <h2>GitHub Search</h2>
      <p>Search users, organizations, and repositories, then add profiles to the sidebar.</p>

      <form className="search-form" onSubmit={handleSubmit}>
        <div className="search-inline">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Try: MythUp or launcher"
            aria-label="Search GitHub"
          />
          <button
            type="submit"
            className="icon-button"
            disabled={loading}
            title="Search"
            aria-label="Search"
          >
            <Icon name="search" className="search-icon" />
          </button>
        </div>
      </form>

      {error && <p className="error-text">{error}</p>}

      <ul className="search-results">
        {results.map((item) => {
          const ownerFromResult =
            item.type === "user" || item.type === "org"
              ? ownerFromGithubUrl(item.url).toLowerCase()
              : "";
          const alreadyInSidebar =
            (item.type === "user" || item.type === "org") &&
            !!ownerFromResult &&
            existingSidebarOwners.has(ownerFromResult);

          return (
            <li key={`${item.type}-${item.id}`} className="search-row">
              <div>
                <strong>{item.name}</strong>
                <p>{item.description || item.url}</p>
              </div>
              {(item.type === "user" || item.type === "org") && !alreadyInSidebar && (
                <button type="button" onClick={() => onAddProfileUrl(item.url)}>
                  Add to Sidebar
                </button>
              )}
              {item.type === "repo" && (
                <button
                  type="button"
                  className="btn-primary"
                  disabled={!compatibilityMap[item.id] || !item.owner || !item.repo}
                  onClick={() => {
                    if (item.owner && item.repo) {
                      onInstall(item.owner, item.repo);
                    }
                  }}
                >
                  Install
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
// Purpose: Resolve installed FTP manifest versions for instances using cache-first and background refresh.
import { useEffect, useState } from "react";
import { apiClient } from "../services/apiClient";
import { InstanceFTPVersionResponse, InstanceRecord } from "../types/models";

function toVersionLabel(response: InstanceFTPVersionResponse): string {
  if (response.version && response.version.trim()) {
    return response.version.trim();
  }

  if (response.error) {
    const normalized = response.error.toLowerCase();
    if (normalized.includes("manifest") && normalized.includes("no")) {
      return "manifest.json missing";
    }
    return "unavailable";
  }

  return "unknown";
}

export function useInstanceFtpVersions(instances: InstanceRecord[]): Record<string, string> {
  const [versions, setVersions] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;

    const ids = new Set(instances.map((instance) => instance.id));
    setVersions((current) => {
      const next: Record<string, string> = {};
      Object.entries(current).forEach(([id, label]) => {
        if (ids.has(id)) {
          next[id] = label;
        }
      });
      return next;
    });

    async function loadAll(): Promise<void> {
      const cachedLabels: Record<string, string> = {};
      for (const instance of instances) {
        const cached = apiClient.getCachedInstanceFTPVersion(instance.id);
        if (cached) {
          cachedLabels[instance.id] = toVersionLabel(cached);
        }
      }

      if (!cancelled && Object.keys(cachedLabels).length > 0) {
        setVersions((current) => ({
          ...current,
          ...cachedLabels
        }));
      }

      const results = await Promise.all(
        instances.map(async (instance) => {
          const cached = apiClient.getCachedInstanceFTPVersion(instance.id);
          try {
            const latest = await apiClient.refreshInstanceFTPVersion(instance.id);
            return [instance.id, toVersionLabel(latest)] as const;
          } catch {
            if (!cached) {
              return [instance.id, "unavailable"] as const;
            }

            return null;
          }
        })
      );

      if (cancelled) {
        return;
      }

      const refreshed: Record<string, string> = {};
      for (const result of results) {
        if (!result) {
          continue;
        }

        refreshed[result[0]] = result[1];
      }

      if (Object.keys(refreshed).length > 0) {
        setVersions((current) => ({
          ...current,
          ...refreshed
        }));
      }
    }

    void loadAll();

    return () => {
      cancelled = true;
    };
  }, [instances]);

  return versions;
}

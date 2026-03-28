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
      for (const instance of instances) {
        if (cancelled) {
          return;
        }

        const cached = apiClient.getCachedInstanceFTPVersion(instance.id);
        if (cached && !cancelled) {
          setVersions((current) => ({
            ...current,
            [instance.id]: toVersionLabel(cached)
          }));
        }

        try {
          const latest = await apiClient.refreshInstanceFTPVersion(instance.id);
          if (cancelled) {
            return;
          }

          setVersions((current) => ({
            ...current,
            [instance.id]: toVersionLabel(latest)
          }));
        } catch {
          if (!cached && !cancelled) {
            setVersions((current) => ({
              ...current,
              [instance.id]: "unavailable"
            }));
          }
        }

        await new Promise((resolve) => setTimeout(resolve, 120));
      }
    }

    void loadAll();

    return () => {
      cancelled = true;
    };
  }, [instances]);

  return versions;
}

// Purpose: Resolve per-instance deployment status (deploy/view/update) with background refresh.
import { useCallback, useEffect, useMemo, useState } from "react";
import { apiClient } from "../services/apiClient";
import { InstanceDeploymentStatusResponse, InstanceRecord } from "../types/models";

interface StatusByInstance {
  [instanceID: string]: InstanceDeploymentStatusResponse;
}

interface LoadingByInstance {
  [instanceID: string]: boolean;
}

export function useInstanceDeploymentStatus(instances: InstanceRecord[]) {
  const [statuses, setStatuses] = useState<StatusByInstance>({});
  const [loading, setLoading] = useState<LoadingByInstance>({});

  const instanceIDs = useMemo(() => instances.map((instance) => instance.id), [instances]);

  const refreshInstanceStatus = useCallback(async (instanceID: string): Promise<void> => {
    setLoading((current) => ({ ...current, [instanceID]: true }));
    try {
      const response = await apiClient.getInstanceDeployStatus(instanceID);
      setStatuses((current) => ({
        ...current,
        [instanceID]: response
      }));
    } catch {
      setStatuses((current) => ({
        ...current,
        [instanceID]: {
          instance_id: instanceID,
          deployed: false,
          update_available: false,
          error: "Unable to load deployment status"
        }
      }));
    } finally {
      setLoading((current) => ({ ...current, [instanceID]: false }));
    }
  }, []);

  const refreshAllStatuses = useCallback(async (): Promise<void> => {
    for (const instance of instances) {
      await refreshInstanceStatus(instance.id);
      await new Promise((resolve) => setTimeout(resolve, 80));
    }
  }, [instances, refreshInstanceStatus]);

  useEffect(() => {
    const idSet = new Set(instanceIDs);
    setStatuses((current) => {
      const next: StatusByInstance = {};
      Object.entries(current).forEach(([id, value]) => {
        if (idSet.has(id)) {
          next[id] = value;
        }
      });
      return next;
    });

    setLoading((current) => {
      const next: LoadingByInstance = {};
      Object.entries(current).forEach(([id, value]) => {
        if (idSet.has(id)) {
          next[id] = value;
        }
      });
      return next;
    });
  }, [instanceIDs]);

  useEffect(() => {
    void refreshAllStatuses();
  }, [refreshAllStatuses]);

  return {
    statuses,
    loading,
    refreshInstanceStatus,
    refreshAllStatuses
  };
}

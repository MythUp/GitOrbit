// Purpose: Centralize launcher data loading and mutations for profiles, repositories, and instances.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_PROFILE_URLS } from "../config/constants";
import { apiClient } from "../services/apiClient";
import {
  InstanceInput,
  InstanceRecord,
  ProfilesConfig,
  RepositoryItem,
  SearchResultItem,
  SidebarFolder,
  SidebarProfileItem
} from "../types/models";
import { ownerDisplayName, ownerFromGithubUrl } from "../utils/github";

function buildDefaultItems(urls: string[]): SidebarProfileItem[] {
  return urls.map((url) => {
    const owner = ownerFromGithubUrl(url);
    return {
      id: `profile-${owner}`,
      url,
      name: ownerDisplayName(url),
      hidden: false
    };
  });
}

function defaultProfilesConfig(): ProfilesConfig {
  return {
    default_profiles: DEFAULT_PROFILE_URLS,
    user_profiles: [],
    folders: [],
    items: buildDefaultItems(DEFAULT_PROFILE_URLS)
  };
}

export function useLauncherData() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [githubWarning, setGithubWarning] = useState<string | null>(null);
  const [githubConnected, setGithubConnected] = useState(false);

  const [profiles, setProfiles] = useState<ProfilesConfig>(defaultProfilesConfig());
  const [selectedProfileId, setSelectedProfileId] = useState<string>("profile-MythUp");
  const [repositories, setRepositories] = useState<RepositoryItem[]>([]);
  const [repositoriesLoading, setRepositoriesLoading] = useState(false);
  const [instances, setInstances] = useState<InstanceRecord[]>([]);
  const repositoriesRequestRef = useRef(0);

  const visibleProfiles = useMemo(
    () => (profiles.items || []).filter((item) => !item.hidden),
    [profiles.items]
  );

  const selectedOwner = useMemo(() => {
    const selected = (profiles.items || []).find((item) => item.id === selectedProfileId);
    if (!selected) {
      return ownerFromGithubUrl(DEFAULT_PROFILE_URLS[0]);
    }
    return ownerFromGithubUrl(selected.url);
  }, [profiles.items, selectedProfileId]);

  const refreshInstances = useCallback(async () => {
    const data = await apiClient.listInstances();
    setInstances(data);
  }, []);

  const refreshGithubAuthStatus = useCallback(async () => {
    try {
      const status = await apiClient.getGithubAuthStatus();
      setGithubConnected(status.connected);
    } catch {
      setGithubConnected(false);
    }
  }, []);

  const refreshRepositories = useCallback(async (owner: string) => {
    const requestId = repositoriesRequestRef.current + 1;
    repositoriesRequestRef.current = requestId;

    const cached = apiClient.getCachedRepositories(owner);

    if (cached) {
      setRepositories(cached);
      setRepositoriesLoading(false);
      setGithubWarning(null);
    } else {
      setRepositoriesLoading(true);
      setRepositories([]);
    }

    try {
      const data = await apiClient.refreshRepositories(owner);
      if (repositoriesRequestRef.current !== requestId) {
        return;
      }
      setRepositories(data);
      setGithubWarning(null);
    } catch (err) {
      if (repositoriesRequestRef.current !== requestId) {
        return;
      }

      if (!cached) {
        setRepositories([]);
      }

      const fallbackMessage = err instanceof Error ? err.message : "GitHub API request failed.";
      setGithubWarning(cached ? `${fallbackMessage} Showing cached repositories.` : fallbackMessage);
    } finally {
      if (repositoriesRequestRef.current === requestId) {
        setRepositoriesLoading(false);
      }
    }
  }, []);

  const loadBootstrapData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      await apiClient.startBackend();
      await apiClient.waitForBackend();
      await refreshGithubAuthStatus();

      const [profilesData, instancesData] = await Promise.all([
        apiClient.getProfiles().catch(() => defaultProfilesConfig()),
        apiClient.listInstances().catch(() => [])
      ]);

      const mergedItems = profilesData.items && profilesData.items.length > 0
        ? profilesData.items
        : buildDefaultItems([
            ...profilesData.default_profiles,
            ...profilesData.user_profiles
          ]);

      const normalizedProfiles: ProfilesConfig = {
        ...profilesData,
        items: mergedItems,
        folders: profilesData.folders || []
      };

      setProfiles(normalizedProfiles);

      const firstVisible = mergedItems.find((item) => !item.hidden);
      if (firstVisible) {
        setSelectedProfileId(firstVisible.id);
        void refreshRepositories(ownerFromGithubUrl(firstVisible.url));
      }

      setInstances(instancesData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unexpected error");
    } finally {
      setLoading(false);
    }
  }, [refreshGithubAuthStatus, refreshRepositories]);

  useEffect(() => {
    void loadBootstrapData();
  }, [loadBootstrapData]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      void refreshGithubAuthStatus();
    }, 15000);

    return () => {
      window.clearInterval(interval);
    };
  }, [refreshGithubAuthStatus]);

  const persistProfiles = useCallback(async (next: ProfilesConfig) => {
    setProfiles(next);
    await apiClient.saveProfiles(next);
  }, []);

  const addProfile = useCallback(
    async (url: string) => {
      const owner = ownerFromGithubUrl(url);
      if (!owner) {
        return;
      }

      const profile: SidebarProfileItem = {
        id: `profile-${owner.toLowerCase()}`,
        url: `https://github.com/${owner}`,
        name: owner,
        hidden: false
      };

      const existing = (profiles.items || []).find((item) => item.id === profile.id);
      if (existing) {
        return;
      }

      const next: ProfilesConfig = {
        ...profiles,
        user_profiles: [...profiles.user_profiles, profile.url],
        items: [...(profiles.items || []), profile]
      };

      await persistProfiles(next);
    },
    [persistProfiles, profiles]
  );

  const hideProfile = useCallback(
    async (profileId: string) => {
      const nextItems = (profiles.items || []).map((item) =>
        item.id === profileId ? { ...item, hidden: true } : item
      );
      await persistProfiles({ ...profiles, items: nextItems });
    },
    [persistProfiles, profiles]
  );

  const removeProfile = useCallback(
    async (profileId: string) => {
      const nextItems = (profiles.items || []).filter((item) => item.id !== profileId);
      const nextFolders: SidebarFolder[] = (profiles.folders || []).map((folder) => ({
        ...folder,
        itemIds: folder.itemIds.filter((id) => id !== profileId)
      }));

      await persistProfiles({
        ...profiles,
        items: nextItems,
        folders: nextFolders
      });
    },
    [persistProfiles, profiles]
  );

  const reorderProfile = useCallback(
    async (sourceId: string, targetId: string) => {
      const items = [...(profiles.items || [])];
      const sourceIndex = items.findIndex((item) => item.id === sourceId);
      const targetIndex = items.findIndex((item) => item.id === targetId);
      if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) {
        return;
      }

      const [moved] = items.splice(sourceIndex, 1);
      items.splice(targetIndex, 0, moved);
      await persistProfiles({ ...profiles, items });
    },
    [persistProfiles, profiles]
  );

  const dropProfileIntoFolder = useCallback(
    async (sourceId: string, targetId: string) => {
      if (sourceId === targetId) {
        return;
      }

      const items = [...(profiles.items || [])].map((item) => {
        if (item.id === sourceId || item.id === targetId) {
          return { ...item, folderId: undefined };
        }
        return item;
      });

      const folderId = `folder-${Date.now()}`;
      const folder: SidebarFolder = {
        id: folderId,
        name: "New Folder",
        itemIds: [targetId, sourceId],
        collapsed: false
      };

      await persistProfiles({
        ...profiles,
        items,
        folders: [...(profiles.folders || []), folder]
      });
    },
    [persistProfiles, profiles]
  );

  const toggleFolder = useCallback(
    async (folderId: string) => {
      const folders = (profiles.folders || []).map((folder) =>
        folder.id === folderId ? { ...folder, collapsed: !folder.collapsed } : folder
      );
      await persistProfiles({ ...profiles, folders });
    },
    [persistProfiles, profiles]
  );

  const selectProfile = useCallback(
    async (profileId: string) => {
      setSelectedProfileId(profileId);
      const selected = (profiles.items || []).find((item) => item.id === profileId);
      if (selected) {
        await refreshRepositories(ownerFromGithubUrl(selected.url));
      }
    },
    [profiles.items, refreshRepositories]
  );

  const searchGithub = useCallback(async (query: string): Promise<SearchResultItem[]> => {
    if (!query.trim()) {
      return [];
    }
    return apiClient.searchGithub(query);
  }, []);

  const saveInstance = useCallback(
    async (input: InstanceInput) => {
      await apiClient.saveInstance(input);
      await refreshInstances();
    },
    [refreshInstances]
  );

  const loadInstanceInput = useCallback(async (id: string): Promise<InstanceInput> => {
    const detail = await apiClient.getInstanceDetail(id);
    return detail.input;
  }, []);

  const updateInstance = useCallback(
    async (id: string, input: InstanceInput) => {
      await apiClient.updateInstance(id, input);
      await refreshInstances();
    },
    [refreshInstances]
  );

  return {
    loading,
    error,
    profiles,
    visibleProfiles,
    selectedProfileId,
    selectedOwner,
    githubConnected,
    repositories,
    repositoriesLoading,
    githubWarning,
    instances,
    addProfile,
    hideProfile,
    removeProfile,
    reorderProfile,
    dropProfileIntoFolder,
    toggleFolder,
    selectProfile,
    searchGithub,
    saveInstance,
    loadInstanceInput,
    updateInstance,
    refreshGithubAuthStatus,
    refreshInstances,
    refreshRepositories
  };
}
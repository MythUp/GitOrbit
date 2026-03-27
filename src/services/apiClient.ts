// Purpose: Provide a typed API client for backend HTTP calls and Tauri backend startup.
import { BACKEND_BASE_URL } from "../config/constants";
import {
  DeployResult,
  DeviceFlowPollResponse,
  DeviceFlowStartResponse,
  FTPDeployByInstanceRequest,
  FTPDeployRequest,
  InstanceDetailResponse,
  InstanceInput,
  InstanceRecord,
  ProfilesConfig,
  RepositoryItem,
  SearchResultItem
} from "../types/models";

const MANIFEST_TTL_MS = 10 * 60 * 1000;
const REPOSITORY_TTL_MS = 5 * 60 * 1000;
const REPOSITORY_STORAGE_PREFIX = "launcher.repositories.cache.v1";

const manifestCache = new Map<
  string,
  {
    value: RepositoryItem;
    expiresAt: number;
  }
>();

const manifestInFlight = new Map<string, Promise<RepositoryItem>>();

const repositoryCache = new Map<
  string,
  {
    value: RepositoryItem[];
    expiresAt: number;
  }
>();

const repositoryInFlight = new Map<string, Promise<RepositoryItem[]>>();

function manifestKey(owner: string, repo: string): string {
  return `${owner.trim().toLowerCase()}/${repo.trim().toLowerCase()}`;
}

function repositoryKey(owner: string): string {
  return owner.trim().toLowerCase();
}

function repositoryStorageKey(owner: string): string {
  return `${REPOSITORY_STORAGE_PREFIX}:${repositoryKey(owner)}`;
}

function loadRepositoryCacheFromStorage(owner: string): RepositoryItem[] | null {
  if (typeof window === "undefined" || !window.localStorage) {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(repositoryStorageKey(owner));
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as {
      value?: RepositoryItem[];
      expiresAt?: number;
    };

    if (!parsed.value || !Array.isArray(parsed.value) || !parsed.expiresAt) {
      return null;
    }

    if (parsed.expiresAt <= Date.now()) {
      window.localStorage.removeItem(repositoryStorageKey(owner));
      return null;
    }

    repositoryCache.set(repositoryKey(owner), {
      value: parsed.value,
      expiresAt: parsed.expiresAt
    });

    return parsed.value;
  } catch {
    return null;
  }
}

function saveRepositoryCache(owner: string, repositories: RepositoryItem[]): void {
  const entry = {
    value: repositories,
    expiresAt: Date.now() + REPOSITORY_TTL_MS
  };

  repositoryCache.set(repositoryKey(owner), entry);

  if (typeof window === "undefined" || !window.localStorage) {
    return;
  }

  try {
    window.localStorage.setItem(repositoryStorageKey(owner), JSON.stringify(entry));
  } catch {
    // Ignore storage errors and keep in-memory cache only.
  }
}

function clearRepositoryCache(): void {
  repositoryCache.clear();
  repositoryInFlight.clear();

  if (typeof window === "undefined" || !window.localStorage) {
    return;
  }

  try {
    Object.keys(window.localStorage)
      .filter((key) => key.startsWith(REPOSITORY_STORAGE_PREFIX + ":"))
      .forEach((key) => window.localStorage.removeItem(key));
  } catch {
    // Ignore storage errors.
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BACKEND_BASE_URL}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {})
    },
    ...init
  });

  if (!response.ok) {
    const data = (await response.json().catch(() => ({ error: "Request failed" }))) as {
      error?: string;
    };

    const errorMessage = data.error || `Request failed with status ${response.status}`;
    if (response.status === 403 && errorMessage.includes("API rate limit exceeded")) {
      throw new Error(
        "GitHub API rate limit exceeded. Please authenticate (GitHub token/device flow) or wait before retrying."
      );
    }

    throw new Error(errorMessage);
  }

  return (await response.json()) as T;
}

async function invokeTauri(command: string): Promise<void> {
  if (!window.__TAURI_IPC__) {
    return;
  }

  const tauri = await import("@tauri-apps/api/tauri");
  await tauri.invoke(command);
}

export const apiClient = {
  async startBackend(): Promise<void> {
    await invokeTauri("start_backend");
  },

  async waitForBackend(maxAttempts = 20, delayMs = 350): Promise<void> {
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      try {
        await request<{ status: string }>("/health");
        return;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
    throw new Error("Backend did not become ready in time.");
  },

  getProfiles(): Promise<ProfilesConfig> {
    return request<ProfilesConfig>("/api/profiles");
  },

  saveProfiles(payload: ProfilesConfig): Promise<{ status: string }> {
    return request<{ status: string }>("/api/profiles", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },

  searchGithub(query: string): Promise<SearchResultItem[]> {
    const encoded = encodeURIComponent(query.trim());
    return request<SearchResultItem[]>(`/api/github/search?q=${encoded}`);
  },

  listRepositories(owner: string): Promise<RepositoryItem[]> {
    const memoryEntry = repositoryCache.get(repositoryKey(owner));
    if (memoryEntry && memoryEntry.expiresAt > Date.now()) {
      return Promise.resolve(memoryEntry.value);
    }

    const stored = loadRepositoryCacheFromStorage(owner);
    if (stored) {
      return Promise.resolve(stored);
    }

    return this.refreshRepositories(owner);
  },

  getCachedRepositories(owner: string): RepositoryItem[] | null {
    const key = repositoryKey(owner);
    const memoryEntry = repositoryCache.get(key);
    if (memoryEntry && memoryEntry.expiresAt > Date.now()) {
      return memoryEntry.value;
    }

    return loadRepositoryCacheFromStorage(owner);
  },

  refreshRepositories(owner: string): Promise<RepositoryItem[]> {
    const key = repositoryKey(owner);
    const pending = repositoryInFlight.get(key);
    if (pending) {
      return pending;
    }

    const encoded = encodeURIComponent(owner.trim());
    const promise = request<RepositoryItem[]>(`/api/github/repos?owner=${encoded}`)
      .then((repositories) => {
        saveRepositoryCache(owner, repositories);
        return repositories;
      })
      .finally(() => {
        repositoryInFlight.delete(key);
      });

    repositoryInFlight.set(key, promise);
    return promise;
  },

  fetchManifest(owner: string, repo: string): Promise<RepositoryItem> {
    const key = manifestKey(owner, repo);
    const cached = manifestCache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return Promise.resolve(cached.value);
    }

    const pending = manifestInFlight.get(key);
    if (pending) {
      return pending;
    }

    const ownerQuery = encodeURIComponent(owner.trim());
    const repoQuery = encodeURIComponent(repo.trim());
    const promise = request<RepositoryItem>(`/api/github/manifest?owner=${ownerQuery}&repo=${repoQuery}`)
      .then((value) => {
        manifestCache.set(key, {
          value,
          expiresAt: Date.now() + MANIFEST_TTL_MS
        });
        return value;
      })
      .finally(() => {
        manifestInFlight.delete(key);
      });

    manifestInFlight.set(key, promise);
    return promise;
  },

  listInstances(): Promise<InstanceRecord[]> {
    return request<InstanceRecord[]>("/api/instances");
  },

  saveInstance(instance: InstanceInput): Promise<{ status: string }> {
    return request<{ status: string }>("/api/instances", {
      method: "POST",
      body: JSON.stringify(instance)
    });
  },

  getInstanceDetail(id: string): Promise<InstanceDetailResponse> {
    const encoded = encodeURIComponent(id);
    return request<InstanceDetailResponse>(`/api/instances?id=${encoded}`);
  },

  updateInstance(id: string, instance: InstanceInput): Promise<{ status: string }> {
    const encoded = encodeURIComponent(id);
    return request<{ status: string }>(`/api/instances?id=${encoded}`, {
      method: "PUT",
      body: JSON.stringify(instance)
    });
  },

  startGithubDeviceFlow(): Promise<DeviceFlowStartResponse> {
    return request<DeviceFlowStartResponse>("/api/auth/github/device/start", {
      method: "POST",
      body: JSON.stringify({ scopes: ["repo", "read:org"] })
    });
  },

  pollGithubDeviceFlow(deviceCode: string): Promise<DeviceFlowPollResponse> {
    return request<DeviceFlowPollResponse>("/api/auth/github/device/poll", {
      method: "POST",
      body: JSON.stringify({ device_code: deviceCode })
    });
  },

  getGithubAuthStatus(): Promise<{ connected: boolean }> {
    return request<{ connected: boolean }>("/api/auth/github/status");
  },

  async setGithubToken(accessToken: string): Promise<{ status: string }> {
    const result = await request<{ status: string }>("/api/auth/github/token", {
      method: "POST",
      body: JSON.stringify({ access_token: accessToken })
    });

    clearRepositoryCache();
    return result;
  },

  deployFtp(payload: FTPDeployRequest): Promise<DeployResult> {
    return request<DeployResult>("/api/deploy/ftp", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },

  deployFtpByInstance(payload: FTPDeployByInstanceRequest): Promise<DeployResult> {
    return request<DeployResult>("/api/deploy/ftp/instance", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  }
};
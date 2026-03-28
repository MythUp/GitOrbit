// Purpose: Provide a typed API client for backend HTTP calls and Tauri backend startup.
import { BACKEND_BASE_URL } from "../config/constants";
import {
  DeployResult,
  DeviceFlowPollResponse,
  DeviceFlowStartResponse,
  FTPDeployByInstanceRequest,
  FTPDeployRequest,
  InstanceDetailResponse,
  InstanceFTPVersionResponse,
  InstanceInput,
  InstanceRecord,
  ProfilesConfig,
  RepositoryItem,
  SearchResultItem,
  WebAuthStartResponse
} from "../types/models";

const MANIFEST_TTL_MS = 10 * 60 * 1000;
const REPOSITORY_TTL_MS = 5 * 60 * 1000;
const REPOSITORY_STORAGE_PREFIX = "launcher.repositories.cache.v1";
const AUTH_STATUS_STORAGE_KEY = "launcher.github.auth.v1";
const INSTANCE_FTP_VERSION_TTL_MS = 60 * 1000;
const INSTANCE_FTP_VERSION_STORAGE_PREFIX = "launcher.instances.ftp-version.v1";

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

const instanceVersionCache = new Map<
  string,
  {
    value: InstanceFTPVersionResponse;
    expiresAt: number;
  }
>();

const instanceVersionInFlight = new Map<string, Promise<InstanceFTPVersionResponse>>();

function manifestKey(owner: string, repo: string): string {
  return `${owner.trim().toLowerCase()}/${repo.trim().toLowerCase()}`;
}

function repositoryKey(owner: string): string {
  return owner.trim().toLowerCase();
}

function repositoryStorageKey(owner: string): string {
  return `${REPOSITORY_STORAGE_PREFIX}:${repositoryKey(owner)}`;
}

function instanceVersionStorageKey(instanceID: string): string {
  return `${INSTANCE_FTP_VERSION_STORAGE_PREFIX}:${instanceID}`;
}

function loadCachedAuthStatus(): boolean | null {
  if (typeof window === "undefined" || !window.localStorage) {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(AUTH_STATUS_STORAGE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as { connected?: boolean; savedAt?: number };
    if (typeof parsed.connected !== "boolean") {
      return null;
    }

    return parsed.connected;
  } catch {
    return null;
  }
}

function saveCachedAuthStatus(connected: boolean): void {
  if (typeof window === "undefined" || !window.localStorage) {
    return;
  }

  try {
    window.localStorage.setItem(
      AUTH_STATUS_STORAGE_KEY,
      JSON.stringify({
        connected,
        savedAt: Date.now()
      })
    );
  } catch {
    // Ignore storage errors.
  }
}

function loadInstanceVersionCacheFromStorage(instanceID: string): InstanceFTPVersionResponse | null {
  if (typeof window === "undefined" || !window.localStorage) {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(instanceVersionStorageKey(instanceID));
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as {
      value?: InstanceFTPVersionResponse;
      expiresAt?: number;
    };

    if (!parsed.value || !parsed.expiresAt) {
      return null;
    }

    if (parsed.expiresAt <= Date.now()) {
      window.localStorage.removeItem(instanceVersionStorageKey(instanceID));
      return null;
    }

    instanceVersionCache.set(instanceID, {
      value: parsed.value,
      expiresAt: parsed.expiresAt
    });

    return parsed.value;
  } catch {
    return null;
  }
}

function saveInstanceVersionCache(instanceID: string, response: InstanceFTPVersionResponse): void {
  const entry = {
    value: response,
    expiresAt: Date.now() + INSTANCE_FTP_VERSION_TTL_MS
  };

  instanceVersionCache.set(instanceID, entry);

  if (typeof window === "undefined" || !window.localStorage) {
    return;
  }

  try {
    window.localStorage.setItem(instanceVersionStorageKey(instanceID), JSON.stringify(entry));
  } catch {
    // Ignore storage errors.
  }
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
      code?: string;
    };

    const errorMessageBase = data.error || `Request failed with status ${response.status}`;
    const errorMessage = data.code ? `${errorMessageBase} (${data.code})` : errorMessageBase;
    if (response.status === 403 && errorMessage.includes("API rate limit exceeded")) {
      throw new Error(
        "GitHub API rate limit exceeded. Please authenticate (GitHub token/device flow) or wait before retrying."
      );
    }

    throw new Error(errorMessage);
  }

  return (await response.json()) as T;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  if (error && typeof error === "object") {
    const maybeMessage = (error as { message?: unknown }).message;
    if (typeof maybeMessage === "string") {
      return maybeMessage;
    }

    try {
      return JSON.stringify(error);
    } catch {
      return "Unknown runtime error";
    }
  }

  return "Unknown runtime error";
}

async function invokeTauri(command: string): Promise<void> {
  if (!window.__TAURI_IPC__) {
    return;
  }

  const tauri = await import("@tauri-apps/api/tauri");
  try {
    await tauri.invoke(command);
  } catch (error) {
    throw new Error(getErrorMessage(error));
  }
}

export const apiClient = {
  async startBackend(): Promise<void> {
    try {
      await invokeTauri("start_backend");
    } catch (error) {
      const message = getErrorMessage(error).toLowerCase();
      if (message.includes("already uses port 3547") || message.includes("address already in use")) {
        return;
      }

      throw new Error(getErrorMessage(error));
    }
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

  getCachedGithubAuthStatus(): boolean | null {
    return loadCachedAuthStatus();
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

  getCachedInstanceFTPVersion(instanceID: string): InstanceFTPVersionResponse | null {
    const cached = instanceVersionCache.get(instanceID);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }

    return loadInstanceVersionCacheFromStorage(instanceID);
  },

  refreshInstanceFTPVersion(instanceID: string): Promise<InstanceFTPVersionResponse> {
    const pending = instanceVersionInFlight.get(instanceID);
    if (pending) {
      return pending;
    }

    const encoded = encodeURIComponent(instanceID);
    const promise = request<InstanceFTPVersionResponse>(`/api/instances/ftp-version?id=${encoded}`)
      .then((response) => {
        saveInstanceVersionCache(instanceID, response);
        return response;
      })
      .finally(() => {
        instanceVersionInFlight.delete(instanceID);
      });

    instanceVersionInFlight.set(instanceID, promise);
    return promise;
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

  startGithubWebFlow(): Promise<WebAuthStartResponse> {
    return request<WebAuthStartResponse>("/api/auth/github/web/start", {
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

  async getGithubAuthStatus(): Promise<{ connected: boolean }> {
    const response = await request<{ connected: boolean }>("/api/auth/github/status");
    saveCachedAuthStatus(response.connected);
    return response;
  },

  async setGithubToken(accessToken: string): Promise<{ status: string }> {
    const result = await request<{ status: string }>("/api/auth/github/token", {
      method: "POST",
      body: JSON.stringify({ access_token: accessToken })
    });

    if (!accessToken.trim()) {
      saveCachedAuthStatus(false);
    }

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
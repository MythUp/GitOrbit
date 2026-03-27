// Purpose: Provide a typed API client for backend HTTP calls and Tauri backend startup.
import { BACKEND_BASE_URL } from "../config/constants";
import {
  DeployResult,
  DeviceFlowPollResponse,
  DeviceFlowStartResponse,
  FTPDeployRequest,
  InstanceInput,
  InstanceRecord,
  ProfilesConfig,
  RepositoryItem,
  SearchResultItem
} from "../types/models";

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
    throw new Error(data.error || `Request failed with status ${response.status}`);
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
    const encoded = encodeURIComponent(owner.trim());
    return request<RepositoryItem[]>(`/api/github/repos?owner=${encoded}`);
  },

  fetchManifest(owner: string, repo: string): Promise<RepositoryItem> {
    const ownerQuery = encodeURIComponent(owner.trim());
    const repoQuery = encodeURIComponent(repo.trim());
    return request<RepositoryItem>(`/api/github/manifest?owner=${ownerQuery}&repo=${repoQuery}`);
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

  setGithubToken(accessToken: string): Promise<{ status: string }> {
    return request<{ status: string }>("/api/auth/github/token", {
      method: "POST",
      body: JSON.stringify({ access_token: accessToken })
    });
  },

  deployFtp(payload: FTPDeployRequest): Promise<DeployResult> {
    return request<DeployResult>("/api/deploy/ftp", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  }
};
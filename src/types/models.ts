// Purpose: Define shared TypeScript models for frontend state and API responses.
export interface SidebarProfileItem {
  id: string;
  url: string;
  name: string;
  hidden?: boolean;
  folderId?: string;
}

export interface SidebarFolder {
  id: string;
  name: string;
  itemIds: string[];
  collapsed: boolean;
}

export interface ProfilesConfig {
  default_profiles: string[];
  user_profiles: string[];
  folders: SidebarFolder[];
  items?: SidebarProfileItem[];
}

export interface LauncherCompatibility {
  compatible: boolean;
  connection_types: string[];
  requires_sql: boolean;
  notes: string;
  ignore: string[];
}

export interface LauncherManifest {
  project_name: string;
  version: string;
  type: "php" | "python" | "html" | "other";
  launcher: LauncherCompatibility;
}

export interface RepositoryItem {
  id: number;
  owner: string;
  name: string;
  full_name: string;
  private: boolean;
  html_url: string;
  default_branch: string;
  description: string | null;
  manifest?: LauncherManifest;
}

export interface SearchResultItem {
  id: number;
  type: "user" | "org" | "repo";
  name: string;
  url: string;
  description?: string;
  owner?: string;
  repo?: string;
  compatible?: boolean;
}

export interface InstanceInput {
  name: string;
  owner: string;
  repo: string;
  ftpHost: string;
  ftpPort: number;
  ftpUsername: string;
  ftpPassword: string;
  ftpRemotePath: string;
  sshHost?: string;
  sshPort?: number;
  sshUsername?: string;
  sshPassword?: string;
  sqlDsn?: string;
}

export interface InstanceRecord {
  id: string;
  name: string;
  owner: string;
  repo: string;
  created_at: string;
  updated_at: string;
  has_ssh: boolean;
  has_sql: boolean;
}

export interface InstanceDetailResponse {
  id: string;
  input: InstanceInput;
}

export interface InstanceFTPVersionResponse {
  instance_id: string;
  version?: string;
  checked_at: string;
  error?: string;
}

export interface DeviceFlowStartResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
  expires_in: number;
  interval: number;
}

export interface WebAuthStartResponse {
  auth_url: string;
}

export interface DeviceFlowPollResponse {
  access_token: string;
  token_type: string;
  scope: string;
}

export interface FTPDeployRequest {
  local_path: string;
  remote_path: string;
  host: string;
  port: number;
  username: string;
  password: string;
  rollback_on_fail: boolean;
}

export interface FTPDeployByInstanceRequest {
  instance_id: string;
  local_path: string;
  rollback_on_fail: boolean;
}

export interface DeployResult {
  uploaded: number;
  updated: number;
  deleted: number;
  logs: string[];
}

export interface ApiError {
  error: string;
}
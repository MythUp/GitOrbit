// Purpose: Define backend models used by handlers, storage layers, and service modules.
package models

type SidebarFolder struct {
	ID        string   `json:"id"`
	Name      string   `json:"name"`
	ItemIDs   []string `json:"itemIds"`
	Collapsed bool     `json:"collapsed"`
}

type SidebarProfileItem struct {
	ID       string `json:"id"`
	URL      string `json:"url"`
	Name     string `json:"name"`
	Hidden   bool   `json:"hidden"`
	FolderID string `json:"folderId,omitempty"`
}

type ProfilesConfig struct {
	DefaultProfiles []string             `json:"default_profiles"`
	UserProfiles    []string             `json:"user_profiles"`
	Folders         []SidebarFolder      `json:"folders"`
	Items           []SidebarProfileItem `json:"items,omitempty"`
}

type LauncherCompatibility struct {
	Compatible       bool     `json:"compatible"`
	ConnectionTypes  []string `json:"connection_types"`
	RequiresSQL      bool     `json:"requires_sql"`
	SQLSchemaPath    string   `json:"sql_schema_path,omitempty"`
	DatabaseFilePath string   `json:"database_file_path,omitempty"`
	SSHCommands      []string `json:"ssh_commands,omitempty"`
	Notes            string   `json:"notes"`
	Ignore           []string `json:"ignore"`
}

type LauncherManifest struct {
	ProjectName string                `json:"project_name"`
	Version     string                `json:"version"`
	Type        string                `json:"type"`
	Database    string                `json:"database,omitempty"`
	Launcher    LauncherCompatibility `json:"launcher"`
}

type RepositoryItem struct {
	ID            int64             `json:"id"`
	Owner         string            `json:"owner"`
	Name          string            `json:"name"`
	FullName      string            `json:"full_name"`
	Private       bool              `json:"private"`
	HTMLURL       string            `json:"html_url"`
	DefaultBranch string            `json:"default_branch"`
	Description   string            `json:"description"`
	Manifest      *LauncherManifest `json:"manifest,omitempty"`
}

type SearchResultItem struct {
	ID          int64  `json:"id"`
	Type        string `json:"type"`
	Name        string `json:"name"`
	URL         string `json:"url"`
	Description string `json:"description,omitempty"`
	Owner       string `json:"owner,omitempty"`
	Repo        string `json:"repo,omitempty"`
	Compatible  *bool  `json:"compatible,omitempty"`
}

type InstanceInput struct {
	Name          string `json:"name"`
	Owner         string `json:"owner"`
	Repo          string `json:"repo"`
	FTPHost       string `json:"ftpHost"`
	FTPPort       int    `json:"ftpPort"`
	FTPUsername   string `json:"ftpUsername"`
	FTPPassword   string `json:"ftpPassword"`
	FTPRemotePath string `json:"ftpRemotePath"`
	SSHHost       string `json:"sshHost,omitempty"`
	SSHPort       int    `json:"sshPort,omitempty"`
	SSHUsername   string `json:"sshUsername,omitempty"`
	SSHPassword   string `json:"sshPassword,omitempty"`
	SQLDSN        string `json:"sqlDsn,omitempty"`
	SQLUsername   string `json:"sqlUsername,omitempty"`
	SQLPassword   string `json:"sqlPassword,omitempty"`
	SQLDatabase   string `json:"sqlDatabase,omitempty"`
	SiteURL       string `json:"siteUrl,omitempty"`
}

type InstanceRecord struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Owner     string `json:"owner"`
	Repo      string `json:"repo"`
	CreatedAt string `json:"created_at"`
	UpdatedAt string `json:"updated_at"`
	HasSSH    bool   `json:"has_ssh"`
	HasSQL    bool   `json:"has_sql"`
}

type StoredInstance struct {
	Record               InstanceRecord `json:"record"`
	EncryptedCredentials string         `json:"encrypted_credentials"`
}

type InstancesConfig struct {
	Items []StoredInstance `json:"items"`
}

type DeviceFlowStartRequest struct {
	Scopes []string `json:"scopes"`
}

type DeviceFlowStartResponse struct {
	DeviceCode              string `json:"device_code"`
	UserCode                string `json:"user_code"`
	VerificationURI         string `json:"verification_uri"`
	VerificationURIComplete string `json:"verification_uri_complete,omitempty"`
	ExpiresIn               int    `json:"expires_in"`
	Interval                int    `json:"interval"`
}

type WebAuthStartResponse struct {
	AuthURL string `json:"auth_url"`
}

type DeviceFlowPollRequest struct {
	DeviceCode string `json:"device_code"`
}

type DeviceFlowPollResponse struct {
	AccessToken string `json:"access_token"`
	TokenType   string `json:"token_type"`
	Scope       string `json:"scope"`
}

type InstanceDetailResponse struct {
	ID    string        `json:"id"`
	Input InstanceInput `json:"input"`
}

type InstanceFTPVersionResponse struct {
	InstanceID string `json:"instance_id"`
	Version    string `json:"version,omitempty"`
	CheckedAt  string `json:"checked_at"`
	Error      string `json:"error,omitempty"`
}

type InstanceDeploymentStatusResponse struct {
	InstanceID            string `json:"instance_id"`
	Deployed              bool   `json:"deployed"`
	RemoteManifestVersion string `json:"remote_manifest_version,omitempty"`
	LatestGitTag          string `json:"latest_git_tag,omitempty"`
	UpdateAvailable       bool   `json:"update_available"`
	SiteURL               string `json:"site_url,omitempty"`
	Error                 string `json:"error,omitempty"`
}

type SetTokenRequest struct {
	AccessToken string `json:"access_token"`
}

type FTPDeployRequest struct {
	LocalPath      string   `json:"local_path"`
	RemotePath     string   `json:"remote_path"`
	Host           string   `json:"host"`
	Port           int      `json:"port"`
	Username       string   `json:"username"`
	Password       string   `json:"password"`
	Ignore         []string `json:"ignore,omitempty"`
	RollbackOnFail bool     `json:"rollback_on_fail"`
}

type FTPDeployByInstanceRequest struct {
	InstanceID     string `json:"instance_id"`
	GitRef         string `json:"git_ref,omitempty"`
	RollbackOnFail bool   `json:"rollback_on_fail"`
}

type FTPDirectoriesRequest struct {
	Host      string `json:"host"`
	Port      int    `json:"port"`
	Username  string `json:"username"`
	Password  string `json:"password"`
	StartPath string `json:"start_path,omitempty"`
}

type FTPDirectoriesResponse struct {
	CurrentPath string   `json:"current_path"`
	Directories []string `json:"directories"`
}

type SQLMigrationPlanRequest struct {
	InstanceID string `json:"instance_id"`
	FromRef    string `json:"from_ref"`
	ToRef      string `json:"to_ref"`
	SchemaPath string `json:"schema_path,omitempty"`
}

type SQLColumnRename struct {
	Table      string `json:"table"`
	FromColumn string `json:"from_column"`
	ToColumn   string `json:"to_column"`
}

type SQLMigrationPlanResponse struct {
	FromRef         string            `json:"from_ref"`
	ToRef           string            `json:"to_ref"`
	SchemaPath      string            `json:"schema_path"`
	AddedTables     []string          `json:"added_tables"`
	RemovedTables   []string          `json:"removed_tables"`
	AddedColumns    []string          `json:"added_columns"`
	RemovedColumns  []string          `json:"removed_columns"`
	RenamedColumns  []SQLColumnRename `json:"renamed_columns"`
	AlterStatements []string          `json:"alter_statements"`
	Warnings        []string          `json:"warnings"`
}

type DeployResult struct {
	Uploaded int      `json:"uploaded"`
	Updated  int      `json:"updated"`
	Deleted  int      `json:"deleted"`
	Logs     []string `json:"logs"`
}

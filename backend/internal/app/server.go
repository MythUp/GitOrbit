// Purpose: Wire dependencies and expose HTTP routes consumed by the desktop frontend.
package app

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"io"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"

	"launcher/backend/internal/config"
	"launcher/backend/internal/models"
	"launcher/backend/internal/security"
	"launcher/backend/internal/services/auth"
	"launcher/backend/internal/services/deploy"
	githubservice "launcher/backend/internal/services/github"
	sqlservice "launcher/backend/internal/services/sql"
	"launcher/backend/internal/storage"
)

type ServerDependencies struct {
	ProfilesStore  *storage.ProfilesStore
	InstancesStore *storage.InstancesStore
	TokenStore     *storage.TokenStore
	GitHub         *githubservice.Client
	DeviceFlow     *auth.DeviceFlowService
	FTPEngine      *deploy.FTPEngine
	SQLExecutor    *sqlservice.Executor
	SQLPlanner     *sqlservice.MigrationPlanner
}

type APIServer struct {
	httpServer          *http.Server
	deps                ServerDependencies
	logger              *log.Logger
	oauthState          string
	oauthStateExpiresAt time.Time
	oauthStateMu        sync.Mutex
}

func NewServer(logger *log.Logger) (*http.Server, error) {
	if err := config.LoadDotEnvIfPresent(".env"); err != nil {
		logger.Printf("warning: failed to load .env file: %v", err)
	}

	paths, err := config.ResolvePaths()
	if err != nil {
		return nil, err
	}

	if err := config.EnsureFiles(paths); err != nil {
		return nil, err
	}

	encryption, err := security.NewEncryptionService(paths.EncryptionKeyPath)
	if err != nil {
		return nil, err
	}

	deps := ServerDependencies{
		ProfilesStore:  storage.NewProfilesStore(paths.ProfilesPath),
		InstancesStore: storage.NewInstancesStore(paths.InstancesPath, encryption),
		TokenStore:     storage.NewTokenStore(paths.OAuthTokenPath, encryption),
		GitHub:         githubservice.NewClient(),
		DeviceFlow:     auth.NewDeviceFlowService(),
		FTPEngine:      deploy.NewFTPEngine(paths.DeployLogDir),
		SQLExecutor:    sqlservice.NewExecutor(),
		SQLPlanner:     sqlservice.NewMigrationPlanner(),
	}

	api := &APIServer{
		deps:   deps,
		logger: logger,
	}

	mux := http.NewServeMux()
	api.registerRoutes(mux)

	server := &http.Server{
		Addr:    "127.0.0.1:3547",
		Handler: withCORS(mux),
	}
	api.httpServer = server

	return server, nil
}

func (api *APIServer) registerRoutes(mux *http.ServeMux) {
	mux.HandleFunc("/health", api.handleHealth)
	mux.HandleFunc("/callback", api.handleOAuthCallback)
	mux.HandleFunc("/api/profiles", api.handleProfiles)
	mux.HandleFunc("/api/instances", api.handleInstances)
	mux.HandleFunc("/api/instances/ftp-version", api.handleInstanceFTPVersion)
	mux.HandleFunc("/api/instances/deploy-status", api.handleInstanceDeployStatus)
	mux.HandleFunc("/api/github/search", api.handleGitHubSearch)
	mux.HandleFunc("/api/github/repos", api.handleGitHubRepos)
	mux.HandleFunc("/api/github/manifest", api.handleGitHubManifest)
	mux.HandleFunc("/api/auth/github/device/start", api.handleStartDeviceFlow)
	mux.HandleFunc("/api/auth/github/device/poll", api.handlePollDeviceFlow)
	mux.HandleFunc("/api/auth/github/web/start", api.handleStartWebOAuth)
	mux.HandleFunc("/api/auth/github/token", api.handleSetToken)
	mux.HandleFunc("/api/auth/github/status", api.handleGitHubAuthStatus)
	mux.HandleFunc("/api/deploy/ftp", api.handleDeployFTP)
	mux.HandleFunc("/api/deploy/ftp/directories", api.handleFTPDirectories)
	mux.HandleFunc("/api/deploy/ftp/instance", api.handleDeployFTPByInstance)
	mux.HandleFunc("/api/sql/migration-plan", api.handleSQLMigrationPlan)
}

func (api *APIServer) handleHealth(writer http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodGet {
		writeError(writer, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	writeJSON(writer, http.StatusOK, map[string]string{"status": "ok"})
}

func (api *APIServer) handleOAuthCallback(writer http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodGet {
		writeError(writer, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	code := strings.TrimSpace(request.URL.Query().Get("code"))
	state := strings.TrimSpace(request.URL.Query().Get("state"))
	if code == "" {
		renderOAuthPage(writer, http.StatusBadRequest, "Callback Missing Code", "The OAuth callback URL does not include an authorization code.", false)
		return
	}

	api.oauthStateMu.Lock()
	expectedState := api.oauthState
	expiresAt := api.oauthStateExpiresAt
	api.oauthStateMu.Unlock()

	if expectedState != "" {
		if state == "" || state != expectedState || time.Now().After(expiresAt) {
			renderOAuthPage(writer, http.StatusBadRequest, "State Validation Failed", "The OAuth state is invalid or expired. Restart login from the desktop app.", false)
			return
		}
	}

	token, err := api.deps.DeviceFlow.ExchangeWebCode(code)
	if err != nil {
		api.logger.Printf("web oauth exchange failed: %v", err)
		renderOAuthPage(writer, http.StatusBadGateway, "OAuth Exchange Failed", "GitHub returned an error while exchanging the code. Return to the app and retry.", false)
		return
	}

	if err := api.deps.TokenStore.Save(token.AccessToken); err != nil {
		api.logger.Printf("failed to persist oauth token: %v", err)
		renderOAuthPage(writer, http.StatusInternalServerError, "Token Save Failed", "The token could not be stored locally. Return to the app and retry.", false)
		return
	}

	api.oauthStateMu.Lock()
	api.oauthState = ""
	api.oauthStateExpiresAt = time.Time{}
	api.oauthStateMu.Unlock()

	renderOAuthPage(writer, http.StatusOK, "Login Approved", "GitHub authorization is complete. You can safely return to Launcher Desktop.", true)
}

func (api *APIServer) handleProfiles(writer http.ResponseWriter, request *http.Request) {
	switch request.Method {
	case http.MethodGet:
		cfg, err := api.deps.ProfilesStore.Read()
		if err != nil {
			writeError(writer, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(writer, http.StatusOK, cfg)
	case http.MethodPost:
		var payload models.ProfilesConfig
		if err := decodeJSON(request.Body, &payload); err != nil {
			writeError(writer, http.StatusBadRequest, err.Error())
			return
		}
		if err := api.deps.ProfilesStore.Write(payload); err != nil {
			writeError(writer, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(writer, http.StatusOK, map[string]string{"status": "saved"})
	default:
		writeError(writer, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (api *APIServer) handleInstances(writer http.ResponseWriter, request *http.Request) {
	switch request.Method {
	case http.MethodGet:
		instanceID := strings.TrimSpace(request.URL.Query().Get("id"))
		if instanceID != "" {
			input, err := api.deps.InstancesStore.GetInstanceInput(instanceID)
			if err != nil {
				writeError(writer, http.StatusNotFound, err.Error())
				return
			}

			writeJSON(writer, http.StatusOK, models.InstanceDetailResponse{
				ID:    instanceID,
				Input: input,
			})
			return
		}

		list, err := api.deps.InstancesStore.ListRecords()
		if err != nil {
			writeError(writer, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(writer, http.StatusOK, list)
	case http.MethodPost:
		var payload models.InstanceInput
		if err := decodeJSON(request.Body, &payload); err != nil {
			writeError(writer, http.StatusBadRequest, err.Error())
			return
		}
		if err := api.deps.InstancesStore.SaveInstance(payload); err != nil {
			writeError(writer, http.StatusBadRequest, err.Error())
			return
		}
		writeJSON(writer, http.StatusOK, map[string]string{"status": "saved"})
	case http.MethodPut:
		instanceID := strings.TrimSpace(request.URL.Query().Get("id"))
		if instanceID == "" {
			writeError(writer, http.StatusBadRequest, "id is required")
			return
		}

		var payload models.InstanceInput
		if err := decodeJSON(request.Body, &payload); err != nil {
			writeError(writer, http.StatusBadRequest, err.Error())
			return
		}

		if err := api.deps.InstancesStore.UpdateInstance(instanceID, payload); err != nil {
			writeError(writer, http.StatusBadRequest, err.Error())
			return
		}
		writeJSON(writer, http.StatusOK, map[string]string{"status": "updated"})
	case http.MethodDelete:
		instanceID := strings.TrimSpace(request.URL.Query().Get("id"))
		if instanceID == "" {
			writeError(writer, http.StatusBadRequest, "id is required")
			return
		}

		if err := api.deps.InstancesStore.DeleteInstance(instanceID); err != nil {
			writeError(writer, http.StatusNotFound, err.Error())
			return
		}
		writeJSON(writer, http.StatusOK, map[string]string{"status": "deleted"})
	default:
		writeError(writer, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (api *APIServer) handleGitHubSearch(writer http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodGet {
		writeError(writer, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	token, _ := api.deps.TokenStore.Read()
	results, err := api.deps.GitHub.Search(request.URL.Query().Get("q"), token)
	if err != nil {
		writeError(writer, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(writer, http.StatusOK, results)
}

func (api *APIServer) handleGitHubRepos(writer http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodGet {
		writeError(writer, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	owner := request.URL.Query().Get("owner")
	token, _ := api.deps.TokenStore.Read()
	repos, err := api.deps.GitHub.ListRepositories(owner, token)
	if err != nil {
		writeError(writer, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(writer, http.StatusOK, repos)
}

func (api *APIServer) handleGitHubManifest(writer http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodGet {
		writeError(writer, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	owner := strings.TrimSpace(request.URL.Query().Get("owner"))
	repo := strings.TrimSpace(request.URL.Query().Get("repo"))
	if owner == "" || repo == "" {
		writeError(writer, http.StatusBadRequest, "owner and repo are required")
		return
	}

	token, _ := api.deps.TokenStore.Read()
	manifest, err := api.deps.GitHub.FetchManifest(owner, repo, token)
	if err != nil {
		writeError(writer, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(writer, http.StatusOK, models.RepositoryItem{
		Owner:    owner,
		Name:     repo,
		FullName: owner + "/" + repo,
		HTMLURL:  "https://github.com/" + owner + "/" + repo,
		Manifest: manifest,
	})
}

func (api *APIServer) handleStartDeviceFlow(writer http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodPost {
		writeError(writer, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	var payload models.DeviceFlowStartRequest
	if err := decodeJSON(request.Body, &payload); err != nil {
		writeError(writer, http.StatusBadRequest, err.Error())
		return
	}

	response, err := api.deps.DeviceFlow.Start(payload.Scopes)
	if err != nil {
		writeError(writer, http.StatusBadRequest, err.Error())
		return
	}

	writeJSON(writer, http.StatusOK, response)
}

func (api *APIServer) handlePollDeviceFlow(writer http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodPost {
		writeError(writer, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	var payload models.DeviceFlowPollRequest
	if err := decodeJSON(request.Body, &payload); err != nil {
		writeError(writer, http.StatusBadRequest, err.Error())
		return
	}

	response, err := api.deps.DeviceFlow.Poll(payload.DeviceCode)
	if err != nil {
		var pendingErr *auth.DeviceFlowPendingError
		if errors.As(err, &pendingErr) {
			writeJSON(writer, http.StatusPreconditionRequired, map[string]string{
				"error": pendingErr.Error(),
				"code":  pendingErr.Code,
			})
			return
		}

		writeError(writer, http.StatusBadRequest, err.Error())
		return
	}

	writeJSON(writer, http.StatusOK, response)
}

func (api *APIServer) handleStartWebOAuth(writer http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodPost {
		writeError(writer, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	var payload models.DeviceFlowStartRequest
	if err := decodeJSON(request.Body, &payload); err != nil {
		writeError(writer, http.StatusBadRequest, err.Error())
		return
	}

	state, err := generateOAuthState()
	if err != nil {
		writeError(writer, http.StatusInternalServerError, err.Error())
		return
	}

	response, err := api.deps.DeviceFlow.StartWebLogin(payload.Scopes, state)
	if err != nil {
		writeError(writer, http.StatusBadRequest, err.Error())
		return
	}

	api.oauthStateMu.Lock()
	api.oauthState = state
	api.oauthStateExpiresAt = time.Now().Add(10 * time.Minute)
	api.oauthStateMu.Unlock()

	writeJSON(writer, http.StatusOK, response)
}

func (api *APIServer) handleSetToken(writer http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodPost {
		writeError(writer, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	var payload models.SetTokenRequest
	if err := decodeJSON(request.Body, &payload); err != nil {
		writeError(writer, http.StatusBadRequest, err.Error())
		return
	}

	if err := api.deps.TokenStore.Save(payload.AccessToken); err != nil {
		writeError(writer, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(writer, http.StatusOK, map[string]string{"status": "saved"})
}

func (api *APIServer) handleGitHubAuthStatus(writer http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodGet {
		writeError(writer, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	token, err := api.deps.TokenStore.Read()
	if err != nil {
		writeError(writer, http.StatusInternalServerError, err.Error())
		return
	}

	connected := strings.TrimSpace(token) != ""
	if connected {
		valid, err := api.deps.GitHub.ValidateToken(token)
		if err != nil {
			api.logger.Printf("warning: github token validation failed: %v", err)
		} else {
			connected = valid
		}
	}

	writeJSON(writer, http.StatusOK, map[string]bool{"connected": connected})
}

func (api *APIServer) handleDeployFTP(writer http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodPost {
		writeError(writer, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	var payload models.FTPDeployRequest
	if err := decodeJSON(request.Body, &payload); err != nil {
		writeError(writer, http.StatusBadRequest, err.Error())
		return
	}

	result, err := api.deps.FTPEngine.Deploy(context.Background(), payload)
	if err != nil {
		writeError(writer, http.StatusBadRequest, err.Error())
		return
	}

	writeJSON(writer, http.StatusOK, result)
}

func (api *APIServer) handleFTPDirectories(writer http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodPost {
		writeError(writer, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	var payload models.FTPDirectoriesRequest
	if err := decodeJSON(request.Body, &payload); err != nil {
		writeError(writer, http.StatusBadRequest, err.Error())
		return
	}

	response, err := api.deps.FTPEngine.ListDirectories(request.Context(), payload)
	if err != nil {
		writeError(writer, http.StatusBadRequest, err.Error())
		return
	}

	writeJSON(writer, http.StatusOK, response)
}

func (api *APIServer) handleDeployFTPByInstance(writer http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodPost {
		writeError(writer, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	var payload models.FTPDeployByInstanceRequest
	if err := decodeJSON(request.Body, &payload); err != nil {
		writeError(writer, http.StatusBadRequest, err.Error())
		return
	}

	instance, err := api.deps.InstancesStore.GetInstanceInput(payload.InstanceID)
	if err != nil {
		writeError(writer, http.StatusNotFound, err.Error())
		return
	}

	token, _ := api.deps.TokenStore.Read()
	manifest, manifestErr := api.deps.GitHub.FetchManifestAtRef(instance.Owner, instance.Repo, payload.GitRef, token)
	if manifestErr != nil {
		writeError(writer, http.StatusBadGateway, manifestErr.Error())
		return
	}

	if manifest != nil && manifest.Launcher.RequiresSQL {
		missing := missingSQLConfigFields(instance)
		if len(missing) > 0 {
			writeError(
				writer,
				http.StatusBadRequest,
				"this project requires SQL but this instance is missing: "+strings.Join(missing, ", ")+" (sqlDatabase is optional if database already exists)",
			)
			return
		}
	}

	sourcePath, cleanup, err := api.deps.GitHub.DownloadRepositorySource(instance.Owner, instance.Repo, payload.GitRef, token)
	if err != nil {
		writeError(writer, http.StatusBadGateway, err.Error())
		return
	}
	defer cleanup()

	ignorePatterns := []string{}
	if manifest != nil {
		ignorePatterns = append(ignorePatterns, manifest.Launcher.Ignore...)
	}

	deployRequest := models.FTPDeployRequest{
		LocalPath:      sourcePath,
		RemotePath:     instance.FTPRemotePath,
		Host:           instance.FTPHost,
		Port:           instance.FTPPort,
		Username:       instance.FTPUsername,
		Password:       instance.FTPPassword,
		Ignore:         ignorePatterns,
		RollbackOnFail: payload.RollbackOnFail,
	}

	result, err := api.deps.FTPEngine.Deploy(context.Background(), deployRequest)
	if err != nil {
		writeError(writer, http.StatusBadRequest, err.Error())
		return
	}

	refLabel := strings.TrimSpace(payload.GitRef)
	if refLabel == "" {
		refLabel = "default-branch"
	}

	result.Logs = append(
		[]string{fmt.Sprintf("source: github %s/%s (ref=%s)", instance.Owner, instance.Repo, refLabel)},
		result.Logs...,
	)

	if manifest != nil && len(ignorePatterns) > 0 {
		result.Logs = append(result.Logs, fmt.Sprintf("ignore patterns applied: %d", len(ignorePatterns)))
	}

	if manifest != nil && manifest.Launcher.RequiresSQL {
		schemaPath := resolveManifestSQLScriptPath(manifest)
		if schemaPath == "" {
			writeError(writer, http.StatusBadRequest, "manifest requires_sql=true but no SQL file path is defined (manifest.database, launcher.sql_schema_path, launcher.database_file_path)")
			return
		}

		scriptPayload, scriptErr := api.deps.GitHub.FetchTextFileAtRef(instance.Owner, instance.Repo, schemaPath, payload.GitRef, token)
		if scriptErr != nil {
			writeError(writer, http.StatusBadGateway, "load SQL script from GitHub: "+scriptErr.Error())
			return
		}

		if execErr := api.deps.SQLExecutor.ExecuteDirect(instance.SQLDSN, instance.SQLUsername, instance.SQLPassword, instance.SQLDatabase, string(scriptPayload)); execErr != nil {
			writeError(writer, http.StatusBadRequest, "execute SQL import: "+execErr.Error())
			return
		}

		result.Logs = append(result.Logs, "sql import applied from "+schemaPath)
	}

	writeJSON(writer, http.StatusOK, result)
}

func (api *APIServer) handleSQLMigrationPlan(writer http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodPost {
		writeError(writer, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	var payload models.SQLMigrationPlanRequest
	if err := decodeJSON(request.Body, &payload); err != nil {
		writeError(writer, http.StatusBadRequest, err.Error())
		return
	}

	if strings.TrimSpace(payload.InstanceID) == "" || strings.TrimSpace(payload.FromRef) == "" || strings.TrimSpace(payload.ToRef) == "" {
		writeError(writer, http.StatusBadRequest, "instance_id, from_ref and to_ref are required")
		return
	}

	instance, err := api.deps.InstancesStore.GetInstanceInput(payload.InstanceID)
	if err != nil {
		writeError(writer, http.StatusNotFound, err.Error())
		return
	}

	if missing := missingSQLConfigFields(instance); len(missing) > 0 {
		writeError(writer, http.StatusBadRequest, "selected instance SQL config is incomplete, missing: "+strings.Join(missing, ", "))
		return
	}

	token, _ := api.deps.TokenStore.Read()
	schemaPath := strings.TrimSpace(payload.SchemaPath)
	if schemaPath == "" {
		manifest, manifestErr := api.deps.GitHub.FetchManifestAtRef(instance.Owner, instance.Repo, payload.ToRef, token)
		if manifestErr != nil {
			writeError(writer, http.StatusBadGateway, manifestErr.Error())
			return
		}

		schemaPath = resolveManifestSQLScriptPath(manifest)

		if schemaPath == "" {
			writeError(writer, http.StatusBadRequest, "schema_path is required when manifest.database, manifest.launcher.sql_schema_path and manifest.launcher.database_file_path are not set")
			return
		}
	}

	fromSchema, err := api.deps.GitHub.FetchTextFileAtRef(instance.Owner, instance.Repo, schemaPath, payload.FromRef, token)
	if err != nil {
		writeError(writer, http.StatusBadGateway, err.Error())
		return
	}

	toSchema, err := api.deps.GitHub.FetchTextFileAtRef(instance.Owner, instance.Repo, schemaPath, payload.ToRef, token)
	if err != nil {
		writeError(writer, http.StatusBadGateway, err.Error())
		return
	}

	plan, err := api.deps.SQLPlanner.BuildPlan(payload.FromRef, payload.ToRef, schemaPath, fromSchema, toSchema)
	if err != nil {
		writeError(writer, http.StatusBadRequest, err.Error())
		return
	}

	writeJSON(writer, http.StatusOK, plan)
}

func withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		writer.Header().Set("Access-Control-Allow-Origin", "*")
		writer.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		writer.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")

		if request.Method == http.MethodOptions {
			writer.WriteHeader(http.StatusNoContent)
			return
		}

		next.ServeHTTP(writer, request)
	})
}

func decodeJSON(body io.ReadCloser, destination any) error {
	defer body.Close()
	decoder := json.NewDecoder(body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(destination); err != nil {
		return fmt.Errorf("invalid json payload: %w", err)
	}
	return nil
}

func writeJSON(writer http.ResponseWriter, status int, payload any) {
	writer.Header().Set("Content-Type", "application/json")
	writer.WriteHeader(status)
	_ = json.NewEncoder(writer).Encode(payload)
}

func writeError(writer http.ResponseWriter, status int, message string) {
	writeJSON(writer, status, map[string]string{"error": message})
}

func missingSQLConfigFields(input models.InstanceInput) []string {
	missing := []string{}
	if strings.TrimSpace(input.SQLDSN) == "" {
		missing = append(missing, "sqlDsn")
	}
	if strings.TrimSpace(input.SQLUsername) == "" {
		missing = append(missing, "sqlUsername")
	}
	if strings.TrimSpace(input.SQLPassword) == "" {
		missing = append(missing, "sqlPassword")
	}
	return missing
}

func resolveManifestSQLScriptPath(manifest *models.LauncherManifest) string {
	if manifest == nil {
		return ""
	}

	if path := strings.TrimSpace(manifest.Database); path != "" {
		return path
	}

	if path := strings.TrimSpace(manifest.Launcher.SQLSchemaPath); path != "" {
		return path
	}

	if path := strings.TrimSpace(manifest.Launcher.DatabaseFilePath); path != "" {
		return path
	}

	return ""
}

func generateOAuthState() (string, error) {
	payload := make([]byte, 24)
	if _, err := rand.Read(payload); err != nil {
		return "", fmt.Errorf("generate oauth state: %w", err)
	}

	return base64.RawURLEncoding.EncodeToString(payload), nil
}

func renderOAuthPage(writer http.ResponseWriter, status int, title, message string, success bool) {
	badgeText := "Authorization Failed"
	badgeColor := "#ffe4e4"
	badgeBorder := "#ffb7b7"
	badgeTextColor := "#9b2020"

	if success {
		badgeText = "Authorization Complete"
		badgeColor = "#e8fff4"
		badgeBorder = "#99ebc8"
		badgeTextColor = "#0b7a4f"
	}

	title = html.EscapeString(title)
	message = html.EscapeString(message)

	page := fmt.Sprintf(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Launcher Desktop OAuth</title>
    <style>
      :root {
        --bg-a: #eef4ff;
        --bg-b: #f6fff4;
        --panel: rgba(255, 255, 255, 0.92);
        --line: #d7e2f2;
        --text: #173053;
        --muted: #5f718b;
        --primary: #1f73ff;
      }

      * { box-sizing: border-box; }

      body {
        margin: 0;
        min-height: 100vh;
        font-family: "Segoe UI", "Calibri", sans-serif;
        color: var(--text);
        background:
          radial-gradient(circle at 8%% 12%%, #cbe0ff 0%%, transparent 33%%),
          radial-gradient(circle at 86%% 8%%, #d8ffd8 0%%, transparent 35%%),
          linear-gradient(165deg, var(--bg-a), var(--bg-b));
        display: grid;
        grid-template-rows: auto 1fr;
      }

      .topbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 14px 22px;
        border-bottom: 1px solid #dce7fb;
        background: rgba(255, 255, 255, 0.72);
        backdrop-filter: blur(6px);
      }

      .brand {
        display: inline-flex;
        align-items: center;
        gap: 10px;
        font-weight: 700;
      }

      .brand-dot {
        width: 22px;
        height: 22px;
        border-radius: 7px;
        background: linear-gradient(180deg, #2158ff, #6840dd);
        box-shadow: 0 10px 24px rgba(40, 72, 145, 0.25);
      }

      .layout {
        width: min(960px, 92vw);
        margin: 28px auto;
        display: grid;
        grid-template-columns: minmax(0, 1fr) 320px;
        gap: 18px;
      }

      .panel {
        border: 1px solid var(--line);
        border-radius: 18px;
        background: var(--panel);
        box-shadow: 0 16px 35px rgba(23, 48, 92, 0.12);
      }

      .main {
        padding: 20px;
      }

      .badge {
        display: inline-flex;
        align-items: center;
        border-radius: 999px;
        padding: 6px 12px;
        font-size: 12px;
        font-weight: 700;
        margin-bottom: 12px;
      }

      h1 {
        margin: 0 0 8px;
        font-size: 24px;
      }

      p {
        margin: 0;
        color: var(--muted);
        line-height: 1.45;
      }

      .actions {
        margin-top: 18px;
        display: flex;
        gap: 10px;
        flex-wrap: wrap;
      }

      .button {
        border: 1px solid #1f73ff;
        border-radius: 10px;
        background: linear-gradient(180deg, #1f73ff, #2f88ff);
        color: #fff;
        font-weight: 600;
        padding: 10px 14px;
        cursor: pointer;
      }

      .button.secondary {
        border-color: #b9c9ea;
        background: #f4f7ff;
        color: #24426d;
      }

      .side {
        padding: 18px;
      }

      .side h2 {
        margin: 0 0 8px;
        font-size: 16px;
      }

      .steps {
        margin: 0;
        padding-left: 18px;
        color: var(--muted);
        display: grid;
        gap: 8px;
      }

      @media (max-width: 860px) {
        .layout {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </head>
  <body>
    <header class="topbar">
      <div class="brand">
        <span class="brand-dot"></span>
        <span>Launcher Desktop</span>
      </div>
      <span style="color:#5f718b;font-size:13px;">GitHub OAuth Callback</span>
    </header>
    <main class="layout">
      <section class="panel main">
        <span class="badge" style="background:%s;border:1px solid %s;color:%s;">%s</span>
        <h1>%s</h1>
        <p>%s</p>
        <div class="actions">
          <button class="button" onclick="window.close()">Return To App</button>
          <button class="button secondary" onclick="location.reload()">Retry Page</button>
        </div>
      </section>
      <aside class="panel side">
        <h2>What Happens Next</h2>
        <ol class="steps">
          <li>Switch back to Launcher Desktop.</li>
          <li>Wait a few seconds for status refresh.</li>
          <li>If needed, start login again from Account.</li>
        </ol>
      </aside>
    </main>
  </body>
</html>`, badgeColor, badgeBorder, badgeTextColor, badgeText, title, message)

	writer.Header().Set("Content-Type", "text/html; charset=utf-8")
	writer.WriteHeader(status)
	_, _ = writer.Write([]byte(page))
}

func (api *APIServer) handleInstanceFTPVersion(writer http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodGet {
		writeError(writer, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	instanceID := strings.TrimSpace(request.URL.Query().Get("id"))
	if instanceID == "" {
		writeError(writer, http.StatusBadRequest, "id is required")
		return
	}

	input, err := api.deps.InstancesStore.GetInstanceInput(instanceID)
	if err != nil {
		writeError(writer, http.StatusNotFound, err.Error())
		return
	}

	version, err := api.deps.FTPEngine.ReadRemoteManifestVersion(request.Context(), input)
	response := models.InstanceFTPVersionResponse{
		InstanceID: instanceID,
		CheckedAt:  time.Now().UTC().Format(time.RFC3339),
	}

	if err != nil {
		response.Error = err.Error()
		writeJSON(writer, http.StatusOK, response)
		return
	}

	response.Version = version
	writeJSON(writer, http.StatusOK, response)
}

func (api *APIServer) handleInstanceDeployStatus(writer http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodGet {
		writeError(writer, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	instanceID := strings.TrimSpace(request.URL.Query().Get("id"))
	if instanceID == "" {
		writeError(writer, http.StatusBadRequest, "id is required")
		return
	}

	input, err := api.deps.InstancesStore.GetInstanceInput(instanceID)
	if err != nil {
		writeError(writer, http.StatusNotFound, err.Error())
		return
	}

	response := models.InstanceDeploymentStatusResponse{
		InstanceID: instanceID,
		SiteURL:    strings.TrimSpace(input.SiteURL),
	}

	token, _ := api.deps.TokenStore.Read()
	latestTag, tagErr := api.deps.GitHub.FetchLatestTag(input.Owner, input.Repo, token)
	if tagErr != nil {
		response.Error = tagErr.Error()
		writeJSON(writer, http.StatusOK, response)
		return
	}
	response.LatestGitTag = latestTag

	isEmpty, emptyErr := api.deps.FTPEngine.IsRemotePathEmpty(request.Context(), input)
	if emptyErr != nil {
		response.Error = emptyErr.Error()
		writeJSON(writer, http.StatusOK, response)
		return
	}

	response.Deployed = !isEmpty
	if isEmpty {
		response.UpdateAvailable = false
		writeJSON(writer, http.StatusOK, response)
		return
	}

	remoteVersion, versionErr := api.deps.FTPEngine.ReadRemoteManifestVersion(request.Context(), input)
	if versionErr == nil {
		response.RemoteManifestVersion = strings.TrimSpace(remoteVersion)
	} else {
		response.Error = versionErr.Error()
	}

	if strings.TrimSpace(response.LatestGitTag) == "" {
		response.UpdateAvailable = false
		writeJSON(writer, http.StatusOK, response)
		return
	}

	if strings.TrimSpace(response.RemoteManifestVersion) == "" {
		response.UpdateAvailable = true
		writeJSON(writer, http.StatusOK, response)
		return
	}

	response.UpdateAvailable = compareVersionLabels(response.LatestGitTag, response.RemoteManifestVersion) != 0
	writeJSON(writer, http.StatusOK, response)
}

func compareVersionLabels(left, right string) int {
	normalize := func(value string) []string {
		value = strings.ToLower(strings.TrimSpace(value))
		value = strings.TrimPrefix(value, "v")
		value = strings.TrimPrefix(value, "release-")
		value = strings.TrimPrefix(value, "version-")
		value = strings.ReplaceAll(value, "_", ".")
		value = strings.ReplaceAll(value, "-", ".")
		parts := strings.Split(value, ".")
		clean := make([]string, 0, len(parts))
		for _, part := range parts {
			if strings.TrimSpace(part) == "" {
				continue
			}
			clean = append(clean, part)
		}
		return clean
	}

	leftParts := normalize(left)
	rightParts := normalize(right)

	maxLen := len(leftParts)
	if len(rightParts) > maxLen {
		maxLen = len(rightParts)
	}

	for index := 0; index < maxLen; index++ {
		leftPart := "0"
		if index < len(leftParts) {
			leftPart = leftParts[index]
		}

		rightPart := "0"
		if index < len(rightParts) {
			rightPart = rightParts[index]
		}

		leftNumber, leftNumberErr := parseVersionNumber(leftPart)
		rightNumber, rightNumberErr := parseVersionNumber(rightPart)

		if leftNumberErr == nil && rightNumberErr == nil {
			if leftNumber > rightNumber {
				return 1
			}
			if leftNumber < rightNumber {
				return -1
			}
			continue
		}

		if leftPart > rightPart {
			return 1
		}
		if leftPart < rightPart {
			return -1
		}
	}

	return 0
}

func parseVersionNumber(value string) (int, error) {
	if value == "" {
		return 0, fmt.Errorf("empty version part")
	}

	number := 0
	for _, character := range value {
		if character < '0' || character > '9' {
			return 0, fmt.Errorf("not numeric")
		}
		number = number*10 + int(character-'0')
	}

	return number, nil
}

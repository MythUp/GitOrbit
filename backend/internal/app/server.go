// Purpose: Wire dependencies and expose HTTP routes consumed by the desktop frontend.
package app

import (
  "context"
  "encoding/json"
  "fmt"
  "io"
  "log"
  "net/http"
  "strings"

  "launcher/backend/internal/config"
  "launcher/backend/internal/models"
  "launcher/backend/internal/security"
  "launcher/backend/internal/services/auth"
  "launcher/backend/internal/services/deploy"
  githubservice "launcher/backend/internal/services/github"
  "launcher/backend/internal/storage"
)

type ServerDependencies struct {
  ProfilesStore *storage.ProfilesStore
  InstancesStore *storage.InstancesStore
  TokenStore    *storage.TokenStore
  GitHub        *githubservice.Client
  DeviceFlow    *auth.DeviceFlowService
  FTPEngine     *deploy.FTPEngine
}

type APIServer struct {
  httpServer *http.Server
  deps       ServerDependencies
  logger     *log.Logger
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
    ProfilesStore: storage.NewProfilesStore(paths.ProfilesPath),
    InstancesStore: storage.NewInstancesStore(paths.InstancesPath, encryption),
    TokenStore:    storage.NewTokenStore(paths.OAuthTokenPath, encryption),
    GitHub:        githubservice.NewClient(),
    DeviceFlow:    auth.NewDeviceFlowService(),
    FTPEngine:     deploy.NewFTPEngine(paths.DeployLogDir),
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
  mux.HandleFunc("/api/profiles", api.handleProfiles)
  mux.HandleFunc("/api/instances", api.handleInstances)
  mux.HandleFunc("/api/github/search", api.handleGitHubSearch)
  mux.HandleFunc("/api/github/repos", api.handleGitHubRepos)
  mux.HandleFunc("/api/github/manifest", api.handleGitHubManifest)
  mux.HandleFunc("/api/auth/github/device/start", api.handleStartDeviceFlow)
  mux.HandleFunc("/api/auth/github/device/poll", api.handlePollDeviceFlow)
  mux.HandleFunc("/api/auth/github/token", api.handleSetToken)
  mux.HandleFunc("/api/auth/github/status", api.handleGitHubAuthStatus)
  mux.HandleFunc("/api/deploy/ftp", api.handleDeployFTP)
  mux.HandleFunc("/api/deploy/ftp/instance", api.handleDeployFTPByInstance)
}

func (api *APIServer) handleHealth(writer http.ResponseWriter, request *http.Request) {
  if request.Method != http.MethodGet {
    writeError(writer, http.StatusMethodNotAllowed, "method not allowed")
    return
  }
  writeJSON(writer, http.StatusOK, map[string]string{"status": "ok"})
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
    writeError(writer, http.StatusBadRequest, err.Error())
    return
  }

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

  writeJSON(writer, http.StatusOK, map[string]bool{"connected": strings.TrimSpace(token) != ""})
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

  deployRequest := models.FTPDeployRequest{
    LocalPath:      payload.LocalPath,
    RemotePath:     instance.FTPRemotePath,
    Host:           instance.FTPHost,
    Port:           instance.FTPPort,
    Username:       instance.FTPUsername,
    Password:       instance.FTPPassword,
    RollbackOnFail: payload.RollbackOnFail,
  }

  result, err := api.deps.FTPEngine.Deploy(context.Background(), deployRequest)
  if err != nil {
    writeError(writer, http.StatusBadRequest, err.Error())
    return
  }

  writeJSON(writer, http.StatusOK, result)
}

func withCORS(next http.Handler) http.Handler {
  return http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
    writer.Header().Set("Access-Control-Allow-Origin", "*")
    writer.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS")
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
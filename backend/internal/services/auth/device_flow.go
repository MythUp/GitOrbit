// Purpose: Implement GitHub OAuth device flow requests without embedding any client secret.
package auth

import (
  "encoding/json"
  "fmt"
  "io"
  "net/http"
  "net/url"
  "os"
  "strings"
  "time"

  "launcher/backend/internal/models"
)

const githubDeviceCodeEndpoint = "https://github.com/login/device/code"
const githubAccessTokenEndpoint = "https://github.com/login/oauth/access_token"

type DeviceFlowService struct {
  clientID   string
  httpClient *http.Client
}

func NewDeviceFlowService() *DeviceFlowService {
  return &DeviceFlowService{
    clientID: strings.TrimSpace(os.Getenv("GITHUB_OAUTH_CLIENT_ID")),
    httpClient: &http.Client{
      Timeout: 20 * time.Second,
    },
  }
}

func (service *DeviceFlowService) Start(scopes []string) (models.DeviceFlowStartResponse, error) {
  if service.clientID == "" {
    return models.DeviceFlowStartResponse{}, fmt.Errorf("missing GITHUB_OAUTH_CLIENT_ID environment variable")
  }

  form := url.Values{}
  form.Set("client_id", service.clientID)
  form.Set("scope", strings.Join(scopes, " "))

  request, err := http.NewRequest(http.MethodPost, githubDeviceCodeEndpoint, strings.NewReader(form.Encode()))
  if err != nil {
    return models.DeviceFlowStartResponse{}, fmt.Errorf("build device code request: %w", err)
  }

  request.Header.Set("Accept", "application/json")
  request.Header.Set("Content-Type", "application/x-www-form-urlencoded")

  response, err := service.httpClient.Do(request)
  if err != nil {
    return models.DeviceFlowStartResponse{}, fmt.Errorf("request device code: %w", err)
  }
  defer response.Body.Close()

  payload, err := io.ReadAll(response.Body)
  if err != nil {
    return models.DeviceFlowStartResponse{}, fmt.Errorf("read device code response: %w", err)
  }

  if response.StatusCode >= 400 {
    return models.DeviceFlowStartResponse{}, fmt.Errorf("device flow start failed: %s", string(payload))
  }

  var parsed models.DeviceFlowStartResponse
  if err := json.Unmarshal(payload, &parsed); err != nil {
    return models.DeviceFlowStartResponse{}, fmt.Errorf("decode device flow start: %w", err)
  }

  return parsed, nil
}

func (service *DeviceFlowService) Poll(deviceCode string) (models.DeviceFlowPollResponse, error) {
  if service.clientID == "" {
    return models.DeviceFlowPollResponse{}, fmt.Errorf("missing GITHUB_OAUTH_CLIENT_ID environment variable")
  }

  form := url.Values{}
  form.Set("client_id", service.clientID)
  form.Set("device_code", deviceCode)
  form.Set("grant_type", "urn:ietf:params:oauth:grant-type:device_code")

  request, err := http.NewRequest(http.MethodPost, githubAccessTokenEndpoint, strings.NewReader(form.Encode()))
  if err != nil {
    return models.DeviceFlowPollResponse{}, fmt.Errorf("build token poll request: %w", err)
  }

  request.Header.Set("Accept", "application/json")
  request.Header.Set("Content-Type", "application/x-www-form-urlencoded")

  response, err := service.httpClient.Do(request)
  if err != nil {
    return models.DeviceFlowPollResponse{}, fmt.Errorf("poll token: %w", err)
  }
  defer response.Body.Close()

  payload, err := io.ReadAll(response.Body)
  if err != nil {
    return models.DeviceFlowPollResponse{}, fmt.Errorf("read token response: %w", err)
  }

  if response.StatusCode >= 400 {
    return models.DeviceFlowPollResponse{}, fmt.Errorf("device flow poll failed: %s", string(payload))
  }

  var errorEnvelope struct {
    Error            string `json:"error"`
    ErrorDescription string `json:"error_description"`
  }
  _ = json.Unmarshal(payload, &errorEnvelope)
  if errorEnvelope.Error != "" {
    return models.DeviceFlowPollResponse{}, fmt.Errorf("device flow pending: %s", errorEnvelope.ErrorDescription)
  }

  var token models.DeviceFlowPollResponse
  if err := json.Unmarshal(payload, &token); err != nil {
    return models.DeviceFlowPollResponse{}, fmt.Errorf("decode token response: %w", err)
  }

  return token, nil
}
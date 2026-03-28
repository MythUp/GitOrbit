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
const githubAuthorizeEndpoint = "https://github.com/login/oauth/authorize"

type DeviceFlowPendingError struct {
	Code        string
	Description string
}

func (err *DeviceFlowPendingError) Error() string {
	if strings.TrimSpace(err.Description) == "" {
		return "device flow pending"
	}

	return "device flow pending: " + err.Description
}

type DeviceFlowService struct {
	clientID     string
	clientSecret string
	redirectURI  string
	httpClient   *http.Client
}

func NewDeviceFlowService() *DeviceFlowService {
	redirectURI := strings.TrimSpace(os.Getenv("GITHUB_OAUTH_REDIRECT_URI"))
	if redirectURI == "" {
		redirectURI = "http://localhost:3547/callback"
	}

	return &DeviceFlowService{
		clientID:     strings.TrimSpace(os.Getenv("GITHUB_OAUTH_CLIENT_ID")),
		clientSecret: strings.TrimSpace(os.Getenv("GITHUB_OAUTH_CLIENT_SECRET")),
		redirectURI:  redirectURI,
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
		if errorEnvelope.Error == "authorization_pending" || errorEnvelope.Error == "slow_down" {
			return models.DeviceFlowPollResponse{}, &DeviceFlowPendingError{
				Code:        errorEnvelope.Error,
				Description: errorEnvelope.ErrorDescription,
			}
		}

		if strings.TrimSpace(errorEnvelope.ErrorDescription) == "" {
			return models.DeviceFlowPollResponse{}, fmt.Errorf("device_flow_%s", errorEnvelope.Error)
		}

		return models.DeviceFlowPollResponse{}, fmt.Errorf("device_flow_%s: %s", errorEnvelope.Error, errorEnvelope.ErrorDescription)
	}

	var token models.DeviceFlowPollResponse
	if err := json.Unmarshal(payload, &token); err != nil {
		return models.DeviceFlowPollResponse{}, fmt.Errorf("decode token response: %w", err)
	}

	return token, nil
}

func (service *DeviceFlowService) StartWebLogin(scopes []string, state string) (models.WebAuthStartResponse, error) {
	if service.clientID == "" {
		return models.WebAuthStartResponse{}, fmt.Errorf("missing GITHUB_OAUTH_CLIENT_ID environment variable")
	}

	if service.clientSecret == "" {
		return models.WebAuthStartResponse{}, fmt.Errorf("missing GITHUB_OAUTH_CLIENT_SECRET environment variable")
	}

	values := url.Values{}
	values.Set("client_id", service.clientID)
	values.Set("redirect_uri", service.redirectURI)
	values.Set("scope", strings.Join(scopes, " "))
	values.Set("state", state)

	return models.WebAuthStartResponse{
		AuthURL: githubAuthorizeEndpoint + "?" + values.Encode(),
	}, nil
}

func (service *DeviceFlowService) ExchangeWebCode(code string) (models.DeviceFlowPollResponse, error) {
	if service.clientID == "" {
		return models.DeviceFlowPollResponse{}, fmt.Errorf("missing GITHUB_OAUTH_CLIENT_ID environment variable")
	}

	if service.clientSecret == "" {
		return models.DeviceFlowPollResponse{}, fmt.Errorf("missing GITHUB_OAUTH_CLIENT_SECRET environment variable")
	}

	form := url.Values{}
	form.Set("client_id", service.clientID)
	form.Set("client_secret", service.clientSecret)
	form.Set("code", strings.TrimSpace(code))
	form.Set("redirect_uri", service.redirectURI)

	request, err := http.NewRequest(http.MethodPost, githubAccessTokenEndpoint, strings.NewReader(form.Encode()))
	if err != nil {
		return models.DeviceFlowPollResponse{}, fmt.Errorf("build web oauth token request: %w", err)
	}

	request.Header.Set("Accept", "application/json")
	request.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	response, err := service.httpClient.Do(request)
	if err != nil {
		return models.DeviceFlowPollResponse{}, fmt.Errorf("exchange web oauth code: %w", err)
	}
	defer response.Body.Close()

	payload, err := io.ReadAll(response.Body)
	if err != nil {
		return models.DeviceFlowPollResponse{}, fmt.Errorf("read web oauth token response: %w", err)
	}

	if response.StatusCode >= 400 {
		return models.DeviceFlowPollResponse{}, fmt.Errorf("web oauth token exchange failed: %s", string(payload))
	}

	var errorEnvelope struct {
		Error            string `json:"error"`
		ErrorDescription string `json:"error_description"`
	}
	_ = json.Unmarshal(payload, &errorEnvelope)
	if strings.TrimSpace(errorEnvelope.Error) != "" {
		if strings.TrimSpace(errorEnvelope.ErrorDescription) == "" {
			return models.DeviceFlowPollResponse{}, fmt.Errorf("web_oauth_%s", errorEnvelope.Error)
		}

		return models.DeviceFlowPollResponse{}, fmt.Errorf("web_oauth_%s: %s", errorEnvelope.Error, errorEnvelope.ErrorDescription)
	}

	var token models.DeviceFlowPollResponse
	if err := json.Unmarshal(payload, &token); err != nil {
		return models.DeviceFlowPollResponse{}, fmt.Errorf("decode web oauth token response: %w", err)
	}

	return token, nil
}

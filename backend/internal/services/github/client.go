// Purpose: Wrap GitHub REST API calls for search, repositories listing, and launcher manifest retrieval.
package github

import (
  "encoding/base64"
  "encoding/json"
  "fmt"
  "io"
  "net/http"
  "net/url"
  "path"
  "strings"
  "sync"
  "time"

  "launcher/backend/internal/models"
)

const apiBaseURL = "https://api.github.com"

type Client struct {
  httpClient    *http.Client
  cacheMu       sync.Mutex
  manifestCache map[string]manifestCacheEntry
}

type manifestCacheEntry struct {
  manifest   *models.LauncherManifest
  expiresAt  time.Time
  hasValue   bool
}

func NewClient() *Client {
  return &Client{
    httpClient:    &http.Client{Timeout: 20 * time.Second},
    manifestCache: map[string]manifestCacheEntry{},
  }
}

func (client *Client) Search(query string, token string) ([]models.SearchResultItem, error) {
  if strings.TrimSpace(query) == "" {
    return []models.SearchResultItem{}, nil
  }

  users, err := client.searchUsers(query, token)
  if err != nil {
    return nil, err
  }

  repos, err := client.searchRepos(query, token)
  if err != nil {
    return nil, err
  }

  results := make([]models.SearchResultItem, 0, len(users)+len(repos))
  results = append(results, users...)
  results = append(results, repos...)
  return results, nil
}

func (client *Client) ListRepositories(owner string, token string) ([]models.RepositoryItem, error) {
  owner = strings.TrimSpace(owner)
  if owner == "" {
    return []models.RepositoryItem{}, nil
  }

  repos := map[string]models.RepositoryItem{}

  publicPath := fmt.Sprintf("/users/%s/repos?per_page=100", url.PathEscape(owner))
  publicItems, err := client.fetchRepos(publicPath, token)
  if err != nil {
    return nil, err
  }

  for _, item := range publicItems {
    repos[item.FullName] = item
  }

  if token != "" {
    orgPath := fmt.Sprintf("/orgs/%s/repos?type=all&per_page=100", url.PathEscape(owner))
    orgItems, _ := client.fetchRepos(orgPath, token)
    for _, item := range orgItems {
      repos[item.FullName] = item
    }

    userItems, _ := client.fetchRepos("/user/repos?visibility=all&per_page=100", token)
    for _, item := range userItems {
      if strings.EqualFold(item.Owner, owner) {
        repos[item.FullName] = item
      }
    }
  }

  output := make([]models.RepositoryItem, 0, len(repos))
  for _, repo := range repos {
    output = append(output, repo)
  }

  return output, nil
}

func (client *Client) FetchManifest(owner, repo, token string) (*models.LauncherManifest, error) {
  cacheKey := strings.ToLower(strings.TrimSpace(owner) + "/" + strings.TrimSpace(repo))

  client.cacheMu.Lock()
  if entry, ok := client.manifestCache[cacheKey]; ok && time.Now().Before(entry.expiresAt) && entry.hasValue {
    client.cacheMu.Unlock()
    return entry.manifest, nil
  }
  client.cacheMu.Unlock()

  endpoint := fmt.Sprintf("/repos/%s/%s/contents/manifest.json", url.PathEscape(owner), url.PathEscape(repo))
  payload, status, err := client.doJSON(http.MethodGet, endpoint, token)
  if err != nil {
    return nil, err
  }
  if status == http.StatusNotFound {
    client.cacheMu.Lock()
    client.manifestCache[cacheKey] = manifestCacheEntry{
      manifest:  nil,
      expiresAt: time.Now().Add(10 * time.Minute),
      hasValue:  true,
    }
    client.cacheMu.Unlock()
    return nil, nil
  }

  var response struct {
    Content string `json:"content"`
  }

  if err := json.Unmarshal(payload, &response); err != nil {
    return nil, fmt.Errorf("decode manifest envelope: %w", err)
  }

  cleanContent := strings.ReplaceAll(response.Content, "\n", "")
  rawManifest, err := base64.StdEncoding.DecodeString(cleanContent)
  if err != nil {
    return nil, fmt.Errorf("decode manifest content: %w", err)
  }

  var manifest models.LauncherManifest
  if err := json.Unmarshal(rawManifest, &manifest); err != nil {
    return nil, fmt.Errorf("decode manifest: %w", err)
  }

  client.cacheMu.Lock()
  client.manifestCache[cacheKey] = manifestCacheEntry{
    manifest:  &manifest,
    expiresAt: time.Now().Add(10 * time.Minute),
    hasValue:  true,
  }
  client.cacheMu.Unlock()

  return &manifest, nil
}

func (client *Client) searchUsers(query, token string) ([]models.SearchResultItem, error) {
  endpoint := "/search/users?q=" + url.QueryEscape(query) + "+in:login&type=Users&per_page=10"
  payload, _, err := client.doJSON(http.MethodGet, endpoint, token)
  if err != nil {
    return nil, err
  }

  var response struct {
    Items []struct {
      ID        int64  `json:"id"`
      Login     string `json:"login"`
      HTMLURL   string `json:"html_url"`
      Type      string `json:"type"`
      AvatarURL string `json:"avatar_url"`
    } `json:"items"`
  }

  if err := json.Unmarshal(payload, &response); err != nil {
    return nil, fmt.Errorf("decode user search: %w", err)
  }

  results := make([]models.SearchResultItem, 0, len(response.Items))
  for _, item := range response.Items {
    entryType := "user"
    if strings.EqualFold(item.Type, "Organization") {
      entryType = "org"
    }
    results = append(results, models.SearchResultItem{
      ID:   item.ID,
      Type: entryType,
      Name: item.Login,
      URL:  item.HTMLURL,
    })
  }

  return results, nil
}

func (client *Client) searchRepos(query, token string) ([]models.SearchResultItem, error) {
  endpoint := "/search/repositories?q=" + url.QueryEscape(query) + "&per_page=10"
  payload, _, err := client.doJSON(http.MethodGet, endpoint, token)
  if err != nil {
    return nil, err
  }

  var response struct {
    Items []struct {
      ID          int64  `json:"id"`
      FullName    string `json:"full_name"`
      HTMLURL     string `json:"html_url"`
      Description string `json:"description"`
    } `json:"items"`
  }

  if err := json.Unmarshal(payload, &response); err != nil {
    return nil, fmt.Errorf("decode repo search: %w", err)
  }

  results := make([]models.SearchResultItem, 0, len(response.Items))
  for _, item := range response.Items {
    parts := strings.SplitN(item.FullName, "/", 2)
    owner := ""
    repo := ""
    if len(parts) == 2 {
      owner = parts[0]
      repo = parts[1]
    }

    results = append(results, models.SearchResultItem{
      ID:          item.ID,
      Type:        "repo",
      Name:        item.FullName,
      URL:         item.HTMLURL,
      Description: item.Description,
      Owner:       owner,
      Repo:        repo,
    })
  }

  return results, nil
}

func (client *Client) fetchRepos(endpoint, token string) ([]models.RepositoryItem, error) {
  payload, _, err := client.doJSON(http.MethodGet, endpoint, token)
  if err != nil {
    return nil, err
  }

  var response []struct {
    ID            int64  `json:"id"`
    Name          string `json:"name"`
    FullName      string `json:"full_name"`
    Private       bool   `json:"private"`
    HTMLURL       string `json:"html_url"`
    Description   string `json:"description"`
    DefaultBranch string `json:"default_branch"`
    Owner         struct {
      Login string `json:"login"`
    } `json:"owner"`
  }

  if err := json.Unmarshal(payload, &response); err != nil {
    return nil, fmt.Errorf("decode repos: %w", err)
  }

  repos := make([]models.RepositoryItem, 0, len(response))
  for _, item := range response {
    repos = append(repos, models.RepositoryItem{
      ID:            item.ID,
      Owner:         item.Owner.Login,
      Name:          path.Base(item.FullName),
      FullName:      item.FullName,
      Private:       item.Private,
      HTMLURL:       item.HTMLURL,
      DefaultBranch: item.DefaultBranch,
      Description:   item.Description,
    })
  }

  return repos, nil
}

func (client *Client) doJSON(method, endpoint, token string) ([]byte, int, error) {
  request, err := http.NewRequest(method, apiBaseURL+endpoint, nil)
  if err != nil {
    return nil, 0, fmt.Errorf("build request: %w", err)
  }

  request.Header.Set("Accept", "application/vnd.github+json")
  request.Header.Set("User-Agent", "LauncherDesktop")
  if token != "" {
    request.Header.Set("Authorization", "Bearer "+token)
  }

  response, err := client.httpClient.Do(request)
  if err != nil {
    return nil, 0, fmt.Errorf("run request: %w", err)
  }
  defer response.Body.Close()

  payload, err := io.ReadAll(response.Body)
  if err != nil {
    return nil, response.StatusCode, fmt.Errorf("read response: %w", err)
  }

  if response.StatusCode >= 400 && response.StatusCode != http.StatusNotFound {
    return nil, response.StatusCode, fmt.Errorf("github api status %d: %s", response.StatusCode, string(payload))
  }

  return payload, response.StatusCode, nil
}
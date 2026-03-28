// Purpose: Download repository sources and read repository files at specific refs for deployment and migration planning.
package github

import (
	"archive/zip"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"strings"

	"launcher/backend/internal/models"
)

func (client *Client) DownloadRepositorySource(owner, repo, ref, token string) (string, func(), error) {
	owner = strings.TrimSpace(owner)
	repo = strings.TrimSpace(repo)
	ref = strings.TrimSpace(ref)

	if owner == "" || repo == "" {
		return "", nil, fmt.Errorf("owner and repo are required")
	}

	endpoint := fmt.Sprintf("/repos/%s/%s/zipball", url.PathEscape(owner), url.PathEscape(repo))
	if ref != "" {
		endpoint += "/" + url.PathEscape(ref)
	}

	request, err := http.NewRequest(http.MethodGet, apiBaseURL+endpoint, nil)
	if err != nil {
		return "", nil, fmt.Errorf("build archive request: %w", err)
	}

	request.Header.Set("Accept", "application/vnd.github+json")
	request.Header.Set("User-Agent", "LauncherDesktop")
	if strings.TrimSpace(token) != "" {
		request.Header.Set("Authorization", "Bearer "+strings.TrimSpace(token))
	}

	response, err := client.httpClient.Do(request)
	if err != nil {
		return "", nil, fmt.Errorf("download repository archive: %w", err)
	}
	defer response.Body.Close()

	if response.StatusCode >= 400 {
		payload, _ := io.ReadAll(response.Body)
		return "", nil, fmt.Errorf("repository archive status %d: %s", response.StatusCode, string(payload))
	}

	tempDir, err := os.MkdirTemp("", "launcher-repo-source-*")
	if err != nil {
		return "", nil, fmt.Errorf("create temp dir: %w", err)
	}

	cleanup := func() {
		_ = os.RemoveAll(tempDir)
	}

	zipPath := filepath.Join(tempDir, "source.zip")
	zipFile, err := os.Create(zipPath)
	if err != nil {
		cleanup()
		return "", nil, fmt.Errorf("create temp archive file: %w", err)
	}

	if _, err := io.Copy(zipFile, response.Body); err != nil {
		_ = zipFile.Close()
		cleanup()
		return "", nil, fmt.Errorf("store repository archive: %w", err)
	}

	if err := zipFile.Close(); err != nil {
		cleanup()
		return "", nil, fmt.Errorf("close repository archive file: %w", err)
	}

	sourceDir := filepath.Join(tempDir, "source")
	if err := os.MkdirAll(sourceDir, 0o700); err != nil {
		cleanup()
		return "", nil, fmt.Errorf("create source dir: %w", err)
	}

	if err := extractZipWithoutTopLevel(zipPath, sourceDir); err != nil {
		cleanup()
		return "", nil, err
	}

	return sourceDir, cleanup, nil
}

func (client *Client) FetchManifestAtRef(owner, repo, ref, token string) (*models.LauncherManifest, error) {
	payload, status, err := client.fetchContents(owner, repo, "manifest.json", ref, token)
	if err != nil {
		return nil, err
	}

	if status == http.StatusNotFound {
		return nil, nil
	}

	var manifest models.LauncherManifest
	if err := json.Unmarshal(payload, &manifest); err != nil {
		return nil, fmt.Errorf("decode manifest: %w", err)
	}

	return &manifest, nil
}

func (client *Client) FetchTextFileAtRef(owner, repo, filePath, ref, token string) ([]byte, error) {
	payload, status, err := client.fetchContents(owner, repo, filePath, ref, token)
	if err != nil {
		return nil, err
	}

	if status == http.StatusNotFound {
		return nil, fmt.Errorf("file not found: %s", filePath)
	}

	return payload, nil
}

func (client *Client) fetchContents(owner, repo, filePath, ref, token string) ([]byte, int, error) {
	owner = strings.TrimSpace(owner)
	repo = strings.TrimSpace(repo)
	filePath = strings.TrimSpace(filePath)
	ref = strings.TrimSpace(ref)

	if owner == "" || repo == "" || filePath == "" {
		return nil, 0, fmt.Errorf("owner, repo, and file path are required")
	}

	cleanPath := path.Clean(strings.TrimPrefix(filePath, "/"))
	if cleanPath == "." || strings.HasPrefix(cleanPath, "../") {
		return nil, 0, fmt.Errorf("invalid repository file path: %s", filePath)
	}

	endpoint := fmt.Sprintf("/repos/%s/%s/contents/%s", url.PathEscape(owner), url.PathEscape(repo), escapeContentPath(cleanPath))
	if ref != "" {
		endpoint += "?ref=" + url.QueryEscape(ref)
	}

	payload, status, err := client.doJSON(http.MethodGet, endpoint, token)
	if err != nil {
		return nil, 0, err
	}

	if status == http.StatusNotFound {
		return nil, status, nil
	}

	var response struct {
		Content string `json:"content"`
	}

	if err := json.Unmarshal(payload, &response); err != nil {
		return nil, 0, fmt.Errorf("decode contents envelope: %w", err)
	}

	cleanContent := strings.ReplaceAll(response.Content, "\n", "")
	decoded, err := base64.StdEncoding.DecodeString(cleanContent)
	if err != nil {
		return nil, 0, fmt.Errorf("decode repository content: %w", err)
	}

	return decoded, status, nil
}

func escapeContentPath(filePath string) string {
	parts := strings.Split(filePath, "/")
	escaped := make([]string, 0, len(parts))
	for _, part := range parts {
		escaped = append(escaped, url.PathEscape(part))
	}

	return strings.Join(escaped, "/")
}

func extractZipWithoutTopLevel(zipPath, destination string) error {
	reader, err := zip.OpenReader(zipPath)
	if err != nil {
		return fmt.Errorf("open downloaded archive: %w", err)
	}
	defer reader.Close()

	destination = filepath.Clean(destination)

	for _, file := range reader.File {
		name := strings.TrimSpace(file.Name)
		if name == "" {
			continue
		}

		parts := strings.Split(name, "/")
		if len(parts) <= 1 {
			continue
		}

		relative := strings.Join(parts[1:], "/")
		if relative == "" {
			continue
		}

		relative = path.Clean(relative)
		if relative == "." || strings.HasPrefix(relative, "../") {
			return fmt.Errorf("invalid path in archive: %s", file.Name)
		}

		targetPath := filepath.Join(destination, filepath.FromSlash(relative))
		cleanTarget := filepath.Clean(targetPath)
		if cleanTarget != destination && !strings.HasPrefix(cleanTarget, destination+string(os.PathSeparator)) {
			return fmt.Errorf("archive path escapes destination: %s", file.Name)
		}

		if file.FileInfo().IsDir() {
			if err := os.MkdirAll(cleanTarget, 0o700); err != nil {
				return fmt.Errorf("create directory from archive: %w", err)
			}
			continue
		}

		if err := os.MkdirAll(filepath.Dir(cleanTarget), 0o700); err != nil {
			return fmt.Errorf("create archive parent directory: %w", err)
		}

		source, err := file.Open()
		if err != nil {
			return fmt.Errorf("open archive entry: %w", err)
		}

		destinationFile, err := os.OpenFile(cleanTarget, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o600)
		if err != nil {
			source.Close()
			return fmt.Errorf("create extracted file: %w", err)
		}

		_, copyErr := io.Copy(destinationFile, source)
		closeErr := destinationFile.Close()
		sourceCloseErr := source.Close()

		if copyErr != nil {
			return fmt.Errorf("extract file: %w", copyErr)
		}

		if closeErr != nil {
			return fmt.Errorf("close extracted file: %w", closeErr)
		}

		if sourceCloseErr != nil {
			return fmt.Errorf("close archive entry: %w", sourceCloseErr)
		}
	}

	return nil
}

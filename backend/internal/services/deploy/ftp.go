// Purpose: Provide a baseline FTP deployment engine with logging and rollback for overwritten files.
package deploy

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"os"
	"path"
	"path/filepath"
	"strings"
	"time"

	"github.com/jlaffaye/ftp"

	"launcher/backend/internal/models"
)

type FTPEngine struct {
	deployLogDir string
}

type rollbackEntry struct {
	RemotePath string `json:"remote_path"`
	BackupPath string `json:"backup_path"`
}

func NewFTPEngine(deployLogDir string) *FTPEngine {
	return &FTPEngine{deployLogDir: deployLogDir}
}

func (engine *FTPEngine) ReadRemoteManifestVersion(ctx context.Context, input models.InstanceInput) (string, error) {
	if input.FTPHost == "" || input.FTPUsername == "" || input.FTPPassword == "" {
		return "", fmt.Errorf("missing FTP credentials")
	}

	if err := ctx.Err(); err != nil {
		return "", err
	}

	address := net.JoinHostPort(input.FTPHost, fmt.Sprintf("%d", input.FTPPort))
	connection, err := ftp.Dial(address, ftp.DialWithTimeout(15*time.Second))
	if err != nil {
		return "", fmt.Errorf("connect ftp: %w", err)
	}
	defer connection.Quit()

	if err := connection.Login(input.FTPUsername, input.FTPPassword); err != nil {
		return "", fmt.Errorf("ftp login: %w", err)
	}

	manifestPath := path.Join(filepath.ToSlash(input.FTPRemotePath), "manifest.json")
	stream, err := connection.Retr(manifestPath)
	if err != nil {
		return "", fmt.Errorf("read remote manifest.json: %w", err)
	}
	defer stream.Close()

	payload, err := io.ReadAll(stream)
	if err != nil {
		return "", fmt.Errorf("read manifest payload: %w", err)
	}

	var manifest struct {
		Version string `json:"version"`
	}

	if err := json.Unmarshal(payload, &manifest); err != nil {
		return "", fmt.Errorf("decode manifest.json: %w", err)
	}

	if strings.TrimSpace(manifest.Version) == "" {
		return "", fmt.Errorf("manifest.json has no version field")
	}

	return strings.TrimSpace(manifest.Version), nil
}

func (engine *FTPEngine) Deploy(ctx context.Context, request models.FTPDeployRequest) (models.DeployResult, error) {
	result := models.DeployResult{Logs: []string{}}

	if request.LocalPath == "" || request.Host == "" || request.Username == "" {
		return result, fmt.Errorf("invalid FTP deployment request")
	}

	address := net.JoinHostPort(request.Host, fmt.Sprintf("%d", request.Port))
	connection, err := ftp.Dial(address, ftp.DialWithTimeout(15*time.Second))
	if err != nil {
		return result, fmt.Errorf("connect ftp: %w", err)
	}
	defer connection.Quit()

	if err := connection.Login(request.Username, request.Password); err != nil {
		return result, fmt.Errorf("ftp login: %w", err)
	}

	transactionID := time.Now().UTC().Format("20060102-150405")
	rollbackDir := filepath.Join(engine.deployLogDir, transactionID)
	if err := os.MkdirAll(rollbackDir, 0o700); err != nil {
		return result, fmt.Errorf("create rollback dir: %w", err)
	}

	entries := []rollbackEntry{}

	walkErr := filepath.Walk(request.LocalPath, func(localPath string, info os.FileInfo, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if info.IsDir() {
			return nil
		}

		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		relative, err := filepath.Rel(request.LocalPath, localPath)
		if err != nil {
			return err
		}

		remotePath := filepath.ToSlash(filepath.Join(request.RemotePath, relative))

		if existing, err := connection.Retr(remotePath); err == nil {
			backupPath := filepath.Join(rollbackDir, strings.ReplaceAll(relative, string(filepath.Separator), "__")+".bak")
			data, readErr := io.ReadAll(existing)
			existing.Close()
			if readErr == nil {
				_ = os.WriteFile(backupPath, data, 0o600)
				entries = append(entries, rollbackEntry{RemotePath: remotePath, BackupPath: backupPath})
				result.Updated++
			}
		} else {
			result.Uploaded++
		}

		localFile, err := os.Open(localPath)
		if err != nil {
			return err
		}
		defer localFile.Close()

		if err := ensureFTPDirectories(connection, filepath.ToSlash(filepath.Dir(remotePath))); err != nil {
			return err
		}

		if err := connection.Stor(remotePath, localFile); err != nil {
			return fmt.Errorf("upload %s: %w", remotePath, err)
		}

		result.Logs = append(result.Logs, "uploaded "+remotePath)
		return nil
	})

	if walkErr != nil {
		if request.RollbackOnFail {
			_ = engine.Rollback(connection, entries)
			result.Logs = append(result.Logs, "rollback completed due to deployment error")
		}
		return result, walkErr
	}

	logPath := filepath.Join(rollbackDir, "deploy-log.json")
	payload, _ := json.MarshalIndent(map[string]any{
		"request": request,
		"result":  result,
	}, "", "  ")
	_ = os.WriteFile(logPath, payload, 0o600)

	return result, nil
}

func (engine *FTPEngine) Rollback(connection *ftp.ServerConn, entries []rollbackEntry) error {
	for _, entry := range entries {
		data, err := os.ReadFile(entry.BackupPath)
		if err != nil {
			continue
		}

		if err := connection.Stor(entry.RemotePath, bytes.NewReader(data)); err != nil {
			return fmt.Errorf("rollback file %s: %w", entry.RemotePath, err)
		}
	}

	return nil
}

func ensureFTPDirectories(connection *ftp.ServerConn, dir string) error {
	if dir == "." || dir == "/" || dir == "" {
		return nil
	}

	parts := strings.Split(dir, "/")
	current := ""
	for _, part := range parts {
		if part == "" {
			continue
		}
		current += "/" + part
		_ = connection.MakeDir(current)
	}

	return nil
}

// Purpose: Resolve application data/config paths and ensure required JSON files exist.
package config

import (
  "encoding/json"
  "fmt"
  "os"
  "path/filepath"

  "launcher/backend/internal/models"
)

type Paths struct {
  ConfigDir         string
  DataDir           string
  ProfilesPath      string
  InstancesPath     string
  EncryptionKeyPath string
  OAuthTokenPath    string
  DeployLogDir      string
}

func ResolvePaths() (Paths, error) {
  configDir, err := os.UserConfigDir()
  if err != nil {
    return Paths{}, fmt.Errorf("resolve config dir: %w", err)
  }

  dataDir, err := os.UserCacheDir()
  if err != nil {
    return Paths{}, fmt.Errorf("resolve cache dir: %w", err)
  }

  appConfigDir := filepath.Join(configDir, "LauncherDesktop")
  appDataDir := filepath.Join(dataDir, "LauncherDesktop")

  return Paths{
    ConfigDir:         appConfigDir,
    DataDir:           appDataDir,
    ProfilesPath:      filepath.Join(appConfigDir, "profiles.json"),
    InstancesPath:     filepath.Join(appConfigDir, "instances.json"),
    EncryptionKeyPath: filepath.Join(appDataDir, "secret.key"),
    OAuthTokenPath:    filepath.Join(appDataDir, "github_token.enc"),
    DeployLogDir:      filepath.Join(appDataDir, "deploy-logs"),
  }, nil
}

func EnsureFiles(paths Paths) error {
  dirs := []string{paths.ConfigDir, paths.DataDir, paths.DeployLogDir}
  for _, dir := range dirs {
    if err := os.MkdirAll(dir, 0o700); err != nil {
      return fmt.Errorf("create dir %s: %w", dir, err)
    }
  }

  if err := ensureJSON(paths.ProfilesPath, models.ProfilesConfig{
    DefaultProfiles: []string{
      "https://github.com/MythUp",
      "https://github.com/Chromared",
    },
    UserProfiles: []string{},
    Folders:      []models.SidebarFolder{},
    Items:        []models.SidebarProfileItem{},
  }); err != nil {
    return err
  }

  if err := ensureJSON(paths.InstancesPath, models.InstancesConfig{Items: []models.StoredInstance{}}); err != nil {
    return err
  }

  return nil
}

func ensureJSON(path string, payload any) error {
  if _, err := os.Stat(path); err == nil {
    return nil
  }

  file, err := os.Create(path)
  if err != nil {
    return fmt.Errorf("create %s: %w", path, err)
  }
  defer file.Close()

  encoder := json.NewEncoder(file)
  encoder.SetIndent("", "  ")
  if err := encoder.Encode(payload); err != nil {
    return fmt.Errorf("write %s: %w", path, err)
  }

  return nil
}
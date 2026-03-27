// Purpose: Persist instances with encrypted credentials and expose safe metadata listings.
package storage

import (
  "encoding/json"
  "fmt"
  "os"
  "sync"
  "time"

  "github.com/google/uuid"

  "launcher/backend/internal/models"
  "launcher/backend/internal/security"
)

type InstancesStore struct {
  path       string
  encryption *security.EncryptionService
  mu         sync.RWMutex
}

func NewInstancesStore(path string, encryption *security.EncryptionService) *InstancesStore {
  return &InstancesStore{path: path, encryption: encryption}
}

func (store *InstancesStore) ListRecords() ([]models.InstanceRecord, error) {
  cfg, err := store.readConfig()
  if err != nil {
    return nil, err
  }

  records := make([]models.InstanceRecord, 0, len(cfg.Items))
  for _, item := range cfg.Items {
    records = append(records, item.Record)
  }

  return records, nil
}

func (store *InstancesStore) SaveInstance(input models.InstanceInput) error {
  if err := validateInstanceInput(input); err != nil {
    return err
  }

  now := time.Now().UTC().Format(time.RFC3339)

  credentialsPayload, err := json.Marshal(input)
  if err != nil {
    return fmt.Errorf("marshal credentials: %w", err)
  }

  encrypted, err := store.encryption.EncryptString(string(credentialsPayload))
  if err != nil {
    return fmt.Errorf("encrypt credentials: %w", err)
  }

  cfg, err := store.readConfig()
  if err != nil {
    return err
  }

  record := models.InstanceRecord{
    ID:        uuid.NewString(),
    Name:      input.Name,
    Owner:     input.Owner,
    Repo:      input.Repo,
    CreatedAt: now,
    UpdatedAt: now,
    HasSSH:    input.SSHHost != "" && input.SSHUsername != "",
    HasSQL:    input.SQLDSN != "",
  }

  cfg.Items = append(cfg.Items, models.StoredInstance{
    Record:               record,
    EncryptedCredentials: encrypted,
  })

  return store.writeConfig(cfg)
}

func (store *InstancesStore) UpdateInstance(id string, input models.InstanceInput) error {
  if id == "" {
    return fmt.Errorf("missing instance id")
  }
  if err := validateInstanceInput(input); err != nil {
    return err
  }

  cfg, err := store.readConfig()
  if err != nil {
    return err
  }

  credentialsPayload, err := json.Marshal(input)
  if err != nil {
    return fmt.Errorf("marshal credentials: %w", err)
  }

  encrypted, err := store.encryption.EncryptString(string(credentialsPayload))
  if err != nil {
    return fmt.Errorf("encrypt credentials: %w", err)
  }

  updated := false
  now := time.Now().UTC().Format(time.RFC3339)
  for index := range cfg.Items {
    if cfg.Items[index].Record.ID != id {
      continue
    }

    cfg.Items[index].Record.Name = input.Name
    cfg.Items[index].Record.Owner = input.Owner
    cfg.Items[index].Record.Repo = input.Repo
    cfg.Items[index].Record.UpdatedAt = now
    cfg.Items[index].Record.HasSSH = input.SSHHost != "" && input.SSHUsername != ""
    cfg.Items[index].Record.HasSQL = input.SQLDSN != ""
    cfg.Items[index].EncryptedCredentials = encrypted
    updated = true
    break
  }

  if !updated {
    return fmt.Errorf("instance not found")
  }

  return store.writeConfig(cfg)
}

func (store *InstancesStore) GetInstanceInput(id string) (models.InstanceInput, error) {
  if id == "" {
    return models.InstanceInput{}, fmt.Errorf("missing instance id")
  }

  cfg, err := store.readConfig()
  if err != nil {
    return models.InstanceInput{}, err
  }

  for _, item := range cfg.Items {
    if item.Record.ID != id {
      continue
    }

    decrypted, err := store.encryption.DecryptString(item.EncryptedCredentials)
    if err != nil {
      return models.InstanceInput{}, fmt.Errorf("decrypt credentials: %w", err)
    }

    var input models.InstanceInput
    if err := json.Unmarshal([]byte(decrypted), &input); err != nil {
      return models.InstanceInput{}, fmt.Errorf("decode credentials: %w", err)
    }

    return input, nil
  }

  return models.InstanceInput{}, fmt.Errorf("instance not found")
}

func validateInstanceInput(input models.InstanceInput) error {
  if input.Name == "" || input.Owner == "" || input.Repo == "" || input.FTPHost == "" || input.FTPUsername == "" || input.FTPPassword == "" {
    return fmt.Errorf("missing required instance fields")
  }
  if input.FTPPort <= 0 {
    return fmt.Errorf("ftp port must be greater than 0")
  }
  if input.FTPRemotePath == "" {
    return fmt.Errorf("ftp remote path is required")
  }
  return nil
}

func (store *InstancesStore) readConfig() (models.InstancesConfig, error) {
  store.mu.RLock()
  defer store.mu.RUnlock()

  payload, err := os.ReadFile(store.path)
  if err != nil {
    return models.InstancesConfig{}, fmt.Errorf("read instances: %w", err)
  }

  var cfg models.InstancesConfig
  if err := json.Unmarshal(payload, &cfg); err != nil {
    return models.InstancesConfig{}, fmt.Errorf("unmarshal instances: %w", err)
  }

  return cfg, nil
}

func (store *InstancesStore) writeConfig(cfg models.InstancesConfig) error {
  store.mu.Lock()
  defer store.mu.Unlock()

  payload, err := json.MarshalIndent(cfg, "", "  ")
  if err != nil {
    return fmt.Errorf("marshal instances: %w", err)
  }

  if err := os.WriteFile(store.path, payload, 0o600); err != nil {
    return fmt.Errorf("write instances: %w", err)
  }

  return nil
}
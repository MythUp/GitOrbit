// Purpose: Persist the GitHub OAuth token encrypted so private repository APIs can be accessed.
package storage

import (
  "fmt"
  "os"

  "launcher/backend/internal/security"
)

type TokenStore struct {
  path       string
  encryption *security.EncryptionService
}

func NewTokenStore(path string, encryption *security.EncryptionService) *TokenStore {
  return &TokenStore{path: path, encryption: encryption}
}

func (store *TokenStore) Save(token string) error {
  encrypted, err := store.encryption.EncryptString(token)
  if err != nil {
    return fmt.Errorf("encrypt token: %w", err)
  }

  if err := os.WriteFile(store.path, []byte(encrypted), 0o600); err != nil {
    return fmt.Errorf("write token: %w", err)
  }

  return nil
}

func (store *TokenStore) Read() (string, error) {
  payload, err := os.ReadFile(store.path)
  if err != nil {
    if os.IsNotExist(err) {
      return "", nil
    }
    return "", fmt.Errorf("read token: %w", err)
  }

  token, err := store.encryption.DecryptString(string(payload))
  if err != nil {
    return "", fmt.Errorf("decrypt token: %w", err)
  }

  return token, nil
}
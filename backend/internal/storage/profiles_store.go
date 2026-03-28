// Purpose: Read and write profile sidebar configuration persisted in profiles.json.
package storage

import (
	"encoding/json"
	"fmt"
	"os"
	"sync"

	"launcher/backend/internal/models"
)

type ProfilesStore struct {
	path string
	mu   sync.RWMutex
}

func NewProfilesStore(path string) *ProfilesStore {
	return &ProfilesStore{path: path}
}

func (store *ProfilesStore) Read() (models.ProfilesConfig, error) {
	store.mu.RLock()
	defer store.mu.RUnlock()

	payload, err := os.ReadFile(store.path)
	if err != nil {
		return models.ProfilesConfig{}, fmt.Errorf("read profiles: %w", err)
	}

	var cfg models.ProfilesConfig
	if err := json.Unmarshal(payload, &cfg); err != nil {
		return models.ProfilesConfig{}, fmt.Errorf("unmarshal profiles: %w", err)
	}

	return cfg, nil
}

func (store *ProfilesStore) Write(cfg models.ProfilesConfig) error {
	store.mu.Lock()
	defer store.mu.Unlock()

	payload, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal profiles: %w", err)
	}

	if err := os.WriteFile(store.path, payload, 0o600); err != nil {
		return fmt.Errorf("write profiles: %w", err)
	}

	return nil
}

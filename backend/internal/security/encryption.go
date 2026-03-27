// Purpose: Encrypt and decrypt sensitive credentials using AES-GCM with a locally stored key.
package security

import (
  "crypto/aes"
  "crypto/cipher"
  "crypto/rand"
  "encoding/base64"
  "fmt"
  "io"
  "os"
)

type EncryptionService struct {
  key []byte
}

func NewEncryptionService(keyPath string) (*EncryptionService, error) {
  key, err := loadOrCreateKey(keyPath)
  if err != nil {
    return nil, err
  }
  return &EncryptionService{key: key}, nil
}

func (service *EncryptionService) EncryptString(plain string) (string, error) {
  block, err := aes.NewCipher(service.key)
  if err != nil {
    return "", fmt.Errorf("create cipher: %w", err)
  }

  gcm, err := cipher.NewGCM(block)
  if err != nil {
    return "", fmt.Errorf("create gcm: %w", err)
  }

  nonce := make([]byte, gcm.NonceSize())
  if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
    return "", fmt.Errorf("read nonce: %w", err)
  }

  encrypted := gcm.Seal(nonce, nonce, []byte(plain), nil)
  return base64.StdEncoding.EncodeToString(encrypted), nil
}

func (service *EncryptionService) DecryptString(encoded string) (string, error) {
  payload, err := base64.StdEncoding.DecodeString(encoded)
  if err != nil {
    return "", fmt.Errorf("decode payload: %w", err)
  }

  block, err := aes.NewCipher(service.key)
  if err != nil {
    return "", fmt.Errorf("create cipher: %w", err)
  }

  gcm, err := cipher.NewGCM(block)
  if err != nil {
    return "", fmt.Errorf("create gcm: %w", err)
  }

  nonceSize := gcm.NonceSize()
  if len(payload) < nonceSize {
    return "", fmt.Errorf("invalid payload")
  }

  nonce, ciphertext := payload[:nonceSize], payload[nonceSize:]
  plain, err := gcm.Open(nil, nonce, ciphertext, nil)
  if err != nil {
    return "", fmt.Errorf("decrypt payload: %w", err)
  }

  return string(plain), nil
}

func loadOrCreateKey(keyPath string) ([]byte, error) {
  if key, err := os.ReadFile(keyPath); err == nil {
    if len(key) != 32 {
      return nil, fmt.Errorf("invalid key length in %s", keyPath)
    }
    return key, nil
  }

  key := make([]byte, 32)
  if _, err := io.ReadFull(rand.Reader, key); err != nil {
    return nil, fmt.Errorf("generate key: %w", err)
  }

  if err := os.WriteFile(keyPath, key, 0o600); err != nil {
    return nil, fmt.Errorf("write key: %w", err)
  }

  return key, nil
}
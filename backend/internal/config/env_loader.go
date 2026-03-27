// Purpose: Load key-value pairs from a local .env file into process environment variables.
package config

import (
  "bufio"
  "fmt"
  "os"
  "strings"
)

func LoadDotEnvIfPresent(path string) error {
  file, err := os.Open(path)
  if err != nil {
    if os.IsNotExist(err) {
      return nil
    }
    return fmt.Errorf("open env file: %w", err)
  }
  defer file.Close()

  scanner := bufio.NewScanner(file)
  for scanner.Scan() {
    line := strings.TrimSpace(scanner.Text())
    if line == "" || strings.HasPrefix(line, "#") {
      continue
    }

    parts := strings.SplitN(line, "=", 2)
    if len(parts) != 2 {
      continue
    }

    key := strings.TrimSpace(parts[0])
    value := strings.TrimSpace(parts[1])
    value = strings.Trim(value, `"`)

    if key == "" {
      continue
    }

    if os.Getenv(key) == "" {
      _ = os.Setenv(key, value)
    }
  }

  if err := scanner.Err(); err != nil {
    return fmt.Errorf("read env file: %w", err)
  }

  return nil
}
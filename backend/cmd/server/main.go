// Purpose: Start the local backend HTTP server that powers the desktop launcher features.
package main

import (
  "context"
  "log"
  "os"
  "os/signal"
  "syscall"

  "launcher/backend/internal/app"
)

func main() {
  logger := log.New(os.Stdout, "[launcher-backend] ", log.LstdFlags|log.Lshortfile)

  server, err := app.NewServer(logger)
  if err != nil {
    logger.Fatalf("failed to initialize server: %v", err)
  }

  ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
  defer stop()

  go func() {
    <-ctx.Done()
    logger.Printf("shutdown signal received")
    _ = server.Shutdown(context.Background())
  }()

  logger.Printf("backend server listening on %s", server.Addr)
  if err := server.ListenAndServe(); err != nil && err.Error() != "http: Server closed" {
    logger.Fatalf("server error: %v", err)
  }
}
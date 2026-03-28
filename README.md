<!-- Purpose: Document architecture, setup, and progressive delivery details of the GitOrbit desktop project. -->

# GitOrbit

Desktop deployment workspace architecture for GitHub-driven projects:

- Tauri provides desktop shell and command bridge.
- React + TypeScript provides UI and local user workflows.
- Go provides local backend API, storage, encryption, GitHub integration, and deployment engines.

## Project structure

```text
  GitOrbit/
  backend/
    cmd/server/
    internal/
      app/
      config/
      models/
      security/
      services/
        auth/
        deploy/
        github/
        sql/
      storage/
    .env.example
    go.mod
  config/
    instances.json
    profiles.json
  src/
    components/
    config/
    hooks/
    services/
    types/
    utils/
    App.tsx
    main.tsx
    styles.css
  src-tauri/
    src/
    Cargo.toml
    tauri.conf.json
  package.json
  vite.config.ts
```

## Current implemented features

### Frontend

- Sidebar with default profiles:
  - [MythUp](https://github.com/MythUp)
  - [Chromared](https://github.com/Chromared)
- Home view listing all instances.
- Search view for GitHub users, organizations, and repositories.
- Repositories view per selected profile.
- Compatibility check button reads `manifest.json` and toggles Install availability.
- Drag and drop profile behavior:
  - Drop profile onto another profile: create folder.
  - Hold Shift while dropping: reorder.
- Right-click context menus for profile and instance quick actions.
- Bottom-left account popup from sidebar icon (compact menu style, with close button).
- Instance popup supports outside-click close, Escape close, and a header close button.

### Backend

- Local HTTP API on `127.0.0.1:3547`.
- `profiles.json` manager.
- `instances.json` manager with encrypted credential payloads.
- AES-GCM local encryption key generation.
- GitHub API client:
  - search users and organizations and repositories
  - list repositories
  - fetch `manifest.json`
- GitHub OAuth Device Flow (without client secret).
- FTP deployment engine baseline with:
  - upload and replace behavior
  - source from GitHub repository archive (branch/tag/commit)
  - manifest-driven ignore patterns (`launcher.ignore`)
  - deployment logs
  - rollback of replaced files (backup restore)
- SSH engine baseline (command execution).
- SQL migration planner endpoint to compare two refs and generate safe ALTER ADD statements + warnings.
- SQL executor supports direct import execution for MySQL and PostgreSQL.
- SFTP module placeholder separated for incremental implementation.

### Tauri bridge

- `start_backend` command starts Go server process from desktop shell.
- Frontend invokes this command before calling local API.

## Security posture in this baseline

- Sensitive fields are encrypted before disk persistence.
- OAuth token is stored encrypted locally.
- No GitHub secret in code or manifest.
- Strict JSON decoding with unknown fields rejected.
- Basic payload validation on instance creation.

## Run instructions

### Prerequisites

- Node.js 20+
- Rust + Cargo (for Tauri build/run)
- Go 1.22+

### Install frontend dependencies

```bash
npm install
```

### Configure backend OAuth

```bash
copy backend/.env.example backend/.env
```

Set `GITHUB_OAUTH_CLIENT_ID` in your environment before launching backend/Tauri.

### Run desktop app

```bash
npm run dev
```

### Optional frontend-only build check

```bash
npm run web:build
```

## API endpoints

- `GET /health`
- `GET /api/profiles`
- `POST /api/profiles`
- `GET /api/instances`
- `POST /api/instances`
- `GET /api/github/search?q=...`
- `GET /api/github/repos?owner=...`
- `GET /api/github/manifest?owner=...&repo=...`
- `POST /api/auth/github/device/start`
- `POST /api/auth/github/device/poll`
- `POST /api/auth/github/token`
- `POST /api/deploy/ftp`
- `POST /api/deploy/ftp/instance`
- `POST /api/sql/migration-plan`

## Manifest behavior

`manifest.json` supports deployment filtering and SQL schema planning fields:

```json
{
  "project_name": "MyProject",
  "version": "1.2.0",
  "type": "php",
  "launcher": {
    "compatible": true,
    "connection_types": ["ftp", "sql"],
    "sql_schema_path": "database/schema.json",
    "ignore": [
      "actions/database.php",
      "storage/",
      "*.log"
    ],
    "notes": "Optional deployment notes"
  }
}
```

Connection behavior:

- `launcher.connection_types` controls required credentials by transport/feature.
- Add `"sql"` to require SQL credentials and execute SQL import during deploy.
- Add `"ssh"` to require SSH host/username.
- `requires_sql` is still accepted for backward compatibility, but `connection_types` is preferred.

Manifest type guidance:

- `type` describes the project runtime/category and drives UI hints.
- Recommended values currently handled by UI: `php`, `html`, `python`, `go`, `other`.
- For this application (GitOrbit), use `"type": "go"`.

Rules for `launcher.ignore`:

- `actions/database.php` ignores exactly this file.
- `storage/` ignores the full directory recursively.
- `*.log` ignores matching filenames.
- `assets/**` ignores a tree prefix.

Why ignore files and folders:

- Keep server-only runtime files untouched (uploads, caches, session files).
- Avoid overwriting environment-specific files.
- Reduce transfer size and accidental destructive updates.

## Progressive next steps

### Part A completed

- Full structure and modules generated.
- Initial usable UI and data flow wired.

### Next after Part A

- Add contextual right-click menu component (instead of prompt).
- Add dedicated drag placeholder lanes for pixel-perfect reorder.

### Part B completed

- Go backend and config and encryption storage are operational by design.

### Next after Part B

- Add migration and versioning for config schema.
- Add integration tests for stores and encryption.

### Part C completed

- Tauri to Go process startup bridge implemented.

### Next after Part C

- Add backend stop and restart command.
- Add health watchdog and auto-restart.

### Part D completed

- GitHub OAuth basic flow implemented.

### Next after Part D

- Add avatar/profile endpoint.
- Add token scope validation and expiry handling.

### Part E baseline completed

- FTP deployment supports upload and replace with backup and rollback.

### Next after Part E

- Add file diff hashing, remote delete sync, and dry-run mode.
- Complete SFTP transfer implementation and pluggable connection strategy.

## Notes

- JSON files cannot include header comments by JSON standard; code files include purpose comments at top.
- On this machine, frontend build was validated. Full Tauri and Go build requires local Cargo and Go binaries available in PATH.

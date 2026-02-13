# 🐴 Clawback

Backup & Disaster Recovery for OpenClaw AI Agents.

Clawback creates portable `.clawback` archives of your agent's identity, memory, config, skills, and scripts — so you can restore your agent on any machine.

## Quickstart

```bash
# Backup your agent
clawback backup --workspace ~/clawd

# Restore on a new machine (bare metal)
clawback restore cowboy-2026-02-14.clawback --workspace ~/agent --force --run

# Or deploy via Docker
clawback containerize cowboy-2026-02-14.clawback --run
```

## Install

```bash
npm install -g clawback-ai
```

Or use directly:

```bash
npx clawback backup
```

## Common Commands

```bash
# Back up your agent
clawback backup --workspace ~/clawd

# Verify the backup is intact
clawback verify cowboy-2026-02-12.clawback

# See what's inside
clawback info cowboy-2026-02-12.clawback

# Compare backup to live workspace
clawback diff cowboy-2026-02-12.clawback --workspace ~/clawd

# Restore to a new machine
clawback restore cowboy-2026-02-12.clawback --workspace ~/agent --force

# Deploy via Docker
clawback containerize cowboy-2026-02-12.clawback --run
```

## Commands

### `clawback backup`

Create a `.clawback` archive from an OpenClaw workspace.

```
Options:
  --workspace <path>    Workspace path (auto-detected if not set)
  --output <path>       Output file path
  --with-credentials    Include encrypted credential vault
  --include-data        Include large skill data directories
  --exclude <pattern>   Exclude files matching glob pattern (repeatable)
```

### `clawback restore <file>`

Restore an agent from a backup archive.

```
Options:
  --workspace <path>    Target workspace directory
  --dry-run             Show what would change without writing
  --force               Skip confirmation prompt
  --skip-credentials    Skip credential restoration
  --run                 Start OpenClaw gateway after restore
  --password <pass>     Password for credential vault (non-interactive)
```

Path remapping is automatic — absolute paths in config files are rewritten to match the new machine's HOME and workspace paths.

#### One-Key Restore (`--run`)

The `--run` flag turns restore into a complete recovery operation:

1. Extracts files and remaps paths
2. Decrypts credentials (if present)
3. Checks that OpenClaw is installed
4. Prompts for an API key if the gateway config has no valid provider key
5. Imports cron jobs from the backup
6. Starts the gateway
7. Runs a health check and prints `✅ Agent '<name>' is running`

```bash
clawback restore backup.clawback --workspace ~/agent --force --run
```

### `clawback containerize <file>`

Generate a Docker deployment from a backup archive.

```
Options:
  --output <dir>        Output directory (default: deploy/)
  --run                 Build image and run interactively
```

Without `--run`, generates deployment files for manual use:

```bash
clawback containerize backup.clawback
cd deploy
docker compose run -it agent    # first run: OpenClaw wizard asks model + API key
docker compose up -d             # then run in background
```

With `--run`, does everything in one command:

```bash
clawback containerize backup.clawback --run
# → generates files → builds image → runs interactively
# → OpenClaw wizard handles model + API key setup
# → agent running in Docker
```

Config and memory persist via volume mounts (`./config/` and `./data/`), so the container survives restarts without re-setup.

### `clawback verify <file>`

Verify archive integrity by checking SHA-256 checksums of every file.

### `clawback info <file>`

Display backup metadata: agent name, creation date, source machine, file counts, and size.

### `clawback diff <file> [fileB]`

Compare a backup to the current workspace (drift detection), or compare two backups.

```
Options:
  --workspace <path>    Workspace to compare against
```

## Archive Format

A `.clawback` file is a gzipped tar archive containing:

```
manifest.json          # File inventory with SHA-256 checksums
README.md              # Human-readable summary
config/env-map.json    # Path placeholders for cross-machine portability
config/cron-jobs.json  # Exported cron job definitions (if present)
agent/SOUL.md          # Agent identity files
agent/MEMORY.md
agent/memory/          # Daily memory files
config/gateway.yaml    # OpenClaw configuration
skills/                # Custom skills
scripts/               # Utility scripts
```

### 6-Layer State Model

Clawback organizes agent state into layers by priority:

| Layer | What | Examples |
|-------|------|---------|
| 1. Identity | Who the agent is | SOUL.md, IDENTITY.md, AGENTS.md |
| 2. Memory | What the agent knows | MEMORY.md, memory/*.md |
| 3. Config | How the agent runs | gateway.yaml, env vars |
| 4. Skills | What the agent can do | Custom skill directories |
| 5. Credentials | Auth & secrets | API keys (encrypted with age) |
| 6. External | Platform state | Cron jobs, channel configs |

## Cross-Platform

Works on macOS (Intel & ARM) and Linux (x86 & ARM). Path remapping handles differences automatically via `env-map.json` placeholders:

- `${HOME}` → user home directory
- `${WORKSPACE}` → agent workspace root

## Credential Backup

Clawback can optionally back up credentials (API keys, tokens, secrets) using the `--with-credentials` flag:

```bash
clawback backup --workspace ~/clawd --with-credentials
```

Credentials are encrypted with [age](https://age-encryption.org) and stored as a separately encrypted vault within the archive. You'll be prompted for a passphrase during backup and restore.

**What's encrypted vs. readable:**

| Content | Encrypted? | Notes |
|---------|-----------|-------|
| Agent files (SOUL.md, MEMORY.md, memory/) | ❌ No | Readable without password — inspect, verify, diff freely |
| Config (gateway.yaml, cron jobs) | ❌ No | API keys in gateway.yaml are **REDACTED** before archiving |
| Skills and scripts | ❌ No | Readable for portability |
| Credential vault (API keys, tokens, .env files) | ✅ Yes | age-encrypted, requires passphrase |

Without the passphrase, credential data is unreadable — the rest of the archive remains fully accessible. This means `info`, `verify`, and `diff` all work without any password. A restore without credentials still boots the agent — it just prompts for a new API key.

On restore, credentials are decrypted and placed back automatically unless `--skip-credentials` is passed.

## Testing

```bash
npm test                                        # Unit tests (vitest, 83 tests)
cd tests/docker && bash run-recovery-test.sh    # Docker integration test
```

The Docker test creates a synthetic workspace on macOS, backs it up, restores inside a Linux container, and verifies file integrity, path remapping, and gateway boot. Requires Docker (colima with 8GB+ RAM on macOS).

## Security

- **No telemetry, no accounts, no network calls** — fully offline
- Credentials are only included with `--with-credentials` and encrypted with [age](https://age-encryption.org)
- Archives are portable files you control — no cloud dependency

## ⚠️ Important: Stop the Original Before Restoring

If you backed up with `--with-credentials`, the archive contains your channel tokens (Slack, Telegram, Discord, etc.). **Do not run two agents with the same credentials simultaneously:**

- **Slack/Discord:** Both agents receive every message → duplicate replies
- **Telegram:** Messages split randomly between the two agents
- **WhatsApp/Signal:** Second agent kicks the first off → auth ping-pong

Clawback is designed for **disaster recovery** — the original is dead, you restore on a new machine. If the original is still running, stop it first (`openclaw gateway stop`) before starting the restored agent.

## Primary Scenario

> You're traveling. Your laptop dies. You have a `.clawback` file on a USB drive (or cloud storage). On any new machine with Node.js:

```bash
npx clawback restore cowboy-backup.clawback --workspace ~/agent --force --run
```

Your agent is back, with all its memories, personality, and configuration intact.

## License

MIT

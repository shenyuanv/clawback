# 🐴 Saddlebag

Backup & Disaster Recovery for OpenClaw AI Agents.

Saddlebag creates portable `.saddlebag` archives of your agent's identity, memory, config, skills, and scripts — so you can restore your agent on any machine.

## Quickstart (5 lines)

```bash
npm install -g saddlebag
saddlebag backup --workspace ~/clawd
saddlebag verify cowboy-2026-02-12.saddlebag
saddlebag restore cowboy-2026-02-12.saddlebag --workspace ~/agent --force
cd ~/agent && openclaw gateway start
```

## Install

```bash
npm install -g saddlebag
```

Or use directly:

```bash
npx saddlebag backup
```

## Common Commands

```bash
# Back up your agent
saddlebag backup --workspace ~/clawd

# Verify the backup is intact
saddlebag verify cowboy-2026-02-12.saddlebag

# See what's inside
saddlebag info cowboy-2026-02-12.saddlebag

# Compare backup to live workspace
saddlebag diff cowboy-2026-02-12.saddlebag --workspace ~/clawd

# Restore to a new machine
saddlebag restore cowboy-2026-02-12.saddlebag --workspace ~/agent --force
```

## Commands

### `saddlebag backup`

Create a `.saddlebag` archive from an OpenClaw workspace.

```
Options:
  --workspace <path>    Workspace path (auto-detected if not set)
  --output <path>       Output file path
  --with-credentials    Include encrypted credential vault
  --include-data        Include large skill data directories
  --exclude <pattern>   Exclude files matching glob pattern (repeatable)
```

### `saddlebag restore <file>`

Restore an agent from a backup archive.

```
Options:
  --workspace <path>    Target workspace directory
  --dry-run             Show what would change without writing
  --force               Skip confirmation prompt
  --skip-credentials    Skip credential restoration
```

Path remapping is automatic — absolute paths in config files are rewritten to match the new machine's HOME and workspace paths.

### `saddlebag verify <file>`

Verify archive integrity by checking SHA-256 checksums of every file.

### `saddlebag info <file>`

Display backup metadata: agent name, creation date, source machine, file counts, and size.

### `saddlebag diff <file> [fileB]`

Compare a backup to the current workspace (drift detection), or compare two backups.

```
Options:
  --workspace <path>    Workspace to compare against
```

## Archive Format

A `.saddlebag` file is a gzipped tar archive containing:

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

Saddlebag organizes agent state into layers by priority:

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

Saddlebag can optionally back up credentials (API keys, tokens, secrets) using the `--with-credentials` flag:

```bash
saddlebag backup --workspace ~/clawd --with-credentials
```

Credentials are encrypted with [age](https://age-encryption.org) and stored as a separately encrypted vault within the archive. You'll be prompted for a passphrase during backup and restore. Without the passphrase, credential data is unreadable — the rest of the archive remains accessible.

On restore, credentials are decrypted and placed back automatically unless `--skip-credentials` is passed.

## Testing

```bash
npm test                                        # Unit tests (vitest, 70 tests)
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

Saddlebag is designed for **disaster recovery** — the original is dead, you restore on a new machine. If the original is still running, stop it first (`openclaw gateway stop`) before starting the restored agent.

## Primary Scenario

> You're traveling. Your laptop dies. You have a `.saddlebag` file on a USB drive (or cloud storage). On any new machine with Node.js:

```bash
npx saddlebag restore cowboy-backup.saddlebag --workspace ~/agent --force
cd ~/agent && openclaw gateway start
```

Your agent is back, with all its memories, personality, and configuration intact.

## License

MIT

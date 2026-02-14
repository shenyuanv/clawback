# 🐴 Clawback — Backup & Disaster Recovery for OpenClaw Agents

> *One command to save. One command to ride again.*

**Codename:** Clawback
**Author:** Cowboy 🤠 + Yuan
**Created:** 2026-02-11
**Status:** Draft v0.2

---

## What Is This?

An open-source CLI tool that backs up an OpenClaw agent's complete state into a single portable file, and restores it on the same or a different machine.

```bash
npm install -g clawback

# Backup
clawback backup
# → cowboy-2026-02-11.clawback (one file, everything inside)

# Restore (same machine)
clawback restore cowboy-2026-02-11.clawback

# Restore (new machine, different paths)
clawback restore cowboy-2026-02-11.clawback --workspace ~/my-agent
```

That's it. No accounts, no cloud service, no configuration required.

---

## Problem

An OpenClaw agent accumulates irreplaceable state over weeks and months — personality, memories, learned preferences, operational configs, credentials. Today there's no way to:

- Back all of this up in one step
- Restore it on a new machine when hardware fails
- Verify a backup is complete and uncorrupted
- See what changed between backups

If your disk dies, your agent dies with it.

---

## Scope

### In Scope (v1)

- **Backup** all OpenClaw agent state into a single `.clawback` file
- **Restore** on same or different machine (macOS + Linux)
- **Path remapping** for cross-environment restore
- **Credential encryption** (credentials always encrypted, even within the archive)
- **Integrity verification** (per-file checksums, tamper detection)
- **Diff** between backup and live state, or between two backups
- **Cross-platform** (macOS Intel/ARM, Linux x86/ARM)
- **Zero config** — auto-detects OpenClaw workspace, just works

### Out of Scope (v1)

- Cloud storage backends (save the file wherever you want — NAS, S3, USB, Dropbox)
- Agent-assisted merge / conflict resolution
- Auto-scheduled backups (cron it yourself: `0 3 * * * clawback backup`)
- Multi-agent workspaces
- Frameworks other than OpenClaw
- Real-time sync or replication

---

## What Gets Backed Up

Clawback auto-discovers the OpenClaw workspace and captures everything the agent needs:

### Agent Files (always included)

```
SOUL.md              — Agent identity & values
AGENTS.md            — Operating procedures
IDENTITY.md          — Name, avatar, metadata
USER.md              — Human's info & preferences
MEMORY.md            — Long-term memory
HEARTBEAT.md         — Periodic task config
CHECKLIST.md         — Session rules
TOOLS.md             — Local tool registry
本我.md               — Human's cognitive foundation (if exists)
memory/              — Daily logs, meditation, research, all subdirs
```

### Configuration

```
Gateway config       — OpenClaw gateway YAML (sanitized)
Cron jobs            — All scheduled jobs (exported as JSON)
Skills list          — Which skills are installed + locations
Custom scripts       — scripts/ directory
```

### Credentials (encrypted, opt-in)

```
API keys             — From config files, .env
OAuth tokens         — Cookie files, token caches
SSH keys             — If referenced by agent
Platform credentials — macOS Keychain / Linux keyring entries used by agent
```

Credentials are **opt-in** (`clawback backup --with-credentials`) and always stored in a separately encrypted vault within the archive. The rest of the backup is readable without the credential key.

### Skills (configurable)

```
Built-in skills      — Skipped (reinstallable from OpenClaw)
Custom skills        — Included (user-created, not available elsewhere)
Skill data           — Large data dirs excluded by default, opt-in with --include-data
```

---

## Backup Format

A `.clawback` file is a zstd-compressed tar archive:

```
cowboy-2026-02-11.clawback
├── manifest.json           # Metadata + per-file SHA-256 checksums
├── agent/                  # All agent markdown files
│   ├── SOUL.md
│   ├── MEMORY.md
│   ├── memory/
│   │   ├── 2026-02-10.md
│   │   └── ...
│   └── ...
├── config/
│   ├── gateway.yaml        # Path-neutralized gateway config
│   ├── cron-jobs.json      # Exported cron definitions
│   └── env-map.json        # Original paths → ${PLACEHOLDERS}
├── skills/                 # Custom skills only
├── scripts/                # Custom scripts
├── credentials.age         # AES-256-GCM encrypted credential vault (if --with-credentials)
└── README.md               # Human-readable: what's in this backup, how to restore
```

### manifest.json

```json
{
  "clawback_version": "1.0",
  "created": "2026-02-11T04:36:00+08:00",
  "agent": {
    "name": "Cowboy",
    "soul_hash": "sha256:abc123..."
  },
  "source": {
    "hostname": "agent-workstation",
    "os": "darwin",
    "arch": "arm64",
    "workspace": "/home/agent/workspace",
    "openclaw_version": "0.9.x"
  },
  "contents": {
    "agent_files": 92,
    "config_files": 3,
    "custom_skills": 5,
    "scripts": 8,
    "credentials": true,
    "total_bytes": 2150000
  },
  "checksums": {
    "agent/SOUL.md": "sha256:...",
    "agent/MEMORY.md": "sha256:...",
    "...": "..."
  }
}
```

---

## CLI Reference

### `clawback backup`

```bash
clawback backup [OPTIONS]

Options:
  --workspace PATH       OpenClaw workspace (auto-detected if not set)
  --output PATH          Output file (default: <agent>-<date>.clawback)
  --with-credentials     Include encrypted credential vault
  --include-data         Include large skill data directories
  --exclude PATTERN      Exclude files matching glob pattern (repeatable)
  --passphrase           Encrypt entire archive (prompted, not on CLI)

Auto-detection: looks for SOUL.md or AGENTS.md in cwd, then checks
common locations (~/.openclaw, ~/clawd, etc.)
```

### `clawback restore`

```bash
clawback restore <FILE> [OPTIONS]

Options:
  --workspace PATH       Target workspace (default: original path or cwd)
  --dry-run              Show what would change, don't apply
  --force                Skip confirmation prompt
  --skip-credentials     Don't restore credentials even if present
  --remap KEY=VALUE      Manual path remap (repeatable)

Flow:
  1. Verify archive integrity (checksums)
  2. Detect target platform
  3. Propose path remappings (auto + manual)
  4. Show diff vs target workspace (or list all files if fresh install)
  5. Confirm with user
  6. Extract files with remapped paths
  7. Restore credentials to platform keyring (if present)
  8. Print post-restore checklist (missing tools, etc.)
```

### `clawback verify`

```bash
clawback verify <FILE>

Checks:
  ✓ Archive integrity (decompresses without error)
  ✓ Manifest present and valid JSON
  ✓ All listed files present in archive
  ✓ All checksums match
  ✓ Credential vault decryptable (if passphrase provided)
```

### `clawback diff`

```bash
# Compare backup to current live state
clawback diff <FILE>

# Compare two backups
clawback diff <FILE_A> <FILE_B>

Output:
  ADDED     memory/2026-02-11.md
  MODIFIED  MEMORY.md (+15 lines, -2 lines)
  DELETED   memory/temp-note.md
  UNCHANGED SOUL.md, AGENTS.md (23 files)
```

### `clawback info`

```bash
clawback info <FILE>

Agent: Cowboy
Created: 2026-02-11 04:36 (3 hours ago)
Source: macOS arm64 (Shen的Mac mini)
Size: 1.8 MB (4.2 MB uncompressed)
Files: 108 (92 agent, 3 config, 5 skills, 8 scripts)
Credentials: yes (encrypted)
Checksum: sha256:7f3a2b...
```

---

## Cross-Platform

### Path Remapping

Paths are stored as placeholders in `env-map.json`:

```json
{
  "${WORKSPACE}": "/home/agent/workspace",
  "${HOME}": "/home/agent",
  "${OPENCLAW}": "/opt/openclaw"
}
```

On restore, Clawback auto-detects new values and asks for confirmation:

```
Path remapping (macOS → Linux):
  ${HOME}      /home/agent → /home/user [auto]
  ${WORKSPACE} /home/agent/workspace → /home/user/workspace [auto]
  ${OPENCLAW}  /opt/openclaw → ? enter path: /usr/local/openclaw
```

Files that contain hardcoded paths (TOOLS.md, gateway config, cron payloads) are rewritten with new values.

### Credential Storage

Credentials are stored as an AES-256-GCM encrypted vault (`credentials.age`) inside the archive. This approach works on all platforms without requiring platform-specific keyring integration.

> **Future consideration:** Platform keyring backends (macOS Keychain, Linux Secret Service, `pass`) could be added for restore-time credential storage, but the encrypted-file approach covers all current use cases.

### Dependency Check

On restore, Clawback lists tools the agent uses and checks availability:

```
Dependencies:
  ✓ node v24.3     ✓ python3.11    ✓ openclaw
  ✓ himalaya       ✗ weibo         ✗ ipsw
  ⚠ 2 optional tools missing. Some skills may have reduced functionality.
```

---

## Security

### Design Principles

1. **Offline by default** — no network access, no accounts, no telemetry
2. **Credentials always encrypted** — AES-256-GCM encryption, separate from main archive
3. **Integrity built-in** — SHA-256 per file, manifest validation
4. **Transparent restore** — always shows diff, never blind-applies
5. **Minimal dependencies** — small attack surface, all deps pinned with hashes
6. **Signed releases** — sigstore/cosign for binary verification

### Threat Mitigations

| Threat | Mitigation |
|--------|-----------|
| Disk failure | Backup exists elsewhere — that's the whole point |
| Stolen backup file | Credentials separately encrypted; optional full-archive encryption |
| Tampered backup | Per-file checksums catch any modification |
| Restoring wrong agent's backup | Manifest includes agent name; restore warns on mismatch |
| Identity poisoning via backup | SOUL.md/AGENTS.md changes highlighted prominently in diff |
| Supply chain attack on Clawback | Signed releases, SBOM, minimal pinned deps |

---

## Implementation

### Tech Stack

Aligned with OpenClaw's stack (TypeScript / Node.js):

- **Language:** TypeScript (strict mode)
- **Runtime:** Node.js 20+ (LTS)
- **Compression:** tar + zstd (via `@napi-rs/zstd` or Node zlib gzip fallback)
- **Encryption:** AES-256-GCM + scrypt (Node crypto stdlib)
- **Hashing:** Node crypto (stdlib — SHA-256)
- **CLI:** Commander.js (same as OpenClaw)
- **Config parsing:** YAML via `yaml` package (same as OpenClaw)
- **Distribution:** npm (`npm install -g clawback` or `npx clawback`)
- **Build:** tsup (single-file bundle) or esbuild
- **Testing:** Vitest
- **Dependencies:** Minimal — commander, yaml, tar-stream, chalk (encryption via Node crypto stdlib)

**Why align with OpenClaw's stack:**
- Same language = potential upstream merge as `openclaw backup`
- Shared dependencies (commander, yaml, chalk already in OpenClaw)
- OpenClaw contributors can contribute without context-switching
- Could import OpenClaw's config parser directly for perfect gateway.yaml handling
- Single runtime requirement (Node.js) — already installed for OpenClaw

### Project Structure

```
clawback/
├── package.json
├── tsconfig.json
├── tsup.config.ts           # Bundle config
├── src/
│   ├── index.ts             # Entry point
│   ├── cli.ts               # Commander CLI definitions
│   ├── backup.ts            # Backup orchestration
│   ├── restore.ts           # Restore orchestration  
│   ├── verify.ts            # Integrity verification
│   ├── diff.ts              # Diff engine
│   ├── manifest.ts          # Manifest creation & parsing
│   ├── pathmap.ts           # Path detection & remapping
│   ├── credentials.ts       # Credential export/import + encryption
│   ├── discovery.ts         # OpenClaw workspace auto-detection
│   ├── encrypt.ts           # Full-archive encryption (AES-256-GCM)
│   ├── archive-reader.ts    # Encrypted/plain archive resolution
│   ├── containerize.ts      # Docker deployment generation
│   ├── output.ts            # Non-PTY-safe stdout/stderr helpers
│   └── cron.ts              # Cron job types
├── tests/
│   ├── backup.test.ts
│   ├── restore.test.ts
│   ├── cross-platform.test.ts
│   └── fixtures/            # Sample workspaces for testing
└── README.md
```

### Development Roadmap

Each stage has: deliverables, tests, and a **gate** (all tests must pass before moving to next stage). Designed for sub-agent dev loop — agent works on a stage, runs tests, iterates until gate passes, then moves to next.

**⚠️ SAFETY RULE: Never test restore/write operations against the live agent workspace (`~/clawd`). All restore tests use isolated temp directories with synthetic fixtures.**

---

#### Stage 1: Project Scaffold + Discovery
**Goal:** Working TypeScript project that can find an OpenClaw workspace.

**Deliverables:**
- [ ] `package.json` with dependencies (commander, yaml, chalk, tar-stream)
- [ ] `tsconfig.json` (strict mode)
- [ ] Build script (`npm run build`) produces working CLI
- [ ] `src/cli.ts` — Commander entry point with `--version` and `--help`
- [ ] `src/discovery.ts` — finds OpenClaw workspace by scanning for SOUL.md/AGENTS.md
- [ ] `tests/fixtures/mock-workspace/` — synthetic agent workspace for testing (fake SOUL.md, MEMORY.md, memory/*.md, AGENTS.md, etc.)

**Tests (Vitest):**
- [ ] `discovery.test.ts`: finds workspace when SOUL.md exists in cwd
- [ ] `discovery.test.ts`: finds workspace when AGENTS.md exists in cwd
- [ ] `discovery.test.ts`: returns null when no workspace markers found
- [ ] `discovery.test.ts`: respects `--workspace` override path
- [ ] `cli.test.ts`: `clawback --version` prints version
- [ ] `cli.test.ts`: `clawback --help` lists commands

**Gate:** `npm test` — all 6 tests pass, `npm run build` succeeds.

---

#### Stage 2: Manifest + File Inventory
**Goal:** Scan a workspace and produce a complete manifest with checksums.

**Deliverables:**
- [ ] `src/manifest.ts` — scan workspace, hash files, produce manifest.json
- [ ] File categorization: agent files, config, skills, scripts
- [ ] SHA-256 checksum for every file
- [ ] Respect `.gitignore` and default excludes (node_modules, .git, *.clawback)
- [ ] `--exclude` pattern support

**Tests:**
- [ ] `manifest.test.ts`: scans mock workspace, finds all expected files
- [ ] `manifest.test.ts`: categorizes SOUL.md as "agent", gateway.yaml as "config"
- [ ] `manifest.test.ts`: SHA-256 checksums are correct (verify against known hash)
- [ ] `manifest.test.ts`: excludes node_modules and .git
- [ ] `manifest.test.ts`: `--exclude` pattern removes matching files
- [ ] `manifest.test.ts`: manifest JSON schema is valid (required fields present)
- [ ] `manifest.test.ts`: handles empty memory/ directory gracefully
- [ ] `manifest.test.ts`: handles files with unicode names (Chinese filenames like 本我.md)

**Gate:** `npm test` — all 8 tests pass.

---

#### Stage 3: Backup Command (Core)
**Goal:** `clawback backup` creates a valid .clawback archive from a workspace.

**Deliverables:**
- [ ] `src/backup.ts` — orchestrates: discover → manifest → tar+compress → write file
- [ ] Output: `<agent-name>-<date>.clawback` (tar.gz format, gzip for max compatibility)
- [ ] Includes `manifest.json` at archive root
- [ ] Includes `README.md` with human-readable restore instructions
- [ ] `--output` flag for custom output path
- [ ] Progress output (file count, size)

**Tests:**
- [ ] `backup.test.ts`: creates .clawback file from mock workspace
- [ ] `backup.test.ts`: archive contains manifest.json
- [ ] `backup.test.ts`: archive contains all expected agent files (SOUL.md, MEMORY.md, etc.)
- [ ] `backup.test.ts`: archive contains README.md
- [ ] `backup.test.ts`: manifest checksums match actual file contents in archive
- [ ] `backup.test.ts`: `--output` flag writes to specified path
- [ ] `backup.test.ts`: backup of empty workspace (only SOUL.md) succeeds
- [ ] `backup.test.ts`: large files (>1MB) are included correctly

**Integration test (safe — read-only against live workspace):**
- [ ] `backup.integration.test.ts`: run `clawback backup --workspace ~/clawd --output /tmp/test-backup.clawback` — succeeds, file is created, manifest is valid JSON, checksums verify

**Gate:** `npm test` — all 9 tests pass + integration test creates valid archive from live workspace.

---

#### Stage 4: Verify Command
**Goal:** `clawback verify` validates archive integrity.

**Deliverables:**
- [ ] `src/verify.ts` — extract manifest, verify all checksums, report results
- [ ] Exit code 0 = valid, exit code 1 = corrupted
- [ ] Detailed output: per-file status (✓/✗)

**Tests:**
- [ ] `verify.test.ts`: valid archive passes verification
- [ ] `verify.test.ts`: archive with modified file fails verification (tamper detection)
- [ ] `verify.test.ts`: archive with missing file fails verification
- [ ] `verify.test.ts`: archive without manifest.json fails with clear error
- [ ] `verify.test.ts`: reports which specific files are corrupted

**Gate:** `npm test` — all 5 tests pass.

---

#### Stage 5: Info Command
**Goal:** `clawback info` shows human-readable backup summary.

**Deliverables:**
- [ ] `src/info.ts` — read manifest, display formatted summary
- [ ] Shows: agent name, creation date, source platform, file counts, size, checksum

**Tests:**
- [ ] `info.test.ts`: displays correct agent name from manifest
- [ ] `info.test.ts`: displays correct file counts per category
- [ ] `info.test.ts`: displays creation date in human-readable format
- [ ] `info.test.ts`: handles archive without credentials gracefully

**Gate:** `npm test` — all 4 tests pass.

---

#### Stage 6: Path Remapping Engine
**Goal:** Detect paths in workspace files and create env-map for cross-machine restore.

**Deliverables:**
- [ ] `src/pathmap.ts` — detect hardcoded paths, generate env-map.json, apply remapping
- [ ] Auto-detect: ${HOME}, ${WORKSPACE}, common tool paths
- [ ] Scan gateway config, TOOLS.md, cron payloads for path references
- [ ] `env-map.json` included in backup archive

**Tests:**
- [ ] `pathmap.test.ts`: detects home directory in TOOLS.md
- [ ] `pathmap.test.ts`: detects workspace path in gateway config
- [ ] `pathmap.test.ts`: generates correct env-map.json with placeholders
- [ ] `pathmap.test.ts`: apply remap correctly substitutes paths in file content
- [ ] `pathmap.test.ts`: handles files with no paths (no-op)
- [ ] `pathmap.test.ts`: handles multiple paths in same file

**Gate:** `npm test` — all 6 tests pass.

---

#### Stage 7: Restore Command (to isolated directory)
**Goal:** `clawback restore` extracts archive to a target directory with path remapping.

**⚠️ All restore tests use temp directories only. Never touch ~/clawd.**

**Deliverables:**
- [ ] `src/restore.ts` — verify → prompt path remaps → extract → remap paths → report
- [ ] `--dry-run` flag: show what would change, don't write
- [ ] `--workspace` flag: target directory (required for safety — no default to cwd)
- [ ] Post-restore checklist (missing tools, credential notes)
- [ ] Identity file warnings (highlight SOUL.md/AGENTS.md changes)

**Tests (all use /tmp/clawback-test-* directories):**
- [ ] `restore.test.ts`: extracts all files to target directory
- [ ] `restore.test.ts`: file contents match original checksums after extract
- [ ] `restore.test.ts`: path remapping applied to TOOLS.md content
- [ ] `restore.test.ts`: path remapping applied to gateway config
- [ ] `restore.test.ts`: `--dry-run` lists changes but writes nothing
- [ ] `restore.test.ts`: refuses to restore without `--workspace` flag
- [ ] `restore.test.ts`: creates target directory if it doesn't exist
- [ ] `restore.test.ts`: warns about missing dependencies

**Integration test (safe — writes to temp only):**
- [ ] `restore.integration.test.ts`: backup live workspace → restore to /tmp/clawback-restore-test/ → verify all files present and checksums match

**Gate:** `npm test` — all 9 tests pass + integration test round-trips successfully.

---

#### Stage 8: Diff Command
**Goal:** Compare backup vs live state, or two backups.

**Deliverables:**
- [ ] `src/diff.ts` — compare file lists + contents between two sources
- [ ] `clawback diff <archive>` — compare archive to live workspace
- [ ] `clawback diff <archive_a> <archive_b>` — compare two archives
- [ ] Output: ADDED / MODIFIED / DELETED / UNCHANGED with line counts

**Tests:**
- [ ] `diff.test.ts`: detects added file (in live but not backup)
- [ ] `diff.test.ts`: detects modified file (different content)
- [ ] `diff.test.ts`: detects deleted file (in backup but not live)
- [ ] `diff.test.ts`: detects unchanged files
- [ ] `diff.test.ts`: two identical archives show no differences
- [ ] `diff.test.ts`: diff between two archives works

**Gate:** `npm test` — all 6 tests pass.

---

#### Stage 9: Cron Job Export/Import
**Goal:** Backup and restore OpenClaw cron job definitions.

**Deliverables:**
- [ ] Extend backup to export cron jobs via OpenClaw config/API
- [ ] Store as `config/cron-jobs.json` in archive
- [ ] Restore imports cron jobs (with path remapping in payloads)

**Tests:**
- [ ] `cron.test.ts`: exports cron jobs to JSON format
- [ ] `cron.test.ts`: cron JSON schema is valid
- [ ] `cron.test.ts`: path remapping applied to cron payloads
- [ ] `cron.test.ts`: handles workspace with no cron jobs

**Gate:** `npm test` — all 4 tests pass.

---

#### Stage 10: MVP Polish + End-to-End
**Goal:** CLI is polished, documented, and passes full end-to-end test.

**Deliverables:**
- [ ] Clean `--help` text for all commands
- [ ] Error handling: clear messages for common failures (workspace not found, corrupt archive, permission denied)
- [ ] `README.md` with install + usage instructions
- [ ] `npm run build` produces single executable entry point

**End-to-end test (safe):**
- [ ] `e2e.test.ts`: Full cycle on mock workspace:
  1. `clawback backup --workspace fixtures/mock-workspace --output /tmp/test.clawback`
  2. `clawback verify /tmp/test.clawback` → exit 0
  3. `clawback info /tmp/test.clawback` → shows correct metadata
  4. Modify a file in mock workspace
  5. `clawback diff /tmp/test.clawback --workspace fixtures/mock-workspace` → shows modification
  6. `clawback restore /tmp/test.clawback --workspace /tmp/restored/ --force`
  7. Compare restored dir to original → all files match

**Live backup test (read-only, safe):**
- [ ] `live.test.ts`: `clawback backup --workspace ~/clawd --output /tmp/cowboy-backup.clawback` succeeds
- [ ] `live.test.ts`: `clawback verify /tmp/cowboy-backup.clawback` → exit 0
- [ ] `live.test.ts`: `clawback info /tmp/cowboy-backup.clawback` → shows "Cowboy"

**Gate:** ALL tests pass. `npm test` exits 0. Live backup of ~/clawd succeeds and verifies.

---

### Stage Summary

| Stage | What | Tests | Cumulative |
|-------|------|-------|-----------|
| 1 | Scaffold + Discovery | 6 | 6 |
| 2 | Manifest + Checksums | 8 | 14 |
| 3 | Backup Command | 9 | 23 |
| 4 | Verify Command | 5 | 28 |
| 5 | Info Command | 4 | 32 |
| 6 | Path Remapping | 6 | 38 |
| 7 | Restore Command | 9 | 47 |
| 8 | Diff Command | 6 | 53 |
| 9 | Cron Export/Import | 4 | 57 |
| 10 | Polish + E2E | 4 | 61 |
| **Total** | | **61 tests** | |

---

## v1.1 Roadmap (Post-Live-Test Fixes)

Issues discovered during live backup test against ~/clawd (Feb 12, 2026):

### P0 — Must Fix

| # | Issue | Details |
|---|-------|---------|
| 1 | **Agent name extraction broken** | `info` shows "IDENTITY.md - Who Am I?" instead of "Cowboy". Parser reads first line literally instead of extracting name field. |
| 2 | ~~**Ship as compiled npm package**~~ | Removed — local build sufficient for now. |
| 3 | **Export gateway config via API** | No `config/` dir in typical workspaces — gateway.yaml is managed by OpenClaw runtime. Should call `openclaw config get` or gateway API to capture running config. |
| 4 | **Export cron jobs via API** | Stage 9 has the schema but doesn't call the OpenClaw cron API during backup. Should `cron list` and embed real jobs in archive. |

### P0.5 — Test Gaps (found the hard way)

The live test exposed issues that unit/e2e tests should have caught. These are test gaps, not feature gaps.

| # | Missing Test | What it would catch |
|---|-------------|---------------------|
| T1 | **Live workspace backup size sanity check** | Archive >5MB on a typical workspace = something is wrong. The 138MB backup (before fix) would have been caught instantly. |
| T2 | **Agent name extraction from real files** | Mock IDENTITY.md had simple content; real one has markdown headers. Test with realistic multi-line markdown. |
| T3 | **Manifest file count sanity check** | >500 files in a backup = probably scanning too many dirs. Should warn or fail. |
| T4 | **Archive round-trip on real workspace** | E2E test only used mock fixtures. A test against a realistic workspace structure (with decoy dirs like `projects/`, `data/`, `images/`) would catch the greedy scanner. |
| T5 | **Backup → info → verify pipeline test** | Each command tested in isolation. A pipeline test (backup produces valid archive that info and verify both accept) would catch format mismatches earlier. |
| T6 | **Known directory whitelist test** | Explicitly test that directories like `projects/`, `data/`, `.git/`, `node_modules/` are excluded even when present in workspace. |

**Lesson:** Mock-only tests give false confidence. Need at least one "realistic workspace" fixture that mirrors a real agent workspace with decoy directories, large files, and edge cases.

### P0.6 — Docker Recovery Integration Test

The ultimate test: can a backed-up agent actually run on a fresh machine? Not just "files restored correctly" but "agent boots and responds."

**Test flow:**
```
1. clawback backup --workspace ~/clawd → cowboy.clawback
2. docker build → fresh Linux container with Node.js + OpenClaw installed
3. COPY cowboy.clawback into container
4. docker run:
   a. clawback restore cowboy.clawback --workspace /agent --force
   b. Verify all files present (SOUL.md, MEMORY.md, config, skills)
   c. Verify path remapping worked (no /Users/shen references in restored files)
   d. openclaw gateway start --workspace /agent (or dry-run equivalent)
   e. Check gateway responds / config is valid
   f. Exit 0 = PASS
```

**Dockerfile sketch:**
```dockerfile
FROM node:24-slim
RUN npm install -g clawback openclaw
COPY cowboy.clawback /tmp/
RUN clawback restore /tmp/cowboy.clawback --workspace /agent --force
RUN grep -r "/Users/shen" /agent/ && exit 1 || echo "No hardcoded paths ✓"
# Validate gateway config parses
RUN cd /agent && openclaw gateway validate 2>/dev/null || echo "Gateway validation skipped"
```

**What this catches that unit tests don't:**
- Cross-platform path remapping (macOS → Linux)
- Architecture differences (arm64 → x86_64)
- Missing runtime dependencies on a clean machine
- File permissions lost in transit
- Gateway config actually parseable on target OS
- The full "traveling human" scenario end-to-end

**Implementation:** `tests/docker/` directory with Dockerfile + `run-recovery-test.sh`. Can run manually or in CI. Not part of `npm test` (requires Docker).

### P0.7 — Credential Backup & Restore

Two backup modes with smart credential handling.

#### Backup

**Safe backup (default):**
```bash
clawback backup
# No credentials included. Safe to store anywhere.
```

**With credentials (opt-in, password-protected):**
```bash
# Interactive — prompts for password twice (confirm):
clawback backup --with-credentials

# Non-interactive — password via argument (for scripts/cron):
clawback backup --with-credentials --password "mypassword"

# Include extra credential files beyond the default whitelist:
clawback backup --with-credentials --include-credential ~/weibo-cookies.json --include-credential ~/.ssh/id_ed25519
```

**Default credential whitelist (auto-detected):**
- Gateway config API keys (anthropic, openai, etc. from gateway YAML)
- OAuth tokens / credential caches (OpenClaw auth)
- `.env` files in workspace root
- Cookie files matching `*-cookies.json` in workspace

**`--include-credential <path>`:** Adds arbitrary files to the encrypted vault. Paths are recorded in the credential manifest so restore knows where to put them back.

**Credential manifest (`credentials-manifest.json`):**
Always stored in `--with-credentials` backups. Records:
```json
{
  "credentials": [
    { "name": "ANTHROPIC_API_KEY", "source": "gateway-config", "required": true },
    { "name": "weibo-cookies.json", "source": "include-credential", "originalPath": "/Users/shen/weibo-cookies.json", "required": false }
  ]
}
```

#### Restore

**Archive HAS credentials vault:**
```bash
clawback restore backup.clawback --workspace /agent
# → Detects credentials.age
# → Prompts for password (or --password "xxx" for non-interactive)
# → Decrypts and deploys all credentials to correct locations
# → Remaps credential paths for target environment
# → Reports: "5 credentials restored"
```

**Archive has NO credentials (safe backup):**
```bash
clawback restore backup.clawback --workspace /agent
# → Restores all files
# → Asks ONLY for the essential AI agent key to get agent running:
#   "Enter your Anthropic API key (or press Enter to skip):"
#   (detects which provider was used from gateway config)
# → Writes key to gateway config
# → Agent can figure out the rest with user later
```

**With `--include-credential` files in backup:**
```bash
# Restore also recovers the extra credential files
# Using paths from credentials-manifest.json, remapped to new environment
# e.g. /Users/shen/weibo-cookies.json → /home/user/weibo-cookies.json
```

#### Password handling
- `--password "xxx"` on backup → use directly, no confirmation prompt
- No `--password` on backup → interactive prompt, type twice to confirm
- `--password "xxx"` on restore → use directly
- No `--password` on restore → interactive prompt (single entry)
- Wrong password → clear error, exit 1 (no retry loop, user re-runs)

#### Implementation
- `src/credentials.ts` — detect, collect, encrypt, decrypt credential files
- Encryption: AES-256-GCM + scrypt KDF (Node crypto stdlib)
- `credentials-manifest.json` — what was backed up and where it goes
- `--with-credentials`, `--password`, `--include-credential` flags
- Tests: encrypt/decrypt round-trip, restore with/without vault, wrong password rejection, include-credential round-trip, manifest accuracy

### P1 — Should Fix

| # | Issue | Details |
|---|-------|---------|
| 5 | **`--include` flag** | Let users whitelist additional directories beyond the defaults (e.g. `--include research/ --include work/`). |
| 6 | **Binary/image exclusion** | Skills may contain large data files. Add size limits (e.g. skip files >1MB by default) or extension-based filtering. |
| 7 | **Restore with OpenClaw integration** | `restore` should optionally call `openclaw config apply` and `cron add` to activate the restored agent, not just dump files. |

### P2 — Nice to Have

| # | Issue | Details |
|---|-------|---------|
| 8 | **Incremental backups** | Full snapshots every day will grow the git repo. Could store diffs or rely on git dedup (OK for <1MB archives). |
| 9 | **Backup rotation** | Keep last N backups, auto-prune old ones from the repo. |
| 10 | **Dry-run backup** | `clawback backup --dry-run` to preview what would be included without creating the archive. |

---

### Sub-Agent Dev Loop

```
For each stage (1 → 10):
  1. Read DESIGN.md for stage requirements
  2. Implement deliverables
  3. Write tests
  4. Run `npm test`
  5. If tests fail → fix and retry (max 5 iterations)
  6. If gate passes → commit, report status, move to next stage
  7. If stuck after 5 iterations → report blocker, stop
```

---

## Primary Scenario: Traveling Human, Lost Agent

**The story:** Yuan is traveling in Japan. His Mac mini at home loses power, disk corrupts, or the OS breaks. He has no physical access. His agent (Cowboy) — with months of memories, configs, cron jobs, credentials — is gone.

**But he ran `clawback backup` last week** and the `.clawback` file is on GitHub / cloud storage / USB he carries.

**Recovery from a hotel room:**
```bash
# On any machine (friend's laptop, VPS, fresh cloud instance)
# Step 1: Install runtime (one command)
curl -fsSL https://raw.githubusercontent.com/openclaw/clawback/main/install.sh | sh
# (or: npm install -g clawback openclaw)

# Step 2: Get the backup file
# From GitHub private repo:
gh repo clone yuan/agent-backups /tmp/backups
# Or from cloud storage, USB, email attachment, whatever

# Step 3: Restore
clawback restore /tmp/backups/cowboy-2026-02-08.clawback --workspace ~/agent

# Clawback walks you through:
#   → Detects new platform (Linux VPS vs macOS)
#   → Remaps all paths automatically
#   → Lists missing tools (optional ones can wait)
#   → Restores credentials to local keyring
#   → Generates ready-to-run openclaw config

# Step 4: Start the agent
openclaw gateway start --workspace ~/agent
# Cowboy is back. Memories intact. Knows Yuan is traveling.
```

**Design implications:**
- **One-command install** — `npx clawback` must work without prior setup
- **Guided restore** — the human may be stressed and not remember paths/configs. Clawback asks minimal questions and provides smart defaults
- **Platform adaptive** — backup from macOS ARM must restore cleanly on Linux x86 VPS
- **Graceful degradation** — if some tools aren't available on the new machine, agent still starts with reduced capabilities rather than failing
- **Small backup files** — must be easy to store in a git repo or carry on a USB stick. Agent state (without large data) should be < 5MB typically

This is the scenario every design decision should be tested against.

---

## Other Usage Scenarios

### Scenario 1: Hardware failure
```bash
# Old machine (before it died — you ran this weekly)
clawback backup --with-credentials --output /nas/backups/cowboy-latest.clawback

# New machine
npm install -g clawback openclaw
clawback restore /nas/backups/cowboy-latest.clawback --workspace ~/clawd
openclaw gateway start
# Cowboy is back, memories intact
```

### Scenario 2: Migration to new OS
```bash
# On Mac
clawback backup --with-credentials

# Copy .clawback file to Linux box, then:
clawback restore cowboy-2026-02-11.clawback --workspace ~/clawd
# Paths auto-remapped, credentials moved to Linux keyring
```

### Scenario 3: "What changed this week?"
```bash
clawback diff last-monday.clawback --live
# Shows all memory additions, config changes, new skills since Monday
```

### Scenario 4: Share agent setup (without credentials)
```bash
clawback backup --exclude memory/ --output my-agent-template.clawback
# Share the template — identity + config + skills, no personal memories or creds
```

---

## v2 Roadmap

### `restore --run` ✅ DONE (v1.2)

One-key restore: extract → decrypt → detect OpenClaw → prompt API key → import cron → start gateway → health check → `✅ Agent running`.

### `containerize` (next)

```bash
clawback containerize backup.clawback [--output <dir>] [--run]
```
Generates `deploy/` with Dockerfile, docker-compose.yml, entrypoint.sh, README.

### Restore Awareness (planned)

After restore + gateway start, inject wake event so the agent knows it was restored:
- Timestamp of backup, current time, gap duration
- Via `openclaw gateway wake --text "RESTORE NOTICE: ..."`
- Without `--run`: generate `restore-wake.sh` for manual use

### Future Ideas

| Feature | Description |
|---------|-------------|
| **`clawback upgrade`** | Migrate backup format between versions |
| **Multi-agent workspaces** | Backup/restore multiple agents from one machine |
| ~~**Full-archive encryption**~~ | ~~`--encrypt` flag for privacy on untrusted storage~~ (done — v1.1) |

---

## Design Decision: Encryption Scope

**Decision: Encrypt credentials only (not full archive)**
**Date:** 2026-02-13

### Current behavior
`--with-credentials` encrypts a small vault (~11KB) with AES-256-GCM. All other files remain readable in the archive.

### Why credentials-only is the right default

**Pros:**
- Fast — only encrypts a small vault, backup/restore stays instant
- Partial access — `info`, `verify`, `diff` all work without any password
- Restore without credentials still works (agent boots, just needs new API key)
- Most files (SOUL.md, memory, skills) aren't secrets — encrypting them adds friction for no security gain
- Lost password = lose credentials only; agent state is still recoverable

**Full-archive encryption (considered, deprioritized):**

Pros:
- Full privacy — archive is opaque without password
- Simpler mental model: "encrypted = safe to store anywhere"
- Protects memory files that might contain personal context

Cons:
- Can't inspect without password — `info`, `verify`, `diff` all need password or become useless
- Lost password = total loss (no partial recovery)
- Password fatigue — every operation needs the password
- Slower for large archives

**Threat model:** Primary scenario is "I lost my machine, restore on a new one" — not "adversary has my backup file." API keys are the actual damage if leaked; SOUL.md is not a secret. For untrusted cloud storage where memory privacy matters, a future `--encrypt` flag could encrypt the full archive as an opt-in option.

**If implemented later:** Add `--encrypt` as a separate flag (not replacing `--with-credentials`). Would need password plumbing through `info`/`verify`/`diff` commands.

---

### Workspace Discovery: Include-All with Ignore (planned)

**Problem:** Current backup only recurses into 4 hardcoded directories (`memory`, `config`, `skills`, `scripts`). Agents accumulate custom directories over time (`projects/`, `data/`, `research/`, etc.) that get silently dropped from backups.

**Proposed fix:** Switch from allowlist to denylist approach with `.clawbackignore` support.

**Options considered:**
1. ~~Allowlist (current)~~ — always lags behind what agents create
2. **Denylist** — backup everything except known-skip dirs (`node_modules`, `.git`, `dist`, `.cache`, `tmp`)
3. **Hybrid (recommended)** — include-all by default + `.clawbackignore` file (gitignore syntax) for exclusions

**Default ignores:** `node_modules/`, `.git/`, `dist/`, `.cache/`, `tmp/`, `*.log`, `.DS_Store`

**Backward compatibility:** Archives created with the new approach will restore fine on older versions (just more files). Old archives restore fine on new versions (missing dirs are simply absent).

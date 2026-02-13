# 🐴 Saddlebag — Backup & Disaster Recovery for OpenClaw Agents

> *One command to save. One command to ride again.*

**Codename:** Saddlebag
**Author:** Cowboy 🤠 + Yuan
**Created:** 2026-02-11
**Status:** Draft v0.2

---

## What Is This?

An open-source CLI tool that backs up an OpenClaw agent's complete state into a single portable file, and restores it on the same or a different machine.

```bash
npm install -g saddlebag

# Backup
saddlebag backup
# → cowboy-2026-02-11.saddlebag (one file, everything inside)

# Restore (same machine)
saddlebag restore cowboy-2026-02-11.saddlebag

# Restore (new machine, different paths)
saddlebag restore cowboy-2026-02-11.saddlebag --workspace ~/my-agent
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

- **Backup** all OpenClaw agent state into a single `.saddlebag` file
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
- Auto-scheduled backups (cron it yourself: `0 3 * * * saddlebag backup`)
- Multi-agent workspaces
- Frameworks other than OpenClaw
- Real-time sync or replication

---

## What Gets Backed Up

Saddlebag auto-discovers the OpenClaw workspace and captures everything the agent needs:

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

Credentials are **opt-in** (`saddlebag backup --with-credentials`) and always stored in a separately encrypted vault within the archive. The rest of the backup is readable without the credential key.

### Skills (configurable)

```
Built-in skills      — Skipped (reinstallable from OpenClaw)
Custom skills        — Included (user-created, not available elsewhere)
Skill data           — Large data dirs excluded by default, opt-in with --include-data
```

---

## Backup Format

A `.saddlebag` file is a zstd-compressed tar archive:

```
cowboy-2026-02-11.saddlebag
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
├── credentials.age         # age-encrypted credential vault (if --with-credentials)
└── README.md               # Human-readable: what's in this backup, how to restore
```

### manifest.json

```json
{
  "saddlebag_version": "1.0",
  "created": "2026-02-11T04:36:00+08:00",
  "agent": {
    "name": "Cowboy",
    "soul_hash": "sha256:abc123..."
  },
  "source": {
    "hostname": "Shen的Mac mini",
    "os": "darwin",
    "arch": "arm64",
    "workspace": "/Users/shen/clawd",
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

### `saddlebag backup`

```bash
saddlebag backup [OPTIONS]

Options:
  --workspace PATH       OpenClaw workspace (auto-detected if not set)
  --output PATH          Output file (default: <agent>-<date>.saddlebag)
  --with-credentials     Include encrypted credential vault
  --include-data         Include large skill data directories
  --exclude PATTERN      Exclude files matching glob pattern (repeatable)
  --passphrase           Encrypt entire archive (prompted, not on CLI)

Auto-detection: looks for SOUL.md or AGENTS.md in cwd, then checks
common locations (~/.openclaw, ~/clawd, etc.)
```

### `saddlebag restore`

```bash
saddlebag restore <FILE> [OPTIONS]

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

### `saddlebag verify`

```bash
saddlebag verify <FILE>

Checks:
  ✓ Archive integrity (decompresses without error)
  ✓ Manifest present and valid JSON
  ✓ All listed files present in archive
  ✓ All checksums match
  ✓ Credential vault decryptable (if passphrase provided)
```

### `saddlebag diff`

```bash
# Compare backup to current live state
saddlebag diff <FILE>

# Compare two backups
saddlebag diff <FILE_A> <FILE_B>

Output:
  ADDED     memory/2026-02-11.md
  MODIFIED  MEMORY.md (+15 lines, -2 lines)
  DELETED   memory/temp-note.md
  UNCHANGED SOUL.md, AGENTS.md (23 files)
```

### `saddlebag info`

```bash
saddlebag info <FILE>

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
  "${WORKSPACE}": "/Users/shen/clawd",
  "${HOME}": "/Users/shen",
  "${OPENCLAW}": "/Users/shen/openclaw-dev"
}
```

On restore, Saddlebag auto-detects new values and asks for confirmation:

```
Path remapping (macOS → Linux):
  ${HOME}      /Users/shen → /home/shen [auto]
  ${WORKSPACE} /Users/shen/clawd → /home/shen/clawd [auto]
  ${OPENCLAW}  /Users/shen/openclaw-dev → ? enter path: /opt/openclaw
```

Files that contain hardcoded paths (TOOLS.md, gateway config, cron payloads) are rewritten with new values.

### Credential Backends

| Platform | Primary | Fallback |
|----------|---------|----------|
| macOS | Keychain (`security` CLI) | Encrypted file |
| Linux (desktop) | Secret Service (D-Bus) | Encrypted file |
| Linux (headless) | `pass` (if available) | Encrypted file |

The fallback (age-encrypted JSON file at `~/.config/saddlebag/vault.age`) always works, on every platform.

### Dependency Check

On restore, Saddlebag lists tools the agent uses and checks availability:

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
2. **Credentials always encrypted** — age encryption, separate from main archive
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
| Supply chain attack on Saddlebag | Signed releases, SBOM, minimal pinned deps |

---

## Implementation

### Tech Stack

Aligned with OpenClaw's stack (TypeScript / Node.js):

- **Language:** TypeScript (strict mode)
- **Runtime:** Node.js 20+ (LTS)
- **Compression:** tar + zstd (via `@napi-rs/zstd` or Node zlib gzip fallback)
- **Encryption:** age (via `age-encryption` npm or shelling to `age` CLI)
- **Hashing:** Node crypto (stdlib — SHA-256)
- **CLI:** Commander.js (same as OpenClaw)
- **Config parsing:** YAML via `yaml` package (same as OpenClaw)
- **Distribution:** npm (`npm install -g saddlebag` or `npx saddlebag`)
- **Build:** tsup (single-file bundle) or esbuild
- **Testing:** Vitest
- **Dependencies:** Minimal — commander, yaml, tar, age encryption, chalk

**Why align with OpenClaw's stack:**
- Same language = potential upstream merge as `openclaw backup`
- Shared dependencies (commander, yaml, chalk already in OpenClaw)
- OpenClaw contributors can contribute without context-switching
- Could import OpenClaw's config parser directly for perfect gateway.yaml handling
- Single runtime requirement (Node.js) — already installed for OpenClaw

### Project Structure

```
saddlebag/
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
│   └── platforms/
│       ├── index.ts         # Platform detection & abstraction
│       ├── darwin.ts        # macOS-specific (Keychain, paths)
│       └── linux.ts         # Linux-specific (Secret Service, XDG)
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
- [ ] `cli.test.ts`: `saddlebag --version` prints version
- [ ] `cli.test.ts`: `saddlebag --help` lists commands

**Gate:** `npm test` — all 6 tests pass, `npm run build` succeeds.

---

#### Stage 2: Manifest + File Inventory
**Goal:** Scan a workspace and produce a complete manifest with checksums.

**Deliverables:**
- [ ] `src/manifest.ts` — scan workspace, hash files, produce manifest.json
- [ ] File categorization: agent files, config, skills, scripts
- [ ] SHA-256 checksum for every file
- [ ] Respect `.gitignore` and default excludes (node_modules, .git, *.saddlebag)
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
**Goal:** `saddlebag backup` creates a valid .saddlebag archive from a workspace.

**Deliverables:**
- [ ] `src/backup.ts` — orchestrates: discover → manifest → tar+compress → write file
- [ ] Output: `<agent-name>-<date>.saddlebag` (tar.gz format, gzip for max compatibility)
- [ ] Includes `manifest.json` at archive root
- [ ] Includes `README.md` with human-readable restore instructions
- [ ] `--output` flag for custom output path
- [ ] Progress output (file count, size)

**Tests:**
- [ ] `backup.test.ts`: creates .saddlebag file from mock workspace
- [ ] `backup.test.ts`: archive contains manifest.json
- [ ] `backup.test.ts`: archive contains all expected agent files (SOUL.md, MEMORY.md, etc.)
- [ ] `backup.test.ts`: archive contains README.md
- [ ] `backup.test.ts`: manifest checksums match actual file contents in archive
- [ ] `backup.test.ts`: `--output` flag writes to specified path
- [ ] `backup.test.ts`: backup of empty workspace (only SOUL.md) succeeds
- [ ] `backup.test.ts`: large files (>1MB) are included correctly

**Integration test (safe — read-only against live workspace):**
- [ ] `backup.integration.test.ts`: run `saddlebag backup --workspace ~/clawd --output /tmp/test-backup.saddlebag` — succeeds, file is created, manifest is valid JSON, checksums verify

**Gate:** `npm test` — all 9 tests pass + integration test creates valid archive from live workspace.

---

#### Stage 4: Verify Command
**Goal:** `saddlebag verify` validates archive integrity.

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
**Goal:** `saddlebag info` shows human-readable backup summary.

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
**Goal:** `saddlebag restore` extracts archive to a target directory with path remapping.

**⚠️ All restore tests use temp directories only. Never touch ~/clawd.**

**Deliverables:**
- [ ] `src/restore.ts` — verify → prompt path remaps → extract → remap paths → report
- [ ] `--dry-run` flag: show what would change, don't write
- [ ] `--workspace` flag: target directory (required for safety — no default to cwd)
- [ ] Post-restore checklist (missing tools, credential notes)
- [ ] Identity file warnings (highlight SOUL.md/AGENTS.md changes)

**Tests (all use /tmp/saddlebag-test-* directories):**
- [ ] `restore.test.ts`: extracts all files to target directory
- [ ] `restore.test.ts`: file contents match original checksums after extract
- [ ] `restore.test.ts`: path remapping applied to TOOLS.md content
- [ ] `restore.test.ts`: path remapping applied to gateway config
- [ ] `restore.test.ts`: `--dry-run` lists changes but writes nothing
- [ ] `restore.test.ts`: refuses to restore without `--workspace` flag
- [ ] `restore.test.ts`: creates target directory if it doesn't exist
- [ ] `restore.test.ts`: warns about missing dependencies

**Integration test (safe — writes to temp only):**
- [ ] `restore.integration.test.ts`: backup live workspace → restore to /tmp/saddlebag-restore-test/ → verify all files present and checksums match

**Gate:** `npm test` — all 9 tests pass + integration test round-trips successfully.

---

#### Stage 8: Diff Command
**Goal:** Compare backup vs live state, or two backups.

**Deliverables:**
- [ ] `src/diff.ts` — compare file lists + contents between two sources
- [ ] `saddlebag diff <archive>` — compare archive to live workspace
- [ ] `saddlebag diff <archive_a> <archive_b>` — compare two archives
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
  1. `saddlebag backup --workspace fixtures/mock-workspace --output /tmp/test.saddlebag`
  2. `saddlebag verify /tmp/test.saddlebag` → exit 0
  3. `saddlebag info /tmp/test.saddlebag` → shows correct metadata
  4. Modify a file in mock workspace
  5. `saddlebag diff /tmp/test.saddlebag --workspace fixtures/mock-workspace` → shows modification
  6. `saddlebag restore /tmp/test.saddlebag --workspace /tmp/restored/ --force`
  7. Compare restored dir to original → all files match

**Live backup test (read-only, safe):**
- [ ] `live.test.ts`: `saddlebag backup --workspace ~/clawd --output /tmp/cowboy-backup.saddlebag` succeeds
- [ ] `live.test.ts`: `saddlebag verify /tmp/cowboy-backup.saddlebag` → exit 0
- [ ] `live.test.ts`: `saddlebag info /tmp/cowboy-backup.saddlebag` → shows "Cowboy"

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
1. saddlebag backup --workspace ~/clawd → cowboy.saddlebag
2. docker build → fresh Linux container with Node.js + OpenClaw installed
3. COPY cowboy.saddlebag into container
4. docker run:
   a. saddlebag restore cowboy.saddlebag --workspace /agent --force
   b. Verify all files present (SOUL.md, MEMORY.md, config, skills)
   c. Verify path remapping worked (no /Users/shen references in restored files)
   d. openclaw gateway start --workspace /agent (or dry-run equivalent)
   e. Check gateway responds / config is valid
   f. Exit 0 = PASS
```

**Dockerfile sketch:**
```dockerfile
FROM node:24-slim
RUN npm install -g saddlebag openclaw
COPY cowboy.saddlebag /tmp/
RUN saddlebag restore /tmp/cowboy.saddlebag --workspace /agent --force
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
saddlebag backup
# No credentials included. Safe to store anywhere.
```

**With credentials (opt-in, password-protected):**
```bash
# Interactive — prompts for password twice (confirm):
saddlebag backup --with-credentials

# Non-interactive — password via argument (for scripts/cron):
saddlebag backup --with-credentials --password "mypassword"

# Include extra credential files beyond the default whitelist:
saddlebag backup --with-credentials --include-credential ~/weibo-cookies.json --include-credential ~/.ssh/id_ed25519
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
saddlebag restore backup.saddlebag --workspace /agent
# → Detects credentials.age
# → Prompts for password (or --password "xxx" for non-interactive)
# → Decrypts and deploys all credentials to correct locations
# → Remaps credential paths for target environment
# → Reports: "5 credentials restored"
```

**Archive has NO credentials (safe backup):**
```bash
saddlebag restore backup.saddlebag --workspace /agent
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
- Encryption: `age` library with password recipient (argon2 KDF)
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
| 10 | **Dry-run backup** | `saddlebag backup --dry-run` to preview what would be included without creating the archive. |

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

**But he ran `saddlebag backup` last week** and the `.saddlebag` file is on GitHub / cloud storage / USB he carries.

**Recovery from a hotel room:**
```bash
# On any machine (friend's laptop, VPS, fresh cloud instance)
# Step 1: Install runtime (one command)
curl -fsSL https://raw.githubusercontent.com/openclaw/saddlebag/main/install.sh | sh
# (or: npm install -g saddlebag openclaw)

# Step 2: Get the backup file
# From GitHub private repo:
gh repo clone yuan/agent-backups /tmp/backups
# Or from cloud storage, USB, email attachment, whatever

# Step 3: Restore
saddlebag restore /tmp/backups/cowboy-2026-02-08.saddlebag --workspace ~/agent

# Saddlebag walks you through:
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
- **One-command install** — `npx saddlebag` must work without prior setup
- **Guided restore** — the human may be stressed and not remember paths/configs. Saddlebag asks minimal questions and provides smart defaults
- **Platform adaptive** — backup from macOS ARM must restore cleanly on Linux x86 VPS
- **Graceful degradation** — if some tools aren't available on the new machine, agent still starts with reduced capabilities rather than failing
- **Small backup files** — must be easy to store in a git repo or carry on a USB stick. Agent state (without large data) should be < 5MB typically

This is the scenario every design decision should be tested against.

---

## Other Usage Scenarios

### Scenario 1: Hardware failure
```bash
# Old machine (before it died — you ran this weekly)
saddlebag backup --with-credentials --output /nas/backups/cowboy-latest.saddlebag

# New machine
npm install -g saddlebag openclaw
saddlebag restore /nas/backups/cowboy-latest.saddlebag --workspace ~/clawd
openclaw gateway start
# Cowboy is back, memories intact
```

### Scenario 2: Migration to new OS
```bash
# On Mac
saddlebag backup --with-credentials

# Copy .saddlebag file to Linux box, then:
saddlebag restore cowboy-2026-02-11.saddlebag --workspace ~/clawd
# Paths auto-remapped, credentials moved to Linux keyring
```

### Scenario 3: "What changed this week?"
```bash
saddlebag diff last-monday.saddlebag --live
# Shows all memory additions, config changes, new skills since Monday
```

### Scenario 4: Share agent setup (without credentials)
```bash
saddlebag backup --exclude memory/ --output my-agent-template.saddlebag
# Share the template — identity + config + skills, no personal memories or creds
```

---

## v2 Roadmap

### `saddlebag restore` → Agent Running (Full Integration)

Restore becomes a complete "one-key" operation — not just files, but a running agent:

```bash
saddlebag restore backup.saddlebag --workspace /agent
# 1. Extract files + remap paths (v1)
# 2. Decrypt credentials if present (v1.1 P0.7)
# 3. Detect if OpenClaw installed → if not, install it (npm install -g openclaw)
# 4. Write gateway config with API key (prompt if missing)
# 5. Import cron jobs (openclaw cron add)
# 6. Apply channel config (Slack/Telegram/Discord tokens)
# 7. Start gateway (openclaw gateway start)
# 8. Post-restore health check — verify agent responds
# 9. Report: "Agent 'Cowboy' is running at localhost:3000"
```

### `saddlebag containerize` — Docker Deployment from Backup

Generate a ready-to-run Docker deployment from any backup:

```bash
saddlebag containerize backup.saddlebag
# → generates:
#   deploy/
#   ├── Dockerfile
#   ├── docker-compose.yml
#   ├── .env.example        # required credentials (user fills in)
#   └── README.md           # how to run

saddlebag containerize backup.saddlebag --with-credentials --password "xxx"
# → same but .env is pre-filled with decrypted credentials

# Then:
cd deploy && docker compose up -d
# → Agent running in container, accessible via configured channels
```

**Dockerfile generates:**
- Base: `node:22-slim`
- Installs OpenClaw + saddlebag
- Restores backup with path remapping
- Configures gateway from environment variables
- Imports cron jobs
- Entrypoint: `openclaw gateway start`
- Health check endpoint

**docker-compose.yml includes:**
- Environment variables for API keys (from `.env`)
- Volume mount for persistent memory (so agent state survives container restart)
- Restart policy: `unless-stopped`
- Port mapping for gateway

### Additional v2 Features

| Feature | Description |
|---------|-------------|
| **Auto-install OpenClaw** | `restore` detects missing OpenClaw, offers to install |
| **Cron job import** | Restore calls `openclaw cron add` for each backed-up job |
| **Channel config handling** | Slack/Telegram/Discord tokens treated as credentials, restored to gateway config |
| **Post-restore health check** | After starting gateway, verify agent responds to a test message |
| **`saddlebag upgrade`** | Migrate backup format between saddlebag versions |
| **Multi-agent workspaces** | Backup/restore multiple agents from one machine |

---

## Design Decision: Encryption Scope

**Decision: Encrypt credentials only (not full archive)**
**Date:** 2026-02-13

### Current behavior
`--with-credentials` encrypts a small vault (~11KB) with age. All other files remain readable in the archive.

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

## v3 Roadmap — Multi-Platform Agent Portability

**Goal:** Saddlebag becomes a universal agent backup/restore/migration tool — not limited to OpenClaw. Backup from one platform, restore to another.

### Target Platforms

| Platform | Architecture | Agent State Storage | Feasibility |
|----------|-------------|-------------------|-------------|
| **OpenClaw** | Node.js, single process, YAML config, flat MD files | Workspace dir (MD files), gateway YAML, cron JSON, SQLite memory index | ✅ Done (v1) |
| **NanoClaw** | Node.js, container-isolated, Claude Agent SDK | `groups/{name}/CLAUDE.md` per-group memory, `data/messages.db` (SQLite), `data/sessions/` (SDK state), `data/state.json`, per-group `logs/` | ✅ Realistic — simpler than OpenClaw, ~700 lines total, flat file + SQLite |
| **Claude Code** (standalone) | Bun/Node, local filesystem | `.claude/` dir, `CLAUDE.md`, conversation history in `~/.claude/` | ✅ Realistic — well-documented structure |
| **Others (future)** | Varies | Research needed | 🔍 TBD |

### Architecture Analysis: NanoClaw

Reviewed source structure (via DeepWiki + GitHub):
```
nanoclaw/
├── src/index.ts              # Main orchestrator (~700 lines)
├── src/container-runner.ts   # Container spawning
├── src/task-scheduler.ts     # Scheduled tasks
├── src/db.ts                 # SQLite operations
├── src/config.ts             # Config constants
├── container/agent-runner.js # Claude SDK executor
├── groups/{name}/CLAUDE.md   # Per-group memory (key state!)
├── data/messages.db          # SQLite message history
├── data/sessions/            # Agent SDK state
├── data/registered_groups.json
├── data/state.json           # Last processed timestamp
└── .claude/skills/           # Skills
```

**What saddlebag would need to capture:**
1. `groups/*/CLAUDE.md` — equivalent to our SOUL.md + MEMORY.md per-group
2. `data/messages.db` — SQLite, portable as-is
3. `data/sessions/` — Agent SDK conversation state
4. `data/state.json` + `registered_groups.json` — runtime state
5. `.claude/skills/` — skills (similar concept)
6. Config is in code (config.ts), not external files — would need extraction

**Cross-platform migration challenges:**
- **State format translation:** OpenClaw uses flat MD files for memory; NanoClaw uses CLAUDE.md + SQLite. Need bidirectional converters.
- **Config translation:** OpenClaw gateway YAML ↔ NanoClaw config.ts constants. Different schemas for channels, scheduling, etc.
- **Channel credentials:** WhatsApp session state is platform-specific (baileys library state). May not be portable.
- **Memory semantics:** OpenClaw has SOUL.md/MEMORY.md/HEARTBEAT.md separation. NanoClaw has single CLAUDE.md per group. Need intelligent merge/split.
- **Cron → Tasks:** OpenClaw cron jobs ↔ NanoClaw task-scheduler entries. Different formats but same concept.

### Proposed Approach

**Phase 1: Platform Adapters**
```
src/adapters/
├── openclaw.ts    # Current implementation, refactored
├── nanoclaw.ts    # NanoClaw backup/restore adapter
├── claude-code.ts # Standalone Claude Code adapter
└── types.ts       # Universal agent state schema
```

**Phase 2: Universal Agent State Schema**
Define a platform-neutral representation of agent state:
```typescript
interface UniversalAgentState {
  identity: { name, personality, values }  // SOUL.md | CLAUDE.md
  memory: { longTerm, daily[], domain[] }  // MEMORY.md | messages.db
  config: { channels, scheduling, skills } // gateway.yaml | config.ts
  credentials: { encrypted[] }             // platform-specific
  metadata: { sourcePlatform, version }
}
```

**Phase 3: Cross-Platform Migration**
```bash
# Backup from NanoClaw
saddlebag backup --platform nanoclaw --workspace ~/nanoclaw

# Restore to OpenClaw
saddlebag restore backup.saddlebag --platform openclaw --workspace ~/clawd

# Or: migrate directly
saddlebag migrate --from nanoclaw:~/nanoclaw --to openclaw:~/clawd
```

### Feasibility Assessment

**NanoClaw support: HIGH feasibility**
- Simple architecture (~700 lines), flat files + SQLite
- Similar concepts (memory, skills, scheduled tasks)
- Main challenge: memory format translation (CLAUDE.md ↔ structured MD files)

**Claude Code standalone: HIGH feasibility**
- Even simpler (local files + conversation cache)
- Well-documented `.claude/` directory structure

**General cross-platform: MEDIUM feasibility**
- The universal schema is the hard part — lossy translation between different memory models
- Channel credentials are platform-specific and may not transfer
- But core agent identity (personality, memories, knowledge) IS portable

---

## Open Questions

1. **Skill inclusion policy:** Include all custom skills by default, or require opt-in? (Leaning: include by default, `--exclude` for large ones)
2. **Incremental backups:** Worth adding in v1, or just full snapshots? (Leaning: full only for simplicity)
3. **Backup rotation:** Should Saddlebag manage old backups, or leave that to the user? (Leaning: user's problem for v1)
4. **OpenClaw integration:** Ship as a built-in OpenClaw command (`openclaw backup`) or standalone tool? (Leaning: standalone first, propose upstream later)
5. **Naming:** Is "Saddlebag" a good public-facing name or too niche? Alternatives: `agentpack`, `agentsave`, `clawback`

---

*"A good cowboy keeps their saddlebag packed. You never know when you'll need to ride."* 🐴

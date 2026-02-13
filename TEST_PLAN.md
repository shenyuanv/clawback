# Clawback — Pre-Release Test Plan

**Goal:** Validate all user-facing scenarios before making the repo public.
**Status:** ⬜ Not started

---

## Environment

| Requirement | Status |
|---|---|
| macOS (Apple Silicon) | ⬜ |
| Linux (Docker via colima, 8GB+ RAM) | ⬜ |
| Node.js 20+ | ⬜ |
| Docker / docker compose | ⬜ |
| Live OpenClaw workspace (~/clawd) | ⬜ |

---

## 1. Unit Tests (automated)

| # | Test | Command | Pass? |
|---|------|---------|-------|
| 1.1 | Full test suite (90 tests, 18 files) | `npm test` | ⬜ |
| 1.2 | Build succeeds | `npm run build` | ⬜ |

---

## 2. Backup Scenarios

### 2.1 Basic Backup
```bash
cd ~/clawd/projects/clawback
node dist/index.js backup --workspace ~/clawd
```
- [ ] Archive created with correct name (`cowboy-YYYY-MM-DD.clawback`)
- [ ] Output shows file count and size
- [ ] File is a valid gzip (check: `file <archive>` shows "gzip compressed")

### 2.2 Backup with Credentials
```bash
node dist/index.js backup --workspace ~/clawd --with-credentials
```
- [ ] Prompts for password (double entry for confirmation)
- [ ] Archive created successfully
- [ ] `info` shows "Credentials: yes (encrypted)"
- [ ] Archive is larger than basic backup (credential vault added)

### 2.3 Backup with --encrypt
```bash
node dist/index.js backup --workspace ~/clawd --encrypt --password "testpass"
```
- [ ] Archive created
- [ ] Archive is NOT gzip (check: `file <archive>` should NOT show "gzip compressed")
- [ ] `info` without password → prompts for password
- [ ] `info --password "testpass"` → shows agent info + "Credentials: yes"
- [ ] `info --password "wrongpass"` → "Invalid password" error

### 2.4 Backup with --password (non-interactive)
```bash
node dist/index.js backup --workspace ~/clawd --with-credentials --password "mypass"
```
- [ ] No interactive prompt — runs to completion silently

### 2.5 Backup with --output
```bash
node dist/index.js backup --workspace ~/clawd --output /tmp/test-backup.clawback
```
- [ ] Archive at specified path
- [ ] No file at default location

### 2.6 Backup auto-detection (no --workspace)
```bash
cd ~/clawd && node ~/clawd/projects/clawback/dist/index.js backup
```
- [ ] Auto-detects workspace from cwd
- [ ] Creates archive successfully

---

## 3. Info / Verify / Diff

### 3.1 Info
```bash
node dist/index.js info <archive>
```
- [ ] Shows agent name ("Cowboy")
- [ ] Shows creation date with relative time ("X minutes ago")
- [ ] Shows file counts (agent, config, skills, scripts)
- [ ] Shows source machine info (OS, arch, hostname)
- [ ] Shows credential status

### 3.2 Verify
```bash
node dist/index.js verify <archive>
```
- [ ] All files show ✓
- [ ] "Archive is valid" at end
- [ ] Exit code 0

### 3.3 Verify tampered archive
```bash
# Copy archive, modify a byte, verify
cp <archive> /tmp/tampered.clawback
# Edit with hex editor or: python3 -c "import sys; d=open(sys.argv[1],'rb').read(); open(sys.argv[1],'wb').write(d[:-10]+b'x'+d[-9:])" /tmp/tampered.clawback
node dist/index.js verify /tmp/tampered.clawback
```
- [ ] Shows ✗ for corrupted file(s)
- [ ] "Archive is CORRUPTED"
- [ ] Exit code 1

### 3.4 Diff vs live workspace
```bash
node dist/index.js diff <archive> --workspace ~/clawd
```
- [ ] Shows unchanged, modified, added, deleted files
- [ ] Modified files show content differences

### 3.5 Diff two archives
```bash
node dist/index.js diff <archive1> <archive2>
```
- [ ] Shows differences between two backups

### 3.6 Encrypted archive — info/verify/diff
```bash
node dist/index.js info <encrypted-archive> --password "testpass"
node dist/index.js verify <encrypted-archive> --password "testpass"
node dist/index.js diff <encrypted-archive> --workspace ~/clawd --password "testpass"
```
- [ ] All three commands work with correct password
- [ ] All three fail gracefully with wrong password

---

## 4. Restore Scenarios

### 4.1 Basic Restore (dry run)
```bash
node dist/index.js restore <archive> --workspace /tmp/test-restore --dry-run
```
- [ ] Lists all files that would be restored
- [ ] Shows path remapping
- [ ] No files written to disk

### 4.2 Basic Restore
```bash
node dist/index.js restore <archive> --workspace /tmp/test-restore --force
```
- [ ] All files extracted
- [ ] Path remapping applied (check TOOLS.md for remapped paths)
- [ ] `restore-fixup.sh` generated
- [ ] `.clawback-restored` marker created
- [ ] Gateway config has API keys REDACTED

### 4.3 Restore with Credentials
```bash
node dist/index.js restore <cred-archive> --workspace /tmp/test-restore-creds --force
```
- [ ] Prompts for credential password
- [ ] Credentials restored to correct paths
- [ ] Gateway config has real API keys (not REDACTED)

### 4.4 Restore with --run
```bash
node dist/index.js restore <archive> --workspace /tmp/test-restore-run --force --run
```
- [ ] Files restored
- [ ] Prompts for API key (if no credentials)
- [ ] Attempts to start OpenClaw gateway
- [ ] Prints "✅ Agent '<name>' is running" (or error if OpenClaw not installed)

### 4.5 Restore encrypted archive
```bash
node dist/index.js restore <encrypted-archive> --workspace /tmp/test-enc-restore --force --password "testpass"
```
- [ ] Decrypts and restores successfully
- [ ] Wrong password → clear error message

### 4.6 Restore to existing workspace
```bash
# Restore twice to same location
node dist/index.js restore <archive> --workspace /tmp/test-overwrite --force
node dist/index.js restore <archive> --workspace /tmp/test-overwrite --force
```
- [ ] Second restore succeeds (overwrites cleanly)

### 4.7 Restore --skip-credentials
```bash
node dist/index.js restore <cred-archive> --workspace /tmp/test-skip-creds --force --skip-credentials
```
- [ ] Restores files but NOT credentials
- [ ] No password prompt

---

## 5. Containerize Scenarios

### 5.1 Generate deploy files
```bash
node dist/index.js containerize <archive>
```
- [ ] Creates `deploy/` directory
- [ ] Contains: Dockerfile, entrypoint.sh, docker-compose.yml, README.md, \<archive\>
- [ ] Dockerfile has `FROM node:22-slim`
- [ ] docker-compose.yml has config + data volumes
- [ ] entrypoint.sh is executable concept (has `#!/bin/sh`)
- [ ] No .env or .env.example generated

### 5.2 Custom output directory
```bash
node dist/index.js containerize <archive> --output /tmp/my-deploy
```
- [ ] Files in `/tmp/my-deploy/` (not `deploy/`)

### 5.3 Docker build (requires Docker)
```bash
node dist/index.js containerize <archive> --output /tmp/docker-test
cd /tmp/docker-test
docker compose build
```
- [ ] Image builds successfully
- [ ] No npm install errors (needs 8GB+ RAM in colima)

### 5.4 Docker run (interactive — full E2E)
```bash
cd /tmp/docker-test
docker compose run -it agent
```
- [ ] Container starts
- [ ] OpenClaw setup wizard appears (if first run)
- [ ] Agent files present in /workspace inside container
- [ ] Memory files intact

### 5.5 Containerize --run (requires Docker)
```bash
node dist/index.js containerize <archive> --output /tmp/docker-run-test --run
```
- [ ] Builds image automatically
- [ ] Runs container interactively
- [ ] Prints success message after exit

---

## 6. CLI UX

### 6.1 --version
```bash
node dist/index.js --version
```
- [ ] Prints version number (matches package.json)

### 6.2 --help
```bash
node dist/index.js --help
node dist/index.js backup --help
node dist/index.js restore --help
node dist/index.js containerize --help
```
- [ ] All show usage information
- [ ] All flags documented

### 6.3 Error handling
```bash
node dist/index.js restore nonexistent.clawback --workspace /tmp/x --force
node dist/index.js info nonexistent.clawback
node dist/index.js verify nonexistent.clawback
node dist/index.js backup --workspace /nonexistent/path
```
- [ ] All show clear error messages (not stack traces)
- [ ] All exit with code 1

### 6.4 No arguments
```bash
node dist/index.js
```
- [ ] Shows help text

---

## 7. Cross-Platform (Docker = Linux)

### 7.1 Docker recovery integration test
```bash
cd ~/clawd/projects/clawback/tests/docker
bash run-recovery-test.sh
```
- [ ] All 5 phases pass:
  1. Build macOS backup
  2. Transfer to Linux container
  3. Restore inside container
  4. Verify file integrity
  5. Verify path remapping

---

## 8. Edge Cases

### 8.1 Large workspace
- [ ] Backup of workspace with 500+ files completes in <30s
- [ ] Archive size reasonable (<5MB for typical workspace)

### 8.2 Unicode filenames
- [ ] Files with Chinese/emoji names backed up and restored correctly (e.g., 本我.md)

### 8.3 Empty memory directory
- [ ] Backup succeeds when memory/ exists but is empty

### 8.4 Missing optional files
- [ ] Backup succeeds without IDENTITY.md, USER.md, HEARTBEAT.md, etc.
- [ ] Only SOUL.md is required

---

## Test Execution Log

| Date | Tester | Sections | Result | Notes |
|------|--------|----------|--------|-------|
| | | | | |

---

## Sign-off

- [ ] All unit tests pass (90/90)
- [ ] All manual scenarios pass
- [ ] Docker integration test passes
- [ ] README is accurate and up to date
- [ ] No sensitive data in repo (grep for API keys, passwords, tokens)
- [ ] License file present (MIT)
- [ ] .gitignore excludes dev files (AGENTS.md, CLAUDE.md, DEV_STATE.md)

**Ready to go public:** ⬜ YES / ⬜ NO

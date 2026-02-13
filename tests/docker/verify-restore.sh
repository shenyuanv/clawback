#!/bin/bash
# verify-restore.sh — Runs inside the Docker container to validate a saddlebag restore.
#
# Expects:
#   /tmp/test-backup.saddlebag       — the backup archive
#   /tmp/.source-workspace-path      — file with source macOS paths (line 1: workspace, line 2: home)
#   saddlebag                        — installed globally in PATH
#   openclaw                         — installed globally in PATH
#
# Exit 0 = all checks pass, exit 1 = failure

set -euo pipefail

RESTORE_DIR="/agent"
ARCHIVE="/tmp/test-backup.saddlebag"
FAILURES=0

# Read the source paths that must NOT appear after restore
SOURCE_WORKSPACE=$(sed -n '1p' /tmp/.source-workspace-path)
SOURCE_HOME=$(sed -n '2p' /tmp/.source-workspace-path)

pass() { echo "  ✓ $1"; }
fail() { echo "  ✗ $1"; FAILURES=$((FAILURES + 1)); }

echo "=== Saddlebag Docker Recovery Test ==="
echo "Source workspace: $SOURCE_WORKSPACE"
echo "Source home:      $SOURCE_HOME"
echo "Restore target:   $RESTORE_DIR"
echo ""

# ---------- Phase 1: Verify archive integrity ----------
echo "[1/5] Verifying archive integrity..."
if saddlebag verify "$ARCHIVE"; then
  pass "Archive integrity valid"
else
  fail "Archive integrity check failed"
fi
echo ""

# ---------- Phase 2: Restore to /agent ----------
echo "[2/5] Restoring backup to $RESTORE_DIR..."
saddlebag restore "$ARCHIVE" --workspace "$RESTORE_DIR" --force
pass "Restore completed"
echo ""

# ---------- Phase 3: Check expected files ----------
echo "[3/5] Checking restored files..."

EXPECTED_FILES=(
  "SOUL.md"
  "MEMORY.md"
  "IDENTITY.md"
  "AGENTS.md"
  "TOOLS.md"
  "memory/daily-log.md"
  "config/gateway.yaml"
  "scripts/hello.sh"
  "skills/test-skill/SKILL.md"
)

for f in "${EXPECTED_FILES[@]}"; do
  if [ -f "$RESTORE_DIR/$f" ]; then
    pass "Found $f"
  else
    fail "Missing $f"
  fi
done

# Check non-empty
for f in SOUL.md MEMORY.md IDENTITY.md; do
  if [ -s "$RESTORE_DIR/$f" ]; then
    pass "$f is non-empty"
  else
    fail "$f is empty"
  fi
done
echo ""

# ---------- Phase 4: Path remapping verification ----------
echo "[4/5] Verifying path remapping (no source macOS paths leaked)..."

REMAP_FILES=("TOOLS.md" "config/gateway.yaml" "AGENTS.md")

for f in "${REMAP_FILES[@]}"; do
  filepath="$RESTORE_DIR/$f"
  if [ ! -f "$filepath" ]; then
    continue
  fi
  # Check for the actual source workspace path
  if grep -qF "$SOURCE_WORKSPACE" "$filepath" 2>/dev/null; then
    fail "$f still contains source workspace path (path remapping failed)"
    echo "    Looking for: $SOURCE_WORKSPACE"
    echo "    Content:"
    sed 's/^/    | /' "$filepath"
  else
    pass "$f has no leaked workspace path"
  fi
  # Check for the source home directory
  if grep -qF "$SOURCE_HOME" "$filepath" 2>/dev/null; then
    fail "$f still contains source home path (path remapping failed)"
    echo "    Looking for: $SOURCE_HOME"
  else
    pass "$f has no leaked home path"
  fi
done

# Broader check: scan ALL restored files for source path references
LEAKED_FILES=$(grep -rlF "$SOURCE_WORKSPACE" "$RESTORE_DIR/" 2>/dev/null || true)
if [ -n "$LEAKED_FILES" ]; then
  fail "Found source workspace path in: $LEAKED_FILES"
else
  pass "No source workspace path references found anywhere"
fi

LEAKED_HOME=$(grep -rlF "$SOURCE_HOME" "$RESTORE_DIR/" 2>/dev/null || true)
if [ -n "$LEAKED_HOME" ]; then
  fail "Found source home path in: $LEAKED_HOME"
else
  pass "No source home path references found anywhere"
fi

# Verify that remapped files now contain the new Linux paths
if grep -qF "$RESTORE_DIR" "$RESTORE_DIR/config/gateway.yaml" 2>/dev/null; then
  pass "gateway.yaml contains new workspace path ($RESTORE_DIR)"
else
  fail "gateway.yaml missing new workspace path"
fi

# Verify TOOLS.md was remapped to new home
LINUX_HOME="$HOME"
if grep -qF "$LINUX_HOME" "$RESTORE_DIR/TOOLS.md" 2>/dev/null; then
  pass "TOOLS.md contains new home path ($LINUX_HOME)"
else
  fail "TOOLS.md missing new home path"
fi
echo ""

# ---------- Phase 5: Gateway boot test ----------
echo "[5/5] Gateway boot test (openclaw)..."

# 5a. Verify openclaw is installed
if command -v openclaw >/dev/null 2>&1; then
  OPENCLAW_VERSION=$(openclaw --version 2>/dev/null || echo "unknown")
  pass "openclaw installed ($OPENCLAW_VERSION)"
else
  fail "openclaw not found in PATH"
  echo ""
  # Skip to summary — can't test gateway without openclaw
  echo "=== Results ==="
  if [ "$FAILURES" -eq 0 ]; then
    echo "ALL CHECKS PASSED"
    exit 0
  else
    echo "FAILED: $FAILURES check(s) failed"
    exit 1
  fi
fi

# 5b. Start gateway in background with restored workspace
GATEWAY_LOG="/tmp/gateway-boot-test.log"
(
  cd "$RESTORE_DIR"
  openclaw gateway start
) >"$GATEWAY_LOG" 2>&1 &
GATEWAY_PID=$!

# 5c. Wait up to 10s for startup, require survival for 5s
BOOT_TIMEOUT=10
SURVIVED_5S=false
CRASHED=false
CRASH_AFTER=0
for i in $(seq 1 $BOOT_TIMEOUT); do
  if ! kill -0 "$GATEWAY_PID" 2>/dev/null; then
    CRASHED=true
    CRASH_AFTER=$i
    break
  fi
  if [ "$i" -ge 5 ]; then
    SURVIVED_5S=true
    break
  fi
  sleep 1
done

if $CRASHED; then
  GATEWAY_EXIT=$(wait "$GATEWAY_PID" 2>/dev/null; echo $?)
  fail "Gateway process crashed after ${CRASH_AFTER}s (exit code: $GATEWAY_EXIT)"
  echo "    Gateway log:"
  tail -20 "$GATEWAY_LOG" 2>/dev/null | sed 's/^/    | /'
else
  pass "Gateway process alive after 5s (no immediate crash)"
fi

# 5d. Check config parse errors in stderr log
if grep -qiE "config parse error|missing required" "$GATEWAY_LOG" 2>/dev/null; then
  fail "Gateway log shows config errors"
  echo "    Gateway log:"
  tail -20 "$GATEWAY_LOG" 2>/dev/null | sed 's/^/    | /'
else
  pass "Gateway log has no config parse errors"
fi

# 5e. Clean shutdown
CLEAN_SHUTDOWN=true
if kill -0 "$GATEWAY_PID" 2>/dev/null; then
  kill "$GATEWAY_PID" 2>/dev/null || true
  for i in $(seq 1 5); do
    if ! kill -0 "$GATEWAY_PID" 2>/dev/null; then
      break
    fi
    sleep 1
  done
  if kill -0 "$GATEWAY_PID" 2>/dev/null; then
    CLEAN_SHUTDOWN=false
    kill -9 "$GATEWAY_PID" 2>/dev/null || true
  fi
fi

if $CLEAN_SHUTDOWN; then
  pass "Gateway shut down cleanly"
else
  fail "Gateway did not shut down cleanly"
fi

rm -f "$GATEWAY_LOG" 2>/dev/null || true
echo ""

# ---------- Summary ----------
echo "=== Results ==="
if [ "$FAILURES" -eq 0 ]; then
  echo "ALL CHECKS PASSED"
  exit 0
else
  echo "FAILED: $FAILURES check(s) failed"
  exit 1
fi

#!/bin/bash
# run-recovery-test.sh — P0.6 Docker Recovery Integration Test
#
# Proves that a clawback backup created on macOS can be restored
# on a fresh Linux container with correct path remapping.
#
# Usage: cd tests/docker && bash run-recovery-test.sh
#
# Requirements: Docker (colima or Docker Desktop)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
DOCKER_DIR="$SCRIPT_DIR"
IMAGE_NAME="clawback-recovery-test"

# Cleanup function
cleanup() {
  echo "[cleanup] Removing temporary artifacts..."
  rm -f "$DOCKER_DIR"/clawback-*.tgz
  rm -f "$DOCKER_DIR/test-backup.clawback"
  rm -f "$DOCKER_DIR/.source-workspace-path"
  rm -rf "$SYNTHETIC_WORKSPACE" 2>/dev/null || true
  echo "[cleanup] Done."
}
trap cleanup EXIT

echo "=== P0.6: Clawback Docker Recovery Integration Test ==="
echo ""

# ---------- Step 1: Build clawback ----------
echo "[1/5] Building clawback..."
cd "$PROJECT_ROOT"
npm run build
echo "      Build complete."
echo ""

# ---------- Step 2: Create npm tarball ----------
echo "[2/5] Packing npm tarball..."
npm pack --pack-destination "$DOCKER_DIR" >/dev/null 2>&1
TARBALL=$(ls "$DOCKER_DIR"/clawback-*.tgz 2>/dev/null | head -1)
if [ -z "$TARBALL" ]; then
  echo "FAIL: npm pack did not produce a tarball"
  exit 1
fi
echo "      Created: $(basename "$TARBALL")"
echo ""

# ---------- Step 3: Create synthetic workspace & backup ----------
echo "[3/5] Creating synthetic workspace and backup..."

# Create a temp workspace that mimics a real agent workspace.
# The env-map captures ${WORKSPACE} -> SYNTHETIC_WORKSPACE and ${HOME} -> $HOME.
# Files that reference these paths will get remapped on restore.
# Use /tmp explicitly (not $TMPDIR which may have trailing slash causing // in paths)
SYNTHETIC_WORKSPACE=$(mktemp -d /tmp/clawback-synthetic-XXXXXX)
SOURCE_HOME="$HOME"

mkdir -p "$SYNTHETIC_WORKSPACE/memory"
mkdir -p "$SYNTHETIC_WORKSPACE/config"
mkdir -p "$SYNTHETIC_WORKSPACE/scripts"
mkdir -p "$SYNTHETIC_WORKSPACE/skills/test-skill"

cat > "$SYNTHETIC_WORKSPACE/SOUL.md" << 'SOULEOF'
# Soul

I am a test agent created for clawback Docker recovery testing.
My purpose is to verify cross-platform portability.
SOULEOF

cat > "$SYNTHETIC_WORKSPACE/IDENTITY.md" << 'IDEOF'
# IDENTITY.md - Who Am I?

- **Name:** DockerTestBot
- **Creature:** Synthetic test agent for P0.6 integration testing
IDEOF

cat > "$SYNTHETIC_WORKSPACE/MEMORY.md" << 'MEMEOF'
# Memory

## Session Log
- Created for Docker recovery integration test
- Testing cross-platform backup/restore
MEMEOF

# Embed REAL paths that the env-map will capture and remap
cat > "$SYNTHETIC_WORKSPACE/AGENTS.md" << EOF
# Agent Operating Procedures

Standard operating procedures for the test agent.
Workspace path: $SYNTHETIC_WORKSPACE
Home directory: $SOURCE_HOME
EOF

cat > "$SYNTHETIC_WORKSPACE/TOOLS.md" << EOF
# Tools

## Registered Tools

- script: $SYNTHETIC_WORKSPACE/scripts/hello.sh
- python: $SOURCE_HOME/.local/bin/python3
EOF

cat > "$SYNTHETIC_WORKSPACE/config/gateway.yaml" << EOF
name: docker-test-gateway
host: localhost
port: 8080
workspace: $SYNTHETIC_WORKSPACE
EOF

cat > "$SYNTHETIC_WORKSPACE/memory/daily-log.md" << 'LOGEOF'
# Daily Log

## 2026-02-13

- Docker recovery test created
- Testing backup/restore pipeline
LOGEOF

cat > "$SYNTHETIC_WORKSPACE/scripts/hello.sh" << 'SHEOF'
#!/bin/bash
echo "Hello from test script"
SHEOF
chmod +x "$SYNTHETIC_WORKSPACE/scripts/hello.sh"

cat > "$SYNTHETIC_WORKSPACE/skills/test-skill/SKILL.md" << 'SKILLEOF'
# Test Skill

A synthetic skill for Docker recovery testing.

## Usage
This skill verifies that skills are preserved across backup/restore.
SKILLEOF

echo "      Synthetic workspace created at: $SYNTHETIC_WORKSPACE"
echo "      Source HOME: $SOURCE_HOME"

# Write the source paths to a file so verify-restore.sh can check for them
# These are the macOS paths that must NOT appear after restore on Linux
echo "$SYNTHETIC_WORKSPACE" > "$DOCKER_DIR/.source-workspace-path"
echo "$SOURCE_HOME" >> "$DOCKER_DIR/.source-workspace-path"

# Create backup using clawback CLI
cd "$PROJECT_ROOT"
npx tsx src/index.ts backup \
  --workspace "$SYNTHETIC_WORKSPACE" \
  --output "$DOCKER_DIR/test-backup.clawback"

if [ ! -f "$DOCKER_DIR/test-backup.clawback" ]; then
  echo "FAIL: Backup was not created"
  exit 1
fi
echo "      Backup created: test-backup.clawback ($(du -h "$DOCKER_DIR/test-backup.clawback" | cut -f1))"
echo ""

# ---------- Step 4: Build Docker image ----------
echo "[4/5] Building Docker image..."
docker build -t "$IMAGE_NAME" "$DOCKER_DIR"
echo "      Image built: $IMAGE_NAME"
echo ""

# ---------- Step 5: Run container ----------
echo "[5/5] Running recovery test in Docker container..."
echo ""

if docker run --rm "$IMAGE_NAME"; then
  echo ""
  echo "========================================="
  echo "  PASS — Docker recovery test succeeded"
  echo "========================================="
  EXIT_CODE=0
else
  echo ""
  echo "========================================="
  echo "  FAIL — Docker recovery test failed"
  echo "========================================="
  EXIT_CODE=1
fi

exit $EXIT_CODE

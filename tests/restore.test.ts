import { describe, it, expect, afterEach } from 'vitest';
import { restoreBackup } from '../src/restore.js';
import { createBackup } from '../src/backup.js';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
  mkdirSync,
} from 'node:fs';
import { resolve, join, basename } from 'node:path';
import { tmpdir } from 'node:os';

const FIXTURES = resolve(import.meta.dirname, 'fixtures');
const MOCK_WORKSPACE = resolve(FIXTURES, 'mock-workspace');

// Track temp resources for cleanup
const tempFiles: string[] = [];
const tempDirs: string[] = [];

afterEach(() => {
  for (const f of tempFiles) {
    try {
      if (existsSync(f)) unlinkSync(f);
    } catch {
      /* ignore */
    }
  }
  tempFiles.length = 0;
  for (const d of tempDirs) {
    try {
      if (existsSync(d)) rmSync(d, { recursive: true });
    } catch {
      /* ignore */
    }
  }
  tempDirs.length = 0;
});

/** Helper: create a backup of mock workspace and return archive path */
async function createTestArchive(): Promise<string> {
  const archivePath = join(
    tmpdir(),
    `saddlebag-test-restore-${Date.now()}-${Math.random().toString(36).slice(2)}.saddlebag`,
  );
  tempFiles.push(archivePath);

  await createBackup({
    workspace: MOCK_WORKSPACE,
    output: archivePath,
  });

  return archivePath;
}

/**
 * Helper: create a workspace with paths matching its own directory,
 * so env-map will correctly capture and remap them.
 */
function createRemappableWorkspace(): string {
  const dir = mkdtempSync(join(tmpdir(), 'saddlebag-test-remap-src-'));
  tempDirs.push(dir);
  const home = process.env.HOME ?? '/tmp';

  writeFileSync(join(dir, 'SOUL.md'), '# Remap Test Agent\n');
  writeFileSync(join(dir, 'IDENTITY.md'), 'Name: RemapBot\n');
  writeFileSync(join(dir, 'AGENTS.md'), '# Agent Procedures\n');
  writeFileSync(join(dir, 'MEMORY.md'), '# Memory\n');
  writeFileSync(
    join(dir, 'TOOLS.md'),
    `# Tools\n\n## Registered Tools\n\n- script: ${dir}/scripts/hello.sh\n- python: ${home}/.local/bin/python3\n`,
  );
  mkdirSync(join(dir, 'config'), { recursive: true });
  writeFileSync(
    join(dir, 'config', 'gateway.yaml'),
    `name: test-gateway\nhost: localhost\nport: 8080\nworkspace: ${dir}\n`,
  );
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  writeFileSync(join(dir, 'scripts', 'hello.sh'), '#!/bin/bash\necho hello\n');

  return dir;
}

/** Helper: create a backup of a custom workspace */
async function createRemappableArchive(workspace: string): Promise<string> {
  const archivePath = join(
    tmpdir(),
    `saddlebag-test-remap-${Date.now()}-${Math.random().toString(36).slice(2)}.saddlebag`,
  );
  tempFiles.push(archivePath);

  await createBackup({ workspace, output: archivePath });
  return archivePath;
}

/** Helper: create a temp target directory */
function createTargetDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'saddlebag-test-restore-target-'));
  tempDirs.push(dir);
  return dir;
}

describe('restore', () => {
  it('extracts all files to target directory', async () => {
    const archivePath = await createTestArchive();
    const targetDir = createTargetDir();

    const result = await restoreBackup(archivePath, {
      workspace: targetDir,
    });

    expect(result.restoredFiles.length).toBeGreaterThan(0);

    // Check key files exist in target
    expect(existsSync(join(targetDir, 'SOUL.md'))).toBe(true);
    expect(existsSync(join(targetDir, 'MEMORY.md'))).toBe(true);
    expect(existsSync(join(targetDir, 'AGENTS.md'))).toBe(true);
    expect(existsSync(join(targetDir, 'IDENTITY.md'))).toBe(true);
    expect(existsSync(join(targetDir, '本我.md'))).toBe(true);
    expect(existsSync(join(targetDir, 'memory', '2026-02-10.md'))).toBe(true);
    expect(existsSync(join(targetDir, 'memory', '2026-02-11.md'))).toBe(true);
    expect(existsSync(join(targetDir, 'config', 'gateway.yaml'))).toBe(true);
    expect(existsSync(join(targetDir, 'skills', 'custom-skill', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(targetDir, 'scripts', 'hello.sh'))).toBe(true);
  });

  it('file contents match original checksums after extract', async () => {
    const archivePath = await createTestArchive();
    const targetDir = createTargetDir();

    await restoreBackup(archivePath, { workspace: targetDir });

    // Check non-remappable files — these should be byte-identical
    const filesToCheck = [
      'SOUL.md',
      'MEMORY.md',
      'IDENTITY.md',
      '本我.md',
      'memory/2026-02-10.md',
      'skills/custom-skill/SKILL.md',
      'scripts/hello.sh',
    ];

    for (const relPath of filesToCheck) {
      const originalContent = readFileSync(join(MOCK_WORKSPACE, relPath));
      const restoredContent = readFileSync(join(targetDir, relPath));
      const originalHash = createHash('sha256').update(originalContent).digest('hex');
      const restoredHash = createHash('sha256').update(restoredContent).digest('hex');
      expect(restoredHash).toBe(originalHash);
    }
  });

  it('path remapping applied to TOOLS.md content', async () => {
    // Create a workspace where TOOLS.md contains the actual workspace path
    const srcWorkspace = createRemappableWorkspace();
    const archivePath = await createRemappableArchive(srcWorkspace);
    const targetDir = createTargetDir();

    const result = await restoreBackup(archivePath, { workspace: targetDir });

    const toolsContent = readFileSync(join(targetDir, 'TOOLS.md'), 'utf-8');

    // Original workspace path should be replaced
    expect(toolsContent).not.toContain(srcWorkspace);

    // New workspace path should appear
    expect(toolsContent).toContain(targetDir);

    // The TOOLS.md entry should be marked as remapped
    const toolsFile = result.restoredFiles.find((f) => f.path === 'TOOLS.md');
    expect(toolsFile).toBeDefined();
    expect(toolsFile!.remapped).toBe(true);
  });

  it('path remapping applied to gateway config', async () => {
    const srcWorkspace = createRemappableWorkspace();
    const archivePath = await createRemappableArchive(srcWorkspace);
    const targetDir = createTargetDir();

    await restoreBackup(archivePath, { workspace: targetDir });

    const gatewayContent = readFileSync(
      join(targetDir, 'config', 'gateway.yaml'),
      'utf-8',
    );

    // Original workspace path should be replaced
    expect(gatewayContent).not.toContain(srcWorkspace);

    // New workspace path should appear
    expect(gatewayContent).toContain(targetDir);
  });

  it('--dry-run lists changes but writes nothing', async () => {
    const archivePath = await createTestArchive();
    const targetDir = join(
      tmpdir(),
      `saddlebag-test-dryrun-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    tempDirs.push(targetDir);

    const result = await restoreBackup(archivePath, {
      workspace: targetDir,
      dryRun: true,
    });

    // Should report files that would be restored
    expect(result.restoredFiles.length).toBeGreaterThan(0);
    expect(result.dryRun).toBe(true);

    // Target directory should NOT exist (nothing written)
    expect(existsSync(targetDir)).toBe(false);
  });

  it('refuses to restore without --workspace flag', async () => {
    const archivePath = await createTestArchive();

    await expect(
      restoreBackup(archivePath, {}),
    ).rejects.toThrow('--workspace flag is required');
  });

  it('creates target directory if it does not exist', async () => {
    const archivePath = await createTestArchive();

    const uniqueTarget = join(
      tmpdir(),
      `saddlebag-test-mkdir-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      'nested',
    );
    const uniqueParent = uniqueTarget.substring(0, uniqueTarget.lastIndexOf('/'));
    tempDirs.push(uniqueParent);

    expect(existsSync(uniqueTarget)).toBe(false);

    const result = await restoreBackup(archivePath, {
      workspace: uniqueTarget,
    });

    expect(existsSync(uniqueTarget)).toBe(true);
    expect(result.restoredFiles.length).toBeGreaterThan(0);
    expect(existsSync(join(uniqueTarget, 'SOUL.md'))).toBe(true);
  });

  it('warns about missing dependencies', async () => {
    // Create workspace with TOOLS.md pointing to known-missing paths
    const srcWorkspace = createRemappableWorkspace();
    const archivePath = await createRemappableArchive(srcWorkspace);
    const targetDir = createTargetDir();

    const result = await restoreBackup(archivePath, { workspace: targetDir });

    // After remapping, python path will be $HOME/.local/bin/python3 which likely doesn't exist
    // The script path will also point to the new targetDir which we just created
    expect(result.missingDeps.length).toBeGreaterThan(0);
    expect(result.missingDeps).toContain('python');
  });

  it('writes restore marker and fixup script', async () => {
    const archivePath = await createTestArchive();
    const targetDir = createTargetDir();

    const result = await restoreBackup(archivePath, { workspace: targetDir });

    const markerPath = join(targetDir, '.saddlebag-restored');
    expect(existsSync(markerPath)).toBe(true);

    const marker = JSON.parse(readFileSync(markerPath, 'utf-8'));
    expect(marker.archivePath).toBe(basename(archivePath));
    expect(marker.fileCount).toBe(result.restoredFiles.length);
    expect(marker.restoredAt).toBeTruthy();
    expect(marker.protectedFiles).toEqual([
      'SOUL.md',
      'IDENTITY.md',
      'MEMORY.md',
      'AGENTS.md',
      'USER.md',
      'HEARTBEAT.md',
      'TOOLS.md',
    ]);

    const scriptPath = join(targetDir, 'restore-fixup.sh');
    expect(existsSync(scriptPath)).toBe(true);
    const script = readFileSync(scriptPath, 'utf-8');
    expect(script).toContain('.saddlebag-originals');
    expect(script).toContain('agent/${file}');
  });
});

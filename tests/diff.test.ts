import { describe, it, expect, afterEach } from 'vitest';
import { diffArchiveVsWorkspace, diffArchiveVsArchive } from '../src/diff.js';
import { createBackup } from '../src/backup.js';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  unlinkSync,
} from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';

const FIXTURES = resolve(import.meta.dirname, 'fixtures');
const MOCK_WORKSPACE = resolve(FIXTURES, 'mock-workspace');

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

/** Helper: create a temp workspace with given files */
function createWorkspace(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'clawback-diff-'));
  tempDirs.push(dir);

  for (const [relPath, content] of Object.entries(files)) {
    const fullPath = join(dir, relPath);
    const parentDir = fullPath.substring(0, fullPath.lastIndexOf('/'));
    mkdirSync(parentDir, { recursive: true });
    writeFileSync(fullPath, content);
  }

  return dir;
}

/** Helper: backup a workspace and return archive path */
async function backupWorkspace(workspace: string): Promise<string> {
  const archivePath = join(
    tmpdir(),
    `clawback-diff-${Date.now()}-${Math.random().toString(36).slice(2)}.clawback`,
  );
  tempFiles.push(archivePath);
  await createBackup({ workspace, output: archivePath });
  return archivePath;
}

describe('diff', () => {
  it('detects added file (in live but not backup)', async () => {
    // Create workspace, backup it, then add a new file
    const workspace = createWorkspace({
      'SOUL.md': '# Agent\n',
      'MEMORY.md': '# Memory\n',
    });

    const archivePath = await backupWorkspace(workspace);

    // Add a new file to live workspace
    writeFileSync(join(workspace, 'NEW_FILE.md'), '# New\n');

    const result = await diffArchiveVsWorkspace(archivePath, workspace);

    const addedEntry = result.entries.find((e) => e.path === 'NEW_FILE.md');
    expect(addedEntry).toBeDefined();
    expect(addedEntry!.status).toBe('added');
  });

  it('detects modified file (different content)', async () => {
    const workspace = createWorkspace({
      'SOUL.md': '# Agent\n',
      'MEMORY.md': '# Memory\nLine 1\nLine 2\n',
    });

    const archivePath = await backupWorkspace(workspace);

    // Modify MEMORY.md in live workspace
    writeFileSync(
      join(workspace, 'MEMORY.md'),
      '# Memory\nLine 1\nLine 2\nLine 3\nLine 4\nLine 5\n',
    );

    const result = await diffArchiveVsWorkspace(archivePath, workspace);

    const modifiedEntry = result.entries.find((e) => e.path === 'MEMORY.md');
    expect(modifiedEntry).toBeDefined();
    expect(modifiedEntry!.status).toBe('modified');
    expect(modifiedEntry!.linesAdded).toBeGreaterThan(0);
  });

  it('detects deleted file (in backup but not live)', async () => {
    const workspace = createWorkspace({
      'SOUL.md': '# Agent\n',
      'MEMORY.md': '# Memory\n',
      'memory/temp-note.md': '# Temp\n',
    });

    const archivePath = await backupWorkspace(workspace);

    // Delete the temp note from live workspace
    rmSync(join(workspace, 'memory', 'temp-note.md'));

    const result = await diffArchiveVsWorkspace(archivePath, workspace);

    const deletedEntry = result.entries.find(
      (e) => e.path === 'memory/temp-note.md',
    );
    expect(deletedEntry).toBeDefined();
    expect(deletedEntry!.status).toBe('deleted');
  });

  it('detects unchanged files', async () => {
    const workspace = createWorkspace({
      'SOUL.md': '# Agent\n',
      'MEMORY.md': '# Memory\n',
    });

    const archivePath = await backupWorkspace(workspace);

    // Don't change anything
    const result = await diffArchiveVsWorkspace(archivePath, workspace);

    const soulEntry = result.entries.find((e) => e.path === 'SOUL.md');
    expect(soulEntry).toBeDefined();
    expect(soulEntry!.status).toBe('unchanged');

    const memoryEntry = result.entries.find((e) => e.path === 'MEMORY.md');
    expect(memoryEntry).toBeDefined();
    expect(memoryEntry!.status).toBe('unchanged');

    // All entries should be unchanged
    expect(result.entries.every((e) => e.status === 'unchanged')).toBe(true);
  });

  it('two identical archives show no differences', async () => {
    const workspace = createWorkspace({
      'SOUL.md': '# Agent\n',
      'MEMORY.md': '# Memory\n',
      'memory/2026-02-10.md': '# Log\n',
    });

    const archiveA = await backupWorkspace(workspace);
    const archiveB = await backupWorkspace(workspace);

    const result = await diffArchiveVsArchive(archiveA, archiveB);

    // All files should be unchanged
    expect(result.entries.length).toBeGreaterThan(0);
    expect(result.entries.every((e) => e.status === 'unchanged')).toBe(true);
  });

  it('diff between two archives works', async () => {
    // Create first workspace and backup
    const workspace = createWorkspace({
      'SOUL.md': '# Agent\n',
      'MEMORY.md': '# Memory\nOld content\n',
      'memory/2026-02-10.md': '# Day 1\n',
    });

    const archiveA = await backupWorkspace(workspace);

    // Modify the workspace: change a file, add a file, remove a file
    writeFileSync(
      join(workspace, 'MEMORY.md'),
      '# Memory\nNew content\nExtra line\n',
    );
    writeFileSync(join(workspace, 'memory', '2026-02-11.md'), '# Day 2\n');
    rmSync(join(workspace, 'memory', '2026-02-10.md'));

    const archiveB = await backupWorkspace(workspace);

    const result = await diffArchiveVsArchive(archiveA, archiveB);

    // MEMORY.md should be modified
    const modifiedEntry = result.entries.find((e) => e.path === 'MEMORY.md');
    expect(modifiedEntry).toBeDefined();
    expect(modifiedEntry!.status).toBe('modified');

    // memory/2026-02-11.md should be added (in B but not A)
    const addedEntry = result.entries.find(
      (e) => e.path === 'memory/2026-02-11.md',
    );
    expect(addedEntry).toBeDefined();
    expect(addedEntry!.status).toBe('added');

    // memory/2026-02-10.md should be deleted (in A but not B)
    const deletedEntry = result.entries.find(
      (e) => e.path === 'memory/2026-02-10.md',
    );
    expect(deletedEntry).toBeDefined();
    expect(deletedEntry!.status).toBe('deleted');

    // SOUL.md should be unchanged
    const unchangedEntry = result.entries.find((e) => e.path === 'SOUL.md');
    expect(unchangedEntry).toBeDefined();
    expect(unchangedEntry!.status).toBe('unchanged');
  });
});

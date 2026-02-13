import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createBackup } from '../src/backup.js';
import { verifyArchive } from '../src/verify.js';
import { getArchiveInfo } from '../src/info.js';
import { diffArchiveVsWorkspace } from '../src/diff.js';
import { restoreBackup } from '../src/restore.js';

const FIXTURES = join(__dirname, 'fixtures', 'mock-workspace');

describe('e2e: full backup-verify-info-diff-restore cycle', () => {
  let tempDir: string;
  let archivePath: string;

  beforeAll(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawback-e2e-'));
    archivePath = join(tempDir, 'test.clawback');
  });

  afterAll(() => {
    if (tempDir && existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('full cycle: backup → verify → info → diff → restore → compare', async () => {
    // Step 1: Backup
    const backupResult = await createBackup({
      workspace: FIXTURES,
      output: archivePath,
    });
    expect(existsSync(archivePath)).toBe(true);
    expect(backupResult.fileCount).toBeGreaterThan(0);

    // Step 2: Verify
    const verifyResult = await verifyArchive(archivePath);
    expect(verifyResult.valid).toBe(true);

    // Step 3: Info
    const info = await getArchiveInfo(archivePath);
    expect(info.manifest.agent.name).toBeTruthy();
    expect(info.manifest.files.length).toBeGreaterThan(0);

    // Step 4: Diff against same workspace (should show no changes)
    const diffClean = await diffArchiveVsWorkspace(archivePath, FIXTURES);
    expect(diffClean.entries.filter(e => e.status === 'modified')).toHaveLength(0);
    expect(diffClean.entries.filter(e => e.status === 'added')).toHaveLength(0);
    expect(diffClean.entries.filter(e => e.status === 'deleted')).toHaveLength(0);

    // Step 5: Restore to isolated temp dir
    const restoreDir = join(tempDir, 'restored');
    const restoreResult = await restoreBackup(archivePath, {
      workspace: restoreDir,
      force: true,
    });
    expect(restoreResult.restoredFiles.length).toBeGreaterThan(0);

    // Step 6: Verify restored files match originals

    // Check top-level identity/config files
    for (const file of ['SOUL.md', 'AGENTS.md', 'MEMORY.md', 'IDENTITY.md', 'TOOLS.md', '本我.md']) {
      const original = readFileSync(join(FIXTURES, file), 'utf-8');
      const restored = readFileSync(join(restoreDir, file), 'utf-8');
      expect(restored, `${file} content mismatch`).toBe(original);
    }

    // Check ALL memory/ files (names + contents)
    const originalMemoryDir = join(FIXTURES, 'memory');
    const restoredMemoryDir = join(restoreDir, 'memory');
    const originalMemoryFiles = readdirSync(originalMemoryDir).sort();
    const restoredMemoryFiles = readdirSync(restoredMemoryDir).sort();
    expect(originalMemoryFiles.length).toBeGreaterThan(0);
    expect(restoredMemoryFiles).toEqual(originalMemoryFiles);
    for (const file of originalMemoryFiles) {
      const original = readFileSync(join(originalMemoryDir, file), 'utf-8');
      const restored = readFileSync(join(restoredMemoryDir, file), 'utf-8');
      expect(restored, `memory/${file} content mismatch`).toBe(original);
    }
  });
});

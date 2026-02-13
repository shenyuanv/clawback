import { describe, it, expect, afterEach } from 'vitest';
import { createBackup } from '../src/backup.js';
import { restoreBackup } from '../src/restore.js';
import { createHash } from 'node:crypto';
import {
  existsSync,
  readFileSync,
  unlinkSync,
  rmSync,
  mkdtempSync,
  mkdirSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createManifest } from '../src/manifest.js';

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

describe('restore integration', () => {
  it('backup → restore round-trip: all files present and checksums match', async () => {
    // 1. Create a realistic workspace with paths that match the actual directory
    const srcWorkspace = mkdtempSync(join(tmpdir(), 'clawback-integ-src-'));
    tempDirs.push(srcWorkspace);
    const home = process.env.HOME ?? '/tmp';

    writeFileSync(join(srcWorkspace, 'SOUL.md'), '# Integration Test Agent\n');
    writeFileSync(join(srcWorkspace, 'IDENTITY.md'), 'Name: IntegBot\n');
    writeFileSync(join(srcWorkspace, 'AGENTS.md'), '# Operating Procedures\n');
    writeFileSync(join(srcWorkspace, 'MEMORY.md'), '# Long-term Memory\n');
    writeFileSync(
      join(srcWorkspace, 'TOOLS.md'),
      `# Tools\n\n- script: ${srcWorkspace}/scripts/run.sh\n- python: ${home}/.local/bin/python3\n`,
    );
    writeFileSync(join(srcWorkspace, '本我.md'), '# 本我\n');

    mkdirSync(join(srcWorkspace, 'memory'), { recursive: true });
    writeFileSync(join(srcWorkspace, 'memory', '2026-02-10.md'), '# Day log\nSome events.\n');
    writeFileSync(join(srcWorkspace, 'memory', '2026-02-11.md'), '# Day log 2\nMore events.\n');

    mkdirSync(join(srcWorkspace, 'config'), { recursive: true });
    writeFileSync(
      join(srcWorkspace, 'config', 'gateway.yaml'),
      `name: test-gw\nhost: localhost\nworkspace: ${srcWorkspace}\n`,
    );

    mkdirSync(join(srcWorkspace, 'scripts'), { recursive: true });
    writeFileSync(join(srcWorkspace, 'scripts', 'run.sh'), '#!/bin/bash\necho running\n');

    mkdirSync(join(srcWorkspace, 'skills', 'my-skill'), { recursive: true });
    writeFileSync(join(srcWorkspace, 'skills', 'my-skill', 'SKILL.md'), '# My Skill\n');

    // 2. Create backup
    const archivePath = join(
      tmpdir(),
      `clawback-integ-${Date.now()}.clawback`,
    );
    tempFiles.push(archivePath);

    const backupResult = await createBackup({
      workspace: srcWorkspace,
      output: archivePath,
    });

    expect(existsSync(archivePath)).toBe(true);

    // 3. Restore to a fresh temp directory
    const restoreDir = join(
      tmpdir(),
      `clawback-integ-target-${Date.now()}`,
    );
    tempDirs.push(restoreDir);

    const restoreResult = await restoreBackup(archivePath, {
      workspace: restoreDir,
    });

    expect(restoreResult.restoredFiles.length).toBe(backupResult.fileCount);

    // 4. Verify every file exists in restored dir
    const originalManifest = createManifest({ workspace: srcWorkspace });

    for (const fileEntry of originalManifest.files) {
      const restoredPath = join(restoreDir, fileEntry.path);
      expect(existsSync(restoredPath)).toBe(true);

      // For non-remapped files, checksums must match exactly
      const restoredFile = restoreResult.restoredFiles.find(
        (f) => f.path === fileEntry.path,
      );

      if (restoredFile && !restoredFile.remapped) {
        const originalContent = readFileSync(join(srcWorkspace, fileEntry.path));
        const restoredContent = readFileSync(restoredPath);

        const originalHash =
          'sha256:' +
          createHash('sha256').update(originalContent).digest('hex');
        const restoredHash =
          'sha256:' +
          createHash('sha256').update(restoredContent).digest('hex');

        expect(restoredHash).toBe(originalHash);
      }
    }

    // 5. Verify path-remapped files contain new paths
    const toolsContent = readFileSync(join(restoreDir, 'TOOLS.md'), 'utf-8');
    expect(toolsContent).not.toContain(srcWorkspace);
    expect(toolsContent).toContain(restoreDir);

    const gatewayContent = readFileSync(
      join(restoreDir, 'config', 'gateway.yaml'),
      'utf-8',
    );
    expect(gatewayContent).not.toContain(srcWorkspace);
    expect(gatewayContent).toContain(restoreDir);
  });
});

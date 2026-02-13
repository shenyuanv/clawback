import { describe, it, expect, afterEach } from 'vitest';
import { getArchiveInfo, formatInfo } from '../src/info.js';
import { createBackup } from '../src/backup.js';
import {
  existsSync,
  unlinkSync,
  mkdtempSync,
  writeFileSync,
  rmSync,
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

describe('info', () => {
  it('displays correct agent name from manifest', async () => {
    const archivePath = join(tmpdir(), `saddlebag-info-name-${Date.now()}.saddlebag`);
    tempFiles.push(archivePath);

    await createBackup({
      workspace: MOCK_WORKSPACE,
      output: archivePath,
    });

    const info = await getArchiveInfo(archivePath);
    const output = formatInfo(info);

    // Mock workspace has IDENTITY.md with "Name: TestBot"
    expect(info.manifest.agent.name).toBe('TestBot');
    expect(output).toContain('Agent: TestBot');
  });

  it('displays correct file counts per category', async () => {
    const archivePath = join(tmpdir(), `saddlebag-info-counts-${Date.now()}.saddlebag`);
    tempFiles.push(archivePath);

    await createBackup({
      workspace: MOCK_WORKSPACE,
      output: archivePath,
    });

    const info = await getArchiveInfo(archivePath);
    const output = formatInfo(info);

    // Verify counts match manifest
    const m = info.manifest.contents;
    expect(m.agent_files).toBeGreaterThan(0);
    expect(output).toContain(`${m.agent_files} agent`);
    expect(output).toContain(`${m.config_files} config`);
    expect(output).toContain(`${m.custom_skills} skills`);
    expect(output).toContain(`${m.scripts} scripts`);

    // Total should be the sum
    const total = m.agent_files + m.config_files + m.custom_skills + m.scripts;
    expect(output).toContain(`Files: ${total}`);
  });

  it('displays creation date in human-readable format', async () => {
    const archivePath = join(tmpdir(), `saddlebag-info-date-${Date.now()}.saddlebag`);
    tempFiles.push(archivePath);

    await createBackup({
      workspace: MOCK_WORKSPACE,
      output: archivePath,
    });

    const info = await getArchiveInfo(archivePath);
    const output = formatInfo(info);

    // Should contain "Created:" with a date and relative time
    expect(output).toMatch(/Created: \d{4}-\d{2}-\d{2} \d{2}:\d{2} \(.+\)/);
    // Archive was just created, so should say "just now" or "X minutes ago"
    expect(output).toMatch(/\(just now|1 minute ago|\d+ minutes? ago\)/);
  });

  it('handles archive without credentials gracefully', async () => {
    const archivePath = join(tmpdir(), `saddlebag-info-nocreds-${Date.now()}.saddlebag`);
    tempFiles.push(archivePath);

    // Default backup has no credentials
    await createBackup({
      workspace: MOCK_WORKSPACE,
      output: archivePath,
    });

    const info = await getArchiveInfo(archivePath);
    const output = formatInfo(info);

    expect(info.manifest.contents.credentials).toBe(false);
    expect(output).toContain('Credentials: no');

    // Should also have checksum and size
    expect(output).toMatch(/Checksum: sha256:[a-f0-9]{64}/);
    expect(output).toMatch(/Size: /);
  });
});

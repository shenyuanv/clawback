import { describe, it, expect, afterEach } from 'vitest';
import { createCli } from '../src/cli.js';
import { spawnSync } from 'node:child_process';
import { createBackup } from '../src/backup.js';
import { existsSync, unlinkSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';

describe('CLI', () => {
  const tempFiles: string[] = [];

  afterEach(() => {
    for (const f of tempFiles) {
      try {
        if (existsSync(f)) unlinkSync(f);
      } catch {
        /* ignore */
      }
    }
    tempFiles.length = 0;
  });

  it('clawback --version prints version', () => {
    const program = createCli();
    // Commander stores the version; we can check it's set
    expect(program.version()).toBe('1.1.0');
  });

  it('clawback --help lists commands', () => {
    const program = createCli();
    const helpText = program.helpInformation();
    expect(helpText).toContain('backup');
    expect(helpText).toContain('restore');
    expect(helpText).toContain('verify');
    expect(helpText).toContain('diff');
    expect(helpText).toContain('info');
  });

  it('prints output when invoked as a child process (non-PTY)', async () => {
    const fixtures = resolve(import.meta.dirname, 'fixtures');
    const workspace = resolve(fixtures, 'mock-workspace');
    const archivePath = join(
      tmpdir(),
      `clawback-cli-${Date.now()}-${Math.random().toString(36).slice(2)}.clawback`,
    );
    tempFiles.push(archivePath);

    await createBackup({ workspace, output: archivePath });

    const cliEntry = resolve(import.meta.dirname, '..', 'src', 'index.ts');
    const result = spawnSync(
      process.execPath,
      ['--import', 'tsx', cliEntry, 'info', archivePath],
      { encoding: 'utf-8' },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Agent:');
  });
});

import { describe, it, expect, afterEach } from 'vitest';
import { createBackup, getArchivePath } from '../src/backup.js';
import { createHash } from 'node:crypto';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  unlinkSync,
  rmSync,
} from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createGunzip } from 'node:zlib';
import { createReadStream } from 'node:fs';
import * as tar from 'tar-stream';
import { pipeline } from 'node:stream/promises';

const FIXTURES = resolve(import.meta.dirname, 'fixtures');
const MOCK_WORKSPACE = resolve(FIXTURES, 'mock-workspace');

/** Helper: extract all entries from a .saddlebag (tar.gz) file */
async function extractArchive(
  archivePath: string,
): Promise<Map<string, Buffer>> {
  const entries = new Map<string, Buffer>();
  const extract = tar.extract();

  const done = new Promise<void>((resolve, reject) => {
    extract.on('entry', (header, stream, next) => {
      const chunks: Buffer[] = [];
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.on('end', () => {
        entries.set(header.name, Buffer.concat(chunks));
        next();
      });
      stream.on('error', reject);
    });
    extract.on('finish', resolve);
    extract.on('error', reject);
  });

  await pipeline(createReadStream(archivePath), createGunzip(), extract);
  await done;

  return entries;
}

// Track temp files for cleanup
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

describe('backup', () => {
  it('creates .saddlebag file from mock workspace', async () => {
    const outputPath = join(
      tmpdir(),
      `saddlebag-test-${Date.now()}.saddlebag`,
    );
    tempFiles.push(outputPath);

    const result = await createBackup({
      workspace: MOCK_WORKSPACE,
      output: outputPath,
    });

    expect(existsSync(result.outputPath)).toBe(true);
    expect(result.outputPath).toBe(outputPath);
    expect(result.fileCount).toBeGreaterThan(0);
    expect(result.totalBytes).toBeGreaterThan(0);
  });

  it('archive contains manifest.json', async () => {
    const outputPath = join(
      tmpdir(),
      `saddlebag-test-manifest-${Date.now()}.saddlebag`,
    );
    tempFiles.push(outputPath);

    await createBackup({
      workspace: MOCK_WORKSPACE,
      output: outputPath,
    });

    const entries = await extractArchive(outputPath);
    expect(entries.has('manifest.json')).toBe(true);

    // Verify it's valid JSON
    const manifestStr = entries.get('manifest.json')!.toString('utf-8');
    const manifest = JSON.parse(manifestStr);
    expect(manifest.saddlebag_version).toBe('1.0');
    expect(manifest.agent.name).toBeTruthy();
  });

  it('archive contains all expected agent files (SOUL.md, MEMORY.md, etc.)', async () => {
    const outputPath = join(
      tmpdir(),
      `saddlebag-test-agent-files-${Date.now()}.saddlebag`,
    );
    tempFiles.push(outputPath);

    await createBackup({
      workspace: MOCK_WORKSPACE,
      output: outputPath,
    });

    const entries = await extractArchive(outputPath);
    const entryNames = [...entries.keys()];

    // Agent root files should be under agent/ prefix
    expect(entryNames).toContain('agent/SOUL.md');
    expect(entryNames).toContain('agent/MEMORY.md');
    expect(entryNames).toContain('agent/AGENTS.md');
    expect(entryNames).toContain('agent/IDENTITY.md');
    expect(entryNames).toContain('agent/本我.md');

    // Memory subdirectory files under agent/memory/
    expect(entryNames).toContain('agent/memory/2026-02-10.md');
    expect(entryNames).toContain('agent/memory/2026-02-11.md');

    // Config files
    expect(entryNames).toContain('config/gateway.yaml');

    // Skills and scripts
    expect(entryNames).toContain('skills/custom-skill/SKILL.md');
    expect(entryNames).toContain('scripts/hello.sh');
  });

  it('archive contains README.md', async () => {
    const outputPath = join(
      tmpdir(),
      `saddlebag-test-readme-${Date.now()}.saddlebag`,
    );
    tempFiles.push(outputPath);

    await createBackup({
      workspace: MOCK_WORKSPACE,
      output: outputPath,
    });

    const entries = await extractArchive(outputPath);
    expect(entries.has('README.md')).toBe(true);

    const readme = entries.get('README.md')!.toString('utf-8');
    expect(readme).toContain('Saddlebag Backup');
    expect(readme).toContain('How to Restore');
    expect(readme).toContain('saddlebag restore');
  });

  it('manifest checksums match actual file contents in archive', async () => {
    const outputPath = join(
      tmpdir(),
      `saddlebag-test-checksums-${Date.now()}.saddlebag`,
    );
    tempFiles.push(outputPath);

    const result = await createBackup({
      workspace: MOCK_WORKSPACE,
      output: outputPath,
    });

    const entries = await extractArchive(outputPath);
    const manifestStr = entries.get('manifest.json')!.toString('utf-8');
    const manifest = JSON.parse(manifestStr);

    // For each file in the manifest, verify the checksum matches the archive content
    for (const fileEntry of manifest.files) {
      const archivePath = getArchivePath(fileEntry.path, fileEntry.category);
      const content = entries.get(archivePath);
      expect(content).toBeDefined();

      const actualHash =
        'sha256:' + createHash('sha256').update(content!).digest('hex');
      expect(manifest.checksums[fileEntry.path]).toBe(actualHash);
    }
  });

  it('--output flag writes to specified path', async () => {
    const customDir = mkdtempSync(join(tmpdir(), 'saddlebag-test-output-'));
    tempDirs.push(customDir);
    const customPath = join(customDir, 'my-custom-backup.saddlebag');

    const result = await createBackup({
      workspace: MOCK_WORKSPACE,
      output: customPath,
    });

    expect(result.outputPath).toBe(customPath);
    expect(existsSync(customPath)).toBe(true);
  });

  it('backup of empty workspace (only SOUL.md) succeeds', async () => {
    const minimalWorkspace = mkdtempSync(
      join(tmpdir(), 'saddlebag-test-minimal-'),
    );
    tempDirs.push(minimalWorkspace);
    writeFileSync(join(minimalWorkspace, 'SOUL.md'), '# Minimal Agent\n');

    const outputPath = join(
      tmpdir(),
      `saddlebag-test-minimal-${Date.now()}.saddlebag`,
    );
    tempFiles.push(outputPath);

    const result = await createBackup({
      workspace: minimalWorkspace,
      output: outputPath,
    });

    expect(existsSync(outputPath)).toBe(true);
    expect(result.fileCount).toBe(1);

    const entries = await extractArchive(outputPath);
    expect(entries.has('manifest.json')).toBe(true);
    expect(entries.has('README.md')).toBe(true);
    expect(entries.has('agent/SOUL.md')).toBe(true);
  });

  it('large files (>1MB) are included correctly', async () => {
    const largeWorkspace = mkdtempSync(
      join(tmpdir(), 'saddlebag-test-large-'),
    );
    tempDirs.push(largeWorkspace);
    writeFileSync(join(largeWorkspace, 'SOUL.md'), '# Large Test Agent\n');

    // Create a 1.5MB file in memory/
    mkdirSync(join(largeWorkspace, 'memory'));
    const largeContent = 'x'.repeat(1_500_000) + '\n';
    writeFileSync(join(largeWorkspace, 'memory', 'large-log.md'), largeContent);

    const outputPath = join(
      tmpdir(),
      `saddlebag-test-large-${Date.now()}.saddlebag`,
    );
    tempFiles.push(outputPath);

    const result = await createBackup({
      workspace: largeWorkspace,
      output: outputPath,
    });

    expect(existsSync(outputPath)).toBe(true);
    expect(result.fileCount).toBe(2);

    // Verify the large file is intact
    const entries = await extractArchive(outputPath);
    const largeEntry = entries.get('agent/memory/large-log.md');
    expect(largeEntry).toBeDefined();
    expect(largeEntry!.length).toBe(1_500_001); // 1.5M + newline

    // Verify checksum
    const manifestStr = entries.get('manifest.json')!.toString('utf-8');
    const manifest = JSON.parse(manifestStr);
    const expectedHash =
      'sha256:' +
      createHash('sha256').update(largeEntry!).digest('hex');
    expect(manifest.checksums['memory/large-log.md']).toBe(expectedHash);
  });
});

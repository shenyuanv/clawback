import { describe, it, expect, afterEach } from 'vitest';
import { verifyArchive } from '../src/verify.js';
import { createBackup } from '../src/backup.js';
import { createHash } from 'node:crypto';
import {
  existsSync,
  unlinkSync,
  rmSync,
  createReadStream,
  createWriteStream,
  writeFileSync,
} from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createGunzip, createGzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import * as tar from 'tar-stream';

const FIXTURES = resolve(import.meta.dirname, 'fixtures');
const MOCK_WORKSPACE = resolve(FIXTURES, 'mock-workspace');

// Track temp files for cleanup
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

/**
 * Helper: extract all entries from a tar.gz archive,
 * then repack with modifications.
 */
async function extractEntries(
  archivePath: string,
): Promise<Map<string, { header: tar.Headers; content: Buffer }>> {
  const entries = new Map<string, { header: tar.Headers; content: Buffer }>();
  const extract = tar.extract();

  const done = new Promise<void>((resolve, reject) => {
    extract.on('entry', (header, stream, next) => {
      const chunks: Buffer[] = [];
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.on('end', () => {
        entries.set(header.name, { header: { ...header }, content: Buffer.concat(chunks) });
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

/**
 * Helper: repack entries into a new tar.gz archive.
 */
async function repackArchive(
  outputPath: string,
  entries: Map<string, { header: tar.Headers; content: Buffer }>,
): Promise<void> {
  const pack = tar.pack();

  for (const [name, entry] of entries) {
    pack.entry({ name, size: entry.content.length }, entry.content);
  }

  pack.finalize();

  const gzip = createGzip({ level: 9 });
  const output = createWriteStream(outputPath);
  await pipeline(pack, gzip, output);
}

describe('verify', () => {
  it('valid archive passes verification', async () => {
    const archivePath = join(tmpdir(), `saddlebag-verify-valid-${Date.now()}.saddlebag`);
    tempFiles.push(archivePath);

    await createBackup({
      workspace: MOCK_WORKSPACE,
      output: archivePath,
    });

    const result = await verifyArchive(archivePath);

    expect(result.valid).toBe(true);
    expect(result.manifest).not.toBeNull();
    expect(result.files.length).toBeGreaterThan(0);
    expect(result.files.every((f) => f.status === 'ok')).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('archive with modified file fails verification (tamper detection)', async () => {
    const originalPath = join(tmpdir(), `saddlebag-verify-tamper-orig-${Date.now()}.saddlebag`);
    const tamperedPath = join(tmpdir(), `saddlebag-verify-tamper-${Date.now()}.saddlebag`);
    tempFiles.push(originalPath, tamperedPath);

    await createBackup({
      workspace: MOCK_WORKSPACE,
      output: originalPath,
    });

    // Extract, modify agent/SOUL.md content, repack
    const entries = await extractEntries(originalPath);
    const soulEntry = entries.get('agent/SOUL.md');
    expect(soulEntry).toBeDefined();

    entries.set('agent/SOUL.md', {
      header: soulEntry!.header,
      content: Buffer.from('TAMPERED CONTENT - this is not the original'),
    });

    await repackArchive(tamperedPath, entries);

    const result = await verifyArchive(tamperedPath);

    expect(result.valid).toBe(false);
    const soulResult = result.files.find((f) => f.path === 'SOUL.md');
    expect(soulResult).toBeDefined();
    expect(soulResult!.status).toBe('corrupted');
  });

  it('archive with missing file fails verification', async () => {
    const originalPath = join(tmpdir(), `saddlebag-verify-missing-orig-${Date.now()}.saddlebag`);
    const missingPath = join(tmpdir(), `saddlebag-verify-missing-${Date.now()}.saddlebag`);
    tempFiles.push(originalPath, missingPath);

    await createBackup({
      workspace: MOCK_WORKSPACE,
      output: originalPath,
    });

    // Extract, remove agent/SOUL.md, repack
    const entries = await extractEntries(originalPath);
    entries.delete('agent/SOUL.md');

    await repackArchive(missingPath, entries);

    const result = await verifyArchive(missingPath);

    expect(result.valid).toBe(false);
    const soulResult = result.files.find((f) => f.path === 'SOUL.md');
    expect(soulResult).toBeDefined();
    expect(soulResult!.status).toBe('missing');
  });

  it('archive without manifest.json fails with clear error', async () => {
    const originalPath = join(tmpdir(), `saddlebag-verify-nomanifest-orig-${Date.now()}.saddlebag`);
    const noManifestPath = join(tmpdir(), `saddlebag-verify-nomanifest-${Date.now()}.saddlebag`);
    tempFiles.push(originalPath, noManifestPath);

    await createBackup({
      workspace: MOCK_WORKSPACE,
      output: originalPath,
    });

    // Extract, remove manifest.json, repack
    const entries = await extractEntries(originalPath);
    entries.delete('manifest.json');

    await repackArchive(noManifestPath, entries);

    const result = await verifyArchive(noManifestPath);

    expect(result.valid).toBe(false);
    expect(result.manifest).toBeNull();
    expect(result.error).toBe('Archive does not contain manifest.json');
  });

  it('reports which specific files are corrupted', async () => {
    const originalPath = join(tmpdir(), `saddlebag-verify-report-orig-${Date.now()}.saddlebag`);
    const corruptedPath = join(tmpdir(), `saddlebag-verify-report-${Date.now()}.saddlebag`);
    tempFiles.push(originalPath, corruptedPath);

    await createBackup({
      workspace: MOCK_WORKSPACE,
      output: originalPath,
    });

    // Tamper with two files and remove one
    const entries = await extractEntries(originalPath);

    // Tamper agent/MEMORY.md
    const memoryEntry = entries.get('agent/MEMORY.md');
    expect(memoryEntry).toBeDefined();
    entries.set('agent/MEMORY.md', {
      header: memoryEntry!.header,
      content: Buffer.from('TAMPERED MEMORY'),
    });

    // Remove scripts/hello.sh
    entries.delete('scripts/hello.sh');

    await repackArchive(corruptedPath, entries);

    const result = await verifyArchive(corruptedPath);

    expect(result.valid).toBe(false);

    // Check that MEMORY.md is reported as corrupted
    const memoryResult = result.files.find((f) => f.path === 'MEMORY.md');
    expect(memoryResult).toBeDefined();
    expect(memoryResult!.status).toBe('corrupted');

    // Check that scripts/hello.sh is reported as missing
    const scriptResult = result.files.find((f) => f.path === 'scripts/hello.sh');
    expect(scriptResult).toBeDefined();
    expect(scriptResult!.status).toBe('missing');

    // Check that unmodified files are still 'ok'
    const soulResult = result.files.find((f) => f.path === 'SOUL.md');
    expect(soulResult).toBeDefined();
    expect(soulResult!.status).toBe('ok');

    // Verify we can list all corrupted/missing files
    const problems = result.files.filter((f) => f.status !== 'ok');
    expect(problems.length).toBe(2);
    expect(problems.map((p) => p.path).sort()).toEqual(['MEMORY.md', 'scripts/hello.sh']);
  });
});

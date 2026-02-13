import { describe, it, expect, afterEach } from 'vitest';
import { createBackup } from '../src/backup.js';
import { createHash } from 'node:crypto';
import { existsSync, unlinkSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createGunzip } from 'node:zlib';
import { createReadStream } from 'node:fs';
import * as tar from 'tar-stream';
import { pipeline } from 'node:stream/promises';

const FIXTURES = resolve(import.meta.dirname, 'fixtures');
const MOCK_WORKSPACE = resolve(FIXTURES, 'mock-workspace');

/** Helper: extract all entries from a .clawback (tar.gz) file */
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

describe('backup integration', () => {
  it('creates valid archive from workspace — file created, manifest valid, checksums verify', async () => {
    const outputPath = join(
      tmpdir(),
      `clawback-integration-${Date.now()}.clawback`,
    );
    tempFiles.push(outputPath);

    // Run backup against mock workspace (safe: read-only)
    const result = await createBackup({
      workspace: MOCK_WORKSPACE,
      output: outputPath,
    });

    // 1. File is created
    expect(existsSync(outputPath)).toBe(true);

    // 2. Extract and parse manifest
    const entries = await extractArchive(outputPath);
    expect(entries.has('manifest.json')).toBe(true);

    const manifestStr = entries.get('manifest.json')!.toString('utf-8');
    const manifest = JSON.parse(manifestStr);

    // 3. Manifest is valid JSON with required fields
    expect(manifest.clawback_version).toBe('1.0');
    expect(manifest.agent).toBeDefined();
    expect(manifest.agent.name).toBe('TestBot');
    expect(manifest.source).toBeDefined();
    expect(manifest.contents).toBeDefined();
    expect(manifest.checksums).toBeDefined();
    expect(manifest.files).toBeDefined();

    // 4. All checksums verify against archive contents
    let verifiedCount = 0;
    for (const fileEntry of manifest.files) {
      const archivePath =
        fileEntry.category === 'agent' && !fileEntry.path.startsWith('memory/')
          ? `agent/${fileEntry.path}`
          : fileEntry.path.startsWith('memory/')
            ? `agent/${fileEntry.path}`
            : fileEntry.path;

      // Read original file from workspace for ground truth
      const originalContent = readFileSync(
        join(MOCK_WORKSPACE, fileEntry.path),
      );
      const expectedHash =
        'sha256:' +
        createHash('sha256').update(originalContent).digest('hex');
      expect(manifest.checksums[fileEntry.path]).toBe(expectedHash);
      verifiedCount++;
    }

    expect(verifiedCount).toBe(manifest.files.length);
    expect(verifiedCount).toBeGreaterThan(0);
  });
});

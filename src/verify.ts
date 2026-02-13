import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { createGunzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import * as tar from 'tar-stream';
import { getArchivePath } from './backup.js';
import type { Manifest } from './manifest.js';

export interface VerifyFileResult {
  path: string;
  status: 'ok' | 'corrupted' | 'missing';
  expected?: string;
  actual?: string;
}

export interface VerifyResult {
  valid: boolean;
  manifest: Manifest | null;
  files: VerifyFileResult[];
  error?: string;
}

/**
 * Verify a .clawback archive's integrity.
 *
 * Extracts the manifest, then checks every listed file exists
 * in the archive and its SHA-256 checksum matches.
 */
export async function verifyArchive(archivePath: string): Promise<VerifyResult> {
  // 1. Extract all entries from the archive
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

  // 2. Check for manifest.json
  const manifestBuf = entries.get('manifest.json');
  if (!manifestBuf) {
    return {
      valid: false,
      manifest: null,
      files: [],
      error: 'Archive does not contain manifest.json',
    };
  }

  let manifest: Manifest;
  try {
    manifest = JSON.parse(manifestBuf.toString('utf-8'));
  } catch {
    return {
      valid: false,
      manifest: null,
      files: [],
      error: 'manifest.json is not valid JSON',
    };
  }

  // 3. Verify each file listed in the manifest
  const fileResults: VerifyFileResult[] = [];
  let allValid = true;

  for (const fileEntry of manifest.files) {
    const archiveEntryPath = getArchivePath(fileEntry.path, fileEntry.category);
    const content = entries.get(archiveEntryPath);
    const expectedChecksum = manifest.checksums[fileEntry.path];

    if (!content) {
      fileResults.push({
        path: fileEntry.path,
        status: 'missing',
        expected: expectedChecksum,
      });
      allValid = false;
      continue;
    }

    const actualChecksum =
      'sha256:' + createHash('sha256').update(content).digest('hex');

    if (actualChecksum !== expectedChecksum) {
      fileResults.push({
        path: fileEntry.path,
        status: 'corrupted',
        expected: expectedChecksum,
        actual: actualChecksum,
      });
      allValid = false;
    } else {
      fileResults.push({
        path: fileEntry.path,
        status: 'ok',
      });
    }
  }

  return {
    valid: allValid,
    manifest,
    files: fileResults,
  };
}

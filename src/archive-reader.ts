/**
 * Handle reading both plain and encrypted .clawback archives.
 * For encrypted archives: decrypt to temp file, return temp path.
 * Caller should clean up with cleanupTempArchive() when done.
 */
import { readFileSync, writeFileSync, unlinkSync, rmdirSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { isEncryptedArchive, decryptArchive } from './encrypt.js';

export interface ResolvedArchive {
  /** Path to the (decrypted) tar.gz file — may be a temp file */
  path: string;
  /** Whether the archive was encrypted */
  encrypted: boolean;
  /** Temp dir to clean up (null if not encrypted) */
  tempDir: string | null;
}

/**
 * Resolve an archive path — if encrypted, decrypt to temp file.
 */
export function resolveArchive(archivePath: string, password?: string): ResolvedArchive {
  const data = readFileSync(archivePath);

  if (!isEncryptedArchive(data)) {
    return { path: archivePath, encrypted: false, tempDir: null };
  }

  if (!password) {
    throw new Error('ENCRYPTED_ARCHIVE');
  }

  const decrypted = decryptArchive(data, password);
  const tempDir = mkdtempSync(join(tmpdir(), 'clawback-dec-'));
  const tempPath = join(tempDir, 'archive.tar.gz');
  writeFileSync(tempPath, decrypted);

  return { path: tempPath, encrypted: true, tempDir };
}

/**
 * Clean up temp files from resolveArchive.
 */
export function cleanupTempArchive(resolved: ResolvedArchive): void {
  if (resolved.tempDir) {
    try {
      unlinkSync(join(resolved.tempDir, 'archive.tar.gz'));
      rmdirSync(resolved.tempDir);
    } catch {
      /* ignore cleanup errors */
    }
  }
}

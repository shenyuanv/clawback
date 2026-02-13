import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';
import { encryptArchive, decryptArchive, isEncryptedArchive } from '../src/encrypt.js';
import { resolveArchive } from '../src/archive-reader.js';

const WORKSPACE = join(import.meta.dirname, 'fixtures', 'mock-workspace');
const CLI = join(import.meta.dirname, '..', 'src', 'index.ts');
const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'clawback-encrypt-'));
  tempDirs.push(dir);
  return dir;
}

function createTestArchive(dir: string): string {
  const archivePath = join(dir, 'test.clawback');
  execSync(
    `node --import tsx ${CLI} backup --workspace ${WORKSPACE} --output ${archivePath}`,
    { stdio: 'pipe' },
  );
  return archivePath;
}

afterEach(() => {
  for (const dir of tempDirs) {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* */ }
  }
  tempDirs.length = 0;
});

describe('full-archive encryption', () => {
  it('encrypt then decrypt round-trip preserves data', () => {
    const original = Buffer.from('hello world test data');
    const encrypted = encryptArchive(original, 'mypassword');
    expect(isEncryptedArchive(encrypted)).toBe(true);
    expect(isEncryptedArchive(original)).toBe(false);
    const decrypted = decryptArchive(encrypted, 'mypassword');
    expect(decrypted.equals(original)).toBe(true);
  });

  it('wrong password throws', () => {
    const original = Buffer.from('secret data');
    const encrypted = encryptArchive(original, 'correct');
    expect(() => decryptArchive(encrypted, 'wrong')).toThrow('Invalid password');
  });

  it('backup --encrypt creates encrypted archive', () => {
    const tmp = createTempDir();
    const archivePath = join(tmp, 'encrypted.clawback');
    execSync(
      `node --import tsx ${CLI} backup --workspace ${WORKSPACE} --output ${archivePath} --encrypt --password testpass123`,
      { stdio: 'pipe' },
    );
    const data = readFileSync(archivePath);
    expect(isEncryptedArchive(data)).toBe(true);
  });

  it('resolveArchive decrypts encrypted archive to temp file', () => {
    const tmp = createTempDir();
    const archive = createTestArchive(tmp);
    const data = readFileSync(archive);
    const encrypted = encryptArchive(data, 'pw123');
    const encPath = join(tmp, 'enc.clawback');
    require('node:fs').writeFileSync(encPath, encrypted);

    const resolved = resolveArchive(encPath, 'pw123');
    expect(resolved.encrypted).toBe(true);
    expect(resolved.tempDir).not.toBeNull();
    // Decrypted file should be a valid tar.gz
    const decData = readFileSync(resolved.path);
    // gzip magic bytes: 1f 8b
    expect(decData[0]).toBe(0x1f);
    expect(decData[1]).toBe(0x8b);
  });

  it('resolveArchive throws ENCRYPTED_ARCHIVE without password', () => {
    const tmp = createTempDir();
    const archive = createTestArchive(tmp);
    const data = readFileSync(archive);
    const encrypted = encryptArchive(data, 'pw');
    const encPath = join(tmp, 'enc.clawback');
    require('node:fs').writeFileSync(encPath, encrypted);

    expect(() => resolveArchive(encPath)).toThrow('ENCRYPTED_ARCHIVE');
  });

  it('info works on encrypted archive via CLI', () => {
    const tmp = createTempDir();
    const archivePath = join(tmp, 'encrypted.clawback');
    execSync(
      `node --import tsx ${CLI} backup --workspace ${WORKSPACE} --output ${archivePath} --encrypt --password secretpw`,
      { stdio: 'pipe' },
    );
    const output = execSync(
      `node --import tsx ${CLI} info ${archivePath} --password secretpw`,
      { encoding: 'utf-8' },
    );
    expect(output).toContain('TestBot');
  });

  it('verify works on encrypted archive via CLI', () => {
    const tmp = createTempDir();
    const archivePath = join(tmp, 'encrypted.clawback');
    execSync(
      `node --import tsx ${CLI} backup --workspace ${WORKSPACE} --output ${archivePath} --encrypt --password pw99`,
      { stdio: 'pipe' },
    );
    const output = execSync(
      `node --import tsx ${CLI} verify ${archivePath} --password pw99`,
      { encoding: 'utf-8' },
    );
    expect(output).toContain('valid');
  });
});

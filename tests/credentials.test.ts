import { describe, it, expect, afterEach } from 'vitest';
import { createBackup } from '../src/backup.js';
import { restoreBackup } from '../src/restore.js';
import {
  encryptCredentialVault,
  decryptCredentialVault,
  type CredentialVaultPayload,
} from '../src/credentials.js';
import { createReadStream } from 'node:fs';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
  mkdirSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createGunzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import * as tar from 'tar-stream';

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

async function readArchiveEntries(archivePath: string): Promise<Map<string, Buffer>> {
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

function createCredentialWorkspace(): string {
  const dir = mkdtempSync(join(tmpdir(), 'clawback-test-creds-'));
  tempDirs.push(dir);

  writeFileSync(join(dir, 'SOUL.md'), '# Cred Test Agent\n');
  writeFileSync(join(dir, 'IDENTITY.md'), 'Name: CredBot\n');
  writeFileSync(join(dir, 'AGENTS.md'), '# Agent Procedures\n');
  writeFileSync(join(dir, 'MEMORY.md'), '# Memory\n');
  writeFileSync(join(dir, 'TOOLS.md'), '# Tools\n');

  mkdirSync(join(dir, 'config'), { recursive: true });
  writeFileSync(
    join(dir, 'config', 'gateway.yaml'),
    [
      'providers:',
      '  anthropic:',
      '    api_key: sk-ant-123',
      '  openai:',
      '    api_key: sk-open-456',
      '',
    ].join('\n'),
  );

  writeFileSync(join(dir, '.env'), 'ANTHROPIC_API_KEY=sk-env-999\n');
  writeFileSync(join(dir, '.env.local'), 'OPENAI_API_KEY=sk-env-local\n');
  writeFileSync(join(dir, 'auth-profiles.json'), '{"profile":"default"}');
  writeFileSync(join(dir, 'models.json'), '{"default":"gpt"}');
  writeFileSync(join(dir, 'session.token'), 'token-xyz');
  writeFileSync(join(dir, 'weibo-cookies.json'), '{"cookie":"value"}');

  mkdirSync(join(dir, '.openclaw'), { recursive: true });
  writeFileSync(join(dir, '.openclaw', 'auth.json'), '{"token":"oauth"}');

  return dir;
}

function createArchivePath(): string {
  const archivePath = join(
    tmpdir(),
    `clawback-test-creds-${Date.now()}-${Math.random().toString(36).slice(2)}.clawback`,
  );
  tempFiles.push(archivePath);
  return archivePath;
}

function createTargetDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'clawback-test-creds-target-'));
  tempDirs.push(dir);
  return dir;
}

describe('credentials', () => {
  it('encrypt/decrypt round-trip', async () => {
    const payload: CredentialVaultPayload = {
      version: 1,
      created: new Date().toISOString(),
      gateway: [
        {
          name: 'ANTHROPIC_API_KEY',
          keyPath: 'providers.anthropic.api_key',
          value: 'sk-test',
        },
      ],
      files: [
        {
          originalPath: '/tmp/.env',
          data: Buffer.from('KEY=VALUE').toString('base64'),
          mode: 0o600,
          mtimeMs: Date.now(),
        },
      ],
    };

    const encrypted = await encryptCredentialVault(payload, 'password123');
    const decrypted = await decryptCredentialVault(encrypted, 'password123');

    expect(decrypted.gateway[0].value).toBe('sk-test');
    expect(Buffer.from(decrypted.files[0].data, 'base64').toString('utf-8')).toBe('KEY=VALUE');
  });

  it('rejects wrong password', async () => {
    const payload: CredentialVaultPayload = {
      version: 1,
      created: new Date().toISOString(),
      gateway: [],
      files: [],
    };

    const encrypted = await encryptCredentialVault(payload, 'correct');
    await expect(decryptCredentialVault(encrypted, 'wrong')).rejects.toThrow(
      'Invalid password',
    );
  });

  it('credential manifest is accurate and excludes secrets', async () => {
    const workspace = createCredentialWorkspace();
    const archivePath = createArchivePath();
    const includePath = join(workspace, 'extra.secret');
    writeFileSync(includePath, 'extra-data');

    await createBackup({
      workspace,
      output: archivePath,
      withCredentials: true,
      password: 'vault-pass',
      includeCredential: [includePath],
    });

    const entries = await readArchiveEntries(archivePath);
    const manifestBuf = entries.get('credentials-manifest.json');
    expect(manifestBuf).toBeDefined();

    const manifestJson = manifestBuf!.toString('utf-8');
    expect(manifestJson).toContain('ANTHROPIC_API_KEY');
    expect(manifestJson).toContain('weibo-cookies.json');
    expect(manifestJson).toContain('.env');
    expect(manifestJson).toContain('.env.local');
    expect(manifestJson).toContain('auth-profiles.json');
    expect(manifestJson).toContain('models.json');
    expect(manifestJson).toContain('session.token');
    expect(manifestJson).toContain('auth.json');
    expect(manifestJson).toContain('extra.secret');

    // Secrets should not appear in manifest
    expect(manifestJson).not.toContain('sk-ant-123');
    expect(manifestJson).not.toContain('sk-env-999');
  });

  it('include-credential round-trip restores file', async () => {
    const workspace = createCredentialWorkspace();
    const archivePath = createArchivePath();
    const includePath = join(workspace, 'extra.secret');
    writeFileSync(includePath, 'extra-data');

    await createBackup({
      workspace,
      output: archivePath,
      withCredentials: true,
      password: 'vault-pass',
      includeCredential: [includePath],
    });

    const targetDir = createTargetDir();
    await restoreBackup(archivePath, {
      workspace: targetDir,
      password: 'vault-pass',
    });

    const restoredPath = join(targetDir, 'extra.secret');
    expect(readFileSync(restoredPath, 'utf-8')).toBe('extra-data');
  });

  it('restore without vault prompts for provider key', async () => {
    const workspace = createCredentialWorkspace();
    const archivePath = createArchivePath();

    await createBackup({
      workspace,
      output: archivePath,
      withCredentials: false,
    });

    let prompted = '';
    const targetDir = createTargetDir();
    await restoreBackup(archivePath, {
      workspace: targetDir,
      prompt: {
        promptSecret: async (message: string) => {
          prompted = message;
          return 'sk-new-999';
        },
      },
    });

    const gatewayConfig = readFileSync(join(targetDir, 'config', 'gateway.yaml'), 'utf-8');
    expect(prompted).toContain('Anthropic');
    expect(gatewayConfig).toContain('sk-new-999');
  });

  it('node pairing files round-trip (paired.json and pending.json)', async () => {
    const workspace = createCredentialWorkspace();
    const archivePath = createArchivePath();

    // Create node pairing files in ~/.openclaw/devices/
    const home = process.env.HOME ?? process.env.USERPROFILE;
    if (!home) {
      // Skip test if HOME not set
      return;
    }

    const devicesDir = join(home, '.openclaw', 'devices');
    const pairedPath = join(devicesDir, 'paired.json');
    const pendingPath = join(devicesDir, 'pending.json');

    // Backup existing files if they exist
    let pairedBackup: string | undefined;
    let pendingBackup: string | undefined;
    if (existsSync(pairedPath)) {
      pairedBackup = readFileSync(pairedPath, 'utf-8');
    }
    if (existsSync(pendingPath)) {
      pendingBackup = readFileSync(pendingPath, 'utf-8');
    }

    try {
      // Create test node pairing files
      mkdirSync(devicesDir, { recursive: true });
      writeFileSync(pairedPath, '{"device1":"token1"}');
      writeFileSync(pendingPath, '{"device2":"token2"}');

      // Backup with credentials
      await createBackup({
        workspace,
        output: archivePath,
        withCredentials: true,
        password: 'test-pass',
      });

      // Check manifest includes node pairing files
      const entries = await readArchiveEntries(archivePath);
      const manifestBuf = entries.get('credentials-manifest.json');
      expect(manifestBuf).toBeDefined();
      const manifestJson = manifestBuf!.toString('utf-8');
      expect(manifestJson).toContain('paired.json');
      expect(manifestJson).toContain('pending.json');

      // Restore to a new location
      const targetDir = createTargetDir();
      await restoreBackup(archivePath, {
        workspace: targetDir,
        password: 'test-pass',
      });

      // Verify node pairing files were restored
      const restoredPaired = join(home, '.openclaw', 'devices', 'paired.json');
      const restoredPending = join(home, '.openclaw', 'devices', 'pending.json');
      expect(readFileSync(restoredPaired, 'utf-8')).toBe('{"device1":"token1"}');
      expect(readFileSync(restoredPending, 'utf-8')).toBe('{"device2":"token2"}');
    } finally {
      // Restore original files
      if (pairedBackup !== undefined) {
        writeFileSync(pairedPath, pairedBackup);
      } else if (existsSync(pairedPath)) {
        unlinkSync(pairedPath);
      }
      if (pendingBackup !== undefined) {
        writeFileSync(pendingPath, pendingBackup);
      } else if (existsSync(pendingPath)) {
        unlinkSync(pendingPath);
      }
    }
  });
});

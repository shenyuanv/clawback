import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';
import { parse as parseYaml } from 'yaml';
import { containerize } from '../src/containerize.js';

const WORKSPACE = join(import.meta.dirname, 'fixtures', 'mock-workspace');
const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'clawback-containerize-'));
  tempDirs.push(dir);
  return dir;
}

function createTestArchive(dir: string): string {
  const archivePath = join(dir, 'test.clawback');
  execSync(
    `node --import tsx ${join(import.meta.dirname, '..', 'src', 'index.ts')} backup --workspace ${WORKSPACE} --output ${archivePath}`,
    { stdio: 'pipe' },
  );
  return archivePath;
}

afterEach(() => {
  for (const dir of tempDirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
  tempDirs.length = 0;
});

describe('containerize', () => {
  it('generates all required deployment files', async () => {
    const tmp = createTempDir();
    const archive = createTestArchive(tmp);
    const outputDir = join(tmp, 'deploy');

    const result = await containerize(archive, { outputDir });

    expect(result.agentName).toBe('TestBot');
    expect(result.files).toContain('Dockerfile');
    expect(result.files).toContain('docker-compose.yml');
    expect(result.files).toContain('README.md');
    expect(result.files).toContain('entrypoint.sh');

    for (const f of result.files) {
      expect(existsSync(join(outputDir, f))).toBe(true);
    }
  });

  it('does not generate .env.example (OpenClaw wizard handles setup)', async () => {
    const tmp = createTempDir();
    const archive = createTestArchive(tmp);
    const outputDir = join(tmp, 'deploy');

    await containerize(archive, { outputDir });

    expect(existsSync(join(outputDir, '.env.example'))).toBe(false);
    expect(existsSync(join(outputDir, '.env'))).toBe(false);
  });

  it('Dockerfile has correct base image and COPY', async () => {
    const tmp = createTempDir();
    const archive = createTestArchive(tmp);
    const outputDir = join(tmp, 'deploy');

    await containerize(archive, { outputDir });

    const dockerfile = readFileSync(join(outputDir, 'Dockerfile'), 'utf-8');
    expect(dockerfile).toContain('FROM node:22-slim');
    expect(dockerfile).toContain('COPY test.clawback');
    expect(dockerfile).toContain('HEALTHCHECK');
    expect(dockerfile).toContain('entrypoint.sh');
  });

  it('docker-compose.yml has config volume and tty for wizard', async () => {
    const tmp = createTempDir();
    const archive = createTestArchive(tmp);
    const outputDir = join(tmp, 'deploy');

    await containerize(archive, { outputDir });

    const raw = readFileSync(join(outputDir, 'docker-compose.yml'), 'utf-8');
    const parsed = parseYaml(raw) as Record<string, unknown>;
    const services = parsed.services as Record<string, Record<string, unknown>>;

    expect(services.agent).toBeDefined();
    expect(services.agent.restart).toBe('unless-stopped');
    expect(services.agent.stdin_open).toBe(true);
    expect(services.agent.tty).toBe(true);
    expect(services.agent.volumes).toContain('./data:/workspace/memory');
    expect(services.agent.volumes).toContain('./config:/workspace/config');
  });

  it('copies the archive into deploy folder', async () => {
    const tmp = createTempDir();
    const archive = createTestArchive(tmp);
    const outputDir = join(tmp, 'deploy');

    await containerize(archive, { outputDir });

    expect(existsSync(join(outputDir, 'test.clawback'))).toBe(true);
  });

  it('entrypoint starts gateway (wizard handles first-run setup)', async () => {
    const tmp = createTempDir();
    const archive = createTestArchive(tmp);
    const outputDir = join(tmp, 'deploy');

    await containerize(archive, { outputDir });

    const entrypoint = readFileSync(join(outputDir, 'entrypoint.sh'), 'utf-8');
    expect(entrypoint).toContain('openclaw gateway start');
    expect(entrypoint).not.toContain('ANTHROPIC_API_KEY');
  });
});

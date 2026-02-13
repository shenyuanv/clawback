import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parse as parseYaml } from 'yaml';

const writeLine = vi.fn(async () => undefined);

vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
}));

vi.mock('../src/output.js', () => ({
  writeLine,
}));

const mockQuestion = vi.fn();
vi.mock('node:readline/promises', () => ({
  createInterface: () => ({
    question: mockQuestion,
    close: vi.fn(),
  }),
}));

const { execSync } = await import('node:child_process');
const execSyncMock = execSync as unknown as vi.Mock;
const { postRestoreRun } = await import('../src/restore.js');

const tempDirs: string[] = [];

function createWorkspace(): string {
  const dir = mkdtempSync(join(tmpdir(), 'clawback-run-test-'));
  tempDirs.push(dir);
  mkdirSync(join(dir, 'config'), { recursive: true });
  return dir;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockQuestion.mockReset();
});

afterEach(() => {
  for (const dir of tempDirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
  tempDirs.length = 0;
  vi.useRealTimers();
});

describe('postRestoreRun', () => {
  it('reports when openclaw is not installed', async () => {
    execSyncMock.mockImplementation((cmd: string) => {
      if (cmd === 'openclaw --version') {
        throw new Error('not found');
      }
      return Buffer.from('');
    });

    await expect(postRestoreRun('/tmp', 'Agent')).rejects.toThrow('OPENCLAW_NOT_FOUND');
    expect(writeLine).toHaveBeenCalledWith(
      'OpenClaw not found. Install it: npm install -g openclaw',
    );
  });

  it('imports cron jobs and calls openclaw for each', async () => {
    const workspace = createWorkspace();
    writeFileSync(
      join(workspace, 'config', 'cron-jobs.json'),
      JSON.stringify([{ name: 'job1' }, { name: 'job2' }], null, 2),
    );
    writeFileSync(join(workspace, 'config', 'gateway.yaml'), 'anthropic:\n  apiKey: OK\n');

    execSyncMock.mockImplementation(() => Buffer.from('ok'));

    vi.useFakeTimers();
    const runPromise = postRestoreRun(workspace, 'Agent');
    await vi.runAllTimersAsync();
    await runPromise;

    const calls = execSyncMock.mock.calls.map(
      (args) => args[0] as string,
    );
    const cronCalls = calls.filter((cmd) => cmd.startsWith('openclaw cron add'));
    expect(cronCalls.length).toBe(2);
    expect(cronCalls[0]).toContain('"name":"job1"');
    expect(cronCalls[1]).toContain('"name":"job2"');
  });

  it('prompts for API key and writes gateway config', async () => {
    const workspace = createWorkspace();
    writeFileSync(
      join(workspace, 'config', 'gateway.yaml'),
      'anthropic:\\n  apiKey: REDACTED\\n',
    );

    execSyncMock.mockImplementation(() => Buffer.from('ok'));
    mockQuestion.mockResolvedValue('test-key-123');

    vi.useFakeTimers();
    const runPromise = postRestoreRun(workspace, 'Agent');
    await vi.runAllTimersAsync();
    await runPromise;

    const updated = readFileSync(join(workspace, 'config', 'gateway.yaml'), 'utf-8');
    const parsed = parseYaml(updated) as Record<string, unknown>;
    expect((parsed.anthropic as Record<string, unknown>).apiKey).toBe('test-key-123');
  });
});

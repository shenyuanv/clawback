import { describe, it, expect } from 'vitest';
import {
  exportCronJobs,
  importCronJobs,
  validateCronExport,
  type CronJob,
  type CronExport,
} from '../src/cron.js';
import type { EnvMap } from '../src/pathmap.js';

const sampleJobs: CronJob[] = [
  {
    id: 'job-001',
    name: 'morning-brief',
    schedule: { kind: 'cron', expr: '0 8 * * *', tz: 'Asia/Shanghai' },
    payload: {
      kind: 'agentTurn',
      message: 'Check /Users/shen/clawd/memory for updates and send morning brief',
    },
    sessionTarget: 'isolated',
    enabled: true,
  },
  {
    id: 'job-002',
    name: 'health-check',
    schedule: { kind: 'every', everyMs: 3600000 },
    payload: {
      kind: 'systemEvent',
      text: 'Run health check on /Users/shen/clawd workspace',
    },
    sessionTarget: 'main',
    enabled: true,
  },
];

const envMap: EnvMap = {
  '${WORKSPACE}': '/Users/shen/clawd',
  '${HOME}': '/Users/shen',
};

describe('cron', () => {
  it('exports cron jobs to JSON format', () => {
    const result = exportCronJobs(sampleJobs, envMap);

    expect(result.version).toBe(1);
    expect(result.exported).toBeTruthy();
    expect(result.jobs).toHaveLength(2);
    expect(result.jobs[0].id).toBe('job-001');
    expect(result.jobs[0].name).toBe('morning-brief');
    expect(result.jobs[1].id).toBe('job-002');
  });

  it('cron JSON schema is valid', () => {
    const exported = exportCronJobs(sampleJobs, envMap);
    const json = JSON.stringify(exported);
    const parsed = JSON.parse(json);

    expect(validateCronExport(parsed)).toBe(true);

    // Invalid schemas
    expect(validateCronExport(null)).toBe(false);
    expect(validateCronExport({})).toBe(false);
    expect(validateCronExport({ version: 2, exported: '', jobs: [] })).toBe(false);
    expect(validateCronExport({ version: 1, exported: '', jobs: [{ noId: true }] })).toBe(false);
  });

  it('path remapping applied to cron payloads', () => {
    const exported = exportCronJobs(sampleJobs, envMap);

    // Paths should be replaced with placeholders
    expect(exported.jobs[0].payload.message).toBe(
      'Check ${WORKSPACE}/memory for updates and send morning brief',
    );
    expect(exported.jobs[1].payload.text).toBe(
      'Run health check on ${WORKSPACE} workspace',
    );

    // Import with different paths
    const newEnvMap: EnvMap = {
      '${WORKSPACE}': '/home/newuser/agent',
      '${HOME}': '/home/newuser',
    };

    const imported = importCronJobs(exported, newEnvMap);

    expect(imported[0].payload.message).toBe(
      'Check /home/newuser/agent/memory for updates and send morning brief',
    );
    expect(imported[1].payload.text).toBe(
      'Run health check on /home/newuser/agent workspace',
    );
  });

  it('handles workspace with no cron jobs', () => {
    const result = exportCronJobs([], envMap);

    expect(result.version).toBe(1);
    expect(result.jobs).toHaveLength(0);
    expect(validateCronExport(result)).toBe(true);
  });
});

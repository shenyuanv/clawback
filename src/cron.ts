import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { applyRemap, unapplyRemap, type EnvMap } from './pathmap.js';

/**
 * Cron job definition — matches OpenClaw's cron job schema.
 */
export interface CronJob {
  id: string;
  name?: string;
  schedule: {
    kind: string;
    [key: string]: unknown;
  };
  payload: {
    kind: string;
    text?: string;
    message?: string;
    [key: string]: unknown;
  };
  sessionTarget?: string;
  enabled?: boolean;
  delivery?: Record<string, unknown>;
}

export interface CronExport {
  version: 1;
  exported: string;
  jobs: CronJob[];
}

/**
 * Export cron jobs to a JSON-serializable format.
 *
 * Applies path remapping to payload text/message fields so that
 * absolute paths become portable placeholders.
 */
export function exportCronJobs(
  jobs: CronJob[],
  envMap: EnvMap,
): CronExport {
  const remappedJobs = jobs.map((job) => ({
    ...job,
    payload: remapPayloadPaths(job.payload, envMap),
  }));

  return {
    version: 1,
    exported: new Date().toISOString(),
    jobs: remappedJobs,
  };
}

/**
 * Apply path remapping to cron job payload fields that may contain paths.
 */
function remapPayloadPaths(
  payload: CronJob['payload'],
  envMap: EnvMap,
): CronJob['payload'] {
  const result = { ...payload };

  if (typeof result.text === 'string') {
    result.text = applyRemap(result.text, envMap);
  }
  if (typeof result.message === 'string') {
    result.message = applyRemap(result.message, envMap);
  }

  return result;
}

/**
 * Prepare imported cron jobs by reversing path remapping.
 *
 * Takes the exported cron JSON and applies new environment paths
 * so jobs reference correct local paths on the target machine.
 */
export function importCronJobs(
  cronExport: CronExport,
  envMap: EnvMap,
): CronJob[] {
  return cronExport.jobs.map((job) => ({
    ...job,
    payload: unremapPayloadPaths(job.payload, envMap),
  }));
}

/**
 * Reverse path remapping on payload fields.
 */
function unremapPayloadPaths(
  payload: CronJob['payload'],
  envMap: EnvMap,
): CronJob['payload'] {
  const result = { ...payload };

  if (typeof result.text === 'string') {
    result.text = unapplyRemap(result.text, envMap);
  }
  if (typeof result.message === 'string') {
    result.message = unapplyRemap(result.message, envMap);
  }

  return result;
}

/**
 * Load cron jobs from an OpenClaw gateway config file.
 *
 * Reads gateway.yaml and extracts cron job definitions.
 * Returns empty array if no config found or no cron jobs defined.
 */
export function loadCronJobsFromConfig(workspace: string): CronJob[] {
  // Try common config locations
  const configPaths = [
    join(workspace, 'config', 'gateway.yaml'),
    join(workspace, '.openclaw', 'gateway.yaml'),
  ];

  for (const configPath of configPaths) {
    if (!existsSync(configPath)) continue;

    try {
      const content = readFileSync(configPath, 'utf-8');
      // Simple YAML cron extraction — look for cron job patterns
      // In practice, cron jobs are managed via the OpenClaw API, not config files
      // This is a fallback for static config-based jobs
      return parseCronJobsFromYaml(content);
    } catch {
      continue;
    }
  }

  return [];
}

/**
 * Parse cron jobs from YAML content.
 * This is a simplified parser — in production, use the OpenClaw API.
 */
function parseCronJobsFromYaml(_content: string): CronJob[] {
  // Cron jobs are typically managed via the OpenClaw cron API,
  // not embedded in YAML config. Return empty for file-based parsing.
  // The real export happens via the cron list API during backup.
  return [];
}

/**
 * Validate a CronExport object has the expected schema.
 */
export function validateCronExport(data: unknown): data is CronExport {
  if (!data || typeof data !== 'object') return false;

  const obj = data as Record<string, unknown>;

  if (obj.version !== 1) return false;
  if (typeof obj.exported !== 'string') return false;
  if (!Array.isArray(obj.jobs)) return false;

  for (const job of obj.jobs) {
    if (!job || typeof job !== 'object') return false;
    const j = job as Record<string, unknown>;
    if (typeof j.id !== 'string') return false;
    if (!j.schedule || typeof j.schedule !== 'object') return false;
    if (!j.payload || typeof j.payload !== 'object') return false;
  }

  return true;
}

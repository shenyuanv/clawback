import { createHash } from 'node:crypto';
import { createWriteStream, readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';
import { execSync } from 'node:child_process';
import * as tar from 'tar-stream';
import { createManifest, hashFile, type Manifest } from './manifest.js';
import { discoverWorkspace } from './discovery.js';
import { createEnvMap, generateEnvMapJson, applyRemap, type EnvMap } from './pathmap.js';
import {
  extractGatewayCredentials,
  detectCredentialFiles,
  buildCredentialManifest,
  buildCredentialVaultPayload,
  encryptCredentialVault,
  promptForPassword,
  resolveCredentialPathsInWorkspace,
  type CredentialManifest,
  type PromptProvider,
} from './credentials.js';

export interface BackupOptions {
  workspace?: string;
  output?: string;
  exclude?: string[];
  withCredentials?: boolean;
  includeData?: boolean;
  password?: string;
  includeCredential?: string[];
  prompt?: PromptProvider;
}

export interface BackupResult {
  outputPath: string;
  manifest: Manifest;
  fileCount: number;
  totalBytes: number;
}

/**
 * Generate a default output filename: <agent-name>-<YYYY-MM-DD>.clawback
 */
function defaultOutputName(agentName: string): string {
  const date = new Date().toISOString().slice(0, 10);
  const safeName = agentName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return `${safeName}-${date}.clawback`;
}

/**
 * Generate a human-readable README for inclusion in the archive.
 */
function generateReadme(manifest: Manifest): string {
  return `# Clawback Backup

Agent: ${manifest.agent.name}
Created: ${manifest.created}
Source: ${manifest.source.os} ${manifest.source.arch} (${manifest.source.hostname})

## Contents

- Agent files: ${manifest.contents.agent_files}
- Config files: ${manifest.contents.config_files}
- Custom skills: ${manifest.contents.custom_skills}
- Scripts: ${manifest.contents.scripts}
- Credentials: ${manifest.contents.credentials ? 'yes (encrypted)' : 'no'}
- Total size: ${manifest.contents.total_bytes} bytes

## How to Restore

\`\`\`bash
npm install -g clawback
clawback restore ${defaultOutputName(manifest.agent.name)} --workspace ~/agent
\`\`\`

## Integrity

This archive includes SHA-256 checksums for every file in manifest.json.
Run \`clawback verify <file>\` to validate integrity.
`;
}

/**
 * Create a .clawback backup archive from a workspace.
 *
 * The archive is a tar.gz containing:
 * - manifest.json at root
 * - README.md at root
 * - All workspace files organized by category (agent/, config/, skills/, scripts/)
 */
export async function createBackup(options: BackupOptions): Promise<BackupResult> {
  // 1. Discover workspace
  const workspace = discoverWorkspace({ workspace: options.workspace });
  if (!workspace) {
    throw new Error(
      options.workspace
        ? `Workspace not found at: ${options.workspace}`
        : 'No OpenClaw workspace found. Use --workspace to specify the path.',
    );
  }

  // 2. Create manifest
  const manifest = createManifest({
    workspace,
    exclude: options.exclude,
  });

  // 3. Determine output path
  const outputPath = options.output ?? defaultOutputName(manifest.agent.name);

  // 4. Pack archive
  const pack = tar.pack();

  // Add env-map.json for cross-machine path remapping
  const envMap = createEnvMap(workspace);
  const envMapJson = generateEnvMapJson(envMap);
  pack.entry({ name: 'config/env-map.json' }, envMapJson);

  // Try to export gateway config (via CLI or file), then sanitize credentials
  const gatewayConfig = exportGatewayConfig(workspace, envMap);
  const gatewayExtraction = gatewayConfig
    ? extractGatewayCredentials(gatewayConfig)
    : null;
  const sanitizedGatewayConfig = gatewayExtraction?.sanitizedConfig ?? gatewayConfig ?? null;

  if (sanitizedGatewayConfig) {
    pack.entry({ name: 'config/gateway.yaml' }, sanitizedGatewayConfig);
  }

  // Try to export cron jobs (via CLI)
  const cronJobsJson = exportCronJobs(envMap);
  if (cronJobsJson) {
    pack.entry({ name: 'config/cron-jobs.json' }, cronJobsJson);
  }

  // Detect credential files to exclude from plaintext archive
  if ((options.includeCredential?.length ?? 0) > 0 && !options.withCredentials) {
    throw new Error('--include-credential requires --with-credentials');
  }
  const credentialFiles = detectCredentialFiles(
    workspace,
    options.includeCredential ?? [],
  );
  const credentialRelPaths = new Set(
    resolveCredentialPathsInWorkspace(workspace, credentialFiles),
  );

  // Override gateway config content in manifest entries if present
  const overrideContent = new Map<string, Buffer>();
  if (sanitizedGatewayConfig) {
    const gatewayCandidates = new Set([
      'config/gateway.yaml',
      'config/gateway.yml',
      'gateway.yaml',
      'gateway.yml',
    ]);
    for (const entry of manifest.files) {
      if (gatewayCandidates.has(entry.path)) {
        overrideContent.set(entry.path, Buffer.from(sanitizedGatewayConfig, 'utf-8'));
      }
    }
  }

  // Remove credential files from manifest so they're never stored plaintext
  if (credentialRelPaths.size > 0) {
    manifest.files = manifest.files.filter((file) => !credentialRelPaths.has(file.path));
  }

  // Recompute manifest checksums and sizes after overrides/removals
  manifest.checksums = {};
  for (const fileEntry of manifest.files) {
    const override = overrideContent.get(fileEntry.path);
    if (override) {
      fileEntry.size = override.length;
      manifest.checksums[fileEntry.path] =
        'sha256:' + createHash('sha256').update(override).digest('hex');
    } else {
      const fullPath = join(workspace, fileEntry.path);
      fileEntry.size = statSync(fullPath).size;
      manifest.checksums[fileEntry.path] = hashFile(fullPath);
    }
  }
  const agentFiles = manifest.files.filter((f) => f.category === 'agent');
  const configFiles = manifest.files.filter((f) => f.category === 'config');
  const skillFiles = manifest.files.filter((f) => f.category === 'skill');
  const scriptFiles = manifest.files.filter((f) => f.category === 'script');
  const manifestTotalBytes = manifest.files.reduce((sum, f) => sum + f.size, 0);
  manifest.contents.agent_files = agentFiles.length;
  manifest.contents.config_files = configFiles.length;
  manifest.contents.custom_skills = skillFiles.length;
  manifest.contents.scripts = scriptFiles.length;
  manifest.contents.total_bytes = manifestTotalBytes;

  // Encrypt credentials into vault if requested
  let credentialManifest: CredentialManifest | null = null;
  if (options.withCredentials) {
    const gatewayCredentials = gatewayExtraction?.credentials ?? [];
    credentialManifest = buildCredentialManifest(gatewayCredentials, credentialFiles);

    let password = options.password;
    if (!password) {
      password = await promptForPassword(
        'Enter password to encrypt credentials: ',
        true,
        options.prompt,
      );
    }

    const vaultPayload = buildCredentialVaultPayload(gatewayCredentials, credentialFiles);
    const encryptedVault = await encryptCredentialVault(vaultPayload, password);

    pack.entry({ name: 'credentials-manifest.json' }, JSON.stringify(credentialManifest, null, 2));
    pack.entry({ name: 'credentials.age', size: encryptedVault.length }, encryptedVault);
    manifest.contents.credentials = true;
  } else {
    manifest.contents.credentials = false;
  }

  // Add manifest.json (after credential processing)
  const manifestJson = JSON.stringify(manifest, null, 2);
  pack.entry({ name: 'manifest.json' }, manifestJson);

  // Add README.md (after manifest finalized)
  const readme = generateReadme(manifest);
  pack.entry({ name: 'README.md' }, readme);

  // Add all workspace files under their category prefix
  let fileCount = 0;
  let totalBytes = 0;

  for (const fileEntry of manifest.files) {
    const fullPath = join(workspace, fileEntry.path);
    const override = overrideContent.get(fileEntry.path);
    const content = override ?? readFileSync(fullPath);
    const stat = statSync(fullPath);

    // Use category as archive prefix: agent/SOUL.md, config/gateway.yaml, etc.
    // Files already under their category dirs keep their paths.
    // Root-level agent files go under agent/
    const archivePath = getArchivePath(fileEntry.path, fileEntry.category);

    pack.entry(
      {
        name: archivePath,
        size: content.length,
        mtime: stat.mtime,
        mode: stat.mode,
      },
      content,
    );

    fileCount++;
    totalBytes += content.length;
  }

  pack.finalize();

  // 5. Pipe through gzip and write to file
  const gzip = createGzip({ level: 9 });
  const output = createWriteStream(outputPath);

  await pipeline(pack, gzip, output);

  return {
    outputPath,
    manifest,
    fileCount,
    totalBytes,
  };
}

/**
 * Try to export gateway config via OpenClaw CLI or by reading config file.
 * Returns the config content with paths remapped, or null if unavailable.
 */
export function exportGatewayConfig(workspace: string, envMap: EnvMap): string | null {
  // Try OpenClaw CLI first
  try {
    const config = execSync('openclaw gateway config get', {
      encoding: 'utf-8',
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    if (config.trim()) {
      return applyRemap(config, envMap);
    }
  } catch {
    // CLI not available or failed, try file-based fallback
  }

  // Try common gateway config file locations
  const configPaths = [
    join(workspace, 'gateway.yaml'),
    join(workspace, 'config', 'gateway.yaml'),
    join(workspace, '.openclaw', 'gateway.yaml'),
  ];

  for (const configPath of configPaths) {
    if (existsSync(configPath)) {
      try {
        const content = readFileSync(configPath, 'utf-8');
        return applyRemap(content, envMap);
      } catch {
        continue;
      }
    }
  }

  return null;
}

/**
 * Try to export cron jobs via OpenClaw CLI.
 * Returns JSON string of cron jobs with paths remapped, or null if unavailable.
 */
export function exportCronJobs(envMap: EnvMap): string | null {
  try {
    const output = execSync('openclaw cron list --format json', {
      encoding: 'utf-8',
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    if (output.trim()) {
      // Parse and remap paths in the cron job payloads
      const jobs = JSON.parse(output);
      const remappedJobs = remapCronJobPaths(jobs, envMap);
      return JSON.stringify(
        {
          version: 1,
          exported: new Date().toISOString(),
          jobs: remappedJobs,
        },
        null,
        2,
      );
    }
  } catch {
    // CLI not available or failed
  }

  return null;
}

/**
 * Apply path remapping to cron job payload fields.
 */
function remapCronJobPaths(jobs: unknown[], envMap: EnvMap): unknown[] {
  return jobs.map((job) => {
    if (!job || typeof job !== 'object') return job;
    const j = job as Record<string, unknown>;

    if (j.payload && typeof j.payload === 'object') {
      const payload = j.payload as Record<string, unknown>;
      if (typeof payload.text === 'string') {
        payload.text = applyRemap(payload.text, envMap);
      }
      if (typeof payload.message === 'string') {
        payload.message = applyRemap(payload.message, envMap);
      }
    }

    return job;
  });
}

/**
 * Map a workspace-relative path to its archive path.
 *
 * Files are organized in the archive by category:
 * - agent/SOUL.md, agent/MEMORY.md, agent/memory/2026-02-10.md
 * - config/gateway.yaml
 * - skills/custom-skill/SKILL.md
 * - scripts/hello.sh
 *
 * Files already under their category directory keep their path.
 * Root-level agent files get the agent/ prefix added.
 */
export function getArchivePath(relPath: string, category: string): string {
  const parts = relPath.split('/');
  const topDir = parts.length > 1 ? parts[0] : null;

  // Already under the correct category directory
  if (topDir === category) return relPath;
  if (topDir === 'memory') return `agent/${relPath}`;
  if (topDir === 'config') return relPath;
  if (topDir === 'skills') return relPath;
  if (topDir === 'scripts') return relPath;

  // Root-level files: prefix with category
  return `${category}/${relPath}`;
}

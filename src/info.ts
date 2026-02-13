import { createHash } from 'node:crypto';
import { createReadStream, statSync } from 'node:fs';
import { createGunzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import * as tar from 'tar-stream';
import type { Manifest } from './manifest.js';

export interface InfoResult {
  manifest: Manifest;
  fileSizeBytes: number;
  archiveChecksum: string;
}

/**
 * Read a .saddlebag archive and return its manifest + archive-level metadata.
 */
export async function getArchiveInfo(archivePath: string): Promise<InfoResult> {
  // Get archive file size and checksum
  const stat = statSync(archivePath);
  const fileSizeBytes = stat.size;

  const fileHash = createHash('sha256');
  const fileStream = createReadStream(archivePath);
  for await (const chunk of fileStream) {
    fileHash.update(chunk);
  }
  const archiveChecksum = `sha256:${fileHash.digest('hex')}`;

  // Extract manifest from archive
  const extract = tar.extract();
  let manifest: Manifest | null = null;

  const done = new Promise<void>((resolve, reject) => {
    extract.on('entry', (header, stream, next) => {
      if (header.name === 'manifest.json') {
        const chunks: Buffer[] = [];
        stream.on('data', (chunk: Buffer) => chunks.push(chunk));
        stream.on('end', () => {
          try {
            manifest = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
          } catch {
            // will be caught below
          }
          next();
        });
      } else {
        stream.on('end', next);
        stream.resume();
      }
      stream.on('error', reject);
    });
    extract.on('finish', resolve);
    extract.on('error', reject);
  });

  await pipeline(createReadStream(archivePath), createGunzip(), extract);
  await done;

  if (!manifest) {
    throw new Error('Archive does not contain a valid manifest.json');
  }

  return {
    manifest,
    fileSizeBytes,
    archiveChecksum,
  };
}

/**
 * Format info result as a human-readable string.
 */
export function formatInfo(info: InfoResult): string {
  const m = info.manifest;
  const lines: string[] = [];

  lines.push(`Agent: ${m.agent.name}`);
  lines.push(`Created: ${formatDate(m.created)}`);
  lines.push(`Source: ${m.source.os} ${m.source.arch} (${m.source.hostname})`);
  lines.push(`Size: ${formatBytes(info.fileSizeBytes)} (${formatBytes(m.contents.total_bytes)} uncompressed)`);

  const totalFiles =
    m.contents.agent_files +
    m.contents.config_files +
    m.contents.custom_skills +
    m.contents.scripts;
  lines.push(
    `Files: ${totalFiles} (${m.contents.agent_files} agent, ${m.contents.config_files} config, ${m.contents.custom_skills} skills, ${m.contents.scripts} scripts)`,
  );

  lines.push(`Credentials: ${m.contents.credentials ? 'yes (encrypted)' : 'no'}`);
  lines.push(`Checksum: ${info.archiveChecksum}`);

  return lines.join('\n');
}

function formatDate(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  let ago: string;
  if (diffMins < 1) {
    ago = 'just now';
  } else if (diffMins < 60) {
    ago = `${diffMins} minute${diffMins === 1 ? '' : 's'} ago`;
  } else if (diffHours < 24) {
    ago = `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
  } else {
    ago = `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;
  }

  const dateStr = date.toISOString().replace('T', ' ').slice(0, 16);
  return `${dateStr} (${ago})`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

import { createHash } from 'node:crypto';
import { createReadStream, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createGunzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import * as tar from 'tar-stream';
import { getArchivePath } from './backup.js';
import { createManifest, hashFile, type Manifest } from './manifest.js';

export type DiffStatus = 'added' | 'modified' | 'deleted' | 'unchanged';

export interface DiffEntry {
  path: string;
  status: DiffStatus;
  linesAdded?: number;
  linesRemoved?: number;
}

export interface DiffResult {
  entries: DiffEntry[];
}

export interface DiffOptions {
  workspace?: string;
}

/**
 * Extract the manifest and file contents from a .clawback archive.
 * Returns the manifest and a map of workspace-relative path → content buffer.
 */
async function extractArchiveContents(
  archivePath: string,
): Promise<{ manifest: Manifest; contents: Map<string, Buffer> }> {
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

  const manifestBuf = entries.get('manifest.json');
  if (!manifestBuf) {
    throw new Error('Archive does not contain manifest.json');
  }

  const manifest: Manifest = JSON.parse(manifestBuf.toString('utf-8'));

  // Map archive entry paths back to workspace-relative paths using the manifest
  const contents = new Map<string, Buffer>();
  for (const fileEntry of manifest.files) {
    const archiveEntryPath = getArchivePath(fileEntry.path, fileEntry.category);
    const content = entries.get(archiveEntryPath);
    if (content) {
      contents.set(fileEntry.path, content);
    }
  }

  return { manifest, contents };
}

/**
 * Count lines in a string.
 */
function countLines(content: string): number {
  if (content.length === 0) return 0;
  // Count newlines; a trailing newline doesn't add an extra "line"
  const lines = content.split('\n');
  return lines[lines.length - 1] === '' ? lines.length - 1 : lines.length;
}

/**
 * Compare a .clawback archive against a live workspace.
 *
 * - ADDED: file exists in workspace but not in archive
 * - MODIFIED: file exists in both but content differs
 * - DELETED: file exists in archive but not in workspace
 * - UNCHANGED: file exists in both with identical content
 */
export async function diffArchiveVsWorkspace(
  archivePath: string,
  workspacePath: string,
): Promise<DiffResult> {
  const { manifest: archiveManifest, contents: archiveContents } =
    await extractArchiveContents(archivePath);

  // Scan the live workspace
  const liveManifest = createManifest({ workspace: workspacePath });

  const archiveFiles = new Map(
    archiveManifest.files.map((f) => [f.path, f]),
  );
  const liveFiles = new Map(
    liveManifest.files.map((f) => [f.path, f]),
  );

  const entries: DiffEntry[] = [];

  // Check all archive files against live
  for (const [path, archiveFile] of archiveFiles) {
    const liveFile = liveFiles.get(path);

    if (!liveFile) {
      // In archive but not in live workspace = DELETED
      entries.push({ path, status: 'deleted' });
    } else {
      // Compare checksums
      const archiveChecksum = archiveManifest.checksums[path];
      const liveChecksum = liveManifest.checksums[path];

      if (archiveChecksum === liveChecksum) {
        entries.push({ path, status: 'unchanged' });
      } else {
        // Modified — compute line diff
        const archiveContent = archiveContents.get(path);
        const liveContent = readFileSync(join(workspacePath, path));

        const oldLines = countLines(archiveContent?.toString('utf-8') ?? '');
        const newLines = countLines(liveContent.toString('utf-8'));

        entries.push({
          path,
          status: 'modified',
          linesAdded: Math.max(0, newLines - oldLines),
          linesRemoved: Math.max(0, oldLines - newLines),
        });
      }
    }
  }

  // Check for files only in live workspace = ADDED
  for (const [path] of liveFiles) {
    if (!archiveFiles.has(path)) {
      entries.push({ path, status: 'added' });
    }
  }

  // Sort by path for deterministic output
  entries.sort((a, b) => a.path.localeCompare(b.path));

  return { entries };
}

/**
 * Compare two .clawback archives.
 *
 * Uses archive A as the baseline, archive B as the comparison:
 * - ADDED: file in B but not A
 * - MODIFIED: file in both but content differs
 * - DELETED: file in A but not B
 * - UNCHANGED: file in both with identical content
 */
export async function diffArchiveVsArchive(
  archivePathA: string,
  archivePathB: string,
): Promise<DiffResult> {
  const { manifest: manifestA, contents: contentsA } =
    await extractArchiveContents(archivePathA);
  const { manifest: manifestB, contents: contentsB } =
    await extractArchiveContents(archivePathB);

  const filesA = new Map(manifestA.files.map((f) => [f.path, f]));
  const filesB = new Map(manifestB.files.map((f) => [f.path, f]));

  const entries: DiffEntry[] = [];

  // Check all files in A against B
  for (const [path] of filesA) {
    const inB = filesB.has(path);

    if (!inB) {
      entries.push({ path, status: 'deleted' });
    } else {
      const checksumA = manifestA.checksums[path];
      const checksumB = manifestB.checksums[path];

      if (checksumA === checksumB) {
        entries.push({ path, status: 'unchanged' });
      } else {
        const contentA = contentsA.get(path);
        const contentB = contentsB.get(path);

        const oldLines = countLines(contentA?.toString('utf-8') ?? '');
        const newLines = countLines(contentB?.toString('utf-8') ?? '');

        entries.push({
          path,
          status: 'modified',
          linesAdded: Math.max(0, newLines - oldLines),
          linesRemoved: Math.max(0, oldLines - newLines),
        });
      }
    }
  }

  // Files only in B = ADDED
  for (const [path] of filesB) {
    if (!filesA.has(path)) {
      entries.push({ path, status: 'added' });
    }
  }

  entries.sort((a, b) => a.path.localeCompare(b.path));

  return { entries };
}

/**
 * Format diff results for human-readable output.
 */
export function formatDiff(result: DiffResult): string {
  const lines: string[] = [];

  const added = result.entries.filter((e) => e.status === 'added');
  const modified = result.entries.filter((e) => e.status === 'modified');
  const deleted = result.entries.filter((e) => e.status === 'deleted');
  const unchanged = result.entries.filter((e) => e.status === 'unchanged');

  for (const entry of added) {
    lines.push(`  ADDED     ${entry.path}`);
  }
  for (const entry of modified) {
    const lineInfo =
      entry.linesAdded !== undefined || entry.linesRemoved !== undefined
        ? ` (+${entry.linesAdded ?? 0} lines, -${entry.linesRemoved ?? 0} lines)`
        : '';
    lines.push(`  MODIFIED  ${entry.path}${lineInfo}`);
  }
  for (const entry of deleted) {
    lines.push(`  DELETED   ${entry.path}`);
  }
  if (unchanged.length > 0) {
    const names = unchanged.map((e) => e.path);
    if (names.length <= 3) {
      lines.push(`  UNCHANGED ${names.join(', ')}`);
    } else {
      lines.push(
        `  UNCHANGED ${names.slice(0, 2).join(', ')} (${names.length} files)`,
      );
    }
  }

  return lines.join('\n');
}

import { createHash } from 'node:crypto';
import {
  existsSync,
  chmodSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join, dirname, basename, resolve } from 'node:path';
import { createReadStream } from 'node:fs';
import { createGunzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import * as tar from 'tar-stream';
import { getArchivePath } from './backup.js';
import { applyRemap, unapplyRemap, type EnvMap } from './pathmap.js';
import type { Manifest } from './manifest.js';
import {
  decryptCredentialVault,
  restoreCredentialFiles,
  injectGatewayCredentials,
  findGatewayCredentialTargets,
  formatProviderName,
  promptForPassword,
  promptForSecret,
  type PromptProvider,
  type CredentialVaultPayload,
} from './credentials.js';

/** Files that may contain hardcoded paths needing remapping */
const PATH_REMAP_FILES = new Set([
  'TOOLS.md',
  'config/gateway.yaml',
  'HEARTBEAT.md',
  'AGENTS.md',
]);

/** Identity-critical files that warrant warnings */
const IDENTITY_FILES = new Set(['SOUL.md', 'AGENTS.md']);

const PROTECTED_FILES = [
  'SOUL.md',
  'IDENTITY.md',
  'MEMORY.md',
  'AGENTS.md',
  'USER.md',
  'HEARTBEAT.md',
  'TOOLS.md',
];

const RESTORE_MARKER = '.saddlebag-restored';
const FIXUP_SCRIPT = 'restore-fixup.sh';

function buildFixupScript(archivePath: string, protectedFiles: string[]): string {
  const archiveDefault = resolve(archivePath);
  const filesList = protectedFiles.map((file) => `  "${file}"`).join('\n');
  return `#!/usr/bin/env bash
set -euo pipefail

WORKSPACE_DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
ARCHIVE_PATH="\${1:-${archiveDefault}}"
ORIGINALS_DIR="\${WORKSPACE_DIR}/.saddlebag-originals"
PROTECTED_FILES=(
${filesList}
)

if [ ! -f "$ARCHIVE_PATH" ]; then
  echo "Archive not found: $ARCHIVE_PATH"
  echo "Pass the archive path as the first argument."
  exit 1
fi

mkdir -p "$ORIGINALS_DIR"

restored=()

for file in "\${PROTECTED_FILES[@]}"; do
  if [ -e "\${WORKSPACE_DIR}/\${file}" ]; then
    mkdir -p "\${ORIGINALS_DIR}/$(dirname "\${file}")"
    cp -a "\${WORKSPACE_DIR}/\${file}" "\${ORIGINALS_DIR}/\${file}"
  fi
  if tar -tzf "$ARCHIVE_PATH" "agent/\${file}" >/dev/null 2>&1; then
    tar -xzf "$ARCHIVE_PATH" -C "$WORKSPACE_DIR" --strip-components=1 "agent/\${file}"
    restored+=("\${file}")
  fi
done

if [ \${#restored[@]} -eq 0 ]; then
  echo "No protected files restored."
else
  echo "Restored protected files:"
  for file in "\${restored[@]}"; do
    echo "  - \${file}"
  done
fi

echo "Originals backed up to: \${ORIGINALS_DIR}"
`;
}

function writeRestoreArtifacts(
  targetDir: string,
  archivePath: string,
  fileCount: number,
): void {
  const markerPath = join(targetDir, RESTORE_MARKER);
  const marker = {
    restoredAt: new Date().toISOString(),
    archivePath: basename(archivePath),
    fileCount,
    protectedFiles: PROTECTED_FILES,
  };
  writeFileSync(markerPath, JSON.stringify(marker, null, 2) + '\n');

  const fixupPath = join(targetDir, FIXUP_SCRIPT);
  writeFileSync(fixupPath, buildFixupScript(archivePath, PROTECTED_FILES));
  chmodSync(fixupPath, 0o755);
}

export interface RestoreOptions {
  workspace?: string;
  dryRun?: boolean;
  force?: boolean;
  skipCredentials?: boolean;
  password?: string;
  prompt?: PromptProvider;
}

export interface RestoredFile {
  path: string;
  remapped: boolean;
}

export interface RestoreResult {
  targetDir: string;
  restoredFiles: RestoredFile[];
  identityWarnings: string[];
  missingDeps: string[];
  dryRun: boolean;
}

/**
 * Restore a .saddlebag archive to a target directory.
 *
 * Flow: verify archive -> extract entries -> remap paths -> write files -> report
 *
 * Safety: --workspace is required. Never defaults to cwd or the original workspace.
 */
export async function restoreBackup(
  archivePath: string,
  options: RestoreOptions,
): Promise<RestoreResult> {
  // 1. Require --workspace
  if (!options.workspace) {
    throw new Error(
      'The --workspace flag is required for restore. Specify a target directory.',
    );
  }

  const targetDir = options.workspace;

  // 2. Extract all archive entries into memory
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

  // 3. Read and validate manifest
  const manifestBuf = entries.get('manifest.json');
  if (!manifestBuf) {
    throw new Error('Archive does not contain manifest.json');
  }

  const manifest: Manifest = JSON.parse(manifestBuf.toString('utf-8'));

  // 4. Verify archive integrity
  for (const fileEntry of manifest.files) {
    const archiveEntryPath = getArchivePath(fileEntry.path, fileEntry.category);
    const content = entries.get(archiveEntryPath);
    const expectedChecksum = manifest.checksums[fileEntry.path];

    if (!content) {
      throw new Error(`Archive integrity check failed: missing file ${fileEntry.path}`);
    }

    const actualChecksum =
      'sha256:' + createHash('sha256').update(content).digest('hex');
    if (actualChecksum !== expectedChecksum) {
      throw new Error(
        `Archive integrity check failed: checksum mismatch for ${fileEntry.path}`,
      );
    }
  }

  // 5. Load env-map for path remapping
  const envMapBuf = entries.get('config/env-map.json');
  let oldEnvMap: EnvMap = {};
  if (envMapBuf) {
    oldEnvMap = JSON.parse(envMapBuf.toString('utf-8'));
  }

  // Build new env-map for target environment
  const newEnvMap: EnvMap = {};
  if (oldEnvMap['${WORKSPACE}']) {
    newEnvMap['${WORKSPACE}'] = targetDir;
  }
  if (oldEnvMap['${HOME}']) {
    newEnvMap['${HOME}'] = process.env.HOME ?? process.env.USERPROFILE ?? '';
  }

  // 6. Check for identity file changes (SOUL.md, AGENTS.md)
  const identityWarnings: string[] = [];
  for (const idFile of IDENTITY_FILES) {
    const targetPath = join(targetDir, idFile);
    if (existsSync(targetPath)) {
      const fileEntry = manifest.files.find((f) => f.path === idFile);
      if (fileEntry) {
        const archiveEntryPath = getArchivePath(fileEntry.path, fileEntry.category);
        const archiveContent = entries.get(archiveEntryPath);
        const existingContent = readFileSync(targetPath);
        if (archiveContent && !archiveContent.equals(existingContent)) {
          identityWarnings.push(
            `${idFile} will be overwritten (contents differ from existing file)`,
          );
        }
      }
    }
  }

  // 7. Extract files to target directory
  const restoredFiles: RestoredFile[] = [];

  if (!options.dryRun) {
    // Create target directory if needed
    mkdirSync(targetDir, { recursive: true });
  }

  for (const fileEntry of manifest.files) {
    const archiveEntryPath = getArchivePath(fileEntry.path, fileEntry.category);
    const content = entries.get(archiveEntryPath)!;
    const targetPath = join(targetDir, fileEntry.path);

    // Determine if this file needs path remapping
    let finalContent = content;
    let remapped = false;

    if (PATH_REMAP_FILES.has(fileEntry.path) && Object.keys(oldEnvMap).length > 0) {
      const textContent = content.toString('utf-8');
      // Replace old paths with placeholders, then placeholders with new paths
      const withPlaceholders = applyRemap(textContent, oldEnvMap);
      const withNewPaths = unapplyRemap(withPlaceholders, newEnvMap);

      if (withNewPaths !== textContent) {
        finalContent = Buffer.from(withNewPaths, 'utf-8');
        remapped = true;
      }
    }

    if (!options.dryRun) {
      // Ensure parent directory exists
      mkdirSync(dirname(targetPath), { recursive: true });
      writeFileSync(targetPath, finalContent);
    }

    restoredFiles.push({ path: fileEntry.path, remapped });
  }

  // 7.5 Handle credentials vault if present
  if (!options.dryRun && !options.skipCredentials) {
    const vaultEntry = entries.get('credentials.age');
    if (vaultEntry) {
      let password = options.password;
      if (!password) {
        password = await promptForPassword(
          'Enter password to decrypt credentials: ',
          false,
          options.prompt,
        );
      }

      const vault = (await decryptCredentialVault(
        vaultEntry,
        password,
      )) as CredentialVaultPayload;

      // Restore file-based credentials
      restoreCredentialFiles(vault.files, oldEnvMap, newEnvMap);

      // Apply gateway credentials to config
      const gatewayPath = join(targetDir, 'config', 'gateway.yaml');
      if (existsSync(gatewayPath) && vault.gateway.length > 0) {
        const current = readFileSync(gatewayPath, 'utf-8');
        const updated = injectGatewayCredentials(
          current,
          vault.gateway.map((cred) => ({ keyPath: cred.keyPath, value: cred.value })),
        );
        writeFileSync(gatewayPath, updated);
      }
    } else {
      // No vault: prompt for essential provider key only
      const gatewayPath = join(targetDir, 'config', 'gateway.yaml');
      if (existsSync(gatewayPath)) {
        const current = readFileSync(gatewayPath, 'utf-8');
        const targets = findGatewayCredentialTargets(current);
        if (targets.length > 0) {
          const providerName = formatProviderName(targets[0].provider);
          const key = await promptForSecret(
            `Enter your ${providerName} API key (or press Enter to skip): `,
            options.prompt,
          );
          if (key.trim()) {
            const updated = injectGatewayCredentials(current, [
              { keyPath: targets[0].keyPath, value: key.trim() },
            ]);
            writeFileSync(gatewayPath, updated);
          }
        }
      }
    }
  }

  // 8. Check for missing dependencies by scanning TOOLS.md
  const missingDeps: string[] = [];
  const toolsEntry = manifest.files.find((f) => f.path === 'TOOLS.md');
  if (toolsEntry) {
    const archiveEntryPath = getArchivePath(toolsEntry.path, toolsEntry.category);
    const toolsContent = entries.get(archiveEntryPath)!.toString('utf-8');
    // Parse tool entries like "- toolname: /path/to/binary"
    const toolLines = toolsContent.match(/^-\s+(\w+):\s+(.+)$/gm);
    if (toolLines) {
      for (const line of toolLines) {
        const match = line.match(/^-\s+(\w+):\s+(.+)$/);
        if (match) {
          const toolName = match[1];
          let toolPath = match[2].trim();
          // If we remapped paths, check the new path
          if (Object.keys(newEnvMap).length > 0) {
            const withPlaceholders = applyRemap(toolPath, oldEnvMap);
            toolPath = unapplyRemap(withPlaceholders, newEnvMap);
          }
          if (!existsSync(toolPath)) {
            missingDeps.push(toolName);
          }
        }
      }
    }
  }

  if (!options.dryRun) {
    writeRestoreArtifacts(targetDir, archivePath, restoredFiles.length);
  }

  return {
    targetDir,
    restoredFiles,
    identityWarnings,
    missingDeps,
    dryRun: options.dryRun ?? false,
  };
}

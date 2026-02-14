import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, lstatSync, existsSync } from 'node:fs';
import { join, relative, basename, extname, resolve } from 'node:path';
import { hostname } from 'node:os';

/** Known agent files at the workspace root */
const AGENT_ROOT_FILES = new Set([
  'SOUL.md',
  'AGENTS.md',
  'IDENTITY.md',
  'USER.md',
  'MEMORY.md',
  'HEARTBEAT.md',
  'CHECKLIST.md',
  'TOOLS.md',
  '本我.md',
]);

/** Directories whose contents are categorized as agent files */
const AGENT_DIRS = new Set(['memory']);

/** Directories mapped to specific categories */
const CATEGORY_DIRS: Record<string, FileCategory> = {
  config: 'config',
  skills: 'skill',
  scripts: 'script',
};

/** Known agent directories that are scanned by default (allowlist) */
const KNOWN_AGENT_DIRS = new Set([...AGENT_DIRS, ...Object.keys(CATEGORY_DIRS)]);

/** Directory/file names always excluded (smart denylist) */
const DEFAULT_EXCLUDE_NAMES = new Set([
  'node_modules',
  '.git',
  '.DS_Store',
  '.venv',
  '__pycache__',
  '.cache',
  'dist',
  'tmp',
]);

/** File extensions always excluded */
const DEFAULT_EXCLUDE_EXTENSIONS = ['.clawback', '.log'];

export type FileCategory = 'agent' | 'config' | 'skill' | 'script';

export interface ManifestFileEntry {
  path: string;
  category: FileCategory;
  size: number;
}

export interface Manifest {
  clawback_version: string;
  created: string;
  agent: {
    name: string;
    soul_hash: string;
  };
  source: {
    hostname: string;
    os: string;
    arch: string;
    workspace: string;
  };
  contents: {
    agent_files: number;
    config_files: number;
    custom_skills: number;
    scripts: number;
    credentials: boolean;
    total_bytes: number;
  };
  checksums: Record<string, string>;
  files: ManifestFileEntry[];
}

export interface CreateManifestOptions {
  workspace: string;
  exclude?: string[];
  include?: string[];
}

export function createManifest(options: CreateManifestOptions): Manifest {
  const { workspace, exclude = [], include = [] } = options;

  // Validate included directories
  const resolvedWorkspace = resolve(workspace);
  for (const dir of include) {
    const fullPath = join(workspace, dir);
    const resolved = resolve(fullPath);

    // Check if it's within the workspace first (before checking existence)
    if (!resolved.startsWith(resolvedWorkspace + '/') && resolved !== resolvedWorkspace) {
      throw new Error(`Included directory is outside workspace: ${dir}`);
    }

    if (!existsSync(fullPath)) {
      throw new Error(`Included directory does not exist: ${dir}`);
    }
    const stat = statSync(fullPath);
    if (!stat.isDirectory()) {
      throw new Error(`Included path is not a directory: ${dir}`);
    }
  }

  // Allowlist approach: scan known directories + explicitly included directories
  const files: ManifestFileEntry[] = [];

  let items: ReturnType<typeof readdirSync>;
  try {
    items = readdirSync(workspace, { withFileTypes: true });
  } catch {
    items = [];
  }

  // Scan workspace root for agent files
  for (const item of items) {
    const fullPath = join(workspace, item.name);
    const relPath = item.name;

    if (isDefaultExcluded(item.name)) continue;
    if (matchesExcludePattern(relPath, item.name, exclude)) continue;

    // Skip symlinks to prevent including files outside workspace
    if (item.isSymbolicLink()) continue;

    if (item.isFile()) {
      // Include root-level files
      const stat = statSync(fullPath);
      files.push({
        path: relPath,
        category: categorizeFile(relPath),
        size: stat.size,
      });
    } else if (item.isDirectory()) {
      // Only recurse into known agent directories or explicitly included directories
      if (KNOWN_AGENT_DIRS.has(item.name) || include.includes(item.name)) {
        files.push(...walkDirectory(fullPath, resolvedWorkspace, exclude));
      }
    }
  }

  // Process explicitly included directories (that may not be in workspace root)
  for (const dir of include) {
    const fullPath = join(workspace, dir);
    const alreadyIncluded = files.some((f) => f.path === dir || f.path.startsWith(dir + '/'));
    if (!alreadyIncluded) {
      // This directory wasn't scanned yet, so walk it now
      files.push(...walkDirectory(fullPath, resolvedWorkspace, exclude));
    }
  }

  const checksums: Record<string, string> = {};
  for (const file of files) {
    checksums[file.path] = hashFile(join(workspace, file.path));
  }

  const agentName = extractAgentName(workspace);
  const soulPath = join(workspace, 'SOUL.md');
  const soulHash = existsSync(soulPath) ? hashFile(soulPath) : '';

  const agentFiles = files.filter((f) => f.category === 'agent');
  const configFiles = files.filter((f) => f.category === 'config');
  const skillFiles = files.filter((f) => f.category === 'skill');
  const scriptFiles = files.filter((f) => f.category === 'script');
  const totalBytes = files.reduce((sum, f) => sum + f.size, 0);

  return {
    clawback_version: '1.0',
    created: new Date().toISOString(),
    agent: {
      name: agentName,
      soul_hash: soulHash,
    },
    source: {
      hostname: hostname(),
      os: process.platform,
      arch: process.arch,
      workspace,
    },
    contents: {
      agent_files: agentFiles.length,
      config_files: configFiles.length,
      custom_skills: skillFiles.length,
      scripts: scriptFiles.length,
      credentials: false,
      total_bytes: totalBytes,
    },
    checksums,
    files,
  };
}

function walkDirectory(
  dir: string,
  rootDir: string,
  excludePatterns: string[],
): ManifestFileEntry[] {
  const entries: ManifestFileEntry[] = [];

  let items: ReturnType<typeof readdirSync>;
  try {
    items = readdirSync(dir, { withFileTypes: true });
  } catch {
    return entries;
  }

  // Sort for deterministic output
  items.sort((a, b) => a.name.localeCompare(b.name));

  for (const item of items) {
    const fullPath = join(dir, item.name);
    const relPath = relative(rootDir, fullPath);

    if (isDefaultExcluded(item.name)) continue;
    if (matchesExcludePattern(relPath, item.name, excludePatterns)) continue;

    // Skip symlinks to prevent including files outside workspace
    if (item.isSymbolicLink()) continue;

    // Verify resolved path stays within workspace
    const resolvedPath = resolve(fullPath);
    if (!resolvedPath.startsWith(rootDir + '/') && resolvedPath !== rootDir) continue;

    if (item.isDirectory()) {
      entries.push(...walkDirectory(fullPath, rootDir, excludePatterns));
    } else if (item.isFile()) {
      const stat = statSync(fullPath);
      entries.push({
        path: relPath,
        category: categorizeFile(relPath),
        size: stat.size,
      });
    }
  }

  return entries;
}

function isDefaultExcluded(name: string): boolean {
  if (DEFAULT_EXCLUDE_NAMES.has(name)) return true;
  if (DEFAULT_EXCLUDE_EXTENSIONS.some((ext) => name.endsWith(ext))) return true;
  return false;
}

function matchesExcludePattern(
  relPath: string,
  name: string,
  patterns: string[],
): boolean {
  for (const pattern of patterns) {
    if (pattern.startsWith('*.')) {
      // Extension glob: *.log, *.tmp
      const ext = pattern.slice(1);
      if (name.endsWith(ext)) return true;
    } else if (pattern.endsWith('/')) {
      // Directory pattern: memory/, scripts/
      const dirName = pattern.slice(0, -1);
      if (relPath === dirName || relPath.startsWith(dirName + '/')) return true;
    } else {
      // Exact match on basename or full relative path
      if (name === pattern || relPath === pattern) return true;
      // Also treat as directory prefix
      if (relPath.startsWith(pattern + '/')) return true;
    }
  }
  return false;
}

export function categorizeFile(relPath: string): FileCategory {
  const parts = relPath.split('/');
  const fileName = parts[parts.length - 1];
  const topDir = parts.length > 1 ? parts[0] : null;

  // Files under category directories
  if (topDir && topDir in CATEGORY_DIRS) {
    return CATEGORY_DIRS[topDir];
  }

  // Files under agent directories (memory/)
  if (topDir && AGENT_DIRS.has(topDir)) {
    return 'agent';
  }

  // Known agent root files
  if (parts.length === 1 && AGENT_ROOT_FILES.has(fileName)) {
    return 'agent';
  }

  // Root-level config files
  if (parts.length === 1) {
    const ext = extname(fileName);
    if (ext === '.yaml' || ext === '.yml') {
      return 'config';
    }
    if (fileName === 'cron-jobs.json' || fileName === 'env-map.json') {
      return 'config';
    }
  }

  // Default: agent (catch-all for other .md files, etc.)
  return 'agent';
}

export function hashFile(filePath: string): string {
  const content = readFileSync(filePath);
  const hash = createHash('sha256').update(content).digest('hex');
  return `sha256:${hash}`;
}

function extractAgentName(workspace: string): string {
  const identityPath = join(workspace, 'IDENTITY.md');
  if (existsSync(identityPath)) {
    const content = readFileSync(identityPath, 'utf-8');
    // Try various Name field patterns:
    // - "Name: Cowboy" (plain)
    // - "**Name:** Cowboy" (bold)
    // - "- **Name:** Cowboy" (list item with bold)
    // - "- Name: Cowboy" (list item plain)
    // Pattern breakdown:
    //   ^[-\s]*       - optional leading dashes/whitespace (list markers)
    //   \*{0,2}       - optional 0-2 asterisks (bold open)
    //   Name          - literal "Name"
    //   \*{0,2}       - optional 0-2 asterisks (bold close)
    //   :             - colon
    //   \*{0,2}       - optional asterisks after colon (for **Name:**)
    //   \s*           - whitespace
    //   (.+)          - capture the name value
    const nameMatch = content.match(/^[-\s]*\*{0,2}Name\*{0,2}:\*{0,2}\s*(.+)$/im);
    if (nameMatch) {
      return nameMatch[1].trim();
    }
  }

  const soulPath = join(workspace, 'SOUL.md');
  if (existsSync(soulPath)) {
    const content = readFileSync(soulPath, 'utf-8');
    const headingMatch = content.match(/^#\s+(.+)$/m);
    if (headingMatch) {
      return headingMatch[1].trim();
    }
  }

  return basename(workspace);
}

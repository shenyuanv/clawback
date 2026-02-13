import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const WORKSPACE_MARKERS = ['SOUL.md', 'AGENTS.md'];

/**
 * Discover an OpenClaw workspace by looking for marker files.
 *
 * Search order:
 * 1. Explicit override path (--workspace flag)
 * 2. Current working directory
 * 3. Common locations (~/.openclaw, ~/clawd)
 *
 * Returns the absolute path to the workspace root, or null if not found.
 */
export function discoverWorkspace(options?: {
  workspace?: string;
  cwd?: string;
}): string | null {
  // 1. Explicit override
  if (options?.workspace) {
    const absPath = resolve(options.workspace);
    if (hasMarkers(absPath)) {
      return absPath;
    }
    // Even if no markers found, trust the explicit path if it exists
    if (existsSync(absPath)) {
      return absPath;
    }
    return null;
  }

  // 2. Current working directory
  const cwd = options?.cwd ?? process.cwd();
  if (hasMarkers(cwd)) {
    return cwd;
  }

  // 3. Walk up parent directories from cwd
  let dir = cwd;
  while (true) {
    const parent = resolve(dir, '..');
    if (parent === dir) break; // reached filesystem root
    if (hasMarkers(parent)) {
      return parent;
    }
    dir = parent;
  }

  // 4. Common locations
  const home = process.env.HOME ?? process.env.USERPROFILE ?? '';
  const commonPaths = [
    join(home, '.openclaw'),
    join(home, 'clawd'),
    join(home, 'openclaw'),
  ];

  for (const candidate of commonPaths) {
    if (hasMarkers(candidate)) {
      return candidate;
    }
  }

  return null;
}

function hasMarkers(dir: string): boolean {
  return WORKSPACE_MARKERS.some((marker) => existsSync(join(dir, marker)));
}

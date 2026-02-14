import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Environment variable map: placeholder → absolute path value.
 * e.g. { "${HOME}": "/home/user", "${WORKSPACE}": "/home/user/workspace" }
 */
export interface EnvMap {
  [placeholder: string]: string;
}

/**
 * Files to scan for hardcoded path references.
 * These are the files most likely to contain absolute paths.
 */
const FILES_TO_SCAN = [
  'TOOLS.md',
  'config/gateway.yaml',
  'HEARTBEAT.md',
  'AGENTS.md',
];

/**
 * Create the environment map for a workspace.
 *
 * Auto-detects HOME and WORKSPACE paths. These are the two most
 * common hardcoded paths in agent workspaces.
 */
export function createEnvMap(workspace: string, homeDir?: string): EnvMap {
  const home = homeDir ?? process.env.HOME ?? process.env.USERPROFILE ?? '';
  const envMap: EnvMap = {};

  // Add WORKSPACE first (more specific), then HOME (more general)
  if (workspace) {
    envMap['${WORKSPACE}'] = workspace;
  }
  if (home) {
    envMap['${HOME}'] = home;
  }

  return envMap;
}

/**
 * Detect which env map paths appear in the given content.
 * Returns the list of placeholder keys whose values were found.
 */
export function detectPathsInContent(
  content: string,
  envMap: EnvMap,
): string[] {
  const found: string[] = [];
  for (const [placeholder, value] of Object.entries(envMap)) {
    if (value && content.includes(value)) {
      found.push(placeholder);
    }
  }
  return found;
}

/**
 * Scan workspace files for hardcoded path references.
 *
 * Returns a map of relative file path → list of detected placeholder keys.
 * Only includes files that contain at least one path reference.
 */
export function scanWorkspaceForPaths(
  workspace: string,
  envMap: EnvMap,
): Record<string, string[]> {
  const results: Record<string, string[]> = {};

  for (const relPath of FILES_TO_SCAN) {
    const fullPath = join(workspace, relPath);
    if (!existsSync(fullPath)) continue;

    const content = readFileSync(fullPath, 'utf-8');
    const detected = detectPathsInContent(content, envMap);
    if (detected.length > 0) {
      results[relPath] = detected;
    }
  }

  return results;
}

/**
 * Apply path remapping: replace actual path values with placeholders.
 *
 * Sorts by longest value first to prevent partial matches.
 * e.g. "/home/user/workspace" is replaced before "/home/user"
 */
export function applyRemap(content: string, envMap: EnvMap): string {
  if (Object.keys(envMap).length === 0) return content;

  // Sort entries by value length descending (longest first)
  const sorted = Object.entries(envMap).sort(
    (a, b) => b[1].length - a[1].length,
  );

  let result = content;
  for (const [placeholder, value] of sorted) {
    if (value) {
      result = result.replaceAll(value, placeholder);
    }
  }
  return result;
}

/**
 * Reverse path remapping: replace placeholders with actual path values.
 * Used during restore to substitute new environment paths.
 */
export function unapplyRemap(content: string, envMap: EnvMap): string {
  let result = content;
  for (const [placeholder, value] of Object.entries(envMap)) {
    if (value) {
      result = result.replaceAll(placeholder, value);
    }
  }
  return result;
}

/**
 * Generate the env-map.json content for inclusion in a backup archive.
 */
export function generateEnvMapJson(envMap: EnvMap): string {
  return JSON.stringify(envMap, null, 2);
}

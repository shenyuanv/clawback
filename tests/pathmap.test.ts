import { describe, it, expect, afterEach } from 'vitest';
import {
  createEnvMap,
  detectPathsInContent,
  scanWorkspaceForPaths,
  applyRemap,
  unapplyRemap,
} from '../src/pathmap.js';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  existsSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const tempDirs: string[] = [];

afterEach(() => {
  for (const d of tempDirs) {
    try {
      if (existsSync(d)) rmSync(d, { recursive: true });
    } catch {
      /* ignore */
    }
  }
  tempDirs.length = 0;
});

/** Helper: create a temp workspace with given files */
function createTempWorkspace(
  files: Record<string, string>,
): string {
  const dir = mkdtempSync(join(tmpdir(), 'saddlebag-pathmap-'));
  tempDirs.push(dir);

  for (const [relPath, content] of Object.entries(files)) {
    const fullPath = join(dir, relPath);
    const parentDir = fullPath.substring(0, fullPath.lastIndexOf('/'));
    mkdirSync(parentDir, { recursive: true });
    writeFileSync(fullPath, content);
  }

  return dir;
}

describe('pathmap', () => {
  it('detects home directory in TOOLS.md', () => {
    const homeDir = '/Users/testuser';
    const workspace = '/Users/testuser/clawd';

    const tmpWorkspace = createTempWorkspace({
      'SOUL.md': '# Agent\n',
      'TOOLS.md': `# Tools\n\n- python: ${homeDir}/.local/bin/python3\n- node: /usr/local/bin/node\n`,
    });

    const envMap = createEnvMap(workspace, homeDir);
    const detected = scanWorkspaceForPaths(tmpWorkspace, envMap);

    // TOOLS.md should have the home directory detected
    expect(detected['TOOLS.md']).toBeDefined();
    expect(detected['TOOLS.md']).toContain('${HOME}');
  });

  it('detects workspace path in gateway config', () => {
    const homeDir = '/Users/testuser';
    const workspace = '/Users/testuser/clawd';

    const tmpWorkspace = createTempWorkspace({
      'SOUL.md': '# Agent\n',
      'config/gateway.yaml': `name: test-gateway\nhost: localhost\nport: 8080\nworkspace: ${workspace}\n`,
    });

    const envMap = createEnvMap(workspace, homeDir);
    const detected = scanWorkspaceForPaths(tmpWorkspace, envMap);

    // gateway config should have the workspace path detected
    expect(detected['config/gateway.yaml']).toBeDefined();
    expect(detected['config/gateway.yaml']).toContain('${WORKSPACE}');
  });

  it('generates correct env-map.json with placeholders', () => {
    const homeDir = '/Users/testuser';
    const workspace = '/Users/testuser/clawd';

    const envMap = createEnvMap(workspace, homeDir);

    // Should contain both WORKSPACE and HOME
    expect(envMap['${WORKSPACE}']).toBe(workspace);
    expect(envMap['${HOME}']).toBe(homeDir);

    // Should be valid JSON
    const json = JSON.stringify(envMap);
    const parsed = JSON.parse(json);
    expect(parsed['${WORKSPACE}']).toBe(workspace);
    expect(parsed['${HOME}']).toBe(homeDir);
  });

  it('apply remap correctly substitutes paths in file content', () => {
    const envMap = {
      '${WORKSPACE}': '/Users/testuser/clawd',
      '${HOME}': '/Users/testuser',
    };

    const content = 'workspace: /Users/testuser/clawd\nbin: /usr/local/bin/node\n';
    const remapped = applyRemap(content, envMap);

    // Workspace path should be replaced with placeholder
    expect(remapped).toContain('workspace: ${WORKSPACE}');
    // Non-matching paths should be untouched
    expect(remapped).toContain('bin: /usr/local/bin/node');
    // No raw workspace path remaining
    expect(remapped).not.toContain('/Users/testuser/clawd');

    // Reverse should restore the original
    const restored = unapplyRemap(remapped, envMap);
    expect(restored).toBe(content);
  });

  it('handles files with no paths (no-op)', () => {
    const envMap = {
      '${WORKSPACE}': '/Users/testuser/clawd',
      '${HOME}': '/Users/testuser',
    };

    const content = '# Simple file\n\nNo absolute paths here.\nJust text.\n';
    const remapped = applyRemap(content, envMap);

    // Content should be unchanged
    expect(remapped).toBe(content);

    // detectPathsInContent should return empty array
    const detected = detectPathsInContent(content, envMap);
    expect(detected).toEqual([]);
  });

  it('handles multiple paths in same file', () => {
    const envMap = {
      '${WORKSPACE}': '/Users/testuser/clawd',
      '${HOME}': '/Users/testuser',
    };

    const content = [
      '# Config',
      'workspace: /Users/testuser/clawd',
      'scripts: /Users/testuser/clawd/scripts',
      'python: /Users/testuser/.local/bin/python3',
      'home: /Users/testuser',
    ].join('\n');

    // Should detect both HOME and WORKSPACE
    const detected = detectPathsInContent(content, envMap);
    expect(detected).toContain('${WORKSPACE}');
    expect(detected).toContain('${HOME}');

    // Apply remap should replace all occurrences
    const remapped = applyRemap(content, envMap);

    // WORKSPACE paths (longer) should be replaced first
    expect(remapped).toContain('workspace: ${WORKSPACE}');
    expect(remapped).toContain('scripts: ${WORKSPACE}/scripts');
    // HOME path should be replaced where it doesn't overlap with WORKSPACE
    expect(remapped).toContain('python: ${HOME}/.local/bin/python3');
    expect(remapped).toContain('home: ${HOME}');
    // No raw paths should remain
    expect(remapped).not.toContain('/Users/testuser');
  });
});

import { describe, it, expect } from 'vitest';
import { createManifest, hashFile, categorizeFile } from '../src/manifest.js';
import { createHash } from 'node:crypto';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';

const FIXTURES = resolve(import.meta.dirname, 'fixtures');
const MOCK_WORKSPACE = resolve(FIXTURES, 'mock-workspace');

describe('manifest', () => {
  it('scans mock workspace, finds all expected files', () => {
    const manifest = createManifest({ workspace: MOCK_WORKSPACE });

    const paths = manifest.files.map((f) => f.path).sort();

    // All expected files in the mock workspace
    expect(paths).toContain('SOUL.md');
    expect(paths).toContain('AGENTS.md');
    expect(paths).toContain('IDENTITY.md');
    expect(paths).toContain('MEMORY.md');
    expect(paths).toContain('本我.md');
    expect(paths).toContain('memory/2026-02-10.md');
    expect(paths).toContain('memory/2026-02-11.md');
    expect(paths).toContain('config/gateway.yaml');
    expect(paths).toContain('scripts/hello.sh');
    expect(paths).toContain('skills/custom-skill/SKILL.md');
  });

  it('categorizes SOUL.md as "agent", gateway.yaml as "config"', () => {
    const manifest = createManifest({ workspace: MOCK_WORKSPACE });

    const soulFile = manifest.files.find((f) => f.path === 'SOUL.md');
    expect(soulFile).toBeDefined();
    expect(soulFile!.category).toBe('agent');

    const gatewayFile = manifest.files.find(
      (f) => f.path === 'config/gateway.yaml',
    );
    expect(gatewayFile).toBeDefined();
    expect(gatewayFile!.category).toBe('config');

    const skillFile = manifest.files.find(
      (f) => f.path === 'skills/custom-skill/SKILL.md',
    );
    expect(skillFile).toBeDefined();
    expect(skillFile!.category).toBe('skill');

    const scriptFile = manifest.files.find(
      (f) => f.path === 'scripts/hello.sh',
    );
    expect(scriptFile).toBeDefined();
    expect(scriptFile!.category).toBe('script');

    const memoryFile = manifest.files.find(
      (f) => f.path === 'memory/2026-02-10.md',
    );
    expect(memoryFile).toBeDefined();
    expect(memoryFile!.category).toBe('agent');

    // Also test the exported categorizeFile function directly
    expect(categorizeFile('SOUL.md')).toBe('agent');
    expect(categorizeFile('config/gateway.yaml')).toBe('config');
    expect(categorizeFile('skills/custom-skill/SKILL.md')).toBe('skill');
    expect(categorizeFile('scripts/hello.sh')).toBe('script');
  });

  it('SHA-256 checksums are correct (verify against known hash)', () => {
    const manifest = createManifest({ workspace: MOCK_WORKSPACE });

    // Independently compute the hash of SOUL.md
    const soulContent = readFileSync(join(MOCK_WORKSPACE, 'SOUL.md'));
    const expectedHash =
      'sha256:' + createHash('sha256').update(soulContent).digest('hex');

    expect(manifest.checksums['SOUL.md']).toBe(expectedHash);

    // Verify hashFile utility matches
    expect(hashFile(join(MOCK_WORKSPACE, 'SOUL.md'))).toBe(expectedHash);

    // Verify all checksums are sha256-prefixed hex strings
    for (const [path, checksum] of Object.entries(manifest.checksums)) {
      expect(checksum).toMatch(/^sha256:[0-9a-f]{64}$/);
    }
  });

  it('excludes node_modules and .git', () => {
    // Create a temp workspace with node_modules/ and .git/
    const tmpWorkspace = mkdtempSync(join(tmpdir(), 'saddlebag-test-excl-'));
    writeFileSync(join(tmpWorkspace, 'SOUL.md'), '# Test Soul\n');
    mkdirSync(join(tmpWorkspace, 'node_modules', 'some-pkg'), {
      recursive: true,
    });
    writeFileSync(
      join(tmpWorkspace, 'node_modules', 'some-pkg', 'index.js'),
      'module.exports = {};\n',
    );
    mkdirSync(join(tmpWorkspace, '.git', 'objects'), { recursive: true });
    writeFileSync(join(tmpWorkspace, '.git', 'config'), '[core]\n');

    const manifest = createManifest({ workspace: tmpWorkspace });
    const paths = manifest.files.map((f) => f.path);

    expect(paths).toContain('SOUL.md');
    expect(paths).not.toContain('node_modules/some-pkg/index.js');
    expect(paths).not.toContain('.git/config');
    expect(paths).not.toContain('.git/objects');

    // Also verify .saddlebag files are excluded
    writeFileSync(join(tmpWorkspace, 'test.saddlebag'), 'archive data');
    const manifest2 = createManifest({ workspace: tmpWorkspace });
    const paths2 = manifest2.files.map((f) => f.path);
    expect(paths2).not.toContain('test.saddlebag');
  });

  it('--exclude pattern removes matching files', () => {
    const manifest = createManifest({
      workspace: MOCK_WORKSPACE,
      exclude: ['scripts/'],
    });
    const paths = manifest.files.map((f) => f.path);

    // scripts/ should be excluded
    expect(paths).not.toContain('scripts/hello.sh');
    // Other files should still be present
    expect(paths).toContain('SOUL.md');
    expect(paths).toContain('config/gateway.yaml');

    // Test excluding by extension
    const manifest2 = createManifest({
      workspace: MOCK_WORKSPACE,
      exclude: ['*.sh'],
    });
    const paths2 = manifest2.files.map((f) => f.path);
    expect(paths2).not.toContain('scripts/hello.sh');
    expect(paths2).toContain('SOUL.md');

    // Test excluding a specific file
    const manifest3 = createManifest({
      workspace: MOCK_WORKSPACE,
      exclude: ['IDENTITY.md'],
    });
    const paths3 = manifest3.files.map((f) => f.path);
    expect(paths3).not.toContain('IDENTITY.md');
    expect(paths3).toContain('SOUL.md');
  });

  it('manifest JSON schema is valid (required fields present)', () => {
    const manifest = createManifest({ workspace: MOCK_WORKSPACE });

    // Required top-level fields
    expect(manifest.saddlebag_version).toBe('1.0');
    expect(manifest.created).toBeTruthy();
    expect(new Date(manifest.created).toISOString()).toBe(manifest.created);

    // Agent info
    expect(manifest.agent).toBeDefined();
    expect(manifest.agent.name).toBeTruthy();
    expect(manifest.agent.soul_hash).toMatch(/^sha256:[0-9a-f]{64}$/);

    // Source info
    expect(manifest.source).toBeDefined();
    expect(manifest.source.hostname).toBeTruthy();
    expect(manifest.source.os).toBeTruthy();
    expect(manifest.source.arch).toBeTruthy();
    expect(manifest.source.workspace).toBe(MOCK_WORKSPACE);

    // Contents counts
    expect(manifest.contents).toBeDefined();
    expect(typeof manifest.contents.agent_files).toBe('number');
    expect(typeof manifest.contents.config_files).toBe('number');
    expect(typeof manifest.contents.custom_skills).toBe('number');
    expect(typeof manifest.contents.scripts).toBe('number');
    expect(typeof manifest.contents.credentials).toBe('boolean');
    expect(typeof manifest.contents.total_bytes).toBe('number');
    expect(manifest.contents.total_bytes).toBeGreaterThan(0);

    // Checksums
    expect(manifest.checksums).toBeDefined();
    expect(Object.keys(manifest.checksums).length).toBe(manifest.files.length);
  });

  it('handles empty memory/ directory gracefully', () => {
    // Create a temp workspace with an empty memory/ dir
    const tmpWorkspace = mkdtempSync(join(tmpdir(), 'saddlebag-test-empty-'));
    writeFileSync(join(tmpWorkspace, 'SOUL.md'), '# Test Soul\n');
    mkdirSync(join(tmpWorkspace, 'memory'));

    const manifest = createManifest({ workspace: tmpWorkspace });

    expect(manifest.files.length).toBeGreaterThan(0);
    expect(manifest.files.map((f) => f.path)).toContain('SOUL.md');
    // No crash, no memory/ entries since it's empty
    const memoryFiles = manifest.files.filter((f) =>
      f.path.startsWith('memory/'),
    );
    expect(memoryFiles.length).toBe(0);
  });

  it('handles files with unicode names (Chinese filenames like 本我.md)', () => {
    const manifest = createManifest({ workspace: MOCK_WORKSPACE });
    const paths = manifest.files.map((f) => f.path);

    expect(paths).toContain('本我.md');

    // Verify it's categorized as agent
    const benwoFile = manifest.files.find((f) => f.path === '本我.md');
    expect(benwoFile).toBeDefined();
    expect(benwoFile!.category).toBe('agent');

    // Verify checksum exists and is valid
    expect(manifest.checksums['本我.md']).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});

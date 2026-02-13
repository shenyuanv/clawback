/**
 * P0.5 Test Gaps - Sanity checks discovered from live testing
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';
import { createManifest } from '../src/manifest.js';

describe('P0.5 sanity checks', () => {
  let tempDir: string;
  const cliEntry = join(process.cwd(), 'src', 'index.ts');
  const nodeCmd = `${process.execPath} --import tsx ${cliEntry}`;

  beforeAll(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'saddlebag-sanity-'));
  });

  afterAll(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  // T1: Backup size sanity check
  describe('T1: backup size sanity', () => {
    it('typical workspace backup should be under 5MB', async () => {
      const workspace = join(tempDir, 'typical-workspace');
      mkdirSync(workspace, { recursive: true });
      
      // Create typical agent files
      writeFileSync(join(workspace, 'SOUL.md'), '# Soul\nI am an agent.');
      writeFileSync(join(workspace, 'IDENTITY.md'), '# Identity\n- **Name:** TestAgent');
      writeFileSync(join(workspace, 'MEMORY.md'), '# Memory\nSome memories here.');
      writeFileSync(join(workspace, 'AGENTS.md'), '# Agents\nAgent instructions.');
      
      // Create memory directory with some files
      mkdirSync(join(workspace, 'memory'), { recursive: true });
      for (let i = 0; i < 10; i++) {
        writeFileSync(join(workspace, 'memory', `note-${i}.md`), `Note ${i}\n`.repeat(100));
      }
      
      // Create skills directory
      mkdirSync(join(workspace, 'skills', 'test-skill'), { recursive: true });
      writeFileSync(join(workspace, 'skills', 'test-skill', 'SKILL.md'), '# Test Skill');
      
      const archivePath = join(tempDir, 'typical.saddlebag');
      execSync(`${nodeCmd} backup --workspace "${workspace}" --output "${archivePath}"`, {
        cwd: join(process.cwd()),
        stdio: 'pipe',
      });
      
      const stat = statSync(archivePath);
      expect(stat.size).toBeLessThan(5 * 1024 * 1024); // < 5MB
    });
  });

  // T2: Agent name extraction from realistic markdown
  describe('T2: realistic name extraction', () => {
    it('extracts name from bold list item format', async () => {
      const workspace = join(tempDir, 'name-test-1');
      mkdirSync(workspace, { recursive: true });
      writeFileSync(join(workspace, 'SOUL.md'), '# Soul');
      writeFileSync(join(workspace, 'IDENTITY.md'), `# IDENTITY.md - Who Am I?

- **Name:** Cowboy
- **Creature:** AI assistant
- **Emoji:** 🤠

Some description here.
`);
      
      const manifest = createManifest({ workspace });
      expect(manifest.agent.name).toBe('Cowboy');
    });

    it('extracts name from plain colon format', async () => {
      const workspace = join(tempDir, 'name-test-2');
      mkdirSync(workspace, { recursive: true });
      writeFileSync(join(workspace, 'SOUL.md'), '# Soul');
      writeFileSync(join(workspace, 'IDENTITY.md'), `# My Identity

Name: SimpleAgent
Role: Assistant
`);
      
      const manifest = createManifest({ workspace });
      expect(manifest.agent.name).toBe('SimpleAgent');
    });

    it('falls back to SOUL.md heading when no Name field', async () => {
      const workspace = join(tempDir, 'name-test-3');
      mkdirSync(workspace, { recursive: true });
      writeFileSync(join(workspace, 'SOUL.md'), '# Phoenix Rising\n\nI am Phoenix.');
      writeFileSync(join(workspace, 'IDENTITY.md'), `# My Identity

No name field here, just description.
`);
      
      const manifest = createManifest({ workspace });
      expect(manifest.agent.name).toBe('Phoenix Rising');
    });

    it('falls back to workspace basename when no markers', async () => {
      const workspace = join(tempDir, 'my-agent-workspace');
      mkdirSync(workspace, { recursive: true });
      writeFileSync(join(workspace, 'SOUL.md'), 'Just text, no heading.');
      
      const manifest = createManifest({ workspace });
      expect(manifest.agent.name).toBe('my-agent-workspace');
    });
  });

  // T3: Manifest file count sanity check
  describe('T3: file count sanity', () => {
    it('manifest should warn/fail if >500 files', async () => {
      const workspace = join(tempDir, 'many-files');
      mkdirSync(workspace, { recursive: true });
      writeFileSync(join(workspace, 'SOUL.md'), '# Soul');
      
      // Only create files in known agent directories
      mkdirSync(join(workspace, 'memory'), { recursive: true });
      for (let i = 0; i < 50; i++) {
        writeFileSync(join(workspace, 'memory', `file-${i}.md`), `File ${i}`);
      }
      
      const manifest = createManifest({ workspace });
      const totalFiles = manifest.contents.agent_files + manifest.contents.config_files + 
                        manifest.contents.custom_skills + manifest.contents.scripts;
      
      // With whitelist approach, should stay well under 500
      expect(totalFiles).toBeLessThan(500);
    });
  });

  // T4: Round-trip with realistic workspace (decoy dirs)
  describe('T4: realistic workspace round-trip', () => {
    it('excludes decoy directories like projects/, data/, .git/', async () => {
      const workspace = join(tempDir, 'realistic-workspace');
      mkdirSync(workspace, { recursive: true });
      
      // Agent files (should be included)
      writeFileSync(join(workspace, 'SOUL.md'), '# Soul');
      writeFileSync(join(workspace, 'MEMORY.md'), '# Memory');
      mkdirSync(join(workspace, 'memory'), { recursive: true });
      writeFileSync(join(workspace, 'memory', '2026-01-01.md'), 'Daily note');
      
      // Decoy directories (should be excluded)
      mkdirSync(join(workspace, 'projects', 'big-project'), { recursive: true });
      writeFileSync(join(workspace, 'projects', 'big-project', 'huge.bin'), Buffer.alloc(1024 * 1024)); // 1MB
      
      mkdirSync(join(workspace, 'data', 'cache'), { recursive: true });
      writeFileSync(join(workspace, 'data', 'cache', 'data.json'), '{}');
      
      mkdirSync(join(workspace, '.git', 'objects'), { recursive: true });
      writeFileSync(join(workspace, '.git', 'config'), '[core]');
      
      mkdirSync(join(workspace, 'node_modules', 'some-pkg'), { recursive: true });
      writeFileSync(join(workspace, 'node_modules', 'some-pkg', 'index.js'), '// pkg');
      
      const manifest = createManifest({ workspace });
      const filePaths = manifest.files.map(f => f.path);
      
      // Should include agent files
      expect(filePaths).toContain('SOUL.md');
      expect(filePaths).toContain('MEMORY.md');
      expect(filePaths).toContain('memory/2026-01-01.md');
      
      // Should NOT include decoy files
      expect(filePaths).not.toContain('projects/big-project/huge.bin');
      expect(filePaths).not.toContain('data/cache/data.json');
      expect(filePaths).not.toContain('.git/config');
      expect(filePaths).not.toContain('node_modules/some-pkg/index.js');
    });
  });

  // T5: Backup → info → verify pipeline
  describe('T5: backup-info-verify pipeline', () => {
    it('creates archive that passes both info and verify', async () => {
      const workspace = join(tempDir, 'pipeline-test');
      mkdirSync(workspace, { recursive: true });
      writeFileSync(join(workspace, 'SOUL.md'), '# Test Soul\n\nI am a test agent.');
      writeFileSync(join(workspace, 'IDENTITY.md'), '# Identity\n- **Name:** PipelineBot');
      
      const archivePath = join(tempDir, 'pipeline.saddlebag');
      
      // Backup
      execSync(`${nodeCmd} backup --workspace "${workspace}" --output "${archivePath}"`, {
        cwd: process.cwd(),
        stdio: 'pipe',
      });
      expect(existsSync(archivePath)).toBe(true);
      
      // Info (should not throw)
      const infoOutput = execSync(`${nodeCmd} info "${archivePath}"`, {
        cwd: process.cwd(),
        encoding: 'utf-8',
      });
      expect(infoOutput).toContain('Agent: PipelineBot');
      
      // Verify (should pass)
      const verifyOutput = execSync(`${nodeCmd} verify "${archivePath}"`, {
        cwd: process.cwd(),
        encoding: 'utf-8',
      });
      expect(verifyOutput).toContain('valid');
    });
  });

  // T6: Known directory whitelist test
  describe('T6: whitelist exclusion', () => {
    it('only scans KNOWN_AGENT_DIRS, ignores unknown directories', async () => {
      const workspace = join(tempDir, 'whitelist-test');
      mkdirSync(workspace, { recursive: true });
      
      writeFileSync(join(workspace, 'SOUL.md'), '# Soul');
      
      // Known dirs (should scan)
      mkdirSync(join(workspace, 'memory'), { recursive: true });
      writeFileSync(join(workspace, 'memory', 'note.md'), 'Note');
      
      mkdirSync(join(workspace, 'skills', 'my-skill'), { recursive: true });
      writeFileSync(join(workspace, 'skills', 'my-skill', 'SKILL.md'), '# Skill');
      
      mkdirSync(join(workspace, 'scripts'), { recursive: true });
      writeFileSync(join(workspace, 'scripts', 'helper.sh'), '#!/bin/bash');
      
      // Unknown dirs (should NOT scan even if present)
      mkdirSync(join(workspace, 'unknown-dir'), { recursive: true });
      writeFileSync(join(workspace, 'unknown-dir', 'file.txt'), 'Should be excluded');
      
      mkdirSync(join(workspace, 'custom-data'), { recursive: true });
      writeFileSync(join(workspace, 'custom-data', 'data.json'), '{}');
      
      const manifest = createManifest({ workspace });
      const filePaths = manifest.files.map(f => f.path);
      
      // Known dirs included
      expect(filePaths).toContain('memory/note.md');
      expect(filePaths).toContain('skills/my-skill/SKILL.md');
      expect(filePaths).toContain('scripts/helper.sh');
      
      // Unknown dirs excluded
      expect(filePaths).not.toContain('unknown-dir/file.txt');
      expect(filePaths).not.toContain('custom-data/data.json');
    });
  });
});

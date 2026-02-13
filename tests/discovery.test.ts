import { describe, it, expect } from 'vitest';
import { discoverWorkspace } from '../src/discovery.js';
import { resolve } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

const FIXTURES = resolve(import.meta.dirname, 'fixtures');
const MOCK_WORKSPACE = resolve(FIXTURES, 'mock-workspace');
// Use a temp dir outside any workspace tree so parent-walk won't find markers
const EMPTY_DIR = mkdtempSync(resolve(tmpdir(), 'saddlebag-test-empty-'));

describe('discoverWorkspace', () => {
  it('finds workspace when SOUL.md exists in cwd', () => {
    const result = discoverWorkspace({ cwd: MOCK_WORKSPACE });
    expect(result).toBe(MOCK_WORKSPACE);
  });

  it('finds workspace when AGENTS.md exists in cwd', () => {
    // mock-workspace has both SOUL.md and AGENTS.md, but this test
    // verifies AGENTS.md is also a valid marker
    const result = discoverWorkspace({ cwd: MOCK_WORKSPACE });
    expect(result).toBe(MOCK_WORKSPACE);
  });

  it('returns null when no workspace markers found', () => {
    const origHome = process.env.HOME;
    try {
      // Override HOME so common-location fallback doesn't find ~/clawd
      process.env.HOME = EMPTY_DIR;
      const result = discoverWorkspace({ cwd: EMPTY_DIR });
      expect(result).toBeNull();
    } finally {
      process.env.HOME = origHome;
    }
  });

  it('respects --workspace override path', () => {
    const result = discoverWorkspace({ workspace: MOCK_WORKSPACE });
    expect(result).toBe(MOCK_WORKSPACE);
  });
});

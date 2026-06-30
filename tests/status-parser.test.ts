import { describe, expect, it } from 'vitest';
import { parseStatusJson } from '../src/electron/services/status-parser.js';

describe('status parser', () => {
  it('normalizes initialized status JSON', () => {
    const status = parseStatusJson(
      JSON.stringify({
        initialized: true,
        version: '1.1.5',
        projectPath: 'D:/repo',
        indexPath: 'D:/repo/.codegraph',
        lastIndexed: '2026-06-30T01:00:00.000Z',
        fileCount: 12,
        nodeCount: 34,
        edgeCount: 56,
        dbSizeBytes: 1024,
        languages: ['typescript'],
        nodesByKind: { function: 10 },
        pendingChanges: { added: 1, modified: 2, removed: 3 },
        index: { reindexRecommended: true },
      }),
      'fallback',
    );

    expect(status.initialized).toBe(true);
    expect(status.projectPath).toBe('D:/repo');
    expect(status.pendingChanges).toEqual({ added: 1, modified: 2, removed: 3 });
    expect(status.reindexRecommended).toBe(true);
  });

  it('fills defaults for uninitialized status JSON', () => {
    const status = parseStatusJson(JSON.stringify({ initialized: false, projectPath: 'D:/repo' }), 'fallback');

    expect(status.initialized).toBe(false);
    expect(status.fileCount).toBe(0);
    expect(status.languages).toEqual([]);
    expect(status.pendingChanges).toEqual({ added: 0, modified: 0, removed: 0 });
  });
});

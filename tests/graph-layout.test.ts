import { describe, expect, it } from 'vitest';
import { createGraphLayout } from '../src/shared/graph-layout.js';
import type { GraphSnapshot } from '../src/shared/types.js';

describe('graph layout', () => {
  it('keeps only edges with visible endpoints', () => {
    const snapshot: GraphSnapshot = {
      projectPath: 'D:/repo',
      totalNodes: 3,
      totalEdges: 2,
      limited: true,
      generatedAt: 1,
      nodes: [
        node('a', 5),
        node('b', 3),
      ],
      edges: [
        { id: '1', source: 'a', target: 'b', kind: 'calls', line: null },
        { id: '2', source: 'a', target: 'missing', kind: 'calls', line: null },
      ],
    };

    const layout = createGraphLayout(snapshot, 800, 600);

    expect(layout.nodes).toHaveLength(2);
    expect(layout.edges).toHaveLength(1);
    expect(layout.edges[0]?.source.id).toBe('a');
    expect(layout.edges[0]?.target.id).toBe('b');
  });
});

function node(id: string, degree: number) {
  return {
    id,
    kind: 'function',
    name: id,
    qualifiedName: id,
    filePath: `${id}.ts`,
    language: 'typescript',
    startLine: 1,
    endLine: 2,
    degree,
  };
}

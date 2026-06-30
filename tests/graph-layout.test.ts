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

  it('keeps high-degree nodes readable in a wider layout', () => {
    const nodes = Array.from({ length: 220 }, (_, index) => node(`node-${index}`, index === 0 ? 250 : 1 + (index % 15)));
    const snapshot: GraphSnapshot = {
      projectPath: 'D:/repo',
      totalNodes: nodes.length,
      totalEdges: nodes.length - 1,
      limited: false,
      generatedAt: 1,
      nodes,
      edges: nodes.slice(1).map((item, index) => ({
        id: String(index),
        source: 'node-0',
        target: item.id,
        kind: 'calls',
        line: null,
      })),
    };

    const layout = createGraphLayout(snapshot, 2200, 1500);
    const xs = layout.nodes.map((item) => item.x);
    const ys = layout.nodes.map((item) => item.y);

    expect(Math.max(...layout.nodes.map((item) => item.radius))).toBeLessThanOrEqual(11);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(1100);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(700);
  });

  it('places a focused node in the center of a focused layout', () => {
    const snapshot: GraphSnapshot = {
      projectPath: 'D:/repo',
      totalNodes: 3,
      totalEdges: 2,
      limited: false,
      generatedAt: 1,
      nodes: [node('center', 2), node('incoming', 1), node('outgoing', 1)],
      edges: [
        { id: '1', source: 'incoming', target: 'center', kind: 'calls', line: null },
        { id: '2', source: 'center', target: 'outgoing', kind: 'calls', line: null },
      ],
    };

    const layout = createGraphLayout(snapshot, 1000, 700, { focusNodeId: 'center' });
    const center = layout.nodes.find((item) => item.id === 'center');

    expect(center?.x).toBeCloseTo(500);
    expect(center?.y).toBeCloseTo(350);
    expect(layout.edges).toHaveLength(2);
    expect(layout.nodes.find((item) => item.id === 'incoming')?.x).toBeLessThan(center?.x ?? 0);
    expect(layout.nodes.find((item) => item.id === 'outgoing')?.x).toBeGreaterThan(center?.x ?? 0);
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

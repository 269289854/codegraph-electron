import type { GraphNode, GraphSnapshot } from './types.js';

export type LayoutNode = GraphNode & {
  x: number;
  y: number;
  radius: number;
};

export type LayoutEdge = {
  id: string;
  source: LayoutNode;
  target: LayoutNode;
  kind: string;
};

export type GraphLayout = {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  width: number;
  height: number;
};

const kindWeight: Record<string, number> = {
  file: 1.3,
  class: 1.2,
  interface: 1.2,
  struct: 1.2,
  method: 1.05,
  function: 1.05,
};

export function createGraphLayout(snapshot: GraphSnapshot, width: number, height: number): GraphLayout {
  const centerX = width / 2;
  const centerY = height / 2;
  const maxDegree = Math.max(1, ...snapshot.nodes.map((node) => node.degree));
  const sortedNodes = [...snapshot.nodes].sort((a, b) => b.degree - a.degree || a.name.localeCompare(b.name));
  const rings = Math.max(1, Math.ceil(Math.sqrt(sortedNodes.length) / 3));
  const minDimension = Math.min(width, height);
  const maxRadius = Math.max(160, minDimension * 0.43);

  const nodes = sortedNodes.map((node, index): LayoutNode => {
    const ringIndex = index % rings;
    const ring = ((ringIndex + 1) / rings) * maxRadius;
    const angle = goldenAngle(index);
    const normalizedDegree = node.degree / maxDegree;
    return {
      ...node,
      x: centerX + Math.cos(angle) * ring * (0.55 + normalizedDegree * 0.35),
      y: centerY + Math.sin(angle) * ring * (0.55 + normalizedDegree * 0.35),
      radius: 5 + Math.sqrt(Math.max(1, node.degree)) * 1.8 * (kindWeight[node.kind] ?? 1),
    };
  });

  const byId = new Map(nodes.map((node) => [node.id, node]));
  const edges = snapshot.edges
    .map((edge) => {
      const source = byId.get(edge.source);
      const target = byId.get(edge.target);
      return source && target ? { id: edge.id, source, target, kind: edge.kind } : null;
    })
    .filter((edge): edge is LayoutEdge => edge !== null);

  return { nodes, edges, width, height };
}

function goldenAngle(index: number): number {
  return index * Math.PI * (3 - Math.sqrt(5));
}

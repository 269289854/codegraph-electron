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
  const rings = Math.max(3, Math.ceil(Math.sqrt(sortedNodes.length) / 2.2));
  const maxRadiusX = Math.max(320, width * 0.45);
  const maxRadiusY = Math.max(240, height * 0.45);

  const nodes = sortedNodes.map((node, index): LayoutNode => {
    const ringIndex = index % rings;
    const ring = (ringIndex + 1) / rings;
    const angle = goldenAngle(index);
    const normalizedDegree = node.degree / maxDegree;
    const degreeRadius = 3.2 + Math.log2(Math.max(1, node.degree) + 1) * 1.15 * (kindWeight[node.kind] ?? 1);
    const degreeOffset = 0.7 + normalizedDegree * 0.24;
    return {
      ...node,
      x: centerX + Math.cos(angle) * ring * maxRadiusX * degreeOffset,
      y: centerY + Math.sin(angle) * ring * maxRadiusY * degreeOffset,
      radius: Math.max(4, Math.min(11, degreeRadius)),
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

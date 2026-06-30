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

export type GraphLayoutOptions = {
  focusNodeId?: string;
};

const kindWeight: Record<string, number> = {
  file: 1.3,
  class: 1.2,
  interface: 1.2,
  struct: 1.2,
  method: 1.05,
  function: 1.05,
};

export function createGraphLayout(snapshot: GraphSnapshot, width: number, height: number, options: GraphLayoutOptions = {}): GraphLayout {
  if (options.focusNodeId) {
    return createFocusedGraphLayout(snapshot, width, height, options.focusNodeId);
  }

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

function createFocusedGraphLayout(snapshot: GraphSnapshot, width: number, height: number, focusNodeId: string): GraphLayout {
  const centerX = width / 2;
  const centerY = height / 2;
  const focusNode = snapshot.nodes.find((node) => node.id === focusNodeId) ?? snapshot.nodes[0];
  if (!focusNode) return { nodes: [], edges: [], width, height };

  const connectedIds = new Set<string>();
  const incomingIds = new Set<string>();
  const outgoingIds = new Set<string>();
  for (const edge of snapshot.edges) {
    if (edge.source === focusNode.id) {
      connectedIds.add(edge.target);
      outgoingIds.add(edge.target);
    }
    if (edge.target === focusNode.id) {
      connectedIds.add(edge.source);
      incomingIds.add(edge.source);
    }
  }

  const neighborNodes = snapshot.nodes
    .filter((node) => node.id !== focusNode.id)
    .sort((a, b) => {
      const aConnected = connectedIds.has(a.id) ? 1 : 0;
      const bConnected = connectedIds.has(b.id) ? 1 : 0;
      return bConnected - aConnected || b.degree - a.degree || a.name.localeCompare(b.name);
    });
  const maxRingRadiusX = Math.max(260, width * 0.36);
  const maxRingRadiusY = Math.max(210, height * 0.34);
  const nodes: LayoutNode[] = [
    {
      ...focusNode,
      x: centerX,
      y: centerY,
      radius: 14,
    },
  ];

  neighborNodes.forEach((node, index) => {
    const angle = focusedAngle(node.id, incomingIds, outgoingIds, index);
    const ring = 0.72 + (index % 3) * 0.14;
    const degreeRadius = 3.2 + Math.log2(Math.max(1, node.degree) + 1) * 0.95 * (kindWeight[node.kind] ?? 1);
    nodes.push({
      ...node,
      x: centerX + Math.cos(angle) * maxRingRadiusX * ring,
      y: centerY + Math.sin(angle) * maxRingRadiusY * ring,
      radius: Math.max(4, Math.min(9, degreeRadius)),
    });
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

function focusedAngle(
  nodeId: string,
  incomingIds: Set<string>,
  outgoingIds: Set<string>,
  index: number,
): number {
  if (outgoingIds.has(nodeId) && !incomingIds.has(nodeId)) {
    return -Math.PI / 5 + (index % 18) * (Math.PI / 28);
  }
  if (incomingIds.has(nodeId) && !outgoingIds.has(nodeId)) {
    return Math.PI - Math.PI / 5 + (index % 18) * (Math.PI / 28);
  }
  return goldenAngle(index);
}

function goldenAngle(index: number): number {
  return index * Math.PI * (3 - Math.sqrt(5));
}

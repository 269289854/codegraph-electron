import fs from 'node:fs';
import path from 'node:path';
import initSqlJs, { type Database, type SqlValue } from 'sql.js';
import type { GraphEdge, GraphSnapshot, GraphSnapshotOptions } from '../../shared/types.js';

type NodeRow = {
  id: string;
  kind: string;
  name: string;
  qualified_name: string;
  file_path: string;
  language: string;
  start_line: number;
  end_line: number;
  degree: number;
};

type EdgeRow = {
  rowid: number;
  source: string;
  target: string;
  kind: string;
  line: number | null;
};

export async function readGraphSnapshot(projectPath: string, options: GraphSnapshotOptions): Promise<GraphSnapshot> {
  const dbPath = path.join(projectPath, '.codegraph', 'codegraph.db');
  const SQL = await initSqlJs();
  const db = new SQL.Database(fs.readFileSync(dbPath));
  try {
    const totalNodes = scalar(db, 'SELECT COUNT(*) AS count FROM nodes');
    const totalEdges = scalar(db, 'SELECT COUNT(*) AS count FROM edges');
    const snapshot = options.mode === 'node' && options.focusNodeId
      ? selectFocusedGraph(db, options)
      : selectGlobalGraph(db, options);

    return buildSnapshot({
      projectPath,
      totalNodes,
      totalEdges,
      rows: snapshot.rows,
      edges: snapshot.edges,
      limited: snapshot.limited,
    });
  } finally {
    db.close();
  }
}

function selectGlobalGraph(db: Database, options: GraphSnapshotOptions): { rows: NodeRow[]; edges: GraphEdge[]; limited: boolean } {
  const totalNodes = scalar(db, 'SELECT COUNT(*) AS count FROM nodes');
  const rows = selectNodes(db, options);
  const nodeIds = rows.map((row) => row.id);
  const edges = selectEdges(db, nodeIds, options.edgeKinds);
  return {
    rows,
    edges,
    limited: rows.length < totalNodes,
  };
}

function selectFocusedGraph(db: Database, options: GraphSnapshotOptions): { rows: NodeRow[]; edges: GraphEdge[]; limited: boolean } {
  const focusNode = selectNodeById(db, options.focusNodeId ?? '');
  if (!focusNode) {
    throw new Error(`未找到聚焦节点：${options.focusNodeId ?? ''}`);
  }

  const maxNodes = Math.max(2, Math.min(options.maxNodes || 300, 1000));
  const focusDirection = options.focusDirection ?? 'both';
  const focusEdges = selectFocusEdges(db, focusNode.id, options.edgeKinds, focusDirection);
  const neighborIds = new Set<string>();
  for (const edge of focusEdges) {
    if (edge.source !== focusNode.id) neighborIds.add(edge.source);
    if (edge.target !== focusNode.id) neighborIds.add(edge.target);
  }

  const neighborRows = selectNodesByIds(db, [...neighborIds], options.nodeKinds)
    .sort((a, b) => b.degree - a.degree || a.file_path.localeCompare(b.file_path) || a.start_line - b.start_line);
  const selectedNeighbors = neighborRows.slice(0, Math.max(0, maxNodes - 1));
  const selectedIds = new Set([focusNode.id, ...selectedNeighbors.map((row) => row.id)]);
  const edges = focusEdges.filter((edge) => selectedIds.has(edge.source) && selectedIds.has(edge.target));

  return {
    rows: [focusNode, ...selectedNeighbors],
    edges,
    limited: neighborRows.length > selectedNeighbors.length,
  };
}

function selectNodes(db: Database, options: GraphSnapshotOptions): NodeRow[] {
  const maxNodes = Math.max(25, Math.min(options.maxNodes || 300, 1000));
  const clauses: string[] = [];
  const params: SqlValue[] = [];

  if (options.nodeKinds.length > 0) {
    clauses.push(`n.kind IN (${options.nodeKinds.map(() => '?').join(',')})`);
    params.push(...options.nodeKinds);
  }

  if (options.mode === 'search' && options.query?.trim()) {
    clauses.push('(n.name LIKE ? OR n.qualified_name LIKE ? OR n.file_path LIKE ?)');
    const q = `%${options.query.trim()}%`;
    params.push(q, q, q);
  }

  if (options.mode === 'file' && options.filePath?.trim()) {
    clauses.push('n.file_path LIKE ?');
    params.push(`${options.filePath.trim()}%`);
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  params.push(maxNodes);

  return rows<NodeRow>(
    db,
    `SELECT n.id, n.kind, n.name, n.qualified_name, n.file_path, n.language, n.start_line, n.end_line,
        (SELECT COUNT(*) FROM edges e WHERE e.source = n.id OR e.target = n.id) AS degree
       FROM nodes n
       ${where}
       ORDER BY degree DESC, n.file_path ASC, n.start_line ASC
       LIMIT ?`,
    params,
  );
}

function selectNodeById(db: Database, nodeId: string): NodeRow | null {
  return rows<NodeRow>(
    db,
    `SELECT n.id, n.kind, n.name, n.qualified_name, n.file_path, n.language, n.start_line, n.end_line,
        (SELECT COUNT(*) FROM edges e WHERE e.source = n.id OR e.target = n.id) AS degree
       FROM nodes n
       WHERE n.id = ?
       LIMIT 1`,
    [nodeId],
  )[0] ?? null;
}

function selectNodesByIds(db: Database, nodeIds: string[], nodeKinds: string[]): NodeRow[] {
  if (nodeIds.length === 0) return [];
  const idsJson = JSON.stringify(nodeIds);
  const params: SqlValue[] = [idsJson];
  let kindWhere = '';
  if (nodeKinds.length > 0) {
    kindWhere = ` AND n.kind IN (${nodeKinds.map(() => '?').join(',')})`;
    params.push(...nodeKinds);
  }

  return rows<NodeRow>(
    db,
    `SELECT n.id, n.kind, n.name, n.qualified_name, n.file_path, n.language, n.start_line, n.end_line,
        (SELECT COUNT(*) FROM edges e WHERE e.source = n.id OR e.target = n.id) AS degree
       FROM nodes n
       WHERE n.id IN (SELECT value FROM json_each(?))
       ${kindWhere}`,
    params,
  );
}

function selectEdges(db: Database, nodeIds: string[], edgeKinds: string[]): GraphEdge[] {
  if (nodeIds.length === 0) return [];
  const idsJson = JSON.stringify(nodeIds);
  const params: SqlValue[] = [idsJson, idsJson];
  let kindWhere = '';
  if (edgeKinds.length > 0) {
    kindWhere = ` AND kind IN (${edgeKinds.map(() => '?').join(',')})`;
    params.push(...edgeKinds);
  }

  const edgeRows = rows<EdgeRow>(
    db,
    `SELECT id AS rowid, source, target, kind, line
       FROM edges
       WHERE source IN (SELECT value FROM json_each(?))
         AND target IN (SELECT value FROM json_each(?))
         ${kindWhere}
       LIMIT 3000`,
    params,
  );

  return edgeRows.map((row) => ({
    id: String(row.rowid),
    source: row.source,
    target: row.target,
    kind: row.kind,
    line: row.line,
  }));
}

function selectFocusEdges(
  db: Database,
  focusNodeId: string,
  edgeKinds: string[],
  direction: 'both' | 'incoming' | 'outgoing',
): GraphEdge[] {
  const params: SqlValue[] = [];
  let directionWhere = '';
  if (direction === 'incoming') {
    directionWhere = 'target = ?';
    params.push(focusNodeId);
  } else if (direction === 'outgoing') {
    directionWhere = 'source = ?';
    params.push(focusNodeId);
  } else {
    directionWhere = '(source = ? OR target = ?)';
    params.push(focusNodeId, focusNodeId);
  }

  let kindWhere = '';
  if (edgeKinds.length > 0) {
    kindWhere = ` AND kind IN (${edgeKinds.map(() => '?').join(',')})`;
    params.push(...edgeKinds);
  }

  const edgeRows = rows<EdgeRow>(
    db,
    `SELECT id AS rowid, source, target, kind, line
       FROM edges
       WHERE ${directionWhere}
         ${kindWhere}
       LIMIT 5000`,
    params,
  );

  return edgeRows.map((row) => ({
    id: String(row.rowid),
    source: row.source,
    target: row.target,
    kind: row.kind,
    line: row.line,
  }));
}

function buildSnapshot({
  projectPath,
  totalNodes,
  totalEdges,
  rows,
  edges,
  limited,
}: {
  projectPath: string;
  totalNodes: number;
  totalEdges: number;
  rows: NodeRow[];
  edges: GraphEdge[];
  limited: boolean;
}): GraphSnapshot {
  const degree = new Map<string, number>();
  for (const edge of edges) {
    degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1);
    degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1);
  }

  return {
    projectPath,
    totalNodes,
    totalEdges,
    nodes: rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      name: row.name,
      qualifiedName: row.qualified_name,
      filePath: row.file_path,
      language: row.language,
      startLine: row.start_line,
      endLine: row.end_line,
      degree: degree.get(row.id) ?? row.degree,
    })),
    edges,
    limited,
    generatedAt: Date.now(),
  };
}

function scalar(db: Database, sql: string): number {
  const result = db.exec(sql)[0];
  return Number(result?.values[0]?.[0] ?? 0);
}

function rows<T extends Record<string, unknown>>(db: Database, sql: string, params: SqlValue[]): T[] {
  const stmt = db.prepare(sql);
  try {
    stmt.bind(params);
    const result: T[] = [];
    while (stmt.step()) {
      result.push(stmt.getAsObject() as T);
    }
    return result;
  } finally {
    stmt.free();
  }
}

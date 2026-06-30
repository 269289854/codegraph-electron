import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import initSqlJs, { type Database } from 'sql.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readGraphSnapshot } from '../src/electron/services/graph-snapshot.js';
import type { GraphSnapshotOptions } from '../src/shared/types.js';

let tempDir: string;

beforeEach(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codegraph-snapshot-'));
  fs.mkdirSync(path.join(tempDir, '.codegraph'));
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run(`
    CREATE TABLE nodes (
      id TEXT PRIMARY KEY,
      kind TEXT,
      name TEXT,
      qualified_name TEXT,
      file_path TEXT,
      language TEXT,
      start_line INTEGER,
      end_line INTEGER
    );
    CREATE TABLE edges (
      id INTEGER PRIMARY KEY,
      source TEXT,
      target TEXT,
      kind TEXT,
      line INTEGER
    );
  `);
  insertNode(db, 'center', 'method');
  insertNode(db, 'in-1', 'function');
  insertNode(db, 'out-1', 'class');
  insertNode(db, 'out-2', 'method');
  insertNode(db, 'ignored-kind', 'file');
  db.run(
    'INSERT INTO edges (id, source, target, kind, line) VALUES (?, ?, ?, ?, ?), (?, ?, ?, ?, ?), (?, ?, ?, ?, ?), (?, ?, ?, ?, ?)',
    [
      1, 'in-1', 'center', 'calls', 10,
      2, 'center', 'out-1', 'calls', 20,
      3, 'center', 'out-2', 'imports', 30,
      4, 'center', 'ignored-kind', 'calls', 40,
    ],
  );
  fs.writeFileSync(path.join(tempDir, '.codegraph', 'codegraph.db'), Buffer.from(db.export()));
  db.close();
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('graph snapshot focused node mode', () => {
  it('returns the focus node with directly connected neighbors and edges', async () => {
    const snapshot = await readGraphSnapshot(tempDir, options({ focusNodeId: 'center' }));

    expect(snapshot.nodes.map((node) => node.id)).toContain('center');
    expect(snapshot.nodes.map((node) => node.id)).toContain('in-1');
    expect(snapshot.nodes.map((node) => node.id)).toContain('out-1');
    expect(snapshot.edges).toHaveLength(4);
  });

  it('keeps the focus node when maxNodes limits neighbors', async () => {
    const snapshot = await readGraphSnapshot(tempDir, options({ focusNodeId: 'center', maxNodes: 2 }));

    expect(snapshot.nodes).toHaveLength(2);
    expect(snapshot.nodes[0]?.id).toBe('center');
    expect(snapshot.limited).toBe(true);
  });

  it('filters focused edges by kind', async () => {
    const snapshot = await readGraphSnapshot(tempDir, options({ focusNodeId: 'center', edgeKinds: ['imports'] }));

    expect(snapshot.edges).toHaveLength(1);
    expect(snapshot.edges[0]?.kind).toBe('imports');
    expect(snapshot.nodes.map((node) => node.id)).toEqual(['center', 'out-2']);
  });

  it('does not filter out the focus node by node kind', async () => {
    const snapshot = await readGraphSnapshot(tempDir, options({ focusNodeId: 'center', nodeKinds: ['class'] }));

    expect(snapshot.nodes.map((node) => node.id)).toContain('center');
    expect(snapshot.nodes.map((node) => node.id)).toContain('out-1');
    expect(snapshot.nodes.map((node) => node.id)).not.toContain('in-1');
  });

  it('reports a missing focus node clearly', async () => {
    await expect(readGraphSnapshot(tempDir, options({ focusNodeId: 'missing' }))).rejects.toThrow('未找到聚焦节点');
  });
});

function options(overrides: Partial<GraphSnapshotOptions>): GraphSnapshotOptions {
  return {
    mode: 'node',
    focusNodeId: 'center',
    focusDepth: 1,
    focusDirection: 'both',
    maxNodes: 25,
    nodeKinds: [],
    edgeKinds: [],
    ...overrides,
  };
}

function insertNode(db: Database, id: string, kind: string): void {
  db.run(
    'INSERT INTO nodes (id, kind, name, qualified_name, file_path, language, start_line, end_line) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [id, kind, id, `Q.${id}`, `${id}.ts`, 'typescript', 1, 2],
  );
}

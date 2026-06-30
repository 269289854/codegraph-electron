import type { ProjectStatus } from '../../shared/types.js';

type RawStatus = {
  initialized?: boolean;
  version?: string;
  projectPath?: string;
  indexPath?: string;
  lastIndexed?: string | null;
  fileCount?: number;
  nodeCount?: number;
  edgeCount?: number;
  dbSizeBytes?: number;
  languages?: string[];
  nodesByKind?: Record<string, number>;
  pendingChanges?: { added?: number; modified?: number; removed?: number };
  index?: { reindexRecommended?: boolean };
};

export function parseStatusJson(stdout: string, fallbackProjectPath: string): ProjectStatus {
  const raw = JSON.parse(stdout.trim()) as RawStatus;
  return {
    initialized: raw.initialized === true,
    projectPath: raw.projectPath ?? fallbackProjectPath,
    indexPath: raw.indexPath ?? `${fallbackProjectPath}/.codegraph`,
    version: raw.version ?? null,
    lastIndexed: raw.lastIndexed ?? null,
    fileCount: raw.fileCount ?? 0,
    nodeCount: raw.nodeCount ?? 0,
    edgeCount: raw.edgeCount ?? 0,
    dbSizeBytes: raw.dbSizeBytes ?? 0,
    languages: raw.languages ?? [],
    nodesByKind: raw.nodesByKind ?? {},
    pendingChanges: {
      added: raw.pendingChanges?.added ?? 0,
      modified: raw.pendingChanges?.modified ?? 0,
      removed: raw.pendingChanges?.removed ?? 0,
    },
    reindexRecommended: raw.index?.reindexRecommended ?? false,
  };
}

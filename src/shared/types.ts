export type InstallStatus = {
  installed: boolean;
  version: string | null;
  commandPath: string | null;
  bundledPath: string | null;
  message: string;
};

export type CodexConfigState = 'missing' | 'valid' | 'conflict' | 'unreadable';

export type CodexValidationState = 'valid' | 'invalid' | 'unavailable';

export type CodexIntegrationStatus = {
  injected: boolean;
  codeGraphInstalled: boolean;
  configPath: string;
  configState: CodexConfigState;
  codexValidation: CodexValidationState;
  canInject: boolean;
  message: string;
};

export type ProjectStatus = {
  initialized: boolean;
  projectPath: string;
  indexPath: string;
  version: string | null;
  lastIndexed: string | null;
  fileCount: number;
  nodeCount: number;
  edgeCount: number;
  dbSizeBytes: number;
  languages: string[];
  nodesByKind: Record<string, number>;
  pendingChanges: {
    added: number;
    modified: number;
    removed: number;
  };
  reindexRecommended: boolean;
  error?: string;
};

export type ProjectInfo = {
  path: string;
  name: string;
  status: ProjectStatus | null;
};

export type JobKind = 'install' | 'inject' | 'inject-opencode' | 'update' | 'build' | 'rebuild' | 'delete';

export type JobState = 'queued' | 'running' | 'succeeded' | 'failed';

export type JobLog = {
  jobId: string;
  stream: 'stdout' | 'stderr' | 'system';
  text: string;
  createdAt: number;
};

export type JobSnapshot = {
  id: string;
  kind: JobKind;
  projectPath?: string;
  state: JobState;
  startedAt: number;
  finishedAt?: number;
  exitCode?: number | null;
  error?: string;
  logs: JobLog[];
};

export type GraphNode = {
  id: string;
  kind: string;
  name: string;
  qualifiedName: string;
  filePath: string;
  language: string;
  startLine: number;
  endLine: number;
  degree: number;
};

export type GraphEdge = {
  id: string;
  source: string;
  target: string;
  kind: string;
  line: number | null;
};

export type GraphSnapshotOptions = {
  mode: 'overview' | 'search' | 'file' | 'node';
  query?: string;
  filePath?: string;
  focusNodeId?: string;
  focusDepth?: 1 | 2;
  focusDirection?: 'both' | 'incoming' | 'outgoing';
  maxNodes: number;
  nodeKinds: string[];
  edgeKinds: string[];
};

export type GraphSnapshot = {
  projectPath: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  totalNodes: number;
  totalEdges: number;
  limited: boolean;
  generatedAt: number;
};

export type UpdateStatus = {
  installedVersion: string | null;
  latestVersion: string | null;
  updateAvailable: boolean;
  releaseUrl: string | null;
  message: string;
  checkedAt: number | null;
  error?: string;
};

export type OpencodeConfigState = 'missing' | 'valid' | 'conflict' | 'unreadable';

export type OpencodeIntegrationStatus = {
  injected: boolean;
  codeGraphInstalled: boolean;
  configPath: string;
  configState: OpencodeConfigState;
  canInject: boolean;
  message: string;
};

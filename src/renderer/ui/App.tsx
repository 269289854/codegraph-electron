import { Activity, Box, FolderOpen, GitBranch, RefreshCw, Search, Trash2, Wrench } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { GraphSnapshot, GraphSnapshotOptions, InstallStatus, JobSnapshot, ProjectInfo } from '../../shared/types';

type FilterState = GraphSnapshotOptions & {
  query: string;
  filePath: string;
};

const defaultFilters: FilterState = {
  mode: 'overview' as const,
  query: '',
  filePath: '',
  maxNodes: 350,
  nodeKinds: [] as string[],
  edgeKinds: [] as string[],
};

export function App(): JSX.Element {
  const [install, setInstall] = useState<InstallStatus | null>(null);
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [jobs, setJobs] = useState<JobSnapshot[]>([]);
  const [snapshot, setSnapshot] = useState<GraphSnapshot | null>(null);
  const [filters, setFilters] = useState(defaultFilters);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  const activeProject = projects.find((project) => project.path === activePath) ?? null;
  const selectedNode = snapshot?.nodes.find((node) => node.id === selectedNodeId) ?? null;

  useEffect(() => {
    void refreshInstall();
    void window.codegraphClient.getRecentProjects().then((items) => {
      setProjects(items);
      setActivePath(items[0]?.path ?? null);
    });

    const offJob = window.codegraphClient.onJobUpdated((job) => {
      setJobs((existing) => [job, ...existing.filter((item) => item.id !== job.id)].slice(0, 20));
    });
    const offLog = window.codegraphClient.onJobLog((log) => {
      setJobs((existing) =>
        existing.map((job) =>
          job.id === log.jobId
            ? { ...job, logs: [...job.logs, { ...log, stream: log.stream as 'stdout' | 'stderr' | 'system' }] }
            : job,
        ),
      );
    });
    return () => {
      offJob();
      offLog();
    };
  }, []);

  async function refreshInstall(): Promise<void> {
    setInstall(await window.codegraphClient.detectInstall());
  }

  async function chooseProject(): Promise<void> {
    const project = await window.codegraphClient.selectProject();
    if (!project) return;
    setProjects((existing) => [project, ...existing.filter((item) => item.path !== project.path)]);
    setActivePath(project.path);
  }

  async function refreshStatus(projectPath = activePath): Promise<void> {
    if (!projectPath) return;
    const status = await window.codegraphClient.getProjectStatus(projectPath);
    setProjects((existing) =>
      existing.map((project) => (project.path === projectPath ? { ...project, status } : project)),
    );
  }

  const refreshSnapshot = useCallback(async (): Promise<void> => {
    if (!activePath) return;
    const graph = await window.codegraphClient.getGraphSnapshot(activePath, filters);
    setSnapshot(graph);
    setSelectedNodeId(graph.nodes[0]?.id ?? null);
  }, [activePath, filters]);

  useEffect(() => {
    if (activeProject?.status?.initialized) {
      void refreshSnapshot();
    } else {
      setSnapshot(null);
    }
  }, [activeProject?.status?.initialized, refreshSnapshot]);

  async function runAndRefresh(run: (path: string) => Promise<JobSnapshot>): Promise<void> {
    if (!activePath) return;
    const job = await run(activePath);
    setJobs((existing) => [job, ...existing.filter((item) => item.id !== job.id)].slice(0, 20));
    await refreshStatus(activePath);
    if (job.state === 'succeeded' && job.kind !== 'delete') {
      await refreshSnapshot();
    } else if (job.kind === 'delete') {
      setSnapshot(null);
    }
  }

  const installLabel = install?.installed ? `CodeGraph ${install.version ?? ''}` : 'CodeGraph missing';
  const status = activeProject?.status;
  const jobList = useMemo(() => jobs.slice(0, 8), [jobs]);

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <Box size={22} />
          <div>
            <strong>CodeGraph Manager</strong>
            <span>{installLabel}</span>
          </div>
        </div>
        <button className="primary" onClick={chooseProject}>
          <FolderOpen size={16} />
          Select Folder
        </button>
        <button className="secondary" onClick={() => void refreshInstall()}>
          <RefreshCw size={16} />
          Detect Install
        </button>
        <button className="secondary" disabled={install?.installed} onClick={() => void window.codegraphClient.installCodeGraph().then(refreshInstall)}>
          <Wrench size={16} />
          Install CodeGraph
        </button>
        <div className="project-list">
          {projects.map((project) => (
            <button
              className={project.path === activePath ? 'project active' : 'project'}
              key={project.path}
              onClick={() => setActivePath(project.path)}
            >
              <strong>{project.name}</strong>
              <span>{project.path}</span>
            </button>
          ))}
        </div>
      </aside>

      <main className="workspace">
        <header className="toolbar">
          <div>
            <strong>{activeProject?.name ?? 'No project selected'}</strong>
            <span>{activeProject?.path ?? 'Choose a folder to start.'}</span>
          </div>
          <div className="toolbar-actions">
            <button disabled={!activePath || status?.initialized} onClick={() => void runAndRefresh(window.codegraphClient.buildGraph)}>
              <GitBranch size={16} />
              Build
            </button>
            <button disabled={!activePath || !status?.initialized} onClick={() => void runAndRefresh(window.codegraphClient.rebuildGraph)}>
              <RefreshCw size={16} />
              Rebuild
            </button>
            <button disabled={!activePath || !status?.initialized} onClick={() => void runAndRefresh(window.codegraphClient.deleteGraph)}>
              <Trash2 size={16} />
              Delete
            </button>
            <button disabled={!activePath} onClick={() => void refreshStatus()}>
              <Activity size={16} />
              Status
            </button>
          </div>
        </header>

        <section className="content">
          <div className="graph-area">
            <div className="graph-tools">
              <div className="search-box">
                <Search size={16} />
                <input
                  placeholder="Search nodes"
                  value={filters.query}
                  onChange={(event) => setFilters({ ...filters, query: event.target.value, mode: 'search' })}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void refreshSnapshot();
                  }}
                />
              </div>
              <label>
                Max nodes
                <input
                  type="range"
                  min="100"
                  max="1000"
                  step="50"
                  value={filters.maxNodes}
                  onChange={(event) => setFilters({ ...filters, maxNodes: Number(event.target.value) })}
                />
                {filters.maxNodes}
              </label>
            </div>
            <GraphCanvas snapshot={snapshot} selectedNodeId={selectedNodeId} onSelect={setSelectedNodeId} />
          </div>

          <aside className="inspector">
            <h2>Status</h2>
            <StatsPanel project={activeProject} snapshot={snapshot} />
            <h2>Selected Node</h2>
            {selectedNode ? (
              <div className="node-detail">
                <strong>{selectedNode.name}</strong>
                <span>{selectedNode.kind}</span>
                <p>{selectedNode.filePath}:{selectedNode.startLine}</p>
                <p>{selectedNode.qualifiedName}</p>
                <small>{selectedNode.degree} connections</small>
              </div>
            ) : (
              <p className="muted">No node selected.</p>
            )}
            <h2>Jobs</h2>
            <div className="jobs">
              {jobList.map((job) => (
                <div className={`job ${job.state}`} key={job.id}>
                  <strong>{job.kind}</strong>
                  <span>{job.state}</span>
                  <pre>{job.logs.slice(-3).map((log) => log.text.trim()).filter(Boolean).join('\n')}</pre>
                </div>
              ))}
            </div>
          </aside>
        </section>
      </main>
    </div>
  );
}

function StatsPanel({ project, snapshot }: { project: ProjectInfo | null; snapshot: GraphSnapshot | null }): JSX.Element {
  const status = project?.status;
  if (!status) return <p className="muted">No status loaded.</p>;
  return (
    <div className="stats">
      <div><span>Initialized</span><strong>{status.initialized ? 'Yes' : 'No'}</strong></div>
      <div><span>Files</span><strong>{status.fileCount.toLocaleString()}</strong></div>
      <div><span>Nodes</span><strong>{status.nodeCount.toLocaleString()}</strong></div>
      <div><span>Edges</span><strong>{status.edgeCount.toLocaleString()}</strong></div>
      <div><span>Visible</span><strong>{snapshot?.nodes.length.toLocaleString() ?? '0'}</strong></div>
    </div>
  );
}

function GraphCanvas({
  snapshot,
  selectedNodeId,
  onSelect,
}: {
  snapshot: GraphSnapshot | null;
  selectedNodeId: string | null;
  onSelect: (id: string) => void;
}): JSX.Element {
  const nodes = useMemo(() => snapshot?.nodes ?? [], [snapshot?.nodes]);
  const edges = snapshot?.edges ?? [];
  const positions = useMemo(() => {
    const map = new Map<string, { x: number; y: number }>();
    const radius = Math.max(160, Math.min(340, nodes.length * 1.2));
    nodes.forEach((node, index) => {
      const angle = (Math.PI * 2 * index) / Math.max(nodes.length, 1);
      const ring = radius * (0.45 + (index % 5) * 0.12);
      map.set(node.id, { x: 460 + Math.cos(angle) * ring, y: 320 + Math.sin(angle) * ring });
    });
    return map;
  }, [nodes]);

  if (!snapshot) {
    return <div className="empty-graph">Select an initialized project to view its graph.</div>;
  }

  return (
    <svg className="graph-canvas" viewBox="0 0 920 640" role="img">
      {edges.map((edge) => {
        const source = positions.get(edge.source);
        const target = positions.get(edge.target);
        if (!source || !target) return null;
        return <line key={edge.id} x1={source.x} y1={source.y} x2={target.x} y2={target.y} className="edge" />;
      })}
      {nodes.map((node) => {
        const point = positions.get(node.id)!;
        const selected = selectedNodeId === node.id;
        return (
          <g key={node.id} transform={`translate(${point.x}, ${point.y})`} onClick={() => onSelect(node.id)}>
            <circle r={selected ? 9 : 6} className={`node ${node.kind}`} />
            <text x="11" y="4">{node.name.slice(0, 28)}</text>
          </g>
        );
      })}
    </svg>
  );
}

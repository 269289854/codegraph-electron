import { Activity, Box, FolderOpen, GitBranch, RefreshCw, Search, Trash2, Wrench } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createGraphLayout } from '../../shared/graph-layout';
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
                  onChange={(event) => setFilters({ ...filters, query: event.target.value })}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      setFilters((current) => ({ ...current, mode: 'search' }));
                      window.setTimeout(() => void refreshSnapshot(), 0);
                    }
                  }}
                />
              </div>
              <div className="search-box compact">
                <input
                  placeholder="Focus file prefix"
                  value={filters.filePath}
                  onChange={(event) => setFilters({ ...filters, filePath: event.target.value })}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      setFilters((current) => ({ ...current, mode: 'file' }));
                      window.setTimeout(() => void refreshSnapshot(), 0);
                    }
                  }}
                />
              </div>
              <button onClick={() => { setFilters({ ...filters, mode: 'overview' }); window.setTimeout(() => void refreshSnapshot(), 0); }}>
                Overview
              </button>
              <button onClick={() => { setFilters({ ...filters, mode: 'search' }); window.setTimeout(() => void refreshSnapshot(), 0); }}>
                Search
              </button>
              <button onClick={() => { setFilters({ ...filters, mode: 'file' }); window.setTimeout(() => void refreshSnapshot(), 0); }}>
                File
              </button>
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
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [viewport, setViewport] = useState({ scale: 1, x: 0, y: 0 });
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  const layout = useMemo(() => (snapshot ? createGraphLayout(snapshot, 1200, 780) : null), [snapshot]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !layout) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(rect.width * dpr);
    canvas.height = Math.floor(rect.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawGraph(ctx, layout, viewport, selectedNodeId);
  }, [layout, selectedNodeId, viewport]);

  if (!snapshot) {
    return <div className="empty-graph">Select an initialized project to view its graph.</div>;
  }

  return (
    <canvas
      ref={canvasRef}
      className="graph-canvas"
      onWheel={(event) => {
        event.preventDefault();
        const nextScale = Math.max(0.35, Math.min(2.5, viewport.scale + (event.deltaY > 0 ? -0.08 : 0.08)));
        setViewport({ ...viewport, scale: nextScale });
      }}
      onMouseDown={(event) => setDrag({ x: event.clientX, y: event.clientY })}
      onMouseMove={(event) => {
        if (!drag) return;
        setViewport({ ...viewport, x: viewport.x + event.clientX - drag.x, y: viewport.y + event.clientY - drag.y });
        setDrag({ x: event.clientX, y: event.clientY });
      }}
      onMouseUp={(event) => {
        if (!layout || !canvasRef.current) {
          setDrag(null);
          return;
        }
        if (drag && Math.abs(event.clientX - drag.x) + Math.abs(event.clientY - drag.y) < 4) {
          const rect = canvasRef.current.getBoundingClientRect();
          const x = (event.clientX - rect.left - viewport.x) / viewport.scale;
          const y = (event.clientY - rect.top - viewport.y) / viewport.scale;
          const hit = [...layout.nodes].reverse().find((node) => Math.hypot(node.x - x, node.y - y) <= node.radius + 4);
          if (hit) onSelect(hit.id);
        }
        setDrag(null);
      }}
      onMouseLeave={() => setDrag(null)}
    />
  );
}

function drawGraph(
  ctx: CanvasRenderingContext2D,
  layout: ReturnType<typeof createGraphLayout>,
  viewport: { scale: number; x: number; y: number },
  selectedNodeId: string | null,
): void {
  const canvas = ctx.canvas;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#0f1318';
  ctx.fillRect(0, 0, width, height);
  ctx.save();
  ctx.translate(viewport.x, viewport.y);
  ctx.scale(viewport.scale, viewport.scale);

  ctx.lineWidth = 1;
  for (const edge of layout.edges) {
    ctx.strokeStyle = edge.kind === 'calls' ? 'rgba(76, 150, 255, 0.33)' : 'rgba(113, 128, 150, 0.24)';
    ctx.beginPath();
    ctx.moveTo(edge.source.x, edge.source.y);
    ctx.lineTo(edge.target.x, edge.target.y);
    ctx.stroke();
  }

  ctx.font = '11px Inter, sans-serif';
  ctx.textBaseline = 'middle';
  for (const node of layout.nodes) {
    const selected = node.id === selectedNodeId;
    ctx.fillStyle = nodeColor(node.kind);
    ctx.strokeStyle = selected ? '#ffffff' : 'rgba(232, 237, 244, 0.6)';
    ctx.lineWidth = selected ? 2.5 : 1;
    ctx.beginPath();
    ctx.arc(node.x, node.y, selected ? node.radius + 3 : node.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    if (selected || node.degree > 3) {
      ctx.fillStyle = '#d8e2ef';
      ctx.fillText(node.name.slice(0, 32), node.x + node.radius + 6, node.y);
    }
  }

  ctx.restore();
}

function nodeColor(kind: string): string {
  if (kind === 'file') return '#2fbf71';
  if (kind === 'class' || kind === 'interface' || kind === 'struct') return '#e4b84a';
  if (kind === 'method' || kind === 'function') return '#eb6f92';
  return '#4c96ff';
}

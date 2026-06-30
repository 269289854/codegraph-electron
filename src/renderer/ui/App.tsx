import { Activity, Box, FolderOpen, GitBranch, RefreshCw, Search, Trash2, Wrench } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createGraphLayout } from '../../shared/graph-layout';
import { clampScale, zoomViewportAtPoint } from '../../shared/viewport';
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
  const [runtimeLogPath, setRuntimeLogPath] = useState<string>('');

  const activeProject = projects.find((project) => project.path === activePath) ?? null;
  const selectedNode = snapshot?.nodes.find((node) => node.id === selectedNodeId) ?? null;

  useEffect(() => {
    void refreshInstall();
    void window.codegraphClient.getRecentProjects().then((items) => {
      setProjects(items);
      setActivePath(items[0]?.path ?? null);
    });
    void window.codegraphClient.getRuntimeLogPath().then(setRuntimeLogPath);

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

  const installLabel = install?.installed ? `CodeGraph ${install.version ?? ''}` : '未检测到 CodeGraph';
  const status = activeProject?.status;
  const canBuild = Boolean(activePath && !status?.initialized);
  const canUseGraph = Boolean(activePath && status?.initialized);
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
          选择项目文件夹
        </button>
        <button className="secondary" onClick={() => void refreshInstall()}>
          <RefreshCw size={16} />
          重新检测安装
        </button>
        <button className="secondary" disabled={install?.installed} onClick={() => void window.codegraphClient.installCodeGraph().then(refreshInstall)}>
          <Wrench size={16} />
          自动安装 CodeGraph
        </button>
        {runtimeLogPath ? <p className="log-path">运行日志：{runtimeLogPath}</p> : null}
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
            <strong>{activeProject?.name ?? '未选择项目'}</strong>
            <span>{activeProject?.path ?? '选择一个项目文件夹开始。'}</span>
          </div>
        </header>

        <section className="content">
          <div className="graph-area">
            <div className="project-actions">
              <button className="primary action-button" disabled={!canBuild} onClick={() => void runAndRefresh(window.codegraphClient.buildGraph)}>
                <GitBranch size={16} />
                开始构建图谱
              </button>
              <button className="secondary action-button" disabled={!canUseGraph} onClick={() => void runAndRefresh(window.codegraphClient.rebuildGraph)}>
                <RefreshCw size={16} />
                重构图谱
              </button>
              <button className="secondary action-button" disabled={!canUseGraph} onClick={() => void runAndRefresh(window.codegraphClient.deleteGraph)}>
                <Trash2 size={16} />
                删除图谱
              </button>
              <button className="secondary action-button" disabled={!activePath} onClick={() => void refreshStatus()}>
                <Activity size={16} />
                刷新状态
              </button>
            </div>
            <div className="graph-tools">
              <div className="search-box">
                <Search size={16} />
                <input
                  placeholder="搜索节点"
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
                  placeholder="按文件前缀聚焦"
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
              <div className="mode-control" role="group" aria-label="图谱查看模式">
                <button className={filters.mode === 'overview' ? 'active' : ''} onClick={() => { setFilters({ ...filters, mode: 'overview' }); window.setTimeout(() => void refreshSnapshot(), 0); }}>
                  总览
                </button>
                <button className={filters.mode === 'search' ? 'active' : ''} onClick={() => { setFilters({ ...filters, mode: 'search' }); window.setTimeout(() => void refreshSnapshot(), 0); }}>
                  搜索
                </button>
                <button className={filters.mode === 'file' ? 'active' : ''} onClick={() => { setFilters({ ...filters, mode: 'file' }); window.setTimeout(() => void refreshSnapshot(), 0); }}>
                  文件
                </button>
              </div>
              <label>
                最大节点数
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
            <GraphCanvas
              snapshot={snapshot}
              selectedNodeId={selectedNodeId}
              activeProject={activeProject}
              onSelect={setSelectedNodeId}
              onBuild={() => void runAndRefresh(window.codegraphClient.buildGraph)}
            />
          </div>

          <aside className="inspector">
            <h2>状态</h2>
            <StatsPanel project={activeProject} snapshot={snapshot} />
            <h2>已选节点</h2>
            {selectedNode ? (
              <div className="node-detail">
                <strong>{selectedNode.name}</strong>
                <span>{selectedNode.kind}</span>
                <p>{selectedNode.filePath}:{selectedNode.startLine}</p>
                <p>{selectedNode.qualifiedName}</p>
                <small>{selectedNode.degree} 个连接</small>
              </div>
            ) : (
              <p className="muted">尚未选择节点。</p>
            )}
            <h2>任务</h2>
            <div className="jobs">
              {jobList.map((job) => (
                <div className={`job ${job.state}`} key={job.id}>
                  <strong>{jobKindLabel(job.kind)}</strong>
                  <span>{jobStateLabel(job.state)}</span>
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
  if (!status) return <p className="muted">尚未加载状态。</p>;
  return (
    <div className="stats">
      <div><span>已构建</span><strong>{status.initialized ? '是' : '否'}</strong></div>
      <div><span>文件数</span><strong>{status.fileCount.toLocaleString()}</strong></div>
      <div><span>节点数</span><strong>{status.nodeCount.toLocaleString()}</strong></div>
      <div><span>边数</span><strong>{status.edgeCount.toLocaleString()}</strong></div>
      <div><span>可见节点</span><strong>{snapshot?.nodes.length.toLocaleString() ?? '0'}</strong></div>
    </div>
  );
}

function GraphCanvas({
  snapshot,
  selectedNodeId,
  activeProject,
  onSelect,
  onBuild,
}: {
  snapshot: GraphSnapshot | null;
  selectedNodeId: string | null;
  activeProject: ProjectInfo | null;
  onSelect: (id: string) => void;
  onBuild: () => void;
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
    if (activeProject && activeProject.status && !activeProject.status.initialized) {
      return (
        <div className="empty-graph">
          <strong>当前项目还没有图谱</strong>
          <span>点击下方按钮开始构建，完成后会自动刷新可视化视图。</span>
          <button className="primary action-button" onClick={onBuild}>
            <GitBranch size={16} />
            开始构建图谱
          </button>
        </div>
      );
    }
    return <div className="empty-graph">请选择项目文件夹，然后构建或查看图谱。</div>;
  }

  return (
    <canvas
      ref={canvasRef}
      className="graph-canvas"
      onWheel={(event) => {
        if (!event.ctrlKey || !canvasRef.current) return;
        event.preventDefault();
        const rect = canvasRef.current.getBoundingClientRect();
        const point = {
          x: event.clientX - rect.left,
          y: event.clientY - rect.top,
        };
        const factor = event.deltaY > 0 ? 0.9 : 1.1;
        const nextScale = clampScale(viewport.scale * factor);
        setViewport(zoomViewportAtPoint(viewport, point, nextScale));
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

function jobKindLabel(kind: JobSnapshot['kind']): string {
  return {
    install: '安装 CodeGraph',
    build: '构建图谱',
    rebuild: '重构图谱',
    delete: '删除图谱',
  }[kind];
}

function jobStateLabel(state: JobSnapshot['state']): string {
  return {
    queued: '排队中',
    running: '运行中',
    succeeded: '已完成',
    failed: '失败',
  }[state];
}

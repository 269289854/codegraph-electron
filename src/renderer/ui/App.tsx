import { Activity, ArrowLeft, Box, FolderOpen, GitBranch, RefreshCw, Search, Trash2, Wrench } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createGraphLayout } from '../../shared/graph-layout';
import { clampScale, zoomViewportAtPoint } from '../../shared/viewport';
import type { GraphSnapshot, GraphSnapshotOptions, InstallStatus, JobSnapshot, ProjectInfo } from '../../shared/types';

type FilterState = GraphSnapshotOptions & {
  query: string;
  filePath: string;
};

const focusedMaxNodes = 48;

const defaultFilters: FilterState = {
  mode: 'overview' as const,
  query: '',
  filePath: '',
  focusNodeId: undefined,
  focusDepth: 1,
  focusDirection: 'both',
  maxNodes: 180,
  nodeKinds: [] as string[],
  edgeKinds: [] as string[],
};

type ViewHistoryItem = {
  filters: FilterState;
  selectedNodeId: string | null;
};

export function App(): JSX.Element {
  const [install, setInstall] = useState<InstallStatus | null>(null);
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [jobs, setJobs] = useState<JobSnapshot[]>([]);
  const [snapshot, setSnapshot] = useState<GraphSnapshot | null>(null);
  const [filters, setFilters] = useState(defaultFilters);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [viewHistory, setViewHistory] = useState<ViewHistoryItem[]>([]);
  const [runtimeLogPath, setRuntimeLogPath] = useState<string>('');

  const activeProject = projects.find((project) => project.path === activePath) ?? null;
  const selectedNode = snapshot?.nodes.find((node) => node.id === selectedNodeId) ?? null;
  const focusNode = filters.mode === 'node' ? snapshot?.nodes.find((node) => node.id === filters.focusNodeId) ?? selectedNode : null;

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
    setViewHistory([]);
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
    const snapshotOptions = filters.mode === 'node'
      ? { ...filters, maxNodes: Math.min(filters.maxNodes, focusedMaxNodes) }
      : filters;
    const graph = await window.codegraphClient.getGraphSnapshot(activePath, snapshotOptions);
    setSnapshot(graph);
    setSelectedNodeId(filters.mode === 'node' ? filters.focusNodeId ?? graph.nodes[0]?.id ?? null : graph.nodes[0]?.id ?? null);
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
  const viewLabel = getViewLabel(filters, focusNode, snapshot);

  function setGlobalMode(mode: 'overview' | 'search' | 'file'): void {
    setViewHistory([]);
    setFilters((current) => ({
      ...current,
      mode,
      focusNodeId: undefined,
      focusDepth: 1,
      focusDirection: 'both',
    }));
  }

  function focusNodeGraph(nodeId: string): void {
    const node = snapshot?.nodes.find((item) => item.id === nodeId);
    setViewHistory((existing) => [...existing, { filters, selectedNodeId }]);
    setFilters((current) => ({
      ...current,
      mode: 'node',
      focusNodeId: nodeId,
      focusDepth: 1,
      focusDirection: 'both',
    }));
    setSelectedNodeId(nodeId);
    setSnapshot(node ? { ...snapshot!, nodes: [node], edges: [], limited: true, generatedAt: Date.now() } : snapshot);
  }

  function goBackView(): void {
    setViewHistory((existing) => {
      const previous = existing.at(-1);
      if (!previous) return existing;
      setFilters(previous.filters);
      setSelectedNodeId(previous.selectedNodeId);
      return existing.slice(0, -1);
    });
  }

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
              onClick={() => {
                setActivePath(project.path);
                setViewHistory([]);
              }}
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
              <button className="secondary graph-back-button" disabled={viewHistory.length === 0} onClick={goBackView}>
                <ArrowLeft size={16} />
                返回上一层
              </button>
              <span className="view-chip">{viewLabel}</span>
              <div className="search-box">
                <Search size={16} />
                <input
                  placeholder="搜索节点"
                  value={filters.query}
                  onChange={(event) => setFilters({ ...filters, query: event.target.value })}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      setViewHistory([]);
                      setFilters((current) => ({ ...current, mode: 'search', focusNodeId: undefined }));
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
                      setViewHistory([]);
                      setFilters((current) => ({ ...current, mode: 'file', focusNodeId: undefined }));
                    }
                  }}
                />
              </div>
              <div className="mode-control" role="group" aria-label="图谱查看模式">
                <button className={filters.mode === 'overview' ? 'active' : ''} onClick={() => setGlobalMode('overview')}>
                  总览
                </button>
                <button className={filters.mode === 'search' ? 'active' : ''} onClick={() => setGlobalMode('search')}>
                  搜索
                </button>
                <button className={filters.mode === 'file' ? 'active' : ''} onClick={() => setGlobalMode('file')}>
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
              focusNodeId={filters.mode === 'node' ? filters.focusNodeId : undefined}
              activeProject={activeProject}
              onSelect={setSelectedNodeId}
              onFocusNode={focusNodeGraph}
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

function getViewLabel(
  filters: FilterState,
  focusNode: GraphSnapshot['nodes'][number] | null,
  snapshot: GraphSnapshot | null,
): string {
  if (filters.mode === 'node') return `聚焦：${focusNode?.name ?? filters.focusNodeId ?? '节点'} · ${snapshot?.nodes.length ?? 0} 个节点`;
  if (filters.mode === 'search') return '搜索视图';
  if (filters.mode === 'file') return '文件视图';
  return '总览视图';
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
  focusNodeId,
  activeProject,
  onSelect,
  onFocusNode,
  onBuild,
}: {
  snapshot: GraphSnapshot | null;
  selectedNodeId: string | null;
  focusNodeId?: string;
  activeProject: ProjectInfo | null;
  onSelect: (id: string) => void;
  onFocusNode: (id: string) => void;
  onBuild: () => void;
}): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [viewport, setViewport] = useState({ scale: 1, x: 0, y: 0 });
  const [drag, setDrag] = useState<{
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
    isPanning: boolean;
    moved: boolean;
  } | null>(null);
  const layout = useMemo(() => {
    if (!snapshot) return null;
    const nodeCount = Math.max(1, snapshot.nodes.length);
    if (focusNodeId) {
      return createGraphLayout(snapshot, 1000, 700, { focusNodeId });
    }
    const spread = Math.sqrt(nodeCount / 180);
    return createGraphLayout(snapshot, Math.round(2200 * spread), Math.round(1500 * spread));
  }, [focusNodeId, snapshot]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !layout) return;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const nextScale = clampScale(Math.min(rect.width / layout.width, rect.height / layout.height) * 0.92);
    setViewport({
      scale: nextScale,
      x: (rect.width - layout.width * nextScale) / 2,
      y: (rect.height - layout.height * nextScale) / 2,
    });
  }, [layout]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !snapshot) return;

    const handleWheel = (event: WheelEvent): void => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const point = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      };
      const factor = event.deltaY > 0 ? 0.9 : 1.1;
      setViewport((current) => {
        const nextScale = clampScale(current.scale * factor);
        return zoomViewportAtPoint(current, point, nextScale);
      });
    };

    canvas.addEventListener('wheel', handleWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', handleWheel);
  }, [snapshot]);

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
    drawGraph(ctx, layout, viewport, selectedNodeId, focusNodeId);
  }, [focusNodeId, layout, selectedNodeId, viewport]);

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
      onMouseDown={(event) =>
        setDrag({
          startX: event.clientX,
          startY: event.clientY,
          lastX: event.clientX,
          lastY: event.clientY,
          isPanning: event.ctrlKey,
          moved: false,
        })
      }
      onMouseMove={(event) => {
        if (!drag) return;
        const moved =
          drag.moved ||
          Math.abs(event.clientX - drag.startX) + Math.abs(event.clientY - drag.startY) >= 4;
        if (!drag.isPanning) {
          setDrag({ ...drag, lastX: event.clientX, lastY: event.clientY, moved });
          return;
        }
        if (!event.ctrlKey) {
          setDrag(null);
          return;
        }
        setViewport((current) => ({
          ...current,
          x: current.x + event.clientX - drag.lastX,
          y: current.y + event.clientY - drag.lastY,
        }));
        setDrag({ ...drag, lastX: event.clientX, lastY: event.clientY, moved });
      }}
      onMouseUp={(event) => {
        if (!layout || !canvasRef.current) {
          setDrag(null);
          return;
        }
        if (drag && !drag.moved) {
          const rect = canvasRef.current.getBoundingClientRect();
          const x = (event.clientX - rect.left - viewport.x) / viewport.scale;
          const y = (event.clientY - rect.top - viewport.y) / viewport.scale;
          const hit = findHitNode(layout.nodes, x, y);
          if (hit) onSelect(hit.id);
        }
        setDrag(null);
      }}
      onDoubleClick={(event) => {
        if (!layout || !canvasRef.current) return;
        const rect = canvasRef.current.getBoundingClientRect();
        const x = (event.clientX - rect.left - viewport.x) / viewport.scale;
        const y = (event.clientY - rect.top - viewport.y) / viewport.scale;
        const hit = findHitNode(layout.nodes, x, y);
        if (hit) onFocusNode(hit.id);
      }}
      onMouseLeave={() => setDrag(null)}
    />
  );
}

function findHitNode(nodes: ReturnType<typeof createGraphLayout>['nodes'], x: number, y: number) {
  return [...nodes].reverse().find((node) => Math.hypot(node.x - x, node.y - y) <= node.radius + 6);
}

function drawGraph(
  ctx: CanvasRenderingContext2D,
  layout: ReturnType<typeof createGraphLayout>,
  viewport: { scale: number; x: number; y: number },
  selectedNodeId: string | null,
  focusNodeId?: string,
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

  const importantNodeIds = new Set(
    [...layout.nodes]
      .sort((a, b) => b.degree - a.degree || a.name.localeCompare(b.name))
      .slice(0, focusNodeId ? 28 : selectedNodeId ? 12 : 18)
      .map((node) => node.id),
  );
  const selectedNode = selectedNodeId ? layout.nodes.find((node) => node.id === selectedNodeId) : null;
  const focusNode = focusNodeId ? layout.nodes.find((node) => node.id === focusNodeId) : null;
  const shouldThinEdges = !focusNode && viewport.scale < 0.9 && selectedNode;

  ctx.lineWidth = 1 / viewport.scale;
  for (const edge of layout.edges) {
    if (shouldThinEdges && edge.source.id !== selectedNode.id && edge.target.id !== selectedNode.id) {
      continue;
    }
    const connectedToSelection = selectedNode && (edge.source.id === selectedNode.id || edge.target.id === selectedNode.id);
    const connectedToFocus = focusNode && (edge.source.id === focusNode.id || edge.target.id === focusNode.id);
    const alpha = focusNode ? 0.48 : connectedToSelection ? 0.32 : edge.kind === 'calls' ? 0.12 : 0.08;
    ctx.lineWidth = (connectedToFocus ? 1.6 : 1) / viewport.scale;
    ctx.strokeStyle = edgeColor(edge, focusNode?.id, alpha);
    ctx.beginPath();
    ctx.moveTo(edge.source.x, edge.source.y);
    ctx.lineTo(edge.target.x, edge.target.y);
    ctx.stroke();
  }

  ctx.font = '11px Inter, sans-serif';
  ctx.textBaseline = 'middle';
  for (const node of layout.nodes) {
    const selected = node.id === selectedNodeId;
    const focused = node.id === focusNodeId;
    const scaledRadius = node.radius / Math.sqrt(Math.max(1, viewport.scale));
    const displayRadius = focused ? scaledRadius + 4 : selected ? scaledRadius + 2.5 : scaledRadius;
    ctx.fillStyle = nodeColor(node.kind);
    ctx.strokeStyle = focused ? '#ffffff' : selected ? '#d8e2ef' : 'rgba(232, 237, 244, 0.6)';
    ctx.lineWidth = (focused ? 3 : selected ? 2.2 : 1) / viewport.scale;
    ctx.beginPath();
    ctx.arc(node.x, node.y, displayRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    if (focused || selected || (importantNodeIds.has(node.id) && (focusNodeId || viewport.scale >= 0.55))) {
      ctx.font = `${focused || selected ? 13 / viewport.scale : 11 / viewport.scale}px Inter, sans-serif`;
      ctx.fillStyle = '#d8e2ef';
      ctx.fillText(node.name.slice(0, 32), node.x + displayRadius + 6 / viewport.scale, node.y);
    }
  }

  ctx.restore();
}

function edgeColor(
  edge: ReturnType<typeof createGraphLayout>['edges'][number],
  focusNodeId: string | undefined,
  alpha: number,
): string {
  if (focusNodeId && edge.source.id === focusNodeId) return `rgba(76, 150, 255, ${alpha})`;
  if (focusNodeId && edge.target.id === focusNodeId) return `rgba(47, 191, 113, ${alpha})`;
  if (edge.kind === 'calls') return `rgba(76, 150, 255, ${alpha})`;
  return `rgba(113, 128, 150, ${alpha})`;
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

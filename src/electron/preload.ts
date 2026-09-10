import { contextBridge, ipcRenderer } from 'electron';
import type { GraphSnapshotOptions } from '../shared/types.js';

const bridge = {
  detectInstall: () => ipcRenderer.invoke('codegraph:detect-install'),
  installCodeGraph: () => ipcRenderer.invoke('codegraph:install'),
  checkForUpdate: () => ipcRenderer.invoke('codegraph:check-update'),
  updateCodeGraph: () => ipcRenderer.invoke('codegraph:update'),
  detectCodexIntegration: () => ipcRenderer.invoke('codex:detect'),
  injectCodex: () => ipcRenderer.invoke('codex:inject'),
  detectOpencodeIntegration: () => ipcRenderer.invoke('opencode:detect'),
  injectOpencode: () => ipcRenderer.invoke('opencode:inject'),
  selectProject: () => ipcRenderer.invoke('project:select'),
  getRecentProjects: () => ipcRenderer.invoke('project:recent'),
  removeProject: (projectPath: string) => ipcRenderer.invoke('project:remove', projectPath),
  getProjectStatus: (projectPath: string) => ipcRenderer.invoke('project:status', projectPath),
  buildGraph: (projectPath: string) => ipcRenderer.invoke('graph:build', projectPath),
  rebuildGraph: (projectPath: string) => ipcRenderer.invoke('graph:rebuild', projectPath),
  deleteGraph: (projectPath: string) => ipcRenderer.invoke('graph:delete', projectPath),
  getGraphSnapshot: (projectPath: string, options: GraphSnapshotOptions) =>
      ipcRenderer.invoke('graph:snapshot', projectPath, options),
  getRuntimeLogPath: () => ipcRenderer.invoke('runtime:log-path'),
  onJobUpdated: (callback: (...args: any[]) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, job: unknown) => callback(job);
    ipcRenderer.on('job:updated', listener);
    return () => ipcRenderer.removeListener('job:updated', listener);
  },
  onJobLog: (callback: (...args: any[]) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, log: unknown) => callback(log);
    ipcRenderer.on('job:log', listener);
    return () => ipcRenderer.removeListener('job:log', listener);
  },
};

contextBridge.exposeInMainWorld('codegraphClient', bridge);

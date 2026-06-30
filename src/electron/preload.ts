import { contextBridge, ipcRenderer } from 'electron';
import type { GraphSnapshotOptions } from '../shared/types.js';

const bridge = {
  detectInstall: () => ipcRenderer.invoke('codegraph:detect-install'),
  installCodeGraph: () => ipcRenderer.invoke('codegraph:install'),
  selectProject: () => ipcRenderer.invoke('project:select'),
  getRecentProjects: () => ipcRenderer.invoke('project:recent'),
  getProjectStatus: (projectPath: string) => ipcRenderer.invoke('project:status', projectPath),
  buildGraph: (projectPath: string) => ipcRenderer.invoke('graph:build', projectPath),
  rebuildGraph: (projectPath: string) => ipcRenderer.invoke('graph:rebuild', projectPath),
  deleteGraph: (projectPath: string) => ipcRenderer.invoke('graph:delete', projectPath),
  getGraphSnapshot: (projectPath: string, options: GraphSnapshotOptions) =>
    ipcRenderer.invoke('graph:snapshot', projectPath, options),
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

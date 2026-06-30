import { dialog, ipcMain } from 'electron';
import path from 'node:path';
import {
  detectCodeGraphInstall,
  readCodeGraphStatus,
  runCodeGraphCommand,
  startOfficialInstall,
} from './services/codegraph.js';
import { readRecentProjects, upsertRecentProject } from './services/projects.js';
import { jobRunner } from './services/jobs.js';
import { readGraphSnapshot } from './services/graph-snapshot.js';
import { getRuntimeLogPath, logError, logInfo } from './services/runtime-logger.js';

ipcMain.handle('codegraph:detect-install', async () =>
  withIpcLogging('codegraph:detect-install', undefined, () => detectCodeGraphInstall()),
);

ipcMain.handle('codegraph:install', async (event) =>
  withIpcLogging('codegraph:install', undefined, () =>
    jobRunner.run({
      kind: 'install',
      run: ({ job, appendLog }) => startOfficialInstall(job.id, event.sender, appendLog),
    }),
  ),
);

ipcMain.handle('project:select', async () => {
  logInfo('IPC project:select');
  const result = await dialog.showOpenDialog({
    title: '选择项目文件夹',
    properties: ['openDirectory'],
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  const projectPath = result.filePaths[0]!;
  const project = {
    path: projectPath,
    name: path.basename(projectPath),
    status: await readCodeGraphStatus(projectPath),
  };
  await upsertRecentProject(project);
  logInfo('Project selected', { projectPath });
  return project;
});

ipcMain.handle('project:recent', async () => withIpcLogging('project:recent', undefined, () => readRecentProjects()));

ipcMain.handle('project:status', async (_event, projectPath: string) => {
  logInfo('IPC project:status', { projectPath });
  const status = await readCodeGraphStatus(projectPath);
  await upsertRecentProject({ path: projectPath, name: path.basename(projectPath), status });
  return status;
});

ipcMain.handle('graph:build', async (event, projectPath: string) =>
  withIpcLogging('graph:build', { projectPath }, () =>
    jobRunner.runProjectJob(projectPath, {
      kind: 'build',
      run: ({ appendLog }) =>
        runCodeGraphCommand(projectPath, ['init', projectPath], { sender: event.sender, appendLog }),
    }),
  ),
);

ipcMain.handle('graph:rebuild', async (event, projectPath: string) =>
  withIpcLogging('graph:rebuild', { projectPath }, () =>
    jobRunner.runProjectJob(projectPath, {
      kind: 'rebuild',
      run: ({ appendLog }) =>
        runCodeGraphCommand(projectPath, ['index', projectPath], { sender: event.sender, appendLog }),
    }),
  ),
);

ipcMain.handle('graph:delete', async (event, projectPath: string) =>
  withIpcLogging('graph:delete', { projectPath }, () =>
    jobRunner.runProjectJob(projectPath, {
      kind: 'delete',
      run: ({ appendLog }) =>
        runCodeGraphCommand(projectPath, ['uninit', projectPath, '--force'], { sender: event.sender, appendLog }),
    }),
  ),
);

ipcMain.handle('graph:snapshot', async (_event, projectPath: string, options) =>
  withIpcLogging('graph:snapshot', { projectPath, options }, () => readGraphSnapshot(projectPath, options)),
);

ipcMain.handle('runtime:log-path', async () => getRuntimeLogPath());

async function withIpcLogging<T>(channel: string, meta: unknown, fn: () => Promise<T>): Promise<T> {
  logInfo(`IPC start: ${channel}`, meta);
  try {
    const result = await fn();
    logInfo(`IPC success: ${channel}`);
    return result;
  } catch (error) {
    logError(`IPC failed: ${channel}`, error);
    throw error;
  }
}

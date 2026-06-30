import { dialog, ipcMain } from 'electron';
import path from 'node:path';
import {
  createUnavailableStatus,
  detectCodeGraphInstall,
  runCodeGraphCommand,
  startOfficialInstall,
} from './services/codegraph.js';
import { readRecentProjects, upsertRecentProject } from './services/projects.js';
import { jobRunner } from './services/jobs.js';
import { readGraphSnapshot } from './services/graph-snapshot.js';

ipcMain.handle('codegraph:detect-install', async () => detectCodeGraphInstall());

ipcMain.handle('codegraph:install', async (event) =>
  jobRunner.run({
    kind: 'install',
    run: ({ job, appendLog }) => startOfficialInstall(job.id, event.sender, appendLog),
  }),
);

ipcMain.handle('project:select', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Select project folder',
    properties: ['openDirectory'],
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  const projectPath = result.filePaths[0]!;
  const project = {
    path: projectPath,
    name: path.basename(projectPath),
    status: await runCodeGraphCommand(projectPath, ['status', projectPath, '--json']).catch(() =>
      createUnavailableStatus(projectPath),
    ),
  };
  await upsertRecentProject(project);
  return project;
});

ipcMain.handle('project:recent', async () => readRecentProjects());

ipcMain.handle('project:status', async (_event, projectPath: string) => {
  const status = await runCodeGraphCommand(projectPath, ['status', projectPath, '--json']).catch((error: unknown) => ({
    ...createUnavailableStatus(projectPath),
    error: error instanceof Error ? error.message : String(error),
  }));
  await upsertRecentProject({ path: projectPath, name: path.basename(projectPath), status });
  return status;
});

ipcMain.handle('graph:build', async (event, projectPath: string) =>
  jobRunner.runProjectJob(projectPath, {
    kind: 'build',
    run: ({ appendLog }) =>
      runCodeGraphCommand(projectPath, ['init', projectPath], { sender: event.sender, appendLog }),
  }),
);

ipcMain.handle('graph:rebuild', async (event, projectPath: string) =>
  jobRunner.runProjectJob(projectPath, {
    kind: 'rebuild',
    run: ({ appendLog }) =>
      runCodeGraphCommand(projectPath, ['index', projectPath], { sender: event.sender, appendLog }),
  }),
);

ipcMain.handle('graph:delete', async (event, projectPath: string) =>
  jobRunner.runProjectJob(projectPath, {
    kind: 'delete',
    run: ({ appendLog }) =>
      runCodeGraphCommand(projectPath, ['uninit', projectPath, '--force'], { sender: event.sender, appendLog }),
  }),
);

ipcMain.handle('graph:snapshot', async (_event, projectPath: string, options) => readGraphSnapshot(projectPath, options));

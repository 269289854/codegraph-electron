import { app } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { ProjectInfo } from '../../shared/types.js';

const maxRecentProjects = 12;

function storePath(): string {
  return path.join(app.getPath('userData'), 'recent-projects.json');
}

export async function readRecentProjects(): Promise<ProjectInfo[]> {
  try {
    const text = await fs.readFile(storePath(), 'utf-8');
    return JSON.parse(text) as ProjectInfo[];
  } catch {
    return [];
  }
}

export async function upsertRecentProject(project: ProjectInfo): Promise<void> {
  const recent = await readRecentProjects();
  const next = [project, ...recent.filter((item) => item.path !== project.path)].slice(0, maxRecentProjects);
  await fs.mkdir(path.dirname(storePath()), { recursive: true });
  await fs.writeFile(storePath(), JSON.stringify(next, null, 2), 'utf-8');
}

import type { WebContents } from 'electron';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { InstallStatus, JobLog, ProjectStatus } from '../../shared/types.js';
import { parseStatusJson } from './status-parser.js';

export function bundledCodeGraphPath(): string | null {
  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData) return null;
  return path.join(localAppData, 'codegraph', 'current', 'bin', process.platform === 'win32' ? 'codegraph.cmd' : 'codegraph');
}

export async function detectCodeGraphInstall(): Promise<InstallStatus> {
  const fromPath = await findCodeGraphOnPath();
  const bundled = bundledCodeGraphPath();
  const bundledExists = bundled ? await exists(bundled) : false;
  const commandPath = fromPath ?? (bundledExists ? bundled : null);
  const version = commandPath ? await readCodeGraphVersion(commandPath) : null;

  return {
    installed: Boolean(commandPath),
    version,
    commandPath,
    bundledPath: bundledExists ? bundled : bundled,
    message: commandPath ? 'CodeGraph is available.' : 'CodeGraph is not installed.',
  };
}

export async function startOfficialInstall(
  jobId: string,
  sender: WebContents,
  appendLog: (stream: JobLog['stream'], text: string) => void,
): Promise<ProjectStatus> {
  const script = 'irm https://raw.githubusercontent.com/colbymchenry/codegraph/main/install.ps1 | iex';
  appendLog('system', 'Starting official CodeGraph standalone installer.');
  const result = await spawnCommand('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], {
    cwd: process.env.USERPROFILE ?? process.cwd(),
    sender,
    jobId,
    appendLog,
  });
  if (result.exitCode !== 0) {
    throw new Error(`Installer failed with exit code ${result.exitCode ?? 'unknown'}.`);
  }
  await detectCodeGraphInstall();
  return createUnavailableStatus(process.cwd());
}

export async function runCodeGraphCommand(
  projectPath: string,
  args: string[],
  options: {
    sender?: WebContents;
    appendLog?: (stream: JobLog['stream'], text: string) => void;
  } = {},
): Promise<ProjectStatus> {
  const install = await detectCodeGraphInstall();
  if (!install.commandPath) {
    throw new Error('CodeGraph is not installed.');
  }

  const result = await spawnCommand(install.commandPath, args, {
    cwd: projectPath,
    sender: options.sender,
    appendLog: options.appendLog,
  });

  if (result.exitCode !== 0) {
    throw new Error(result.stderr.trim() || `codegraph ${args[0]} failed with exit code ${result.exitCode}.`);
  }

  if (args.includes('--json')) {
    return parseStatusJson(result.stdout, projectPath);
  }

  return runCodeGraphCommand(projectPath, ['status', projectPath, '--json']);
}

export function createUnavailableStatus(projectPath: string): ProjectStatus {
  return {
    initialized: false,
    projectPath,
    indexPath: path.join(projectPath, '.codegraph'),
    version: null,
    lastIndexed: null,
    fileCount: 0,
    nodeCount: 0,
    edgeCount: 0,
    dbSizeBytes: 0,
    languages: [],
    nodesByKind: {},
    pendingChanges: { added: 0, modified: 0, removed: 0 },
    reindexRecommended: false,
  };
}

async function findCodeGraphOnPath(): Promise<string | null> {
  const command = process.platform === 'win32' ? 'where.exe' : 'which';
  const result = await spawnCommand(command, ['codegraph']).catch(() => null);
  if (!result || result.exitCode !== 0) return null;
  return result.stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? null;
}

async function readCodeGraphVersion(commandPath: string): Promise<string | null> {
  const result = await spawnCommand(commandPath, ['version']).catch(() => null);
  if (!result || result.exitCode !== 0) return null;
  return result.stdout.trim() || null;
}

async function exists(filePath: string): Promise<boolean> {
  return fs.access(filePath).then(() => true, () => false);
}

async function spawnCommand(
  command: string,
  args: string[],
  options: {
    cwd?: string;
    sender?: WebContents;
    jobId?: string;
    appendLog?: (stream: JobLog['stream'], text: string) => void;
  } = {},
): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      shell: false,
      windowsHide: true,
      env: process.env,
    });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      stdout += text;
      options.appendLog?.('stdout', text);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      stderr += text;
      options.appendLog?.('stderr', text);
    });
    child.on('error', reject);
    child.on('close', (exitCode) => resolve({ exitCode, stdout, stderr }));
  });
}

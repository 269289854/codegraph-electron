import type { WebContents } from 'electron';
import { spawn } from 'node:child_process';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type {
  CodexConfigState,
  CodexIntegrationStatus,
  CodexValidationState,
  InstallStatus,
  JobLog,
  ProjectStatus,
} from '../../shared/types.js';
import { parseStatusJson } from './status-parser.js';
import { logError, logInfo } from './runtime-logger.js';

export type CommandResult = { exitCode: number | null; stdout: string; stderr: string };
export type CommandRunner = (command: string, args: string[], cwd?: string) => Promise<CommandResult>;

const codexMcpHeader = '[mcp_servers.codegraph]';
const codexInjectionArgs = ['install', '--target=codex', '--location=global', '--yes'];

export const officialInstallCommand = {
  command: 'powershell.exe',
  args: [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    'irm https://raw.githubusercontent.com/colbymchenry/codegraph/main/install.ps1 | iex',
  ],
};

export function bundledCodeGraphPath(): string | null {
  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData) return null;
  return path.join(localAppData, 'codegraph', 'current', 'bin', process.platform === 'win32' ? 'codegraph.cmd' : 'codegraph');
}

export function codexConfigPath(homeDirectory = os.homedir()): string {
  return path.join(homeDirectory, '.codex', 'config.toml');
}

export async function detectCodexIntegration(
  runner?: CommandRunner,
  configPath = codexConfigPath(),
): Promise<CodexIntegrationStatus> {
  const run = runner ?? ((command, args, cwd) => spawnCommand(command, args, { cwd }));
  const install = await detectCodeGraphInstall(run);
  const configState = await readCodexConfigState(configPath);
  const codexValidation = await validateCodexConfig(run);
  const injected = configState === 'valid';
  const canInject = install.installed && configState === 'missing' && codexValidation !== 'invalid';

  return {
    injected,
    codeGraphInstalled: install.installed,
    configPath,
    configState,
    codexValidation,
    canInject,
    message: codexIntegrationMessage({
      configState,
      codexValidation,
      codeGraphInstalled: install.installed,
      injected,
    }),
  };
}

export function parseCodexConfigState(content: string): CodexConfigState {
  const lines = content.split(/\r?\n/);
  const headerIndex = lines.findIndex((line) => line.trim() === codexMcpHeader);
  if (headerIndex < 0) return 'missing';

  const sectionLines: string[] = [];
  for (const line of lines.slice(headerIndex + 1)) {
    if (/^\s*\[[^\]]+\]\s*$/.test(line)) break;
    sectionLines.push(line);
  }

  const command = sectionLines.find((line) => /^\s*command\s*=/.test(line));
  const args = sectionLines.find((line) => /^\s*args\s*=/.test(line));
  const commandMatches = /^\s*command\s*=\s*"([^"]*)"\s*(?:#.*)?$/.exec(command ?? '');
  const argsMatches = /^\s*args\s*=\s*\[\s*"([^"]*)"\s*,\s*"([^"]*)"\s*\]\s*(?:#.*)?$/.exec(args ?? '');

  return commandMatches?.[1] === 'codegraph' && argsMatches?.[1] === 'serve' && argsMatches?.[2] === '--mcp'
    ? 'valid'
    : 'conflict';
}

async function readCodexConfigState(configPath: string): Promise<CodexConfigState> {
  try {
    return parseCodexConfigState(await fs.readFile(configPath, 'utf8'));
  } catch (error) {
    if (isFileMissingError(error)) return 'missing';
    return 'unreadable';
  }
}

async function validateCodexConfig(run: CommandRunner): Promise<CodexValidationState> {
  const commandPath = await findCommandOnPath('codex', run);
  if (!commandPath) return 'unavailable';
  const result = await run(commandPath, ['mcp', 'list']).catch(() => null);
  return result?.exitCode === 0 ? 'valid' : 'invalid';
}

function codexIntegrationMessage({
  configState,
  codexValidation,
  codeGraphInstalled,
  injected,
}: Pick<CodexIntegrationStatus, 'configState' | 'codexValidation' | 'codeGraphInstalled' | 'injected'>): string {
  if (codexValidation === 'invalid') return 'Codex 配置无法解析，请先修复 Codex 配置。';
  if (configState === 'unreadable') return '无法读取 Codex 配置文件。';
  if (configState === 'conflict') return '检测到已有 CodeGraph 配置，但内容与官方配置不一致。';
  if (!codeGraphInstalled) return '未安装 CodeGraph，暂时不能注入 Codex。';
  if (injected && codexValidation === 'unavailable') return 'CodeGraph 已注入 Codex，未找到 codex 命令，跳过完整校验。';
  if (injected) return 'CodeGraph 已注入 Codex。';
  if (codexValidation === 'unavailable') return '尚未注入 Codex，未找到 codex 命令，已完成文件级检测。';
  return 'CodeGraph 已安装，可以注入 Codex。';
}

function isFileMissingError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT');
}

export async function detectCodeGraphInstall(runner?: CommandRunner): Promise<InstallStatus> {
  const run = runner ?? ((command, args) => spawnCommand(command, args));
  const fromPath = await findCodeGraphOnPath(run);
  const bundled = bundledCodeGraphPath();
  const bundledExists = bundled ? await exists(bundled) : false;
  const commandPath = fromPath ?? (bundledExists ? bundled : null);
  const version = commandPath ? await readCodeGraphVersion(commandPath, run) : null;

  return {
    installed: Boolean(commandPath),
    version,
    commandPath,
    bundledPath: bundledExists ? bundled : bundled,
    message: commandPath ? 'CodeGraph 已可用。' : '未检测到 CodeGraph。',
  };
}

export async function startOfficialInstall(
  jobId: string,
  sender: WebContents,
  appendLog: (stream: JobLog['stream'], text: string) => void,
): Promise<ProjectStatus> {
  appendLog('system', '正在启动 CodeGraph 官方独立安装脚本。');
  const result = await spawnCommand(officialInstallCommand.command, officialInstallCommand.args, {
    cwd: process.env.USERPROFILE ?? process.cwd(),
    sender,
    jobId,
    appendLog,
  });
  if (result.exitCode !== 0) {
    throw new Error(`安装程序失败，退出码：${result.exitCode ?? 'unknown'}。`);
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
  const result = await runCodeGraphCliCommand(args, {
    cwd: projectPath,
    sender: options.sender,
    appendLog: options.appendLog,
  });

  if (result.exitCode !== 0) {
    throw new Error(result.stderr.trim() || `codegraph ${args[0]} 执行失败，退出码：${result.exitCode}。`);
  }

  if (args.includes('--json')) {
    return parseStatusJson(result.stdout, projectPath);
  }

  return runCodeGraphCommand(projectPath, ['status', projectPath, '--json']);
}

export async function runCodeGraphCliCommand(
  args: string[],
  options: {
    cwd?: string;
    sender?: WebContents;
    jobId?: string;
    appendLog?: (stream: JobLog['stream'], text: string) => void;
  } = {},
  runner?: CommandRunner,
): Promise<CommandResult> {
  const run = runner ?? ((command, commandArgs, cwd) => spawnCommand(command, commandArgs, {
    cwd,
    sender: options.sender,
    jobId: options.jobId,
    appendLog: options.appendLog,
  }));
  const install = await detectCodeGraphInstall(run);
  if (!install.commandPath) {
    throw new Error('未安装 CodeGraph。');
  }
  return run(install.commandPath, args, options.cwd ?? process.cwd());
}

export async function startCodexInjection(
  jobId: string,
  sender: WebContents,
  appendLog: (stream: JobLog['stream'], text: string) => void,
  runner?: CommandRunner,
  configPath = codexConfigPath(),
): Promise<CodexIntegrationStatus> {
  const before = await detectCodexIntegration(runner, configPath);
  if (!before.canInject) {
    throw new Error(before.message);
  }

  appendLog('system', '正在调用 CodeGraph 官方安装器注入 Codex MCP。');
  const result = await runCodeGraphCliCommand(codexInjectionArgs, {
    cwd: process.env.USERPROFILE ?? process.cwd(),
    sender,
    jobId,
    appendLog,
  }, runner);
  if (result.exitCode !== 0) {
    throw new Error(result.stderr.trim() || `Codex 注入失败，退出码：${result.exitCode ?? 'unknown'}。`);
  }

  const after = await detectCodexIntegration(runner, configPath);
  if (!after.injected) {
    throw new Error(`注入命令已完成，但未检测到有效的 Codex MCP 配置：${after.message}`);
  }
  return after;
}

export async function readCodeGraphStatus(projectPath: string): Promise<ProjectStatus> {
  try {
    return await runCodeGraphCommand(projectPath, ['status', projectPath, '--json']);
  } catch (error) {
    return {
      ...createUnavailableStatus(projectPath),
      error: error instanceof Error ? error.message : String(error),
    };
  }
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

async function findCodeGraphOnPath(run: CommandRunner): Promise<string | null> {
  return findCommandOnPath('codegraph', run);
}

async function findCommandOnPath(commandName: string, run: CommandRunner): Promise<string | null> {
  const command = process.platform === 'win32' ? 'where.exe' : 'which';
  const result = await run(command, [commandName]).catch(() => null);
  if (!result || result.exitCode !== 0) return null;
  return result.stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? null;
}

async function readCodeGraphVersion(commandPath: string, run: CommandRunner): Promise<string | null> {
  const result = await run(commandPath, ['version']).catch(() => null);
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
    const spawnSpec = normalizeSpawnCommand(command, args);
    logInfo('Spawning command', { command: spawnSpec.command, args: spawnSpec.args, originalCommand: command, originalArgs: args, cwd: options.cwd });
    const child = spawn(spawnSpec.command, spawnSpec.args, {
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
    child.on('error', (error) => {
      logError('Command spawn failed', { command: spawnSpec.command, args: spawnSpec.args, originalCommand: command, originalArgs: args, error });
      reject(error);
    });
    child.on('close', (exitCode) => {
      logInfo('Command finished', { command: spawnSpec.command, args: spawnSpec.args, originalCommand: command, originalArgs: args, exitCode, stdoutLength: stdout.length, stderrLength: stderr.length });
      resolve({ exitCode, stdout, stderr });
    });
  });
}

export function normalizeSpawnCommand(command: string, args: string[]): { command: string; args: string[] } {
  const standalone = resolveStandaloneCodeGraphCommand(command, args);
  if (standalone) {
    return standalone;
  }

  if (process.platform !== 'win32' || !/\.(cmd|bat)$/i.test(command)) {
    return { command, args };
  }

  const commandLine = [quoteCmdArg(command), ...args.map(quoteCmdArg)].join(' ');
  return {
    command: 'cmd.exe',
    args: ['/d', '/c', `call ${commandLine}`],
  };
}

function resolveStandaloneCodeGraphCommand(command: string, args: string[]): { command: string; args: string[] } | null {
  if (process.platform !== 'win32' || path.basename(command).toLowerCase() !== 'codegraph.cmd') {
    return null;
  }

  const currentDir = path.resolve(path.dirname(command), '..');
  const nodePath = path.join(currentDir, 'node.exe');
  const cliPath = path.join(currentDir, 'lib', 'dist', 'bin', 'codegraph.js');
  try {
    // The standalone Windows launcher is a tiny .cmd wrapper. Running the
    // real node entrypoint avoids cmd.exe/%* quote loss for project paths with spaces.
    requireFile(nodePath);
    requireFile(cliPath);
    return {
      command: nodePath,
      args: ['--liftoff-only', cliPath, ...args],
    };
  } catch {
    return null;
  }
}

function requireFile(filePath: string): void {
  if (!fsSync.existsSync(filePath)) {
    throw new Error(`missing file: ${filePath}`);
  }
}

function quoteCmdArg(value: string): string {
  if (value.length === 0) return '""';
  if (!/[\s"&|<>^]/.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

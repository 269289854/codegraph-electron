import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  detectCodexIntegration,
  detectCodeGraphInstall,
  normalizeSpawnCommand,
  officialInstallCommand,
  parseCodexConfigState,
  startCodexInjection,
  type CommandRunner,
} from '../src/electron/services/codegraph.js';

const pathLookupCommand = process.platform === 'win32' ? 'where.exe' : 'which';
const codeGraphCommandPath = 'C:\\tools\\codegraph.cmd';

function createRunner(options: {
  codeGraphInstalled?: boolean;
  codexInstalled?: boolean;
  codexExitCode?: number;
  onInject?: () => void;
} = {}): { calls: Array<{ command: string; args: string[] }>; runner: CommandRunner } {
  const calls: Array<{ command: string; args: string[] }> = [];
  const runner: CommandRunner = async (command, args) => {
    calls.push({ command, args });
    if (command === pathLookupCommand && args[0] === 'codegraph') {
      return options.codeGraphInstalled === false
        ? { exitCode: 1, stdout: '', stderr: 'not found' }
        : { exitCode: 0, stdout: `${codeGraphCommandPath}\r\n`, stderr: '' };
    }
    if (command === pathLookupCommand && args[0] === 'codex') {
      return options.codexInstalled
        ? { exitCode: 0, stdout: 'C:\\tools\\codex.cmd\r\n', stderr: '' }
        : { exitCode: 1, stdout: '', stderr: 'not found' };
    }
    if (command === codeGraphCommandPath && args[0] === 'version') {
      return { exitCode: 0, stdout: '1.1.5\n', stderr: '' };
    }
    if (command === 'C:\\tools\\codex.cmd' && args[0] === 'mcp' && args[1] === 'list') {
      return { exitCode: options.codexExitCode ?? 0, stdout: '', stderr: options.codexExitCode ? 'invalid config' : '' };
    }
    if (command === codeGraphCommandPath && args[0] === 'install') {
      options.onInject?.();
      return { exitCode: 0, stdout: 'installed\n', stderr: '' };
    }
    return { exitCode: 1, stdout: '', stderr: 'not found' };
  };
  return { calls, runner };
}

async function withMissingBundledInstall<T>(callback: () => Promise<T>): Promise<T> {
  const originalLocalAppData = process.env.LOCALAPPDATA;
  process.env.LOCALAPPDATA = path.join(os.tmpdir(), 'codegraph-electron-missing-bundle');
  try {
    return await callback();
  } finally {
    process.env.LOCALAPPDATA = originalLocalAppData;
  }
}

describe('CodeGraph install detection', () => {
  it('builds the official Windows installer command', () => {
    expect(officialInstallCommand.command).toBe('powershell.exe');
    expect(officialInstallCommand.args).toContain('-NoProfile');
    expect(officialInstallCommand.args.join(' ')).toContain('install.ps1');
    expect(officialInstallCommand.args.join(' ')).toContain('colbymchenry/codegraph');
  });

  it('detects codegraph on PATH and reads version', async () => {
    const status = await detectCodeGraphInstall(async (command, args) => {
      if ((command === 'where.exe' || command === 'which') && args[0] === 'codegraph') {
        return { exitCode: 0, stdout: 'C:\\tools\\codegraph.cmd\r\n', stderr: '' };
      }
      if (command === 'C:\\tools\\codegraph.cmd' && args[0] === 'version') {
        return { exitCode: 0, stdout: '1.1.5\n', stderr: '' };
      }
      return { exitCode: 1, stdout: '', stderr: 'not found' };
    });

    expect(status.installed).toBe(true);
    expect(status.commandPath).toBe('C:\\tools\\codegraph.cmd');
    expect(status.version).toBe('1.1.5');
  });

  it('returns missing status when codegraph cannot be found', async () => {
    const originalLocalAppData = process.env.LOCALAPPDATA;
    process.env.LOCALAPPDATA = 'C:\\definitely-missing-codegraph-test-dir';
    const status = await detectCodeGraphInstall(async () => ({ exitCode: 1, stdout: '', stderr: 'not found' }));
    process.env.LOCALAPPDATA = originalLocalAppData;

    expect(status.installed).toBe(false);
    expect(status.commandPath).toBeNull();
    expect(status.version).toBeNull();
  });

  it('wraps Windows cmd launchers with cmd.exe', () => {
    const normalized = normalizeSpawnCommand('C:\\Program Files\\codegraph\\codegraph.cmd', [
      'init',
      'D:\\work\\github work\\wa-app-electron',
    ]);

    if (process.platform === 'win32') {
      expect(normalized.command).toBe('cmd.exe');
      expect(normalized.args.join(' ')).toContain('/c');
      expect(normalized.args.join(' ')).toContain('call');
      expect(normalized.args.join(' ')).toContain('"C:\\Program Files\\codegraph\\codegraph.cmd"');
      expect(normalized.args.join(' ')).toContain('"D:\\work\\github work\\wa-app-electron"');
    } else {
      expect(normalized.command).toContain('codegraph.cmd');
    }
  });

  it('resolves standalone codegraph.cmd to its node entrypoint', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codegraph-launcher-'));
    const current = path.join(root, 'current');
    const bin = path.join(current, 'bin');
    const cliDir = path.join(current, 'lib', 'dist', 'bin');
    fs.mkdirSync(bin, { recursive: true });
    fs.mkdirSync(cliDir, { recursive: true });
    fs.writeFileSync(path.join(current, 'node.exe'), '');
    fs.writeFileSync(path.join(cliDir, 'codegraph.js'), '');

    const normalized = normalizeSpawnCommand(path.join(bin, 'codegraph.cmd'), ['status', 'D:\\repo with spaces']);

    if (process.platform === 'win32') {
      expect(normalized.command).toBe(path.join(current, 'node.exe'));
      expect(normalized.args).toEqual([
        '--liftoff-only',
        path.join(cliDir, 'codegraph.js'),
        'status',
        'D:\\repo with spaces',
      ]);
    }
  });

  it('classifies Codex MCP configuration states', () => {
    expect(parseCodexConfigState('model = "gpt-5"\n')).toBe('missing');
    expect(parseCodexConfigState([
      '[mcp_servers.codegraph]',
      'command = "codegraph"',
      'args = ["serve", "--mcp"]',
    ].join('\n'))).toBe('valid');
    expect(parseCodexConfigState([
      '[mcp_servers.codegraph]',
      'command = "other-server"',
      'args = ["serve", "--mcp"]',
    ].join('\n'))).toBe('conflict');
  });

  it('enables Codex injection only when CodeGraph is installed and config is missing', async () => {
    const configPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'codegraph-codex-')), 'config.toml');
    const { runner } = createRunner();

    const status = await withMissingBundledInstall(() => detectCodexIntegration(runner, configPath));

    expect(status.configState).toBe('missing');
    expect(status.injected).toBe(false);
    expect(status.canInject).toBe(true);
  });

  it('keeps injection disabled for unreadable or invalid Codex configuration', async () => {
    const unreadablePath = fs.mkdtempSync(path.join(os.tmpdir(), 'codegraph-codex-dir-'));
    const unreadableRunner = createRunner();
    const unreadable = await withMissingBundledInstall(() => detectCodexIntegration(unreadableRunner.runner, unreadablePath));

    expect(unreadable.configState).toBe('unreadable');
    expect(unreadable.canInject).toBe(false);

    const invalidConfigPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'codegraph-codex-invalid-')), 'config.toml');
    const invalidRunner = createRunner({ codexInstalled: true, codexExitCode: 1 });
    const invalid = await withMissingBundledInstall(() => detectCodexIntegration(invalidRunner.runner, invalidConfigPath));

    expect(invalid.codexValidation).toBe('invalid');
    expect(invalid.canInject).toBe(false);
  });

  it('falls back to file-level detection when codex is unavailable', async () => {
    const configPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'codegraph-codex-no-cli-')), 'config.toml');
    fs.writeFileSync(configPath, '[mcp_servers.codegraph]\ncommand = "codegraph"\nargs = ["serve", "--mcp"]\n');
    const { runner } = createRunner();

    const status = await withMissingBundledInstall(() => detectCodexIntegration(runner, configPath));

    expect(status.injected).toBe(true);
    expect(status.codexValidation).toBe('unavailable');
    expect(status.canInject).toBe(false);
  });

  it('rejects Codex injection when CodeGraph is not installed', async () => {
    const configPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'codegraph-codex-no-codegraph-')), 'config.toml');
    const { runner } = createRunner({ codeGraphInstalled: false });

    await expect(withMissingBundledInstall(() => startCodexInjection('inject-test', undefined as never, () => undefined, runner, configPath)))
      .rejects.toThrow('未安装 CodeGraph');
  });

  it('injects through the official CLI arguments and verifies the result', async () => {
    const configPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'codegraph-codex-inject-')), 'config.toml');
    const { calls, runner } = createRunner({
      onInject: () => fs.writeFileSync(configPath, '[mcp_servers.codegraph]\ncommand = "codegraph"\nargs = ["serve", "--mcp"]\n'),
    });

    const status = await withMissingBundledInstall(() => startCodexInjection('inject-test', undefined as never, () => undefined, runner, configPath));
    const injectionCall = calls.find((call) => call.command === codeGraphCommandPath && call.args[0] === 'install');

    expect(injectionCall?.args).toEqual(['install', '--target=codex', '--location=global', '--yes']);
    expect(status.injected).toBe(true);
    expect(status.configState).toBe('valid');
  });
});

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { detectCodeGraphInstall, normalizeSpawnCommand, officialInstallCommand } from '../src/electron/services/codegraph.js';

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
});

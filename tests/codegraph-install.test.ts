import { describe, expect, it } from 'vitest';
import { detectCodeGraphInstall, officialInstallCommand } from '../src/electron/services/codegraph.js';

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
    const status = await detectCodeGraphInstall(async () => ({ exitCode: 1, stdout: '', stderr: 'not found' }));

    expect(status.installed).toBe(false);
    expect(status.commandPath).toBeNull();
    expect(status.version).toBeNull();
  });
});

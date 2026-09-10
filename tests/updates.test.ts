import { describe, expect, it } from 'vitest';
import { checkForUpdates, compareVersions } from '../src/electron/services/updates.js';

function createFetcher(payload: unknown, options: { ok?: boolean; status?: number } = {}): (url: string) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}> {
  return async () => ({
    ok: options.ok ?? true,
    status: options.status ?? 200,
    json: async () => payload,
  });
}

describe('CodeGraph update checking', () => {
  it('compares dotted version segments', () => {
    expect(compareVersions('1.2.0', '1.1.9')).toBe(1);
    expect(compareVersions('1.10.0', '1.9.0')).toBe(1);
    expect(compareVersions('v2.0.0', 'v1.5.0')).toBe(1);
    expect(compareVersions('1.1.5', '1.1.5')).toBe(0);
    expect(compareVersions('1.1.5', '2.0.0')).toBe(-1);
    expect(compareVersions('1.1', '1.1.0')).toBe(0);
  });

  it('reports an available update when the remote tag is newer', async () => {
    const status = await checkForUpdates('1.1.5', createFetcher({ tag_name: 'v1.2.0', html_url: 'https://github.com/colbymchenry/codegraph/releases/tag/v1.2.0' }));

    expect(status.updateAvailable).toBe(true);
    expect(status.latestVersion).toBe('1.2.0');
    expect(status.releaseUrl).toBe('https://github.com/colbymchenry/codegraph/releases/tag/v1.2.0');
  });

  it('reports up to date when the remote tag is not newer', async () => {
    const status = await checkForUpdates('1.2.0', createFetcher({ tag_name: '1.2.0' }));

    expect(status.updateAvailable).toBe(false);
    expect(status.latestVersion).toBe('1.2.0');
  });

  it('does not report an update when no local version is known', async () => {
    const status = await checkForUpdates(null, createFetcher({ tag_name: 'v1.2.0' }));

    expect(status.updateAvailable).toBe(false);
    expect(status.latestVersion).toBe('1.2.0');
  });

  it('reports a GitHub error without throwing', async () => {
    const status = await checkForUpdates('1.1.5', createFetcher({}, { ok: false, status: 403 }));

    expect(status.updateAvailable).toBe(false);
    expect(status.message).toContain('403');
  });

  it('reports a network failure without throwing', async () => {
    const status = await checkForUpdates('1.1.5', async () => {
      throw new Error('network down');
    });

    expect(status.updateAvailable).toBe(false);
    expect(status.error).toBe('network down');
    expect(status.message).toContain('检查更新失败');
  });
});

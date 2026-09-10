import type { WebContents } from 'electron';
import type { JobLog, UpdateStatus } from '../../shared/types.js';
import { runCodeGraphCliCommand } from './codegraph.js';

const latestReleaseUrl = 'https://api.github.com/repos/colbymchenry/codegraph/releases/latest';
const releasePageUrl = 'https://github.com/colbymchenry/codegraph/releases/latest';

type Fetcher = (url: string) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

export async function checkForUpdates(installedVersion: string | null, fetcher?: Fetcher): Promise<UpdateStatus> {
  const fetchJson = fetcher ?? defaultFetcher;
  try {
    const response = await fetchJson(latestReleaseUrl);
    if (!response.ok) {
      return {
        installedVersion,
        latestVersion: null,
        updateAvailable: false,
        releaseUrl: null,
        message: `检查更新失败：GitHub 返回 ${response.status}。`,
        checkedAt: Date.now(),
      };
    }
    const payload = (await response.json()) as { tag_name?: unknown; html_url?: unknown };
    const tag = typeof payload.tag_name === 'string' ? payload.tag_name.replace(/^v/, '') : null;
    const releaseUrl = typeof payload.html_url === 'string' ? payload.html_url : releasePageUrl;
    const updateAvailable = Boolean(installedVersion && tag && compareVersions(tag, installedVersion) > 0);
    return {
      installedVersion,
      latestVersion: tag,
      updateAvailable,
      releaseUrl,
      message: updateAvailable
        ? `发现新版本 CodeGraph ${tag}，当前安装 ${installedVersion}。`
        : tag
          ? `CodeGraph 已是最新版本 ${tag}。`
          : '无法解析远端版本信息。',
      checkedAt: Date.now(),
    };
  } catch (error) {
    return {
      installedVersion,
      latestVersion: null,
      updateAvailable: false,
      releaseUrl: null,
      message: '检查更新失败，请确认网络连接。',
      checkedAt: Date.now(),
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function compareVersions(a: string, b: string): number {
  const left = versionSegments(a);
  const right = versionSegments(b);
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference > 0 ? 1 : -1;
  }
  return 0;
}

function versionSegments(version: string): number[] {
  return version
    .replace(/^v/i, '')
    .split('.')
    .map((segment) => Number.parseInt(segment, 10))
    .map((segment) => (Number.isNaN(segment) ? 0 : segment));
}

export async function runCodeGraphUpgrade(
  jobId: string,
  sender: WebContents,
  appendLog: (stream: JobLog['stream'], text: string) => void,
): Promise<string> {
  appendLog('system', '正在调用 CodeGraph 官方升级命令 codegraph upgrade。');
  const result = await runCodeGraphCliCommand(['upgrade'], {
    cwd: process.env.USERPROFILE ?? process.cwd(),
    sender,
    jobId,
    appendLog,
  });
  if (result.exitCode !== 0) {
    throw new Error(result.stderr.trim() || `升级失败，退出码：${result.exitCode ?? 'unknown'}。`);
  }
  return result.stdout.trim();
}

async function defaultFetcher(url: string): Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    return await fetch(url, {
      headers: { accept: 'application/vnd.github+json' },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import util from 'node:util';

type LogLevel = 'info' | 'warn' | 'error';

let logFilePath: string | null = null;

export function getRuntimeLogPath(): string {
  if (!logFilePath) {
    const logDir = path.join(app.getPath('userData'), 'logs');
    fs.mkdirSync(logDir, { recursive: true });
    logFilePath = path.join(logDir, 'runtime.log');
  }
  return logFilePath;
}

export function logInfo(message: string, meta?: unknown): void {
  writeLog('info', message, meta);
}

export function logWarn(message: string, meta?: unknown): void {
  writeLog('warn', message, meta);
}

export function logError(message: string, meta?: unknown): void {
  writeLog('error', message, meta);
}

function writeLog(level: LogLevel, message: string, meta?: unknown): void {
  try {
    const line = JSON.stringify({
      time: new Date().toISOString(),
      level,
      message,
      meta: normalizeMeta(meta),
    });
    fs.appendFileSync(getRuntimeLogPath(), `${line}\n`, 'utf-8');
  } catch {
    // Logging must never break app startup or IPC.
  }
}

function normalizeMeta(meta: unknown): unknown {
  if (meta instanceof Error) {
    return {
      name: meta.name,
      message: meta.message,
      stack: meta.stack,
    };
  }
  if (meta === undefined) return undefined;
  try {
    JSON.stringify(meta);
    return meta;
  } catch {
    return util.inspect(meta, { depth: 4, breakLength: 160 });
  }
}

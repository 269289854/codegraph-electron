import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getRuntimeLogPath, logError, logInfo, logWarn } from './services/runtime-logger.js';
import './ipc.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isDev = !app.isPackaged;
let mainWindow: BrowserWindow | null = null;

function getAppIconPath(): string {
  return isDev
    ? path.join(__dirname, '../../build/icon.ico')
    : path.join(process.resourcesPath, 'build/icon.ico');
}

function createWindow(): void {
  logInfo('Creating main window', { isPackaged: app.isPackaged, logPath: getRuntimeLogPath() });
  const window = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1120,
    minHeight: 720,
    title: 'CodeGraph Manager',
    backgroundColor: '#101216',
    icon: getAppIconPath(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  window.webContents.on('did-finish-load', () => {
    logInfo('Renderer loaded', { url: window.webContents.getURL() });
  });
  window.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    logError('Renderer failed to load', { errorCode, errorDescription, validatedURL });
  });
  window.webContents.on('render-process-gone', (_event, details) => {
    logError('Renderer process gone', details);
  });
  window.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    if (level >= 2) {
      logWarn('Renderer console message', { level, message, line, sourceId });
    }
  });
  window.on('closed', () => {
    if (mainWindow === window) {
      mainWindow = null;
    }
  });
  mainWindow = window;

  if (isDev) {
    logInfo('Loading development renderer', { url: 'http://127.0.0.1:5173' });
    void window.loadURL('http://127.0.0.1:5173');
    window.webContents.openDevTools({ mode: 'detach' });
  } else {
    const rendererPath = path.join(__dirname, '../../dist/index.html');
    logInfo('Loading packaged renderer', { rendererPath });
    void window.loadFile(rendererPath);
  }
}

function showMainWindow(): void {
  if (!mainWindow) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  mainWindow.focus();
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    logInfo('Second instance requested, focusing existing window');
    showMainWindow();
  });

  app.whenReady().then(() => {
    app.setAppUserModelId('com.yizhimeng.codegraph-electron');
    logInfo('App ready', {
      version: app.getVersion(),
      electron: process.versions.electron,
      node: process.versions.node,
      platform: process.platform,
      arch: process.arch,
    });
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      } else {
        showMainWindow();
      }
    });
  });
}

process.on('uncaughtException', (error) => {
  logError('Uncaught exception', error);
});

process.on('unhandledRejection', (reason) => {
  logError('Unhandled rejection', reason);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    logInfo('All windows closed, quitting app');
    app.quit();
  }
});

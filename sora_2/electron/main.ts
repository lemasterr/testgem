import path from 'path';
import { app, BrowserWindow, ipcMain, shell } from 'electron';
import { getConfig, updateConfig } from './config/config';
import {
  listChromeProfiles,
  scanChromeProfiles,
  setActiveChromeProfile,
  cloneActiveChromeProfile,
  resolveChromeProfileForSession,
} from './chrome/profiles';
import { getSession, listSessions, saveSession, deleteSession } from './sessions/repo';
import { runPrompts, cancelPrompts } from './automation/promptsRunner';
import { runDownloads, cancelDownloads } from './automation/downloader';
import { runPipeline, cancelPipeline } from './automation/pipeline';
import { extractPreviewFrames, pickSmartPreviewFrames } from './video/ffmpegWatermark';
import { blurVideoWithProfile, listBlurProfiles, saveBlurProfile, deleteBlurProfile } from './video/ffmpegBlur';
import { testTelegram, sendTelegramMessage } from './integrations/telegram';
import { loggerEvents, logError } from './logging/logger';
import { clearLogFile, ensureLogDestination, logInfo } from '../core/utils/log';
import { pages } from '../core/config/pages';
import { getDailyStats, getTopSessions } from './logging/history';
import { getLastSelectorForSession, startInspectorForSession } from './automation/selectorInspector';
import { runCleanupNow, scheduleDailyCleanup } from './maintenance/cleanup';
import { openProfileFolder, readProfileFiles, saveProfileFiles } from './content/profileFiles';
import { sessionLogBroker } from './sessionLogs';
import { launchBrowserForSession } from './chrome/cdp';
import { shutdownAllChrome } from './chrome/manager';
import { resolveSessionCdpPort } from './utils/ports';
import type { Session } from './sessions/types';
import type { SessionCommandAction, WorkflowClientStep } from '../shared/types';
import type { Browser } from 'puppeteer-core';

let mainWindow: BrowserWindow | null = null;
const manualBrowsers = new Map<string, Browser>();

const isDev = process.env.NODE_ENV !== 'production';

function createMainWindow(): void {
  const preload = path.join(__dirname, 'preload.js');

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    frame: false,
    backgroundColor: '#09090b',
    webPreferences: {
      preload,
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    const indexPath = path.join(__dirname, '..', '..', 'dist', 'index.html');
    mainWindow.loadFile(indexPath);
  }

  loggerEvents.on('log', (entry) => {
    mainWindow?.webContents.send('logging:push', entry);
  });
}

function logSession(sessionId: string, scope: string, level: 'info' | 'error', message: string) {
  const entry = { timestamp: Date.now(), scope, level, message };
  sessionLogBroker.log(sessionId, entry);
}

async function findSessionByKey(key: string): Promise<Session | null> {
  const direct = await getSession(key);
  if (direct) return direct as Session;
  const all = await listSessions();
  return (all.find((s) => s.name === key) as Session | undefined) ?? null;
}

async function getOrLaunchManualBrowser(session: Session): Promise<Browser> {
  const existing = manualBrowsers.get(session.id);
  if (existing && existing.isConnected()) {
    return existing;
  }

  const profile = await resolveChromeProfileForSession({ chromeProfileName: session.chromeProfileName });
  if (!profile) {
    throw new Error('No Chrome profile available. Select a Chrome profile in Settings.');
  }

  const config = await getConfig();
  const safePort = resolveSessionCdpPort(session, config.cdpPort ?? 9222);
  const browser = await launchBrowserForSession(profile, safePort);
  manualBrowsers.set(session.id, browser);
  return browser;
}

logInfo(`[main] starting, NODE_ENV=${process.env.NODE_ENV}`);

app.whenReady()
  .then(() => {
    logInfo('[main] app is ready, creating window');
    createMainWindow();
  })
  .then(() => {
    scheduleDailyCleanup();
    logInfo('[main] daily cleanup scheduled');
  });

app.on('window-all-closed', () => {
  logInfo('[main] window-all-closed');
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', async () => {
  logInfo('[main] before-quit');
  for (const browser of manualBrowsers.values()) {
    try {
      browser.close();
    } catch {
      // ignore
    }
  }
  manualBrowsers.clear();
  await shutdownAllChrome();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createMainWindow();
  }
});

function handle<T extends any[]>(channel: string, fn: (...args: T) => Promise<any> | any) {
  ipcMain.handle(channel, async (_event, ...args: T) => {
    try {
      return await fn(...args);
    } catch (error) {
      const message = (error as Error)?.message || 'IPC handler failed';
      logError('ipc', `${channel}: ${message}`);
      return { ok: false, error: message };
    }
  });
}

handle('config:get', async () => getConfig());
handle('config:update', async (partial) => updateConfig(partial));

handle('chrome:scanProfiles', async () => {
  const profiles = await scanChromeProfiles();
  return { ok: true, profiles };
});
handle('chrome:listProfiles', async () => {
  const profiles = await listChromeProfiles();
  return { ok: true, profiles };
});
handle('chrome:setActiveProfile', async (name: string) => {
  await setActiveChromeProfile(name);
  const profiles = await listChromeProfiles();
  return { ok: true, profiles };
});
handle('chrome:cloneProfile', async () => cloneActiveChromeProfile());

ipcMain.handle('sessions:subscribeLogs', (event, sessionId: string) => {
  sessionLogBroker.subscribe(sessionId, event.sender);
  return { ok: true };
});

ipcMain.handle('sessions:unsubscribeLogs', (event, sessionId: string) => {
  sessionLogBroker.unsubscribe(sessionId, event.sender.id);
  return { ok: true };
});

handle('sessions:list', async () => listSessions());
handle('sessions:get', async (id: string) => getSession(id));
handle('sessions:save', async (session) => saveSession(session));
handle('sessions:delete', async (id: string) => deleteSession(id));
handle('sessions:command', async (sessionId: string, action: SessionCommandAction) => {
  const session = await getSession(sessionId);
  if (!session) return { ok: false, error: 'Session not found' };

  const config = await getConfig();
  const safePort = resolveSessionCdpPort(session, config.cdpPort ?? 9222);

  try {
    if (action === 'startChrome') {
      const profile = await resolveChromeProfileForSession({ chromeProfileName: session.chromeProfileName });
      if (!profile) throw new Error('No Chrome profile available. Select a Chrome profile in Settings.');
      const existing = manualBrowsers.get(session.id);
      if (existing) {
        try {
          await existing.close();
        } catch {
          // ignore close errors
        }
      }
      const browser = await launchBrowserForSession(profile, safePort);
      manualBrowsers.set(session.id, browser);
      logSession(session.id, 'Chrome', 'info', `Started Chrome on port ${safePort}`);
      return { ok: true, details: `Started Chrome on port ${safePort}` };
    }

    if (action === 'runPrompts') {
      logSession(session.id, 'Prompts', 'info', 'Starting prompt run');
      const result = await runPrompts(session as Session);
      logSession(session.id, 'Prompts', result.ok ? 'info' : 'error', result.ok ? 'Prompts finished' : result.error || 'Prompt run failed');
      return result;
    }

    if (action === 'runDownloads') {
      logSession(session.id, 'Download', 'info', 'Starting downloads');
      const result = await runDownloads(session as Session, session.maxVideos ?? 0);
      logSession(session.id, 'Download', result.ok ? 'info' : 'error', result.ok ? 'Downloads finished' : result.error || 'Download run failed');
      return result;
    }

    if (action === 'cleanWatermark') {
      logSession(session.id, 'Watermark', 'info', 'Watermark cleanup not implemented');
      return { ok: false, error: 'Watermark cleanup is not implemented yet' };
    }

    if (action === 'stop') {
      await cancelPrompts(session.id);
      await cancelDownloads(session.id);
      const browser = manualBrowsers.get(session.id);
      if (browser) {
        try {
          await browser.close();
        } catch {
          // ignore
        }
        manualBrowsers.delete(session.id);
      }
      logSession(session.id, 'Worker', 'info', 'Stop signal sent');
      return { ok: true, details: 'Stopped session workers' };
    }

    return { ok: false, error: `Unknown action ${action}` };
  } catch (error) {
    const message = (error as Error).message || 'Session command failed';
    logSession(session.id, 'Worker', 'error', message);
    return { ok: false, error: message };
  }
});
handle('files:read', async (profileName?: string | null) => {
  const files = await readProfileFiles(profileName);
  return { ok: true, files };
});
handle('files:save', async (profileName: string | null, files) => saveProfileFiles(profileName, files));
handle('files:openFolder', async (profileName?: string | null) => openProfileFolder(profileName));
handle('sessions:runPrompts', async (id: string) => {
  const session = await getSession(id);
  if (!session) return { ok: false, error: 'Session not found' };
  return runPrompts(session as any);
});
handle('sessions:cancelPrompts', async (id: string) => cancelPrompts(id));
handle('sessions:runDownloads', async (id: string, maxVideos?: number) => {
  const session = await getSession(id);
  if (!session) return { ok: false, error: 'Session not found' };
  return runDownloads(session as any, maxVideos ?? 0);
});
handle('sessions:cancelDownloads', async (id: string) => cancelDownloads(id));

handle('downloader:run', async (sessionId: string, options?: { limit?: number }) => {
  const session = await getSession(sessionId);
  if (!session) return { ok: false, error: 'Session not found' };
  const limit = options?.limit ?? session.maxVideos ?? 0;
  return runDownloads(session as Session, limit ?? 0);
});

handle('downloader:stop', async (sessionId: string) => {
  cancelDownloads(sessionId);
  return { ok: true };
});

handle('downloader:openDrafts', async (sessionKey: string) => {
  const session = await findSessionByKey(sessionKey);
  if (!session) return { ok: false, error: 'Session not found' };

  try {
    const browser = await getOrLaunchManualBrowser(session as Session);
    const page = await browser.newPage();
    await page.goto(pages.draftsUrl, { waitUntil: 'networkidle2' });
    return { ok: true, details: 'Drafts page opened' };
  } catch (error) {
    const message = (error as Error).message || 'Failed to open drafts';
    return { ok: false, error: message };
  }
});

handle('downloader:scanDrafts', async (sessionKey: string) => {
  const session = await findSessionByKey(sessionKey);
  if (!session) return { ok: false, error: 'Session not found' };

  try {
    const browser = await getOrLaunchManualBrowser(session as Session);
    const page = await browser.newPage();
    await page.goto(pages.draftsUrl, { waitUntil: 'networkidle2' });
    const cards = await page.$$('.sora-draft-card');
    return { ok: true, draftsFound: cards.length };
  } catch (error) {
    const message = (error as Error).message || 'Failed to scan drafts';
    return { ok: false, error: message };
  }
});

handle('downloader:downloadAll', async (sessionKey: string, options?: { limit?: number }) => {
  const session = await findSessionByKey(sessionKey);
  if (!session) return { ok: false, error: 'Session not found' };
  const limit = options?.limit ?? session.maxVideos ?? 0;
  return runDownloads(session as Session, limit ?? 0);
});

handle('pipeline:run', async (steps) => {
  const safeSteps: WorkflowClientStep[] = Array.isArray(steps)
    ? steps.map((step) => ({
        id: step?.id,
        label: step?.label,
        enabled: step?.enabled !== false,
        dependsOn: Array.isArray(step?.dependsOn) ? step.dependsOn : undefined,
      }))
    : [];

  await runPipeline(safeSteps, (status) => mainWindow?.webContents.send('pipeline:progress', status));
  return { ok: true };
});
handle('pipeline:cancel', async () => {
  cancelPipeline();
  return { ok: true };
});

handle('window:minimize', async () => {
  mainWindow?.minimize();
  return { ok: true };
});

handle('window:maximize', async () => {
  if (!mainWindow) return { ok: false, error: 'No window' };
  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow.maximize();
  }
  return { ok: true, maximized: mainWindow.isMaximized() };
});

handle('window:isMaximized', async () => {
  return mainWindow?.isMaximized() ?? false;
});

handle('window:close', async () => {
  mainWindow?.close();
  return { ok: true };
});

handle('video:extractPreviewFrames', async (videoPath: string, count: number) => extractPreviewFrames(videoPath, count));
handle('video:pickSmartPreviewFrames', async (videoPath: string, count: number) => pickSmartPreviewFrames(videoPath, count));
handle('video:blurWithProfile', async (input: string, output: string, profileId: string) =>
  blurVideoWithProfile(input, output, profileId)
);
handle('video:blurProfiles:list', async () => listBlurProfiles());
handle('video:blurProfiles:save', async (profile) => saveBlurProfile(profile));
handle('video:blurProfiles:delete', async (id: string) => deleteBlurProfile(id));

handle('telegram:test', async () => testTelegram());
handle('telegram:sendMessage', async (text: string) => sendTelegramMessage(text));

handle('analytics:getDailyStats', async (days: number) => getDailyStats(days ?? 7));
handle('analytics:getTopSessions', async (limit: number) => getTopSessions(limit ?? 5));

handle('selectorInspector:start', async (sessionId: string) => startInspectorForSession(sessionId));
handle('selectorInspector:getLast', async (sessionId: string) => getLastSelectorForSession(sessionId));

handle('cleanup:run', async () => runCleanupNow());

handle('logging:rendererError', async (payload) => {
  logError('renderer', JSON.stringify(payload));
  return { ok: true };
});

handle('system:openPath', async (target: string) => shell.openPath(target));
handle('logging:info', async () => {
  const { dir, file } = ensureLogDestination();
  if (!dir || !file) {
    return { ok: false, error: 'No writable log destination available.' };
  }
  return { ok: true, dir, file };
});

handle('logging:clear', async () => {
  const result = clearLogFile();
  if (!result.ok) return result;
  logInfo('[logging] log file cleared by user');
  return result;
});

handle('system:openLogs', async () => {
  const { dir } = ensureLogDestination();
  if (!dir) {
    return { ok: false, error: 'No writable log directory available.' };
  }
  await shell.openPath(dir);
  return { ok: true, dir };
});

// legacy
handle('ping', async () => 'pong');

export {};

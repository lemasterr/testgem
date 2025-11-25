// sora_2/electron/main.ts
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
// Import NEW Worker
import { runPromptsForSessionOldStyle } from './automation/soraPromptWorker';

import { extractPreviewFrames, pickSmartPreviewFrames } from './video/ffmpegWatermark';
import { blurVideoWithProfile, listBlurProfiles, saveBlurProfile, deleteBlurProfile } from './video/ffmpegBlur';
import { testTelegram, sendTelegramMessage } from './integrations/telegram';
import { loggerEvents, logError, logInfo } from './logging/logger';
import { clearLogFile, ensureLogDestination } from '../core/utils/log';
import { pages } from '../core/config/pages';
import { getDailyStats, getTopSessions } from './logging/history';
import { getLastSelectorForSession, startInspectorForSession } from './automation/selectorInspector';
import { runCleanupNow, scheduleDailyCleanup } from './maintenance/cleanup';
import { openProfileFolder, readProfileFiles, saveProfileFiles } from './content/profileFiles';
import { sessionLogBroker } from './sessionLogs';
import { launchBrowserForSession } from './chrome/cdp';
import { shutdownAllChrome } from './chrome/manager';
import { resolveSessionCdpPort } from './utils/ports';
import { startPythonServer, stopPythonServer } from './integrations/pythonClient';
import { runHealthCheck } from './healthCheck';
import './chrome/processManager';

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

logInfo('main', `starting, NODE_ENV=${process.env.NODE_ENV}`);

app.whenReady()
  .then(async () => {
    logInfo('main', 'app is ready');

    // Start Python Backend
    try {
      await startPythonServer();
    } catch (e) {
      logError('main', `Failed to start Python backend: ${(e as Error).message}`);
    }

    createMainWindow();
  })
  .then(() => {
    scheduleDailyCleanup();
    logInfo('main', 'daily cleanup scheduled');
  });

app.on('window-all-closed', () => {
  logInfo('main', 'window-all-closed');
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', async () => {
  logInfo('main', 'before-quit');
  // Stop Python Backend
  stopPythonServer();

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

// Helper to wrap IPC handlers with safe error logging
function registerIpc(channel: string, handler: (...args: any[]) => Promise<any> | any) {
  ipcMain.handle(channel, async (_event, ...args: any[]) => {
    try {
      return await handler(...args);
    } catch (error) {
      const message = (error as Error)?.message || 'IPC handler failed';
      logError('ipc', `${channel}: ${message}`);
      return { ok: false, error: message };
    }
  });
}

// --- IPC Handlers ---

registerIpc('config:get', async () => getConfig());
registerIpc('config:update', async (partial) => updateConfig(partial));
registerIpc('chrome:scanProfiles', async () => { const profiles = await scanChromeProfiles(); return { ok: true, profiles }; });
registerIpc('chrome:listProfiles', async () => { const profiles = await listChromeProfiles(); return { ok: true, profiles }; });
registerIpc('chrome:setActiveProfile', async (name: string) => { await setActiveChromeProfile(name); const profiles = await listChromeProfiles(); return { ok: true, profiles }; });
registerIpc('chrome:cloneProfile', async () => cloneActiveChromeProfile());

ipcMain.handle('sessions:subscribeLogs', (event, sessionId: string) => { sessionLogBroker.subscribe(sessionId, event.sender); return { ok: true }; });
ipcMain.handle('sessions:unsubscribeLogs', (event, sessionId: string) => { sessionLogBroker.unsubscribe(sessionId, event.sender.id); return { ok: true }; });

registerIpc('sessions:list', async () => listSessions());
registerIpc('sessions:get', async (id: string) => getSession(id));
registerIpc('sessions:save', async (session) => saveSession(session));
registerIpc('sessions:delete', async (id: string) => deleteSession(id));

registerIpc('sessions:command', async (sessionId: string, action: SessionCommandAction) => {
  const session = await getSession(sessionId);
  if (!session) return { ok: false, error: 'Session not found' };
  const config = await getConfig();
  const safePort = resolveSessionCdpPort(session, config.cdpPort ?? 9222);

  try {
    if (action === 'startChrome') {
      const profile = await resolveChromeProfileForSession({ chromeProfileName: session.chromeProfileName });
      if (!profile) throw new Error('No Chrome profile available.');
      const browser = await launchBrowserForSession(profile, safePort);
      manualBrowsers.set(session.id, browser);
      return { ok: true, details: `Started Chrome on port ${safePort}` };
    }
    if (action === 'runPrompts') {
       // SWITCHED TO NEW OLD-STYLE WORKER
       return runPromptsForSessionOldStyle(session as Session, session.maxVideos ?? 0);
    }
    if (action === 'runDownloads') return runDownloads(session as Session, session.maxVideos ?? 0);
    if (action === 'cleanWatermark') return { ok: false, error: 'Watermark cleanup is not implemented yet' };
    if (action === 'stop') {
      await cancelPrompts(session.id);
      await cancelDownloads(session.id);
      return { ok: true, details: 'Stopped session workers' };
    }
    return { ok: false, error: `Unknown action ${action}` };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
});

registerIpc('files:read', async (profileName) => ({ ok: true, files: await readProfileFiles(profileName) }));
registerIpc('files:save', async (profileName, files) => saveProfileFiles(profileName, files));
registerIpc('files:openFolder', async (profileName) => openProfileFolder(profileName));
registerIpc('sessions:runPrompts', async (id) => {
    const session = await getSession(id);
    return session ? runPromptsForSessionOldStyle(session as any, session.maxVideos ?? 0) : { ok: false };
});
registerIpc('sessions:cancelPrompts', async (id) => cancelPrompts(id));
registerIpc('sessions:runDownloads', async (id, max) => { const session = await getSession(id); return session ? runDownloads(session as any, max ?? 0) : { ok: false }; });
registerIpc('sessions:cancelDownloads', async (id) => cancelDownloads(id));
registerIpc('downloader:run', async (id, opt) => { const session = await getSession(id); return session ? runDownloads(session as any, opt?.limit ?? 0) : { ok: false }; });
registerIpc('downloader:stop', async (id) => { cancelDownloads(id); return { ok: true }; });
registerIpc('downloader:openDrafts', async (key) => {
    const session = await findSessionByKey(key);
    if (!session) return { ok: false };
    const browser = await getOrLaunchManualBrowser(session as Session);
    const page = await browser.newPage();
    await page.goto(pages.draftsUrl);
    return { ok: true };
});
registerIpc('downloader:scanDrafts', async (key) => {
    const session = await findSessionByKey(key);
    if (!session) return { ok: false };
    const browser = await getOrLaunchManualBrowser(session as Session);
    const page = await browser.newPage();
    await page.goto(pages.draftsUrl);
    const cards = await page.$$('.sora-draft-card');
    return { ok: true, draftsFound: cards.length };
});
registerIpc('downloader:downloadAll', async (key, opt) => {
    const session = await findSessionByKey(key);
    return session ? runDownloads(session as Session, opt?.limit ?? 0) : { ok: false };
});

// --- Added missing autogen handlers ---
registerIpc('autogen:run', async (id) => {
    const session = await getSession(id);
    return session ? runPromptsForSessionOldStyle(session as any, session.maxVideos ?? 0) : { ok: false };
});
registerIpc('autogen:stop', async (id) => {
    cancelPrompts(id);
    return { ok: true };
});

registerIpc('pipeline:run', async (steps) => {
  const safeSteps: WorkflowClientStep[] = Array.isArray(steps) ? steps : [];
  await runPipeline(safeSteps, (status) => mainWindow?.webContents.send('pipeline:progress', status));
  return { ok: true };
});
registerIpc('pipeline:cancel', async () => { cancelPipeline(); return { ok: true }; });

registerIpc('window:minimize', async () => { mainWindow?.minimize(); return { ok: true }; });
registerIpc('window:maximize', async () => { mainWindow?.isMaximized() ? mainWindow.unmaximize() : mainWindow?.maximize(); return { ok: true, maximized: mainWindow?.isMaximized() }; });
registerIpc('window:isMaximized', async () => mainWindow?.isMaximized());
registerIpc('window:close', async () => { mainWindow?.close(); return { ok: true }; });

registerIpc('video:extractPreviewFrames', async (v, c) => extractPreviewFrames(v, c));
registerIpc('video:pickSmartPreviewFrames', async (v, c) => pickSmartPreviewFrames(v, c));
registerIpc('video:blurWithProfile', async (i, o, p) => blurVideoWithProfile(i, o, p));
registerIpc('video:blurProfiles:list', async () => listBlurProfiles());
registerIpc('video:blurProfiles:save', async (p) => saveBlurProfile(p));
registerIpc('video:blurProfiles:delete', async (id) => deleteBlurProfile(id));

registerIpc('telegram:test', async () => testTelegram());
registerIpc('telegram:sendMessage', async (t) => sendTelegramMessage(t));
registerIpc('analytics:getDailyStats', async (d) => getDailyStats(d));
registerIpc('analytics:getTopSessions', async (l) => getTopSessions(l));
registerIpc('selectorInspector:start', async (id) => startInspectorForSession(id));
registerIpc('selectorInspector:getLast', async (id) => getLastSelectorForSession(id));
registerIpc('cleanup:run', async () => runCleanupNow());
registerIpc('logging:rendererError', async (p) => { logError('renderer', JSON.stringify(p)); return { ok: true }; });
registerIpc('system:openPath', async (t) => shell.openPath(t));
registerIpc('logging:info', async () => ensureLogDestination());
registerIpc('logging:clear', async () => clearLogFile());
registerIpc('system:openLogs', async () => { const {dir} = ensureLogDestination(); if(dir) shell.openPath(dir); return {ok:true}; });
registerIpc('ping', async () => 'pong');

// New health check endpoint
registerIpc('health:check', async () => runHealthCheck());

export {};
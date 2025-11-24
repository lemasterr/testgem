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
import { startPythonServer, stopPythonServer } from './integrations/pythonClient'; // IMPORT NEW CLIENT
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
  .then(async () => {
    logInfo('[main] app is ready');

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

// ... (Всі інші IPC хендлери залишаються без змін, вони дуже довгі, тому я їх пропускаю для стислості,
// але в реальному файлі вони повинні бути тут) ...
// Для повноти коду, я додаю скорочений блок існуючих хендлерів:

handle('config:get', async () => getConfig());
handle('config:update', async (partial) => updateConfig(partial));
handle('chrome:scanProfiles', async () => { const profiles = await scanChromeProfiles(); return { ok: true, profiles }; });
handle('chrome:listProfiles', async () => { const profiles = await listChromeProfiles(); return { ok: true, profiles }; });
handle('chrome:setActiveProfile', async (name: string) => { await setActiveChromeProfile(name); const profiles = await listChromeProfiles(); return { ok: true, profiles }; });
handle('chrome:cloneProfile', async () => cloneActiveChromeProfile());

ipcMain.handle('sessions:subscribeLogs', (event, sessionId: string) => { sessionLogBroker.subscribe(sessionId, event.sender); return { ok: true }; });
ipcMain.handle('sessions:unsubscribeLogs', (event, sessionId: string) => { sessionLogBroker.unsubscribe(sessionId, event.sender.id); return { ok: true }; });

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
      if (!profile) throw new Error('No Chrome profile available.');
      const browser = await launchBrowserForSession(profile, safePort);
      manualBrowsers.set(session.id, browser);
      return { ok: true, details: `Started Chrome on port ${safePort}` };
    }
    if (action === 'runPrompts') return runPrompts(session as Session);
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

handle('files:read', async (profileName) => ({ ok: true, files: await readProfileFiles(profileName) }));
handle('files:save', async (profileName, files) => saveProfileFiles(profileName, files));
handle('files:openFolder', async (profileName) => openProfileFolder(profileName));
handle('sessions:runPrompts', async (id) => { const session = await getSession(id); return session ? runPrompts(session as any) : { ok: false }; });
handle('sessions:cancelPrompts', async (id) => cancelPrompts(id));
handle('sessions:runDownloads', async (id, max) => { const session = await getSession(id); return session ? runDownloads(session as any, max ?? 0) : { ok: false }; });
handle('sessions:cancelDownloads', async (id) => cancelDownloads(id));
handle('downloader:run', async (id, opt) => { const session = await getSession(id); return session ? runDownloads(session as any, opt?.limit ?? 0) : { ok: false }; });
handle('downloader:stop', async (id) => { cancelDownloads(id); return { ok: true }; });
handle('downloader:openDrafts', async (key) => {
    const session = await findSessionByKey(key);
    if (!session) return { ok: false };
    const browser = await getOrLaunchManualBrowser(session as Session);
    const page = await browser.newPage();
    await page.goto(pages.draftsUrl);
    return { ok: true };
});
handle('downloader:scanDrafts', async (key) => {
    const session = await findSessionByKey(key);
    if (!session) return { ok: false };
    const browser = await getOrLaunchManualBrowser(session as Session);
    const page = await browser.newPage();
    await page.goto(pages.draftsUrl);
    const cards = await page.$$('.sora-draft-card');
    return { ok: true, draftsFound: cards.length };
});
handle('downloader:downloadAll', async (key, opt) => {
    const session = await findSessionByKey(key);
    return session ? runDownloads(session as Session, opt?.limit ?? 0) : { ok: false };
});

handle('pipeline:run', async (steps) => {
  const safeSteps: WorkflowClientStep[] = Array.isArray(steps) ? steps : [];
  await runPipeline(safeSteps, (status) => mainWindow?.webContents.send('pipeline:progress', status));
  return { ok: true };
});
handle('pipeline:cancel', async () => { cancelPipeline(); return { ok: true }; });

handle('window:minimize', async () => { mainWindow?.minimize(); return { ok: true }; });
handle('window:maximize', async () => { mainWindow?.isMaximized() ? mainWindow.unmaximize() : mainWindow?.maximize(); return { ok: true, maximized: mainWindow?.isMaximized() }; });
handle('window:isMaximized', async () => mainWindow?.isMaximized());
handle('window:close', async () => { mainWindow?.close(); return { ok: true }; });

handle('video:extractPreviewFrames', async (v, c) => extractPreviewFrames(v, c));
handle('video:pickSmartPreviewFrames', async (v, c) => pickSmartPreviewFrames(v, c));
handle('video:blurWithProfile', async (i, o, p) => blurVideoWithProfile(i, o, p));
handle('video:blurProfiles:list', async () => listBlurProfiles());
handle('video:blurProfiles:save', async (p) => saveBlurProfile(p));
handle('video:blurProfiles:delete', async (id) => deleteBlurProfile(id));

handle('telegram:test', async () => testTelegram());
handle('telegram:sendMessage', async (t) => sendTelegramMessage(t));
handle('analytics:getDailyStats', async (d) => getDailyStats(d));
handle('analytics:getTopSessions', async (l) => getTopSessions(l));
handle('selectorInspector:start', async (id) => startInspectorForSession(id));
handle('selectorInspector:getLast', async (id) => getLastSelectorForSession(id));
handle('cleanup:run', async () => runCleanupNow());
handle('logging:rendererError', async (p) => { logError('renderer', JSON.stringify(p)); return { ok: true }; });
handle('system:openPath', async (t) => shell.openPath(t));
handle('logging:info', async () => ensureLogDestination());
handle('logging:clear', async () => clearLogFile());
handle('system:openLogs', async () => { const {dir} = ensureLogDestination(); if(dir) shell.openPath(dir); return {ok:true}; });
handle('ping', async () => 'pong');

export {};
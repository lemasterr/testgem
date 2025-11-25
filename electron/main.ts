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
import { runPromptsForSessionOldStyle } from './automation/soraPromptWorker';
import { extractPreviewFrames, pickSmartPreviewFrames } from './video/ffmpegWatermark';
import { blurVideoWithProfile, listBlurProfiles, saveBlurProfile, deleteBlurProfile, blurVideo, type BlurZone } from './video/ffmpegBlur';
import { testTelegram, sendTelegramMessage } from './integrations/telegram';
import { loggerEvents, logError, logInfo } from './logging/logger';
import { clearLogFile, ensureLogDestination } from '../core/utils/log';
import { pages } from '../core/config/pages';
import { getDailyStats, getTopSessions } from './logging/history';
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
const manualBrowsers = new Map<string, any>();
const isDev = process.env.NODE_ENV !== 'production';

function createMainWindow(): void {
  const preload = path.join(__dirname, 'preload.js');
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 850,
    frame: false,
    backgroundColor: '#09090b',
    webPreferences: { preload, nodeIntegration: false, contextIsolation: true },
  });
  if (isDev) mainWindow.loadURL('http://localhost:5173');
  else mainWindow.loadFile(path.join(__dirname, '..', '..', 'dist', 'index.html'));

  // Global Log Forwarding to Renderer
  loggerEvents.on('log', (entry) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('logging:push', entry);
      }
  });
}

async function findSessionByKey(key: string): Promise<Session | null> {
  const all = await listSessions();
  return (all.find(s => s.name === key) as Session) || null;
}

logInfo('main', `starting, NODE_ENV=${process.env.NODE_ENV}`);

app.whenReady().then(async () => {
  try { await startPythonServer(); } catch (e) { logError('main', `Python error: ${(e as Error).message}`); }
  createMainWindow();
  scheduleDailyCleanup();
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', async () => {
  stopPythonServer();
  for (const browser of manualBrowsers.values()) {
    try { browser.close(); } catch {}
  }
  manualBrowsers.clear();
  await shutdownAllChrome();
});

function reg(channel: string, handler: (...args: any[]) => any) {
  ipcMain.handle(channel, async (_, ...args) => {
    try { return await handler(...args); }
    catch (e) {
      logError('ipc', `${channel}: ${(e as Error).message}`);
      return { ok: false, error: (e as Error).message };
    }
  });
}

// Config & Chrome
reg('config:get', getConfig);
reg('config:update', updateConfig);
reg('chrome:scanProfiles', async () => ({ ok: true, profiles: await scanChromeProfiles() }));
reg('chrome:listProfiles', async () => ({ ok: true, profiles: await listChromeProfiles() }));
reg('chrome:setActiveProfile', async (n) => { await setActiveChromeProfile(n); return { ok: true, profiles: await listChromeProfiles() }; });
reg('chrome:cloneProfile', cloneActiveChromeProfile);

// Files (This was missing)
reg('files:read', async (profileName) => ({ ok: true, files: await readProfileFiles(profileName) }));
reg('files:save', async (profileName, files) => saveProfileFiles(profileName, files));
reg('files:openFolder', async (profileName) => openProfileFolder(profileName));

// Sessions
ipcMain.handle('sessions:subscribeLogs', (e, id) => { sessionLogBroker.subscribe(id, e.sender); return { ok: true }; });
ipcMain.handle('sessions:unsubscribeLogs', (e, id) => { sessionLogBroker.unsubscribe(id, e.sender.id); return { ok: true }; });
reg('sessions:list', listSessions);
reg('sessions:get', getSession);
reg('sessions:save', saveSession);
reg('sessions:delete', deleteSession);
reg('sessions:command', async (id, action) => {
  const s = await getSession(id);
  if (!s) throw new Error('Session not found');
  if (action === 'startChrome') {
      const profile = await resolveChromeProfileForSession({ chromeProfileName: s.chromeProfileName });
      if (!profile) throw new Error('No profile');
      const config = await getConfig();
      const port = resolveSessionCdpPort(s, config.cdpPort ?? 9222);
      await launchBrowserForSession(profile, port);
      return { ok: true, details: `Launched on port ${port}` };
  }
  if (action === 'runPrompts') return runPromptsForSessionOldStyle(s as Session, s.maxVideos || 0);
  if (action === 'runDownloads') return runDownloads(s as Session, s.maxVideos || 0);
  if (action === 'stop') { await cancelPrompts(s.id); await cancelDownloads(s.id); return { ok: true }; }
  return { ok: false, error: 'Unknown action' };
});

// Workers
reg('autogen:run', async (id) => { const s = await getSession(id); return s ? runPromptsForSessionOldStyle(s as any, s.maxVideos || 0) : { ok: false }; });
reg('autogen:stop', async (id) => cancelPrompts(id));
reg('downloader:run', async (id, opt) => { const s = await getSession(id); return s ? runDownloads(s as any, opt?.limit || 0) : { ok: false }; });
reg('downloader:stop', async (id) => cancelDownloads(id));
reg('pipeline:run', async (steps) => { await runPipeline(steps, (s) => mainWindow?.webContents.send('pipeline:progress', s)); return { ok: true }; });
reg('pipeline:cancel', cancelPipeline);

// Video
// Adapt storage profiles (zones) <-> UI masks (rects)
function zonesToRects(zones: any[] = []) {
  return zones.map((z) => ({
    x: z.x,
    y: z.y,
    width: z.w ?? z.width,
    height: z.h ?? z.height,
    label: z.label,
    // passthrough optional mode/strength/band from UI if present
    mode: z.mode,
    blur_strength: z.blur_strength,
    band: z.band,
  }));
}
function rectsToZones(rects: any[] = []): BlurZone[] {
  return rects.map((r) => ({
    x: r.x,
    y: r.y,
    w: r.w ?? r.width,
    h: r.h ?? r.height,
    // @ts-ignore keep optional keys for enhanced blur pipeline
    mode: r.mode,
    // @ts-ignore
    blur_strength: r.blur_strength,
    // @ts-ignore
    band: r.band,
  } as any));
}

reg('video:blurProfiles:list', async () => {
  const profiles = await listBlurProfiles();
  const masks = profiles.map((p: any) => ({ id: p.id, name: p.name, rects: zonesToRects(p.zones) }));
  return masks;
});

reg('video:blurProfiles:save', async (mask: any) => {
  const toSave = { id: mask.id, name: mask.name, zones: rectsToZones(mask.rects || []) };
  await saveBlurProfile(toSave as any);
  const profiles = await listBlurProfiles();
  return profiles.map((p: any) => ({ id: p.id, name: p.name, rects: zonesToRects(p.zones) }));
});

reg('video:blurProfiles:delete', async (id: string) => {
  await deleteBlurProfile(id);
  const profiles = await listBlurProfiles();
  return profiles.map((p: any) => ({ id: p.id, name: p.name, rects: zonesToRects(p.zones) }));
});

reg('video:blurWithProfile', async (input: string, output: string, profileId: string) => {
  await blurVideoWithProfile(input, output, profileId);
  return { ok: true, output };
});

reg('video:runBlur', async (input: string, zones: BlurZone[]) => {
    const parsed = path.parse(input);
    const output = path.join(parsed.dir, `${parsed.name}_blurred${parsed.ext}`);
    await blurVideo(input, output, zones);
    return { ok: true, output };
});

// Downloader manual
reg('downloader:openDrafts', async (name) => {
    const s = await findSessionByKey(name);
    if (!s) return { ok: false, error: 'Session not found' };
    const config = await getConfig();
    const profile = await resolveChromeProfileForSession({ chromeProfileName: s.chromeProfileName });
    if (!profile) return { ok: false, error: 'Profile not found' };
    const port = resolveSessionCdpPort(s, config.cdpPort ?? 9222);
    const browser = await launchBrowserForSession(profile, port);
    const page = await browser.newPage();
    await page.goto(pages.draftsUrl);
    return { ok: true };
});
reg('downloader:scanDrafts', async (name) => {
    // Mock scan for manual mode usually connects to existing chrome
    return { ok: true, draftsFound: 0 };
});
reg('downloader:downloadAll', async (name, opt) => {
    const s = await findSessionByKey(name);
    return s ? runDownloads(s as any, opt?.limit || 0) : { ok: false };
});

// System
reg('system:openPath', (t) => shell.openPath(t));
reg('system:openLogs', async () => { const {dir} = ensureLogDestination(); if(dir) shell.openPath(dir); return {ok:true}; });
reg('logging:clear', clearLogFile);
reg('health:check', runHealthCheck);
reg('window:minimize', () => mainWindow?.minimize());
reg('window:maximize', () => mainWindow?.isMaximized() ? mainWindow.unmaximize() : mainWindow?.maximize());
reg('window:isMaximized', () => mainWindow?.isMaximized());
reg('window:close', () => mainWindow?.close());

export {};
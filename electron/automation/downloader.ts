// sora_2/electron/automation/downloader.ts
import fs from 'fs/promises';
import path from 'path';
import { type Browser, type Page } from 'puppeteer-core';
import { pages } from '../../core/config/pages';
import { runDownloadLoop } from '../../core/download/downloadFlow';
import { selectors, waitForVisible } from '../../core/selectors/selectors';

import { getConfig, type Config } from '../config/config';
import { getSessionPaths } from '../sessions/repo';
import type { Session } from '../sessions/types';
import { formatTemplate, sendTelegramMessage } from '../integrations/telegram';
import { heartbeat, startWatchdog, stopWatchdog } from './watchdog';
import { registerSessionPage, unregisterSessionPage } from './selectorInspector';
import { runPostDownloadHook } from './hooks';
import { ensureDir } from '../utils/fs';
import { logInfo } from '../logging/logger';
import { ensureBrowserForSession } from './sessionChrome';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assertPage(page: Page | null): asserts page is Page {
  if (!page) {
    throw new Error('No active page');
  }
}

export type DownloadRunResult = {
  ok: boolean;
  downloaded: number;
  errorCode?: string;
  error?: string;
};

const WATCHDOG_TIMEOUT_MS = 120_000;
const MAX_WATCHDOG_RESTARTS = 2;

type CancelFlag = { cancelled: boolean };
const cancellationMap = new Map<string, CancelFlag>();

async function readLines(filePath: string): Promise<string[]> {
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    return raw.split(/\r?\n/).map((line) => line.trim());
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

function safeFileName(title: string): string {
  const sanitized = title.replace(/[\\/:*?"<>|]/g, '_');
  return sanitized.length > 80 ? sanitized.slice(0, 80) : sanitized;
}

async function disconnectIfExternal(browser: Browser | null): Promise<void> {
  if (!browser) return;

  const meta = browser as any;
  if (meta.__soraManaged) {
    return;
  }

  try {
    await browser.disconnect();
  } catch {
    // ignore disconnect errors
  }
}

async function configureDownloads(page: Page, downloadsDir: string): Promise<void> {
  await ensureDir(downloadsDir);
  const client = await page.target().createCDPSession();
  await client.send('Page.setDownloadBehavior', {
    behavior: 'allow',
    downloadPath: downloadsDir,
  });
}

async function preparePage(browser: Browser, downloadDir: string): Promise<Page> {
  const context = browser.browserContexts()[0] ?? browser.defaultBrowserContext();
  const pagesList = await context.pages();
  const existing = pagesList.find((p) => p.url().startsWith(pages.baseUrl));
  const page = existing ?? (await context.newPage());

  await configureDownloads(page, downloadDir);
  if (!page.url().startsWith(pages.draftsUrl)) {
    await page.goto(pages.draftsUrl, { waitUntil: 'networkidle2' });
  }
  await waitForVisible(page, selectors.cardItem).catch(() => undefined);
  return page;
}

type CardMeta = {
  url: string;
  index: number;
  label: string;
  signature: string;
};

async function getCurrentCardMeta(page: Page): Promise<CardMeta> {
  return page.evaluate((cardSelector) => {
    const video = document.querySelector('video') as HTMLVideoElement | null;
    const src = video?.currentSrc || video?.src || '';
    const path = window.location.pathname || '';
    const poster = video?.getAttribute('poster') ?? '';
    const cards = Array.from(document.querySelectorAll(cardSelector)) as HTMLAnchorElement[];
    let activeIndex = -1;
    let activeLabel = '';

    const normalizedPath = path.split('/').filter(Boolean).pop();

    cards.forEach((card, idx) => {
      if (activeIndex !== -1) return;
      const href = card.getAttribute('href') ?? '';
      const text = (card.textContent ?? '').trim();
      const ariaCurrent = card.getAttribute('aria-current');

      if (href && normalizedPath && href.includes(normalizedPath)) {
        activeIndex = idx;
        activeLabel = text;
        return;
      }

      if (ariaCurrent === 'page' || card.classList.contains('active') || card.classList.contains('selected')) {
        activeIndex = idx;
        activeLabel = text;
      }
    });

    return {
      url: window.location.href,
      index: activeIndex,
      label: activeLabel,
      signature: `${path}::${src}::${poster}`,
    } satisfies CardMeta;
  }, selectors.cardItem);
}

// FIX: Gentle Scroll - small delta, no repetition without check
async function gentleSwipe(page: Page): Promise<void> {
  try { await page.click('body', { delay: 20 }); } catch {}

  try {
    const viewport = page.viewport() || { width: 1280, height: 720 };
    await page.mouse.move(viewport.width / 2, viewport.height * 0.7);
  } catch {}

  const wheel = async (delta: number) => {
    try {
      await page.mouse.wheel({ deltaY: delta });
    } catch {
      await page.evaluate((d) => window.scrollBy(0, d), delta);
    }
  };

  // Один аккуратный скролл
  await wheel(450);
  await delay(300);
}

async function keyNudgeForNextCard(page: Page): Promise<void> {
  try {
    await page.keyboard.press('ArrowDown');
    await delay(300);
  } catch {
    // ignore
  }
}

async function scrollToNextCardInFeed(
  page: Page,
  pauseMs = 1500,
  timeoutMs = 15000
): Promise<boolean> {
  const startMeta = await getCurrentCardMeta(page);
  const deadline = Date.now() + timeoutMs;

  const hasChanged = (current: CardMeta) => {
    const idxChanged = current.index !== -1 && current.index !== startMeta.index;
    const urlChanged = current.url !== startMeta.url;
    return idxChanged || urlChanged;
  };

  const logProgress = (message: string) => {
    logInfo('downloader', `[Feed] ${message}`);
  };

  for (let attempt = 0; attempt < 5 && Date.now() < deadline; attempt += 1) {
    // 1. Пробуем свайп
    await gentleSwipe(page);

    // Ждем изменения состояния (до 2.5 сек)
    let checkTime = 0;
    while (checkTime < 2500) {
        const meta = await getCurrentCardMeta(page);
        if (hasChanged(meta)) {
            logProgress(`Moved to index ${meta.index} (prev: ${startMeta.index})`);
            // Важно: даем время на "успокоение" UI перед следующим действием
            await delay(1000);
            return true;
        }
        await delay(250);
        checkTime += 250;
    }

    // 2. Fallback: Стрелка вниз
    if (attempt > 0) {
        await keyNudgeForNextCard(page);
        await delay(1000);
        const metaAfterKey = await getCurrentCardMeta(page);
        if (hasChanged(metaAfterKey)) {
            logProgress(`Moved via Key to index ${metaAfterKey.index}`);
            return true;
        }
    }
  }

  logProgress('Failed to move to next card before timeout');
  return false;
}

/**
 * Download videos for a session using the TikTok-style viewer flow. Shared by session actions and pipeline steps.
 */
export async function runDownloads(
  session: Session,
  maxVideos = 0,
  externalCancelFlag?: CancelFlag
): Promise<DownloadRunResult> {
  const cancelFlag: CancelFlag = externalCancelFlag ?? { cancelled: false };
  cancellationMap.set(session.id, cancelFlag);

  const runId = `download:${session.id}:${Date.now()}`;
  let browser: Browser | null = null;
  let page: Page | null = null;
  let downloaded = 0;
  let config: Config | null = null;
  let watchdogTimeouts = 0;
  let fatalWatchdog = false;

  try {
    const [loadedConfig, paths] = await Promise.all([getConfig(), getSessionPaths(session)]);
    config = loadedConfig;

    const { browser: connected } = await ensureBrowserForSession(session, config);
    browser = connected;

    const prepare = async () => {
      if (!browser) return;
      if (page) {
        try {
          unregisterSessionPage(session.id, page);
          await page.close();
        } catch {
          // ignore
        }
      }
      page = await preparePage(browser, paths.downloadDir);
      registerSessionPage(session.id, page);
      heartbeat(runId);
    };

    const titles = await readLines(paths.titlesFile);

    const onTimeout = async () => {
      watchdogTimeouts += 1;
      if (watchdogTimeouts >= MAX_WATCHDOG_RESTARTS) {
        fatalWatchdog = true;
        cancelFlag.cancelled = true;
      }
    };

    await prepare();
    startWatchdog(runId, WATCHDOG_TIMEOUT_MS, onTimeout);

    const explicitCap = Number.isFinite(maxVideos) && maxVideos > 0 ? maxVideos : 0;
    const fallbackCap = Number.isFinite(session.maxVideos) && session.maxVideos > 0 ? session.maxVideos : 0;
    const hardCap = explicitCap > 0 ? explicitCap : fallbackCap;
    const draftsUrl = pages.draftsUrl;

    if (!page) {
      return { ok: false, downloaded, error: 'No active page' };
    }

    assertPage(page);
    const activePage: Page = page;
    await activePage.goto(draftsUrl, { waitUntil: 'networkidle2' }).catch(() => undefined);
    await waitForVisible(activePage, selectors.cardItem).catch(() => undefined);

    const downloadLimit = hardCap > 0 ? hardCap : Number.MAX_SAFE_INTEGER;
    const loopResult = await runDownloadLoop({
      page: activePage,
      maxDownloads: downloadLimit,
      downloadDir: paths.downloadDir,
      waitForReadySelectors: [selectors.rightPanel],
      downloadButtonSelector: selectors.downloadButton,
      swipeNext: async () => {
        const moved = await scrollToNextCardInFeed(activePage);
        if (!moved) {
          throw new Error('Не удалось перейти к следующей карточке');
        }
      },
      onStateChange: () => heartbeat(runId),
      isCancelled: () => cancelFlag.cancelled || fatalWatchdog,
      maxSeenFiles: 1000
    });

    for (let index = 0; index < loopResult.savedFiles.length; index += 1) {
      const savedPath = loopResult.savedFiles[index];
      const titleFromList = titles[downloaded + index];
      const titleFromPage = (await activePage.title()) || '';
      const title = titleFromList || titleFromPage || `video_${downloaded + index + 1}`;

      const targetName = `${safeFileName(title)}.mp4`;
      const targetPath = path.join(paths.downloadDir, targetName);
      if (savedPath !== targetPath) {
        try {
          await fs.rename(savedPath, targetPath);
        } catch {
          // fallback: keep original path
        }
      }

      const finalPath = fs
        .access(targetPath)
        .then(() => targetPath)
        .catch(() => savedPath ?? targetPath);

      await runPostDownloadHook(await finalPath, title);
      downloaded += 1;
      logInfo('downloader', `[Feed] Downloaded ${downloaded} videos for session ${session.name}`);
      heartbeat(runId);

      if (hardCap > 0 && downloaded >= hardCap) {
        break;
      }
    }

    if (fatalWatchdog) {
      return { ok: false, downloaded, errorCode: 'watchdog_timeout', error: 'Watchdog timeout' };
    }

    return { ok: true, downloaded };
  } catch (error) {
    const message = (error as Error).message;
    if (config?.telegram?.enabled && config.telegramTemplates?.sessionError) {
      const lower = message.toLowerCase();
      if (!lower.includes('cloudflare')) {
        const text = formatTemplate(config.telegramTemplates.sessionError, {
          session: session.id,
          submitted: 0,
          failed: 0,
          downloaded,
          durationMinutes: 0,
          error: message,
        });
        await sendTelegramMessage(text);
      }
    }
    return { ok: false, downloaded, error: message };
  } finally {
    stopWatchdog(runId);
    cancellationMap.delete(session.id);
    unregisterSessionPage(session.id, page);
    await disconnectIfExternal(browser);
  }
}

export function cancelDownloads(sessionId: string): void {
  const flag = cancellationMap.get(sessionId);
  if (flag) {
    flag.cancelled = true;
  }
}
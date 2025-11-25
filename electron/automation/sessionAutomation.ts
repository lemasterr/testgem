// sora_2/electron/automation/sessionAutomation.ts
import fs from 'fs/promises';
import path from 'path';
import type { Browser, ElementHandle, Page } from 'puppeteer-core';
import type { RunResult } from '../../shared/types';
import { pages } from '../../core/config/pages';
import { selectors, waitForClickable, waitForVisible } from '../../core/selectors/selectors';
import { configureDownloads, newPage, type SessionRunContext } from './chromeController';
import { getOrLaunchChromeForProfile } from '../chrome/manager';
import { resolveSessionCdpPort } from '../utils/ports';
import { resolveChromeProfileForSession, type ChromeProfile } from '../chrome/profiles';
import { logError } from '../../core/utils/log';

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const DRAFTS_URL = pages.draftsUrl;

const sessionLocks = new Set<string>();
const sessionContexts = new Map<string, SessionRunContext>();
const activeDraftBrowsers = new Map<string, Browser>();

const registerContext = (ctx: SessionRunContext) => {
  sessionContexts.set(ctx.sessionName, ctx);
};

const unregisterContext = (ctx: SessionRunContext) => {
  sessionContexts.delete(ctx.sessionName);
};

export const cancelSessionRun = (sessionName: string): boolean => {
  const ctx = sessionContexts.get(sessionName);
  if (ctx) {
    ctx.cancelled = true;
    return true;
  }
  return false;
};

const withSessionLock = async (ctx: SessionRunContext, runner: () => Promise<RunResult>): Promise<RunResult> => {
  if (sessionLocks.has(ctx.sessionName)) {
    return { ok: false, error: 'Session run already in progress' };
  }

  sessionLocks.add(ctx.sessionName);
  registerContext(ctx);
  try {
    return await runner();
  } finally {
    unregisterContext(ctx);
    sessionLocks.delete(ctx.sessionName);
  }
};

const closeBrowserSafe = async (browser: Browser | null) => {
  try {
    if (browser) {
      const meta = browser as any;
      if (meta.__soraManaged) {
        return;
      }
      await browser.disconnect();
    }
  } catch (error) {
    logError('Failed to close browser', error);
  }
};

const resolveProfileForContext = async (ctx: SessionRunContext): Promise<ChromeProfile> => {
  const profilePath = ctx.profileDir;

  if (profilePath) {
    const profileDirectory = path.basename(profilePath) || 'Default';
    const userDataDir = path.dirname(profilePath);

    try {
      const stats = await fs.stat(profilePath);
      if (stats.isDirectory()) {
        return {
          id: profileDirectory,
          name: profileDirectory,
          userDataDir,
          profileDirectory,
          profileDir: profileDirectory,
        };
      }
    } catch {
      // fall through to config-based resolution
    }
  }

  const profile = await resolveChromeProfileForSession({ chromeProfileName: ctx.config.chromeActiveProfileName });
  if (profile) return profile;
  throw new Error('No Chrome profile available. Select a Chrome profile in Settings.');
};

const getOrLaunchBrowser = async (
  ctx: SessionRunContext
): Promise<{ browser: Browser; created: boolean }> => {
  const existing = activeDraftBrowsers.get(ctx.sessionName);

  if (existing && existing.isConnected()) {
    return { browser: existing, created: false };
  }

  const profile = await resolveProfileForContext(ctx);
  const basePort = ctx.config.cdpPort ?? 9222;
  const port = resolveSessionCdpPort({ name: ctx.sessionName, cdpPort: null }, basePort);
  const browser = await getOrLaunchChromeForProfile(profile, port);
  activeDraftBrowsers.set(ctx.sessionName, browser);
  browser.on('disconnected', () => activeDraftBrowsers.delete(ctx.sessionName));
  return { browser, created: true };
};

const readLines = async (filePath: string): Promise<string[]> => {
  try {
    const data = await fs.readFile(filePath, 'utf-8');
    return data.split(/\r?\n/);
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
};

const appendLog = async (filePath: string, message: string) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.appendFile(filePath, `${message}\n`, 'utf-8');
};

const getSafeFileName = (title: string): string => {
  const sanitized = title.replace(/[\\/:*?"<>|]/g, '_').trim();
  const base = sanitized.length > 0 ? sanitized : 'video';
  return base.slice(0, 80);
};

const resolveUniqueFilePath = async (directory: string, baseName: string): Promise<string> => {
  let counter = 0;
  const extension = '.mp4';
  let candidate = path.join(directory, `${baseName}${extension}`);

  while (true) {
    try {
      await fs.access(candidate);
      counter += 1;
      candidate = path.join(directory, `${baseName}_${counter}${extension}`);
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === 'ENOENT') {
        return candidate;
      }
      throw error;
    }
  }
};

const findLatestDownloadedFile = async (directory: string): Promise<string | null> => {
  const entries = await fs.readdir(directory);
  let latestPath: string | null = null;
  let latestMtime = 0;

  await Promise.all(
    entries.map(async (entry) => {
      if (!entry.toLowerCase().endsWith('.mp4')) {
        return;
      }
      const fullPath = path.join(directory, entry);
      const stats = await fs.stat(fullPath);
      if (stats.mtimeMs > latestMtime) {
        latestMtime = stats.mtimeMs;
        latestPath = fullPath;
      }
    })
  );

  return latestPath;
};

const waitForDraftAcceptance = async (page: Page, config: SessionRunContext['config']) => {
  await Promise.race([
    waitForClickable(page, selectors.enabledSubmitButton, config.draftTimeoutMs).catch(() => null),
    delay(config.promptDelayMs)
  ]);
};

const runPromptsInternal = async (ctx: SessionRunContext): Promise<RunResult> => {
  let browser: Browser | null = null;
  let submittedCount = 0;
  let failedCount = 0;

  const promptsPath = path.join(ctx.sessionPath, 'prompts.txt');
  const imagePromptsPath = path.join(ctx.sessionPath, 'image_prompts.txt');
  const submittedLogPath = path.join(ctx.sessionPath, 'submitted.log');
  const failedLogPath = path.join(ctx.sessionPath, 'failed.log');

  try {
    const prompts = await readLines(promptsPath);
    const imagePrompts = await readLines(imagePromptsPath);

    const { browser: managedBrowser } = await getOrLaunchBrowser(ctx);
    browser = managedBrowser;
    const page = await newPage(browser);
    await configureDownloads(page, ctx.downloadsDir);
    await page.goto(pages.baseUrl, { waitUntil: 'networkidle2' });
    await waitForVisible(page, selectors.promptInput, ctx.config.draftTimeoutMs);

    for (let i = 0; i < prompts.length; i += 1) {
      if (ctx.cancelled) {
        break;
      }

      const promptText = (prompts[i] ?? '').trim();
      if (!promptText) {
        continue;
      }

      const imagePath = (imagePrompts[i] ?? '').trim();

      try {
        // Improved text clearing and typing logic
        await waitForVisible(page, selectors.promptInput);
        await page.click(selectors.promptInput);
        await delay(50);

        // Robust clear: Ctrl+A / Cmd+A -> Backspace
        const isMac = process.platform === 'darwin';
        const modifier = isMac ? 'Meta' : 'Control';

        await page.keyboard.down(modifier);
        await page.keyboard.press('A');
        await page.keyboard.up(modifier);
        await delay(20);
        await page.keyboard.press('Backspace');
        await delay(20);

        // Type new text
        await page.type(selectors.promptInput, promptText, { delay: 10 });

        if (imagePath) {
          try {
            await fs.access(imagePath);
            const imageInput = (await page.$(selectors.fileInput)) as ElementHandle<HTMLInputElement> | null;
            if (!imageInput) {
              throw new Error('Image input not found');
            }
            await imageInput.uploadFile(imagePath);
          } catch (imageError) {
            throw new Error(`Image upload failed: ${imageError instanceof Error ? imageError.message : 'unknown error'}`);
          }
        }

        const submitButton = await page.$(selectors.submitButton);
        if (!submitButton) {
          throw new Error('Submit button not found');
        }
        await submitButton.click({ delay: 80 });

        await waitForDraftAcceptance(page, ctx.config);

        submittedCount += 1;
        await appendLog(
          submittedLogPath,
          `${new Date().toISOString()} | prompt #${i + 1} OK | ${promptText.slice(0, 80)}`
        );
      } catch (error) {
        failedCount += 1;
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        await appendLog(
          failedLogPath,
          `${new Date().toISOString()} | prompt #${i + 1} FAILED | ${promptText.slice(0, 80)} | ${errorMessage}`
        );
      }
    }

    return { ok: true, submittedCount, failedCount };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    await appendLog(failedLogPath, `${new Date().toISOString()} | FATAL | ${errorMessage}`);
    return { ok: false, error: errorMessage, submittedCount, failedCount };
  } finally {
    await closeBrowserSafe(browser);
  }
};

export const runPrompts = async (ctx: SessionRunContext): Promise<RunResult> => {
  return withSessionLock(ctx, () => runPromptsInternal(ctx));
};

const waitForDownloadCompletion = async (
  page: Page,
  timeoutMs: number
): Promise<void> => {
  const client = await page.target().createCDPSession();
  await client.send('Page.enable');

  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      client.removeAllListeners('Page.downloadProgress');
      reject(new Error('Download timed out'));
    }, timeoutMs);

    const handler = (event: { state: string }) => {
      if (event.state === 'completed') {
        clearTimeout(timeout);
        if (typeof client.off === 'function') {
          client.off('Page.downloadProgress', handler as never);
        } else {
          client.removeAllListeners('Page.downloadProgress');
        }
        resolve();
      } else if (event.state === 'canceled') {
        clearTimeout(timeout);
        if (typeof client.off === 'function') {
          client.off('Page.downloadProgress', handler as never);
        } else {
          client.removeAllListeners('Page.downloadProgress');
        }
        reject(new Error('Download cancelled'));
      }
    };

    client.on('Page.downloadProgress', handler);
  });
};

const downloadDraftCard = async (
  page: Page,
  cardHandle: ElementHandle,
  title: string,
  ctx: SessionRunContext
): Promise<string> => {
  await fs.mkdir(ctx.downloadsDir, { recursive: true });

  await cardHandle.click({ delay: 80 });

  const downloadButton = await waitForClickable(page, selectors.downloadButton, ctx.config.downloadTimeoutMs);

  if (!downloadButton) {
    throw new Error('Download button not found');
  }

  const downloadPromise = waitForDownloadCompletion(page, ctx.config.downloadTimeoutMs);

  await downloadButton.click({ delay: 80 });

  await downloadPromise;

  const latestFile = await findLatestDownloadedFile(ctx.downloadsDir);
  if (!latestFile) {
    throw new Error('Downloaded file not found');
  }

  const targetPath = await resolveUniqueFilePath(ctx.downloadsDir, getSafeFileName(title));

  if (latestFile !== targetPath) {
    await fs.rename(latestFile, targetPath);
  }

  try {
    await page.keyboard.press('Escape');
  } catch (error) {
    logError('Failed to close draft modal', error);
  }

  return targetPath;
};

export const runDownloads = async (ctx: SessionRunContext, maxVideos: number): Promise<RunResult> => {
  return withSessionLock(ctx, async () => {
    let browser: Browser | null = null;
    const failedLogPath = path.join(ctx.sessionPath, 'failed.log');
    let downloadedCount = 0;
    let skippedCount = 0;
    let lastDownloadedFile: string | undefined;

    try {
      const titlesPath = path.join(ctx.sessionPath, 'titles.txt');
      const titles = await readLines(titlesPath);

      const { browser: managedBrowser } = await getOrLaunchBrowser(ctx);
      browser = managedBrowser;
      const page = await newPage(browser);
      await configureDownloads(page, ctx.downloadsDir);
      await page.goto(DRAFTS_URL, { waitUntil: 'networkidle2' });
      await waitForVisible(page, selectors.draftCard, ctx.config.downloadTimeoutMs);

      const cards = await page.$$(selectors.draftCard);
      const total = Math.min(cards.length, titles.length, Math.max(0, maxVideos));

      for (let i = 0; i < total; i += 1) {
        if (ctx.cancelled) {
          break;
        }

        const card = cards[i];
        const title = titles[i]?.trim() || `video_${i + 1}`;

        try {
          lastDownloadedFile = await downloadDraftCard(page, card, title, ctx);
          downloadedCount += 1;
          await delay(1000);
        } catch (error) {
          skippedCount += 1;
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          await appendLog(
            failedLogPath,
            `${new Date().toISOString()} | download #${i + 1} FAILED | ${title} | ${errorMessage}`
          );
        }
      }

      return { ok: true, downloadedCount, skippedCount, lastDownloadedFile };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      await appendLog(failedLogPath, `${new Date().toISOString()} | DOWNLOAD FATAL | ${errorMessage}`);
      return { ok: false, error: errorMessage, downloadedCount, skippedCount, lastDownloadedFile };
    } finally {
      await closeBrowserSafe(browser);
    }
  });
};

export const openDrafts = async (ctx: SessionRunContext): Promise<RunResult> => {
  try {
    const { browser } = await getOrLaunchBrowser(ctx);
    const page = await newPage(browser);
    await page.goto(DRAFTS_URL, { waitUntil: 'networkidle2' });
    return { ok: true, details: 'Drafts page opened in Chrome' };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return { ok: false, error: errorMessage };
  }
};

export const scanDrafts = async (ctx: SessionRunContext): Promise<RunResult> => {
  let browser: Browser | null = null;
  let created = false;

  try {
    const result = await getOrLaunchBrowser(ctx);
    browser = result.browser;
    created = result.created;

    const page = await newPage(browser);
    await page.goto(DRAFTS_URL, { waitUntil: 'networkidle2' });
    const cards = await page.$$(selectors.draftCard);

    return { ok: true, draftsFound: cards.length, details: `${cards.length} drafts found` };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return { ok: false, error: errorMessage };
  } finally {
    if (created) {
      await closeBrowserSafe(browser);
    }
  }
};
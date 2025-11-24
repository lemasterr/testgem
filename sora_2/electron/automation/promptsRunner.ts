import fs from 'fs/promises';
import path from 'path';
import { type Browser, type Page } from 'puppeteer-core';

import { pages } from '../../core/config/pages';
import { selectors, waitForClickable, waitForVisible } from '../../core/selectors/selectors';
import { getConfig, type Config } from '../config/config';
import { getSessionPaths } from '../sessions/repo';
import type { Session } from '../sessions/types';
import { formatTemplate, sendTelegramMessage } from '../integrations/telegram';
import { heartbeat, startWatchdog, stopWatchdog } from './watchdog';
import { registerSessionPage, unregisterSessionPage } from './selectorInspector';
import { ensureBrowserForSession } from './sessionChrome';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assertPage(page: Page | null): asserts page is Page {
  if (!page) {
    throw new Error('No active page');
  }
}

export type PromptsRunResult = {
  ok: boolean;
  submitted: number;
  failed: number;
  errorCode?: string;
  error?: string;
};

const WATCHDOG_TIMEOUT_MS = 120_000;
const MAX_WATCHDOG_RESTARTS = 2;

type CancelFlag = { cancelled: boolean };
const cancellationMap = new Map<string, CancelFlag>();

async function ensureFileParentExists(filePath: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

async function appendLogLine(filePath: string, line: string): Promise<void> {
  await ensureFileParentExists(filePath);
  await fs.appendFile(filePath, `${line}\n`, 'utf-8');
}

async function readLines(filePath: string): Promise<string[]> {
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    return raw.split(/\r?\n/);
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

async function preparePage(browser: Browser): Promise<Page> {
  const context = browser.browserContexts()[0] ?? browser.defaultBrowserContext();
  const pagesList = await context.pages();
  const existing = pagesList.find((p) => p.url().startsWith(pages.baseUrl));
  const page = existing ?? (await context.newPage());

  try {
    await waitForVisible(page, selectors.promptInput, 20_000);
  } catch {
    await page.goto(pages.baseUrl, { waitUntil: 'networkidle2' });
    await waitForVisible(page, selectors.promptInput, 60_000);
  }

  return page;
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

/**
 * Submit prompts for a single session. Shared by direct session actions and pipeline steps.
 */
export async function runPrompts(
  session: Session,
  externalCancelFlag?: CancelFlag
): Promise<PromptsRunResult> {
  const cancelFlag: CancelFlag = externalCancelFlag ?? { cancelled: false };
  cancellationMap.set(session.id, cancelFlag);

  const runId = `prompts:${session.id}:${Date.now()}`;
  let browser: Browser | null = null;
  let page: Page | null = null;
  let submitted = 0;
  let failed = 0;
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
      page = await preparePage(browser);
      registerSessionPage(session.id, page);
      heartbeat(runId);
    };

    const prompts = (await readLines(paths.promptsFile)).map((line) => line.trim());
    const imagePrompts = (await readLines(paths.imagePromptsFile)).map((line) => line.trim());

    const onTimeout = async () => {
      watchdogTimeouts += 1;
      if (watchdogTimeouts >= MAX_WATCHDOG_RESTARTS) {
        fatalWatchdog = true;
        return;
      }
      await prepare();
      setTimeout(() => startWatchdog(runId, WATCHDOG_TIMEOUT_MS, onTimeout), 0);
    };

    await prepare();
    startWatchdog(runId, WATCHDOG_TIMEOUT_MS, onTimeout);

    for (let index = 0; index < prompts.length; index += 1) {
      if (cancelFlag.cancelled || fatalWatchdog) break;

      heartbeat(runId);
      const promptText = prompts[index];
      if (!promptText || !page) continue;
      assertPage(page);
      const activePage = page as any;

      const imagePath = imagePrompts[index];

      try {
        await activePage.click(selectors.promptInput, { clickCount: 3, delay: 80 });
        await activePage.keyboard.press('Backspace');
        await activePage.type(selectors.promptInput, promptText);

        if (imagePath) {
          const input = await activePage.$(selectors.fileInput);
          if (input) {
            await input.uploadFile(imagePath);
          }
        }

        const submitButton = await waitForClickable(
          activePage,
          selectors.submitButton,
          config.promptDelayMs + 15_000
        );
        await submitButton.click({ delay: 80 });
        await delay(config.promptDelayMs);
        heartbeat(runId);

        submitted += 1;
        await appendLogLine(
          paths.submittedLog,
          `${new Date().toISOString()} | prompt #${index + 1} OK | ${promptText.slice(0, 80)}`
        );
      } catch (error) {
        failed += 1;
        await appendLogLine(
          paths.failedLog,
          `${new Date().toISOString()} | prompt #${index + 1} FAIL | ${promptText.slice(0, 80)} | ${String(
            error
          )}`
        );
      }
    }

    if (fatalWatchdog) {
      return { ok: false, submitted, failed, errorCode: 'watchdog_timeout', error: 'Watchdog timeout' };
    }

    return { ok: true, submitted, failed };
  } catch (error) {
    const message = (error as Error).message;
    if (config?.telegram?.enabled && config.telegramTemplates?.sessionError) {
      const lower = message.toLowerCase();
      if (!lower.includes('cloudflare')) {
        const text = formatTemplate(config.telegramTemplates.sessionError, {
          session: session.id,
          submitted,
          failed,
          downloaded: 0,
          durationMinutes: 0,
          error: message,
        });
        await sendTelegramMessage(text);
      }
    }
    return { ok: false, submitted, failed, error: message };
  } finally {
    stopWatchdog(runId);
    cancellationMap.delete(session.id);
    unregisterSessionPage(session.id, page);
    await disconnectIfExternal(browser);
  }
}

export function cancelPrompts(sessionId: string): void {
  const flag = cancellationMap.get(sessionId);
  if (flag) {
    flag.cancelled = true;
  }
}

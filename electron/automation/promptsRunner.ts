// lemasterr/testgem/testgem-2/electron/automation/promptsRunner.ts
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
import { logInfo } from '../logging/logger';

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

  // Ищем любую страницу Sora
  const existing = pagesList.find((p) => p.url().includes('sora.chatgpt.com'));
  const page = existing ?? (await context.newPage());

  // Оптимизация: Используем страницу профиля вместо главной, чтобы снизить потребление RAM
  // Главная страница (Explore) грузит много видео, профиль обычно легче.
  const targetUrl = pages.profileUrl || pages.baseUrl;

  if (!page.url().startsWith(targetUrl)) {
    logInfo('promptsRunner', `Navigating to ${targetUrl} for better performance`);
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
  }

  try {
    // Ждем поле ввода. Оно должно быть доступно и на странице профиля.
    await waitForVisible(page, selectors.promptInput, 20_000);
  } catch {
    // Если на профиле не нашли, пробуем главную как фоллбек
    logInfo('promptsRunner', 'Input not found on profile page, trying base URL...');
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

  const sessionPromptDelay = session.promptDelayMs && session.promptDelayMs > 0 ? session.promptDelayMs : undefined;
  const sessionMaxPrompts = session.maxPromptsPerRun && session.maxPromptsPerRun > 0 ? session.maxPromptsPerRun : undefined;
  const postRunDelay = session.postLastPromptDelayMs && session.postLastPromptDelayMs > 0 ? session.postLastPromptDelayMs : 0;

  try {
    const [loadedConfig, paths] = await Promise.all([getConfig(), getSessionPaths(session)]);
    config = loadedConfig;

    const promptDelay = sessionPromptDelay ?? config.promptDelayMs ?? 2000;
    const maxLimit = sessionMaxPrompts ?? 1000;

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

    const prompts = (await readLines(paths.promptsFile)).map((line) => line.trim()).filter(l => l.length > 0);
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

    const promptsToRun = Math.min(prompts.length, maxLimit);

    for (let index = 0; index < promptsToRun; index += 1) {
      if (cancelFlag.cancelled || fatalWatchdog) break;

      heartbeat(runId);
      const promptText = prompts[index];
      if (!promptText || !page) continue;
      assertPage(page);
      const activePage = page as any;

      const imagePath = imagePrompts[index];

      try {
        await waitForVisible(activePage, selectors.promptInput);

        await activePage.click(selectors.promptInput);
        await delay(50);

        const isMac = process.platform === 'darwin';
        const modifier = isMac ? 'Meta' : 'Control';

        await activePage.keyboard.down(modifier);
        await activePage.keyboard.press('A');
        await activePage.keyboard.up(modifier);
        await delay(20);
        await activePage.keyboard.press('Backspace');
        await delay(20);

        await activePage.type(selectors.promptInput, promptText, { delay: 10 });

        if (imagePath) {
          const input = await activePage.$(selectors.fileInput);
          if (input) {
            await input.uploadFile(imagePath);
          }
        }

        const submitButton = await waitForClickable(
          activePage,
          selectors.submitButton,
          promptDelay + 15_000
        );
        await submitButton.click({ delay: 80 });

        await delay(promptDelay);
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

    if (submitted > 0 && postRunDelay > 0) {
      await delay(postRunDelay);
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
import { PromptManager } from '../../core/prompts/promptManager';
import { ensureBrowserForSession } from './sessionChrome';
import { Session } from '../sessions/types';
import { getSessionPaths } from '../sessions/repo';
import { insertPromptAndGenerate } from './interactionHelper';
import { logInfo, logError } from '../logging/logger';
import { selectors } from '../../core/selectors/selectors';
import { runDownloadLoop } from '../../core/download/downloadFlow';

export async function runPromptsForSessionOldStyle(
  session: Session,
  maxDownloads: number = 0
): Promise<{ ok: boolean; message: string }> {
  const sessionPaths = await getSessionPaths(session);

  // 1. Инициализация
  const promptManager = new PromptManager('');
  await promptManager.loadPrompts(session.id, sessionPaths.promptsFile);

  if (!promptManager.hasMore(session.id)) {
    return { ok: false, message: 'No prompts found in file' };
  }

  // 2. Браузер
  let browser = null;
  let page = null;

  try {
    const { browser: connectedBrowser } = await ensureBrowserForSession(session);
    browser = connectedBrowser;

    const pagesList = await browser.pages();
    page = pagesList.find(p => p.url().includes('sora')) || await browser.newPage();

    const client = await page.target().createCDPSession();
    await client.send('Page.setDownloadBehavior', {
      behavior: 'allow',
      downloadPath: sessionPaths.downloadDir,
    });

    await page.goto('https://sora.chatgpt.com', { waitUntil: 'networkidle2' });

    let downloadCount = 0;
    const limit = (maxDownloads > 0) ? maxDownloads : Infinity;

    // 3. Цикл
    while (promptManager.hasMore(session.id)) {
      if (downloadCount >= limit) {
        logInfo('SoraWorker', `Reached download limit (${limit}) for session ${session.name}`);
        break;
      }

      // Берем первый в очереди, но ПОКА НЕ УДАЛЯЕМ
      const prompt = promptManager.peekNextPrompt(session.id);
      if (!prompt) break;

      logInfo('SoraWorker', `[${session.name}] Processing: "${prompt.substring(0, 40)}..."`);

      // 3.1 Вставка
      try {
        await insertPromptAndGenerate(page, prompt);
        logInfo('SoraWorker', `[${session.name}] Generation started...`);
      } catch (e) {
        logError('SoraWorker', `Failed to generate: ${(e as Error).message}`);
        // Если не смогли нажать кнопку, пробуем снова этот же промпт или выходим
        // Лучше сделать небольшую паузу и ретрай
        await new Promise(r => setTimeout(r, 5000));
        continue;
      }

      // 3.2 Ожидание
      logInfo('SoraWorker', `[${session.name}] Waiting (~60s)...`);
      await new Promise(r => setTimeout(r, 60000));

      // 3.3 Скачка
      await page.goto('https://sora.chatgpt.com/drafts', { waitUntil: 'networkidle2' });

      let success = false;
      try {
        const result = await runDownloadLoop({
            page,
            maxDownloads: 1,
            downloadDir: sessionPaths.downloadDir,
            waitForReadySelectors: [selectors.rightPanel],
            downloadButtonSelector: selectors.downloadButton,
            swipeNext: async () => {},
            maxSeenFiles: 1000
        });

        if (result.completed > 0) {
            downloadCount++;
            success = true;
            logInfo('SoraWorker', `[${session.name}] Download OK. Total: ${downloadCount}`);
        } else {
            logError('SoraWorker', `[${session.name}] Download failed.`);
        }

      } catch (e) {
          logError('SoraWorker', `Download error: ${(e as Error).message}`);
      }

      // 3.4 Удаление промпта и переход к следующему
      if (success) {
        // ВАЖНО: Удаляем промпт из файла только если успешно скачали
        await promptManager.consumeCurrentPrompt(session.id, sessionPaths.promptsFile);
        logInfo('SoraWorker', `[${session.name}] Prompt removed from file.`);
      } else {
        logInfo('SoraWorker', `[${session.name}] Keeping prompt in file due to failure.`);
      }

      await page.goto('https://sora.chatgpt.com', { waitUntil: 'domcontentloaded' });
      await new Promise(r => setTimeout(r, 3000));
    }

    return { ok: true, message: `Finished. Downloads: ${downloadCount}` };

  } catch (error) {
    logError('SoraWorker', `Fatal: ${(error as Error).message}`);
    return { ok: false, message: (error as Error).message };
  } finally {
    if (browser) browser.disconnect();
  }
}
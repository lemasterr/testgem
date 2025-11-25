import selectorsConfig from '../../config/selectors.json';
import type { ElementHandle, Page } from 'puppeteer-core';

export type SelectorMap = typeof selectorsConfig;

export const selectors: SelectorMap = selectorsConfig;

const DEFAULT_TIMEOUT_MS = 15_000;

export async function waitForVisible(
  page: Page,
  selector: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<ElementHandle<Element>> {
  const handle = await page.waitForSelector(selector, { timeout: timeoutMs, visible: true });
  if (!handle) {
    throw new Error(`Selector not found or visible: ${selector}`);
  }

  return handle;
}

export async function waitForClickable(
  page: Page,
  selector: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS
) {
  const handle = await waitForVisible(page, selector, timeoutMs);
  await page.waitForFunction(
    (el) => !(el as HTMLElement).hasAttribute('disabled'),
    { timeout: timeoutMs },
    handle
  );
  return handle;
}

export async function waitForDisappear(
  page: Page,
  selector: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS
) {
  return page.waitForSelector(selector, { timeout: timeoutMs, hidden: true });
}

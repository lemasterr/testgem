import type { Page } from 'puppeteer-core';

const sessionPages = new Map<string, Page>();

export function registerSessionPage(sessionId: string, page: Page): void {
  sessionPages.set(sessionId, page);
}

export function unregisterSessionPage(sessionId: string, page?: Page | null): void {
  const existing = sessionPages.get(sessionId);
  if (!existing) return;
  if (!page || existing === page) {
    sessionPages.delete(sessionId);
  }
}

export function getSessionPage(sessionId: string): Page | null {
  const page = sessionPages.get(sessionId) ?? null;
  if (page && typeof (page as Page).isClosed === 'function' && page.isClosed()) {
    sessionPages.delete(sessionId);
    return null;
  }
  return page ?? null;
}

export async function startSelectorInspect(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as typeof window & {
      __selectorInspectorCleanup?: () => void;
      __lastSelector?: string | null;
    };

    if (w.__selectorInspectorCleanup) {
      w.__selectorInspectorCleanup();
    }

    const compute = (el: Element | null): string | null => {
      if (!el) return null;
      const parts: string[] = [];
      let current: Element | null = el;
      let depth = 0;
      while (current && depth < 5) {
        let selector = current.tagName.toLowerCase();
        if (current.id) {
          selector += `#${current.id}`;
          parts.unshift(selector);
          break;
        }
        const classes = Array.from(current.classList).slice(0, 3);
        if (classes.length) selector += `.${classes.join('.')}`;
        const parent: HTMLElement | null = current.parentElement;
        if (parent) {
          const siblings = Array.from(parent.children).filter((child: Element) => child.tagName === current!.tagName);
          if (siblings.length > 1) {
            const idx = siblings.indexOf(current) + 1;
            selector += `:nth-of-type(${idx})`;
          }
        }
        parts.unshift(selector);
        current = parent;
        depth += 1;
      }
      return parts.join(' > ');
    };

    const handler = (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      w.__lastSelector = compute(event.target as Element);
    };

    const cleanup = () => {
      document.removeEventListener('click', handler, true);
    };

    w.__selectorInspectorCleanup = cleanup;
    w.__lastSelector = null;

    document.addEventListener('click', handler, true);
  });
}

export async function getLastSelector(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const w = window as typeof window & { __lastSelector?: string | null };
    return w.__lastSelector ?? null;
  });
}

export async function startInspectorForSession(
  sessionId: string
): Promise<{ ok: boolean; error?: string }> {
  const page = getSessionPage(sessionId);
  if (!page) {
    return { ok: false, error: 'No active page for session' };
  }

  try {
    await startSelectorInspect(page);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}

export async function getLastSelectorForSession(
  sessionId: string
): Promise<{ ok: boolean; selector?: string | null; error?: string }> {
  const page = getSessionPage(sessionId);
  if (!page) {
    return { ok: false, error: 'No active page for session' };
  }

  try {
    const selector = await getLastSelector(page);
    return { ok: true, selector };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}

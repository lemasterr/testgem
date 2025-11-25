import type { Page, ElementHandle } from 'puppeteer-core';

const PROMPT_INPUT_SELECTORS = [
  'textarea[data-testid="prompt-input"]',
  'textarea[placeholder*="Describe the video"]',
  'textarea[placeholder*="Describe your video"]',
  'textarea'
];

const GENERATE_BTN_SELECTORS = [
  'button[data-testid="generate-button"]',
  'button[aria-label="Generate"]',
  'button[type="submit"]'
];

async function findElementBySelectors(page: Page, selectorList: string[], timeout = 2000) {
  for (const sel of selectorList) {
    try {
      const el = await page.waitForSelector(sel, { timeout, visible: true });
      if (el) return { el, selector: sel };
    } catch {
      continue;
    }
  }
  return null;
}

// Helper to find button by text content
async function findButtonByText(page: Page, texts: string[]): Promise<ElementHandle<Element> | null> {
  for (const text of texts) {
    try {
      // Use evaluateHandle to find the element in DOM
      const handle = await page.evaluateHandle((t) => {
        const buttons = Array.from(document.querySelectorAll('button'));
        // Check text and visibility loosely
        return buttons.find(b => b.textContent?.includes(t) && b.offsetParent !== null);
      }, text);

      const element = handle.asElement();
      if (element) {
        // Explicit cast to satisfy TypeScript strictness regarding Node vs Element
        return element as ElementHandle<Element>;
      }
    } catch {
      continue;
    }
  }
  return null;
}

export async function insertPromptAndGenerate(page: Page, prompt: string): Promise<void> {
  // 1. Find input
  const inputResult = await findElementBySelectors(page, PROMPT_INPUT_SELECTORS, 5000);

  if (!inputResult) {
    throw new Error('Prompt input field not found');
  }

  const input = inputResult.el;

  // 2. Clear and type (Robust method)
  // Click to focus
  await input.click({ clickCount: 3 });
  // Ensure clear via keyboard (Cmd+A / Ctrl+A -> Backspace)
  const isMac = process.platform === 'darwin';
  const modifier = isMac ? 'Meta' : 'Control';

  await page.keyboard.down(modifier);
  await page.keyboard.press('A');
  await page.keyboard.up(modifier);
  await new Promise(r => setTimeout(r, 50));
  await page.keyboard.press('Backspace');

  // Fallback clear via DOM if keyboard failed to clear everything
  await page.evaluate((el) => (el as HTMLTextAreaElement).value = '', input);

  // Type new prompt
  await input.type(prompt, { delay: 15 });

  // 3. Find Generate button
  let generateBtn = (await findElementBySelectors(page, GENERATE_BTN_SELECTORS, 3000))?.el;

  if (!generateBtn) {
    const textBtn = await findButtonByText(page, ['Generate', 'Create']);
    if (textBtn) generateBtn = textBtn;
  }

  if (!generateBtn) {
    throw new Error('Generate button not found');
  }

  // 4. Click
  await new Promise(r => setTimeout(r, 500));

  // Check if disabled
  const isDisabled = await page.evaluate((el) => (el as HTMLButtonElement).disabled, generateBtn);
  if (isDisabled) {
     throw new Error('Generate button is disabled');
  }

  await generateBtn.click();
}
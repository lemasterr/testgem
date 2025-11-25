// sora_2/electron/automation/chromeController.ts
import path from 'path';
import { Browser, Page } from 'puppeteer-core';

import type { Config } from '../../shared/types';
import { getOrLaunchChromeForProfile } from '../chrome/manager';
import { type ChromeProfile } from '../chrome/profiles';
import { resolveSessionCdpPort } from '../utils/ports';

export type SessionRunContext = {
  sessionName: string;
  sessionPath: string;
  profileDir: string;
  downloadsDir: string;
  config: Config;
  cancelled: boolean;
};

const deriveProfileFromContext = (ctx: SessionRunContext): ChromeProfile => {
  const directoryName = path.basename(ctx.profileDir) || 'Default';
  const baseDir = path.dirname(ctx.profileDir);
  return {
    id: directoryName,
    name: directoryName,
    userDataDir: baseDir,
    profileDirectory: directoryName,
    profileDir: directoryName,
  };
};

export const launchBrowser = async (ctx: SessionRunContext): Promise<{ browser: Browser }> => {
  const profile = deriveProfileFromContext(ctx);
  const basePort = ctx.config.cdpPort ?? 9222;
  const port = resolveSessionCdpPort({ name: ctx.sessionName, cdpPort: null }, basePort);
  const browser = await getOrLaunchChromeForProfile(profile, port);
  return { browser };
};

export const newPage = async (browser: Browser): Promise<Page> => {
  return browser.newPage();
};

export const configureDownloads = async (page: Page, downloadsDir: string): Promise<void> => {
  const client = await page.target().createCDPSession();
  await client.send('Page.setDownloadBehavior', {
    behavior: 'allow',
    downloadPath: downloadsDir
  });
};
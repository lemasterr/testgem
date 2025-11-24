import { type Browser } from 'puppeteer-core';

import { ChromeProfile } from './profiles';
import { getOrLaunchChromeForProfile } from './manager';

export async function launchBrowserForSession(profile: ChromeProfile, cdpPort: number): Promise<Browser> {
  return getOrLaunchChromeForProfile(profile, cdpPort);
}


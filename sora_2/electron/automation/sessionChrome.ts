import type { Browser } from 'puppeteer-core';

import { getConfig, type Config } from '../config/config';
import { getOrLaunchChromeForProfile } from '../chrome/manager';
import { scanChromeProfiles, type ChromeProfile } from '../chrome/profiles';
import type { Session } from '../sessions/types';

const FALLBACK_CDP_PORT = 9222;

function normalize(value?: string | null): string | null {
  return value ? value.trim().toLowerCase() : null;
}

function pickProfileByName(profiles: ChromeProfile[], name: string): ChromeProfile | null {
  const normalized = normalize(name);
  if (!normalized) return null;

  return (
    profiles.find((p) => normalize(p.name) === normalized) ||
    profiles.find((p) => normalize(p.profileDirectory) === normalized) ||
    profiles.find((p) => normalize(p.profileDir) === normalized) ||
    profiles.find((p) => normalize(p.id) === normalized) ||
    null
  );
}

function resolvePort(session: Session, config?: Config | null): number {
  const candidate = session.cdpPort ?? config?.cdpPort ?? FALLBACK_CDP_PORT;
  const port = Number(candidate);
  return Number.isFinite(port) && port > 0 ? port : FALLBACK_CDP_PORT;
}

async function resolveProfile(
  session: Session,
  config?: Config
): Promise<{ profile: ChromeProfile; profiles: ChromeProfile[] }> {
  const profiles = await scanChromeProfiles();
  if (profiles.length === 0) {
    throw new Error('Chrome profiles not found. Configure Chrome user data root in Settings.');
  }

  const preferredName = session.chromeProfileName ?? config?.chromeActiveProfileName ?? null;
  const preferred = preferredName ? pickProfileByName(profiles, preferredName) : null;
  if (preferred) return { profile: preferred, profiles };

  const fallback = profiles.find((p) => p.isDefault) ?? profiles[0];
  return { profile: fallback, profiles };
}

export async function ensureBrowserForSession(
  session: Session,
  config?: Config
): Promise<{ browser: Browser; profile: ChromeProfile; port: number; config: Config }> {
  const resolvedConfig = config ?? (await getConfig());
  const { profile } = await resolveProfile(session, resolvedConfig);
  const port = resolvePort(session, resolvedConfig);
  const browser = await getOrLaunchChromeForProfile(profile, port);

  return { browser, profile, port, config: resolvedConfig };
}

export { resolvePort as resolveCdpPort };


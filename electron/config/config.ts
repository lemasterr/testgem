// sora_2/electron/config/config.ts
import { app } from 'electron';
import fs from 'fs/promises';
import path from 'path';

import { ensureDir } from '../utils/fs';
import { encryptSensitive, decryptSensitive } from './secureStorage';

// Define types locally to avoid circular dependency with shared/types.ts
export interface WatermarkRect {
  x: number;
  y: number;
  width: number;
  height: number;
  label?: string;
}

export interface WatermarkMask {
  id: string;
  name: string;
  rects: WatermarkRect[];
  updatedAt?: number;
}

export type Config = {
  sessionsRoot: string;
  chromeExecutablePath: string | null;
  chromeUserDataRoot?: string | null;
  chromeUserDataDir: string | null;
  chromeActiveProfileName: string | null;
  chromeProfileId?: string | null;
  chromeClonedProfilesRoot?: string | null;
  cdpPort: number | null;
  promptDelayMs: number;
  draftTimeoutMs: number;
  downloadTimeoutMs: number;
  maxParallelSessions: number;
  ffmpegPath: string | null;
  cleanup?: {
    enabled?: boolean;
    dryRun?: boolean;
    retentionDaysDownloads?: number;
    retentionDaysBlurred?: number;
    retentionDaysTemp?: number;
  };
  telegram: {
    enabled: boolean;
    botToken: string | null;
    chatId: string | null;
  };
  telegramTemplates?: {
    pipelineFinished?: string;
    sessionError?: string;
  };
  hooks?: {
    postDownload?: string;
  };
  // --- New Fields for Watermark/Blur ---
  watermarkMasks?: WatermarkMask[];
  activeWatermarkMaskId?: string;
};

const CONFIG_FILE = 'config.json';

// Cache configuration
let configCache: { data: Config; timestamp: number } | null = null;
const CACHE_TTL = 5000; // 5 seconds

function defaultConfig(): Config {
  const defaultSessionsRoot = path.join(getUserDataPath(), 'sessions');
  return {
    sessionsRoot: defaultSessionsRoot,
    chromeExecutablePath: null,
    chromeUserDataRoot: null,
    chromeUserDataDir: null,
    chromeActiveProfileName: null,
    chromeProfileId: null,
    chromeClonedProfilesRoot: path.join(defaultSessionsRoot, 'chrome-clones'),
    cdpPort: 9222,
    promptDelayMs: 2000,
    draftTimeoutMs: 60_000,
    downloadTimeoutMs: 300_000,
    maxParallelSessions: 2,
    ffmpegPath: null,
    cleanup: {
      enabled: true,
      dryRun: false,
      retentionDaysDownloads: 14,
      retentionDaysBlurred: 30,
      retentionDaysTemp: 3,
    },
    telegram: {
      enabled: false,
      botToken: null,
      chatId: null,
    },
    telegramTemplates: {
      pipelineFinished: undefined,
      sessionError: undefined,
    },
    hooks: {
      postDownload: undefined,
    },
    // Default watermark settings
    watermarkMasks: [],
    activeWatermarkMaskId: undefined,
  };
}

function getConfigPath(): string {
  return path.join(getUserDataPath(), CONFIG_FILE);
}

async function ensureAppReady(): Promise<void> {
  if (app.isReady()) return;
  await app.whenReady();
}

async function ensureConfigDir(): Promise<void> {
  await ensureAppReady();
  await ensureDir(getUserDataPath());
}

export function getUserDataPath(): string {
  return app.getPath('userData');
}

function mergeConfig(base: Config, partial?: Partial<Config>): Config {
  const next: Config = {
    ...base,
    ...partial,
    telegram: {
      ...base.telegram,
      ...(partial?.telegram ?? {}),
    },
    cleanup: {
      ...base.cleanup,
      ...(partial?.cleanup ?? {}),
    },
    telegramTemplates: {
      ...base.telegramTemplates,
      ...(partial?.telegramTemplates ?? {}),
    },
    hooks: {
      ...base.hooks,
      ...(partial?.hooks ?? {}),
    },
    watermarkMasks: partial?.watermarkMasks ?? base.watermarkMasks,
    activeWatermarkMaskId: partial?.activeWatermarkMaskId ?? base.activeWatermarkMaskId,
  };
  return next;
}

async function loadConfigFromDisk(): Promise<Config> {
  await ensureConfigDir();
  const defaults = defaultConfig();

  try {
    const raw = await fs.readFile(getConfigPath(), 'utf-8');
    const parsed = JSON.parse(raw) as Partial<Config>;

    // Decrypt sensitive fields
    if (parsed.telegram?.botToken) {
      parsed.telegram.botToken = decryptSensitive(parsed.telegram.botToken);
    }

    const merged = mergeConfig(defaults, parsed);
    await ensureDir(merged.sessionsRoot);
    return merged;
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') {
      throw error;
    }

    await fs.writeFile(getConfigPath(), JSON.stringify(defaults, null, 2), 'utf-8');
    await ensureDir(defaults.sessionsRoot);
    return defaults;
  }
}

export async function getConfig(): Promise<Config> {
  const now = Date.now();
  if (configCache && (now - configCache.timestamp) < CACHE_TTL) {
    return configCache.data;
  }

  const config = await loadConfigFromDisk();
  configCache = { data: config, timestamp: now };
  return config;
}

export async function updateConfig(partial: Partial<Config>): Promise<Config> {
  const current = await getConfig();

  // Handle sensitive data encryption before merging/saving
  const toSave: Partial<Config> = { ...partial };
  if (toSave.telegram?.botToken) {
    toSave.telegram.botToken = encryptSensitive(toSave.telegram.botToken);
  }

  // We merge with current *decrypted* config for the return value,
  // but we need to ensure we save encrypted values to disk.
  // To simplify: we merge first, then save.

  const next = mergeConfig(current, partial); // 'next' contains decrypted values for usage

  // Prepare object for disk writing (with encryption)
  const diskVersion = JSON.parse(JSON.stringify(next));
  if (diskVersion.telegram?.botToken) {
    diskVersion.telegram.botToken = encryptSensitive(diskVersion.telegram.botToken);
  }

  await ensureConfigDir();
  await ensureDir(next.sessionsRoot);
  await fs.writeFile(getConfigPath(), JSON.stringify(diskVersion, null, 2), 'utf-8');

  // Update cache with the usable (decrypted) version
  configCache = { data: next, timestamp: Date.now() };

  return next;
}
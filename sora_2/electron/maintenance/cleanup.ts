import fs from 'fs/promises';
import path from 'path';
import { getConfig } from '../config/config';
import { getUserDataPath } from '../config/config';
import { ensureDir } from '../utils/fs';

export type CleanupResult = {
  deleted: string[];
  skipped: string[];
};

type CategoryKey = 'downloads' | 'blurred' | 'temp';

type CleanupCategory = {
  key: CategoryKey;
  retentionDays: number;
  paths: string[];
};

async function collectFiles(dir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries) {
      const entryPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...(await collectFiles(entryPath)));
      } else {
        files.push(entryPath);
      }
    }
    return files;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

export async function runCleanupNow(): Promise<CleanupResult> {
  const config = await getConfig();
  const { cleanup } = config;
  const result: CleanupResult = { deleted: [], skipped: [] };

  const categories: CleanupCategory[] = [
    {
      key: 'downloads',
      retentionDays: cleanup?.retentionDaysDownloads ?? 7,
      paths: [path.join(config.sessionsRoot, 'downloads')],
    },
    {
      key: 'blurred',
      retentionDays: cleanup?.retentionDaysBlurred ?? 14,
      paths: [path.join(config.sessionsRoot, 'clean'), path.join(config.sessionsRoot, 'blurred')],
    },
    {
      key: 'temp',
      retentionDays: cleanup?.retentionDaysTemp ?? 3,
      paths: [path.join(getUserDataPath(), 'temp')],
    },
  ];

  const now = Date.now();

  for (const category of categories) {
    for (const base of category.paths) {
      await ensureDir(base);
      const files = await collectFiles(base);
      for (const file of files) {
        const stats = await fs.stat(file).catch(() => null);
        if (!stats) continue;
        const ageDays = (now - stats.mtimeMs) / (1000 * 60 * 60 * 24);
        if (ageDays < category.retentionDays) continue;

        if (cleanup?.enabled === false) {
          result.skipped.push(file);
          continue;
        }

        if (cleanup?.dryRun) {
          result.skipped.push(file);
          continue;
        }

        await fs.unlink(file).catch(() => {});
        result.deleted.push(file);
      }
    }
  }

  return result;
}

export function scheduleDailyCleanup(): void {
  // Run immediately once during startup
  runCleanupNow().catch(() => undefined);

  const DAY_MS = 24 * 60 * 60 * 1000;
  setInterval(() => {
    runCleanupNow().catch(() => undefined);
  }, DAY_MS);
}


// Path: sora_2/electron/maintenance/cleanup.ts
import path from 'path';
import { getConfig } from '../config/config';
import { getUserDataPath } from '../config/config';
import { pythonCleanup } from '../integrations/pythonClient';
import { logInfo, logError } from '../logging/logger';

export type CleanupResult = {
  deleted: string[];
  skipped: string[];
};

export async function runCleanupNow(): Promise<CleanupResult> {
  const config = await getConfig();
  const { cleanup } = config;

  if (cleanup?.enabled === false) {
    return { deleted: [], skipped: [] };
  }

  const dryRun = cleanup?.dryRun ?? false;
  const downloadsDir = path.join(config.sessionsRoot, 'downloads');
  const cleanDir = path.join(config.sessionsRoot, 'clean');
  const tempDir = path.join(getUserDataPath(), 'temp');

  logInfo('Cleanup', 'Starting cleanup via Python...');

  try {
    // 1. Downloads
    await pythonCleanup(downloadsDir, cleanup?.retentionDaysDownloads ?? 14, dryRun);

    // 2. Clean/Blurred
    await pythonCleanup(cleanDir, cleanup?.retentionDaysBlurred ?? 30, dryRun);

    // 3. Temp files
    await pythonCleanup(tempDir, cleanup?.retentionDaysTemp ?? 3, dryRun);

    logInfo('Cleanup', 'Cleanup tasks completed via Python');
    return { deleted: [], skipped: [] };
  } catch (error) {
    logError('Cleanup', `Cleanup failed: ${(error as Error).message}`);
    return { deleted: [], skipped: [] };
  }
}

export function scheduleDailyCleanup(): void {
  // Run immediately once during startup after a short delay
  setTimeout(() => runCleanupNow().catch(() => undefined), 10000);

  const DAY_MS = 24 * 60 * 60 * 1000;
  setInterval(() => {
    runCleanupNow().catch(() => undefined);
  }, DAY_MS);
}
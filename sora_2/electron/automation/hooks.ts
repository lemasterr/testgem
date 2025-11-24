import { spawn } from 'child_process';
import { getConfig } from '../config/config';
import { logError, logInfo } from '../logging/logger';

function fillTemplate(template: string, videoPath: string, title: string): string {
  return template
    .replace(/\{videoPath\}/g, videoPath)
    .replace(/\{title\}/g, title);
}

export async function runPostDownloadHook(videoPath: string, title: string): Promise<void> {
  const config = await getConfig();
  const template = config.hooks?.postDownload;

  if (!template) return;

  const command = fillTemplate(template, videoPath, title);

  try {
    const child = spawn(command, {
      shell: true,
      stdio: 'ignore',
      detached: true,
    });

    child.on('error', (error) => {
      logError('hooks', `postDownload failed to start: ${(error as Error).message}`);
    });

    child.unref();
    logInfo('hooks', `postDownload started: ${command}`);
  } catch (error) {
    logError('hooks', `postDownload error: ${(error as Error).message}`);
  }
}

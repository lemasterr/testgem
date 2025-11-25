// sora_2/electron/chrome/processManager.ts
import { app } from 'electron';
import { spawn } from 'child_process';
import { logInfo, logError } from '../logging/logger';

const chromeProcesses = new Set<number>();

export function registerChromeProcess(pid: number) {
  chromeProcesses.add(pid);
}

export function unregisterChromeProcess(pid: number) {
  chromeProcesses.delete(pid);
}

app.on('before-quit', async () => {
  logInfo('cleanup', 'Terminating all Chrome processes...');

  for (const pid of chromeProcesses) {
    try {
      if (process.platform === 'win32') {
        spawn('taskkill', ['/PID', `${pid}`, '/T', '/F'], { stdio: 'ignore' });
      } else {
        process.kill(pid, 'SIGTERM');
        // Give it a moment to close gracefully
        await new Promise(r => setTimeout(r, 500));
        try {
          // Force kill if still running
          process.kill(pid, 'SIGKILL');
        } catch {
          // Ignore if already gone
        }
      }
    } catch (err) {
      logError('cleanup', `Failed to kill PID ${pid}: ${(err as Error).message}`);
    }
  }

  chromeProcesses.clear();
});
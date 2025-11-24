import { spawn } from 'child_process';
import fs from 'fs';
import http from 'http';
import net from 'net';
import path from 'path';

import { resolveChromeExecutablePath } from '../../platform/chromePaths';
import { logError, logInfo } from '../utils/log';

// Centralized Chrome launcher used across the app to start a single Chrome instance
// with the required DevTools (CDP) port and user profile. All callers should go
// through this module instead of spawning Chrome directly.

const CDP_HOST = '127.0.0.1';

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type CDPProbeResult = { reachable: boolean; isChrome: boolean; error?: Error; bodySnippet?: string };

async function probeCDPEndpoint(port: number): Promise<CDPProbeResult> {
  const endpoint = `http://${CDP_HOST}:${port}/json/version`;
  return new Promise((resolve) => {
    const req = http.get(endpoint, { timeout: 1200 }, (res) => {
      let body = '';
      res.on('data', (chunk) => {
        body += chunk.toString();
      });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          const isChrome = Boolean(parsed?.webSocketDebuggerUrl || parsed?.Browser);
          resolve({ reachable: true, isChrome, bodySnippet: body.slice(0, 200) });
        } catch (error) {
          resolve({ reachable: true, isChrome: false, error: error as Error, bodySnippet: body.slice(0, 200) });
        }
      });
    });

    req.on('error', (error) => resolve({ reachable: false, isChrome: false, error: error as Error }));
    req.on('timeout', () => {
      req.destroy();
      resolve({ reachable: false, isChrome: false, error: new Error('CDP probe timeout') });
    });
  });
}

function isPortOccupied(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ port, host: CDP_HOST, timeout: 800 });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
  });
}

/**
 * Waits for the Chrome DevTools Protocol endpoint to come up on the given port.
 * Provides actionable error messages for common failure scenarios.
 */
export async function waitForCDP(port: number, timeoutMs = 20000): Promise<boolean> {
  const endpoint = `http://${CDP_HOST}:${port}/json/version`;
  const start = Date.now();

  const firstProbe = await probeCDPEndpoint(port);
  if (firstProbe.reachable && !firstProbe.isChrome) {
    throw new Error(
      [
        `CDP порт ${port} уже занят другим процессом.`,
        'Закройте все окна Chrome и другие приложения, использующие этот порт, либо выберите другой порт.',
      ].join('\n')
    );
  }
  if (firstProbe.isChrome) {
    return true;
  }

  let lastError: Error | undefined = firstProbe.error;

  while (Date.now() - start < timeoutMs) {
    const probe = await probeCDPEndpoint(port);
    if (probe.reachable && probe.isChrome) {
      return true;
    }
    if (probe.reachable && !probe.isChrome) {
      throw new Error(
        [
          `Chrome уже запущен на порту ${port}, но не отдал DevTools. Порт занят или откликается другой сервис.`,
          'Закройте все окна Chrome и перезапустите сессию, либо укажите другой CDP порт.',
        ].join('\n')
      );
    }
    lastError = probe.error ?? lastError;
    await delay(450);
  }

  const occupiedHint = await isPortOccupied(port);
  const reasonLines = [
    `Chrome не открыл CDP по адресу ${endpoint} за ${timeoutMs} мс.`,
    occupiedHint ? 'Порт выглядит занятым. Закройте все окна Chrome или выберите другой порт.' : 'Порт не отвечает.',
    'Возможные причины:',
    '— профиль поврежден или заблокирован; удалите lock-файлы или выберите другой профиль.',
    '— Chrome уже запущен без флага --remote-debugging-port.',
    '— порт занят другим приложением.',
    'Попробуйте перезагрузить сессию и полностью закрыть Chrome.',
  ];

  if (lastError?.message) {
    reasonLines.push(`Последняя ошибка подключения: ${lastError.message}`);
  }

  const message = reasonLines.join('\n');
  logError(message);
  throw new Error(message);
}

async function terminateSpawnedProcess(pid?: number) {
  if (!pid) return;

  if (process.platform === 'win32') {
    return new Promise<void>((resolve) => {
      const killer = spawn('taskkill', ['/PID', `${pid}`, '/T', '/F'], { stdio: 'ignore' });
      killer.on('exit', () => resolve());
      killer.on('error', () => resolve());
    });
  }

  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    // ignore
  }

  await delay(300);

  try {
    process.kill(pid, 0);
    process.kill(pid, 'SIGKILL');
  } catch {
    // ignore if already exited
  }
}

function buildLaunchArgs(profilePath: string, cdpPort: number, extraArgs: string[] = []): string[] {
  const defaultArgs = [
    `--remote-debugging-port=${cdpPort}`,
    `--user-data-dir=${profilePath}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-features=AutomationControlled',
    '--disable-component-update',
    '--disable-background-networking',
    '--disable-sync',
    '--disable-dev-shm-usage',
    '--disable-session-crashed-bubble',
    '--disable-features=Translate',
    '--start-maximized',
  ];

  return [...defaultArgs, ...extraArgs];
}

/**
 * Launches Chrome with a user data directory and CDP port. CDP readiness is
 * validated by the caller to avoid double polling. Returns the spawned PID
 * alongside the normalized profile path and port.
 */
export async function launchChromeWithCDP(options: {
  profilePath: string;
  cdpPort: number;
  extraArgs?: string[];
}): Promise<{
  pid: number;
  cdpPort: number;
  profilePath: string;
}> {
  const { profilePath, cdpPort, extraArgs = [] } = options;

  if (!profilePath || !fs.existsSync(profilePath)) {
    throw new Error(`Chrome profile directory not found: ${profilePath}`);
  }

  const executablePath = await resolveChromeExecutablePath();
  const args = buildLaunchArgs(profilePath, cdpPort, extraArgs);

  const child = spawn(executablePath, args, {
    detached: true,
    stdio: 'ignore',
  });

  child.unref();

  logInfo(`Launching Chrome with profile ${profilePath} on CDP port ${cdpPort}`);
  // Waiting for CDP is handled by the caller (electron/chrome/manager) to avoid double polling.
  logInfo(`Chrome launched with pid ${child.pid ?? -1} on port ${cdpPort}`);
  return { pid: child.pid ?? -1, cdpPort, profilePath: path.resolve(profilePath) };
}

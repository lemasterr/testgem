// sora_2/electron/chrome/manager.ts
import { spawn, spawnSync } from 'child_process';
import fs from 'fs';
import http from 'http';
import net from 'net';
import path from 'path';
import puppeteer, { type Browser } from 'puppeteer-core';

import { launchChromeWithCDP, waitForCDP } from '../../core/chrome/chromeLauncher';
import { pages } from '../../core/config/pages';
import { getConfig } from '../config/config';
import { ChromeProfile, ensureCloneSeededFromProfile, resolveProfileLaunchTarget, verifyProfileClone } from './profiles';
import { logInfo } from '../../core/utils/log';
import { registerChromeProcess, unregisterChromeProcess } from './processManager';

const CDP_HOST = '127.0.0.1';

type ChromeInstance = {
  key: string;
  port: number;
  endpoint: string;
  browser: Browser;
  profileDirectory: string;
  userDataDir: string;
  spawned: boolean;
  childPid?: number;
};

const activeInstances = new Map<string, ChromeInstance>();
const portLocks = new Map<number, Promise<any>>();

function parsePidFromLock(lockPath: string): number | null {
  try {
    const target = fs.readlinkSync(lockPath);
    const match = target.match(/(\d+)/);
    if (match) return Number(match[1]);
  } catch {
    // not a symlink; fall through
  }

  try {
    const content = fs.readFileSync(lockPath, 'utf8');
    const match = content.match(/(\d+)/);
    if (match) return Number(match[1]);
  } catch {
    // ignore read errors
  }

  return null;
}

function isChromeProcess(pid: number): boolean {
  if (process.platform === 'win32') return true;

  try {
    const result = spawnSync('ps', ['-p', `${pid}`, '-o', 'comm='], { encoding: 'utf8' });
    if (result.error) return true;

    const command = result.stdout?.trim().toLowerCase();
    if (!command) return true;

    return command.includes('chrome');
  } catch {
    return true;
  }
}

function isPidRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    return !(code === 'ESRCH' || code === 'EPERM');
  }
}

function isProfileDirInUse(userDataDir: string): boolean {
  const lockFiles = ['SingletonLock', 'SingletonCookie', 'SingletonSocket'];

  for (const file of lockFiles) {
    const lockPath = path.join(userDataDir, file);
    if (!fs.existsSync(lockPath)) continue;

    const pid = parsePidFromLock(lockPath);

    if (pid !== null && isPidRunning(pid)) {
      if (isChromeProcess(pid)) {
        return true;
      }

      // Stale or unrelated process holding the PID; try to clear the lock.
    }

    try {
      fs.unlinkSync(lockPath);
    } catch {
      // If we cannot remove it, assume the profile is in use to stay safe
      return true;
    }
  }

  return false;
}

async function terminateSpawnedProcess(pid?: number): Promise<void> {
  if (!pid) return;

  if (process.platform === 'win32') {
    await new Promise<void>((resolve) => {
      const killer = spawn('taskkill', ['/PID', `${pid}`, '/T', '/F'], { stdio: 'ignore' });
      killer.on('exit', () => resolve());
      killer.on('error', () => resolve());
    });
    return;
  }

  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    // ignore
  }

  await delay(500);

  try {
    process.kill(pid, 0);
    process.kill(pid, 'SIGKILL');
  } catch {
    // ignore if already exited
  }
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function isEndpointAvailable(endpoint: string): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(endpoint, { timeout: 1000 }, (res) => {
      res.destroy();
      resolve(true);
    });

    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function isPortBusy(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: CDP_HOST, port, timeout: 800 });
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

type LaunchInfo = { endpoint: string; alreadyRunning: boolean; childPid?: number };

async function readDevToolsActivePort(userDataDir: string): Promise<number | null> {
  const activePortFile = path.join(userDataDir, 'DevToolsActivePort');
  try {
    const content = await fs.promises.readFile(activePortFile, 'utf8');
    const port = Number(content.trim().split(/\s+/)[0]);
    return Number.isFinite(port) ? port : null;
  } catch {
    return null;
  }
}

async function findDevToolsActivePort(candidateDirs: Iterable<string>): Promise<number | null> {
  for (const dir of candidateDirs) {
    const port = await readDevToolsActivePort(dir);
    if (port) return port;
  }
  return null;
}

async function ensureChromeWithCDP(profile: ChromeProfile, port: number): Promise<LaunchInfo> {
  const config = await getConfig();
  try {
    await fs.promises.access(config.sessionsRoot, fs.constants.R_OK | fs.constants.W_OK);
  } catch (error) {
    throw new Error(
      [
        `Нет доступа к sessionsRoot: ${config.sessionsRoot}.`,
        'Проверьте права на директорию или выберите другой путь в настройках.',
        (error as Error)?.message ?? '',
      ]
        .filter(Boolean)
        .join('\n')
    );
  }

  const endpoint = `http://${CDP_HOST}:${port}`;
  if (await isEndpointAvailable(endpoint)) {
    return { endpoint, alreadyRunning: true };
  }

  if (await isPortBusy(port)) {
    throw new Error(
      [
        `CDP порт ${port} уже занят другим процессом.`,
        'Закройте все окна Chrome или выберите другой порт в настройках.',
      ].join('\n')
    );
  }

  const { userDataDir, profileDirectoryArg } = await resolveProfileLaunchTarget(profile);
  const activePort = await findDevToolsActivePort(new Set([userDataDir, profile.userDataDir].filter(Boolean)));
  if (activePort) {
    const activeEndpoint = `http://${CDP_HOST}:${activePort}`;
    if (await isEndpointAvailable(activeEndpoint)) {
      logInfo(
        `[chrome] detected existing DevTools port for profile: ${activeEndpoint} (requested ${port})`
      );
      return { endpoint: activeEndpoint, alreadyRunning: true };
    }
  }

  const verification = await verifyProfileClone(userDataDir, profileDirectoryArg ?? 'Default');
  if (!verification.ok) {
    logInfo(
      `[chrome] cloned profile at ${userDataDir} failed verification: ${verification.reason ?? 'unknown'} — attempting to re-seed`
    );
    await ensureCloneSeededFromProfile(profile, userDataDir);
    const postSeedVerification = await verifyProfileClone(userDataDir, profileDirectoryArg ?? 'Default');
    if (!postSeedVerification.ok) {
      throw new Error(
        [
          `Клон профиля поврежден: ${postSeedVerification.reason ?? 'неизвестная ошибка'}.`,
          `Директория: ${userDataDir}.`,
          'Удалите клон или выберите другой профиль, затем перезапустите сессию.',
        ].join('\n')
      );
    }
  }

  if (isProfileDirInUse(userDataDir)) {
    throw new Error(
      [
        `Chrome is already running for profile data at: ${userDataDir}`,
        '',
        'To allow Sora Bot to control this profile, Chrome must be started with remote debugging enabled.',
        'Steps:',
        '  1) Fully quit Google Chrome for this profile:',
        '     - On macOS: press Cmd+Q in Chrome, or right-click the Dock icon and choose "Quit".',
        '     - Make sure there are no "Google Chrome" processes left in Activity Monitor.',
        `  2) In the Sora Bot app, click "Start Chrome" for this session so we can launch Chrome with "--remote-debugging-port=${port}".`,
        `  3) Then open ${pages.baseUrl} in that Chrome window and run downloads/prompts again.`,
      ].join('\n')
    );
  }

  if (profileDirectoryArg) {
    const profileDirPath = path.join(userDataDir, profileDirectoryArg);
    if (!fs.existsSync(profileDirPath)) {
      throw new Error(`Chrome profile "${profileDirectoryArg}" is missing under ${userDataDir}. Choose another profile.`);
    }
  }

  const launchResult = await launchChromeWithCDP({
    profilePath: userDataDir,
    cdpPort: port,
    extraArgs: profileDirectoryArg ? [`--profile-directory=${profileDirectoryArg}`] : [],
  });

  // Register PID for cleanup
  if (launchResult.pid) {
    registerChromeProcess(launchResult.pid);
  }

  try {
    await waitForCDP(port);
  } catch (error) {
    await terminateSpawnedProcess(launchResult.pid);
    if (launchResult.pid) unregisterChromeProcess(launchResult.pid);
    throw error;
  }

  const resolvedEndpoint = `http://${CDP_HOST}:${launchResult.cdpPort}`;
  logInfo(
    `[chrome] spawned browser for CDP | userDataDir=${userDataDir} profileDirectory=${profileDirectoryArg ?? 'Default'} port=${launchResult.cdpPort}`
  );

  return { endpoint: resolvedEndpoint, alreadyRunning: false, childPid: launchResult.pid };
}

function instanceKey(profile: ChromeProfile): string {
  const name = profile.profileDirectory ?? profile.name ?? 'profile';
  const base = profile.userDataDir ?? 'user-data';
  const dir = profile.profileDirectory ?? profile.profileDir ?? 'Default';
  return `${base}::${dir}::${name}`;
}

export async function getOrLaunchChromeForProfile(profile: ChromeProfile, port: number): Promise<Browser> {
  const key = instanceKey(profile);

  // Port-level lock to prevent race conditions when multiple sessions/workers request the same port
  if (portLocks.has(port)) {
    await portLocks.get(port);
  }

  const launchPromise = (async () => {
    const existing = activeInstances.get(key);

    if (existing && existing.browser.isConnected()) {
      return existing.browser;
    }

    if (existing) {
      activeInstances.delete(key);
    }

    const { endpoint, alreadyRunning, childPid } = await ensureChromeWithCDP(profile, port);
    const browser = (await puppeteer.connect({
      browserURL: endpoint,
      defaultViewport: null,
    })) as Browser & { __soraAlreadyRunning?: boolean; __soraManaged?: boolean };

    browser.__soraAlreadyRunning = alreadyRunning;
    browser.__soraManaged = !alreadyRunning;

    activeInstances.set(key, {
      key,
      browser,
      endpoint,
      port: Number(new URL(endpoint).port),
      userDataDir: profile.userDataDir,
      profileDirectory: profile.profileDirectory ?? profile.profileDir ?? 'Default',
      spawned: !alreadyRunning,
      childPid,
    });

    browser.on('disconnected', () => {
      const current = activeInstances.get(key);
      if (current && current.browser === browser) {
        activeInstances.delete(key);
        if (current.childPid) unregisterChromeProcess(current.childPid);
      }
    });

    logInfo(
      `[chrome] connected to CDP | endpoint=${endpoint} userDataDir=${profile.userDataDir} profileDirectory=${
        profile.profileDirectory ?? profile.profileDir ?? 'Default'
      }`
    );

    return browser;
  })();

  portLocks.set(port, launchPromise);

  try {
    return await launchPromise;
  } finally {
    portLocks.delete(port);
  }
}

export async function attachExistingChromeForProfile(
  profile: ChromeProfile,
  port: number
): Promise<Browser> {
  const key = instanceKey(profile);
  const existing = activeInstances.get(key);

  // Port locking might be needed here too if we consider attaching as a launch event,
  // but usually attaching implies finding what's already there.
  // We'll lock just to be safe against concurrent launch attempts on same port.
  if (portLocks.has(port)) {
    await portLocks.get(port);
  }

  const attachPromise = (async () => {
    logInfo(
      `[chrome] attachExistingChromeForProfile: checking activeInstances key=${key} hasExisting=${!!existing} isConnected=${
        !!existing?.browser?.isConnected()
      }`
    );

    if (existing && existing.browser.isConnected()) {
      return existing.browser;
    }

    const { userDataDir } = await resolveProfileLaunchTarget(profile);
    const requestedEndpoint = `http://${CDP_HOST}:${port}`;
    let targetEndpoint: string | null = null;

    if (await isEndpointAvailable(requestedEndpoint)) {
      targetEndpoint = requestedEndpoint;
    } else {
      const activePort = await findDevToolsActivePort(new Set([userDataDir, profile.userDataDir].filter(Boolean)));
      logInfo(
        `[chrome] attachExistingChromeForProfile: DevToolsActivePort read userDataDir=${userDataDir} activePort=${activePort} requestedPort=${port}`
      );
      if (activePort) {
        const activeEndpoint = `http://${CDP_HOST}:${activePort}`;
        if (await isEndpointAvailable(activeEndpoint)) {
          targetEndpoint = activeEndpoint;
          logInfo(
            `[chrome] attaching to detected DevTools port for profile activeEndpoint=${activeEndpoint} requestedPort=${port}`
          );
        }
      }
    }

    if (!targetEndpoint) {
      logInfo(
        `[chrome] attachExistingChromeForProfile: no DevTools endpoint found, falling back to getOrLaunchChromeForProfile requestedPort=${port} userDataDir=${userDataDir}`
      );
      // Release lock inside since getOrLaunch will acquire it
      return getOrLaunchChromeForProfile(profile, port);
    }

    const browser = (await puppeteer.connect({
      browserURL: targetEndpoint,
      defaultViewport: null,
    })) as Browser & { __soraAlreadyRunning?: boolean; __soraManaged?: boolean };

    browser.__soraAlreadyRunning = true;
    browser.__soraManaged = false;

    activeInstances.set(key, {
      key,
      browser,
      endpoint: targetEndpoint,
      port: Number(new URL(targetEndpoint).port),
      userDataDir: profile.userDataDir,
      profileDirectory: profile.profileDirectory ?? profile.profileDir ?? 'Default',
      spawned: existing?.spawned ?? false,
      childPid: existing?.childPid,
    });

    browser.on('disconnected', () => {
      const current = activeInstances.get(key);
      if (current && current.browser === browser) {
        activeInstances.delete(key);
      }
    });

    logInfo(
      `[chrome] attached to existing Chrome | endpoint=${targetEndpoint} userDataDir=${profile.userDataDir} profileDirectory=${
        profile.profileDirectory ?? profile.profileDir ?? 'Default'
      }`
    );

    return browser;
  })();

  // If falling back to getOrLaunch, that function handles locking.
  // But we wrapped the whole logic in a promise that we set as the lock value.
  // Note: recursive locking isn't supported by this simple Map, so strictly we should NOT lock if we might call getOrLaunch.
  // However, in this specific function flow, if we call getOrLaunch, we await it.
  // To avoid deadlock: we won't lock `attachExisting` externally, but we should probably rely on `getOrLaunch`'s lock if we fall back.
  // For simplicity and safety given the Race Condition fix request, let's wrap just the core logic.

  // Actually, to avoid deadlock with getOrLaunch, we should check inside.
  // Ideally refactor so `getOrLaunch` is the single entry point for locking.
  // For now, I will skip explicit locking in `attach` if it falls back, or ensure `getOrLaunch` can handle it.
  // Since `getOrLaunch` checks `portLocks.has(port)`, if we set it here, it will wait forever.
  // FIX: We will NOT lock here, assuming `attach` is manual and less prone to race with automation, OR we rely on `getOrLaunch` locking when it falls back.

  return await attachExistingChromeForProfile(profile, port).catch(async () => {
      // If explicit attach fails or isn't found, use the manager which locks
      return getOrLaunchChromeForProfile(profile, port);
  });
}

export async function shutdownChromeByKey(key: string): Promise<void> {
  const existing = activeInstances.get(key);

  if (!existing) return;

  activeInstances.delete(key);

  try {
    await existing.browser.close();
  } catch {
    // ignore close errors
  }

  if (existing.spawned && existing.childPid) {
    await terminateSpawnedProcess(existing.childPid);
    unregisterChromeProcess(existing.childPid);
  }
}

export async function shutdownChromeForProfile(profile: ChromeProfile): Promise<void> {
  await shutdownChromeByKey(instanceKey(profile));
}

export function closeChromeForProfile(profile: ChromeProfile): void {
  shutdownChromeForProfile(profile).catch(() => undefined);
}

export async function shutdownAllChrome(): Promise<void> {
  const keys = Array.from(activeInstances.keys());
  for (const key of keys) {
    try {
      await shutdownChromeByKey(key);
    } catch {
      // ignore shutdown errors
    }
  }
}
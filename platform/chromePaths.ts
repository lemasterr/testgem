import fs from 'fs';
import path from 'path';

const exists = (candidate: string | null | undefined): candidate is string => {
  if (!candidate) return false;
  try {
    return fs.existsSync(candidate);
  } catch {
    return false;
  }
};

const windowsCandidates = (): string[] => {
  const targets: string[] = [];
  const roots = [process.env.LOCALAPPDATA, process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)']].filter(Boolean);
  for (const root of roots) {
    const base = path.join(root as string, 'Google', 'Chrome', 'Application', 'chrome.exe');
    if (!targets.includes(base)) targets.push(base);
  }
  return targets;
};

const macCandidates = (): string[] => [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
  '/Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta',
];

const linuxCandidates = (): string[] => [
  'google-chrome',
  'google-chrome-stable',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/google-chrome',
  '/opt/google/chrome/chrome',
];

async function resolveFromPath(binaryName: string): Promise<string | null> {
  if (binaryName.includes(path.sep)) {
    return exists(binaryName) ? binaryName : null;
  }

  const envPath = process.env.PATH || '';
  const segments = envPath.split(path.delimiter);
  for (const segment of segments) {
    const candidate = path.join(segment, binaryName);
    if (exists(candidate)) {
      return candidate;
    }
  }
  return null;
}

async function readConfiguredChromePath(): Promise<string | null> {
  try {
    const { getConfig } = await import('../electron/config/config');
    const config = await getConfig();
    if (exists(config.chromeExecutablePath)) {
      return config.chromeExecutablePath as string;
    }
  } catch {
    // Optional: configuration may not be available in non-Electron contexts
  }

  if (exists(process.env.CHROME_BINARY)) {
    return process.env.CHROME_BINARY as string;
  }

  if (exists(process.env.SORA_CHROME_PATH)) {
    return process.env.SORA_CHROME_PATH as string;
  }

  return null;
}

/**
 * Try to locate a system Google Chrome binary using optional config overrides,
 * environment hints, and well-known install locations per platform. Returns
 * null if nothing is found so the caller can present a helpful error.
 */
export async function findSystemChromeExecutable(): Promise<string | null> {
  const configured = await readConfiguredChromePath();
  if (configured) {
    return configured;
  }

  const candidates: string[] = [];

  if (process.platform === 'darwin') {
    candidates.push(...macCandidates());
  } else if (process.platform === 'win32') {
    candidates.push(...windowsCandidates());
  } else {
    candidates.push(...linuxCandidates());
  }

  for (const candidate of candidates) {
    const resolved = await resolveFromPath(candidate);
    if (resolved && exists(resolved)) {
      return resolved;
    }
  }

  return null;
}

export async function resolveChromeExecutablePath(): Promise<string> {
  const executablePath = await findSystemChromeExecutable();
  if (!executablePath) {
    throw new Error('Не удалось найти Google Chrome. Укажите путь к браузеру в настройках и перезапустите сессию.');
  }
  return executablePath;
}


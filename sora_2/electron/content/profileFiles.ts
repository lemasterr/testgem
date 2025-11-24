import fs from 'fs/promises';
import path from 'path';
import type { SessionFiles } from '../../shared/types';
import { shell } from 'electron';
import { getConfig } from '../config/config';
import { logError, logInfo } from '../logging/logger';
import { ensureDir } from '../utils/fs';

const DEFAULT_PROFILE = 'Default';
const PROMPTS_DIR = 'prompts';

function normalizeProfileName(name?: string | null): string {
  if (name && name.trim().length > 0) return name.trim();
  return DEFAULT_PROFILE;
}

async function ensurePromptsDir(sessionsRoot: string): Promise<string> {
  const dir = path.join(sessionsRoot, PROMPTS_DIR);
  await ensureDir(dir);
  return dir;
}

function buildProfileFilenames(profileName: string) {
  const safeName = normalizeProfileName(profileName).replace(/[\\/:]/g, '_');
  return {
    prompts: `${safeName}_prompts.txt`,
    titles: `${safeName}_titles.txt`,
    images: `${safeName}_images.txt`,
  } as const;
}

async function readLines(filePath: string): Promise<string[]> {
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    if (raw.includes('\u0000')) {
      throw new Error('File contains null bytes and may be corrupted');
    }

    return sanitizeLines(raw.split(/\r?\n/));
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return [];
    throw error;
  }
}

async function writeLines(filePath: string, lines: string[]): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const sanitized = sanitizeLines(lines);
  await fs.writeFile(filePath, sanitized.join('\n'), 'utf-8');
}

function sanitizeLines(lines: string[]): string[] {
  return lines
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !/^[\u0000-\u001f]+$/.test(line));
}

export async function readProfileFiles(profileName?: string | null): Promise<SessionFiles> {
  const config = await getConfig();
  const normalizedName = normalizeProfileName(profileName ?? config.chromeActiveProfileName);
  const promptsDir = await ensurePromptsDir(config.sessionsRoot);
  const filenames = buildProfileFilenames(normalizedName);

  const promptsPath = path.join(promptsDir, filenames.prompts);
  const titlesPath = path.join(promptsDir, filenames.titles);
  const imagesPath = path.join(promptsDir, filenames.images);

  try {
    const [prompts, titles, imagePrompts] = await Promise.all([
      readLines(promptsPath),
      readLines(titlesPath),
      readLines(imagesPath),
    ]);

    logInfo(
      'profileFiles',
      `Loaded files for profile ${normalizedName}: prompts=${prompts.length}, titles=${titles.length}, images=${imagePrompts.length}`,
    );

    return { prompts, titles, imagePrompts };
  } catch (error) {
    logError('profileFiles', `Failed to read files for ${normalizedName}: ${(error as Error).message}`);
    throw error;
  }
}

export async function saveProfileFiles(profileName: string | null, files: SessionFiles): Promise<{ ok: boolean; error?: string }> {
  const config = await getConfig();
  const normalizedName = normalizeProfileName(profileName ?? config.chromeActiveProfileName);
  const promptsDir = await ensurePromptsDir(config.sessionsRoot);
  const filenames = buildProfileFilenames(normalizedName);

  const promptsPath = path.join(promptsDir, filenames.prompts);
  const titlesPath = path.join(promptsDir, filenames.titles);
  const imagesPath = path.join(promptsDir, filenames.images);

  try {
    await Promise.all([
      writeLines(promptsPath, files.prompts ?? []),
      writeLines(titlesPath, files.titles ?? []),
      writeLines(imagesPath, files.imagePrompts ?? []),
    ]);

    logInfo('profileFiles', `Saved files for profile ${normalizedName}`);
    return { ok: true };
  } catch (error) {
    const message = (error as Error).message;
    logError('profileFiles', `Failed to save files for ${normalizedName}: ${message}`);
    return { ok: false, error: message };
  }
}

export async function openProfileFolder(profileName?: string | null): Promise<{ ok: boolean; path?: string; error?: string }> {
  const config = await getConfig();
  const normalizedName = normalizeProfileName(profileName ?? config.chromeActiveProfileName);

  try {
    const promptsDir = await ensurePromptsDir(config.sessionsRoot);
    const folderPath = path.join(promptsDir);
    await shell.openPath(folderPath);
    logInfo('profileFiles', `Opened profile folder for ${normalizedName}: ${folderPath}`);
    return { ok: true, path: folderPath };
  } catch (error) {
    const message = (error as Error).message;
    logError('profileFiles', `Failed to open folder for ${normalizedName}: ${message}`);
    return { ok: false, error: message };
  }
}

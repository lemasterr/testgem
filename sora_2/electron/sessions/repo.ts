import { randomUUID } from 'crypto';
import { app } from 'electron';
import fs from 'fs/promises';
import path from 'path';

import { getConfig } from '../config/config';
import type { ManagedSession } from '../../shared/types';
import { Session } from './types';
import { ensureDir } from '../utils/fs';

const SESSIONS_FILE = 'sessions.json';

async function ensureUserDataReady(): Promise<void> {
  if (app.isReady()) return;
  await app.whenReady();
}

async function getSessionsFilePath(): Promise<string> {
  await ensureUserDataReady();
  return path.join(app.getPath('userData'), SESSIONS_FILE);
}

async function readSessionsFile(): Promise<Session[]> {
  const filePath = await getSessionsFilePath();

  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(raw) as Session[];
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

async function writeSessionsFile(sessions: Session[]): Promise<void> {
  const filePath = await getSessionsFilePath();
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(sessions, null, 2), 'utf-8');
}

async function normalizeSessions(sessions: Session[]): Promise<Session[]> {
  const config = await getConfig();
  let changed = false;
  const normalized: Session[] = [];

  for (const session of sessions) {
    const { normalized: next, changed: sessionChanged } = await applySessionDefaults(session, config.sessionsRoot);
    normalized.push(next);
    changed = changed || sessionChanged;
  }

  if (changed) {
    await writeSessionsFile(normalized);
  }

  return normalized;
}

function slugifySessionName(name: string): string {
  const normalized = name.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-_]/gi, '');
  return normalized.length > 0 ? normalized : 'session';
}

async function ensureFile(filePath: string): Promise<void> {
  try {
    await fs.access(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
      await ensureDir(path.dirname(filePath));
      await fs.writeFile(filePath, '', 'utf-8');
      return;
    }
    throw error;
  }
}

async function applySessionDefaults(session: Session, sessionsRoot: string): Promise<{ normalized: Session; changed: boolean }>
 {
  const slug = slugifySessionName(session.name || session.id || 'session');
  const baseRel = path.join(slug);

  const next: Session = { ...session };
  let changed = false;

  const setIfEmpty = <K extends keyof Session>(key: K, value: Session[K]) => {
    const current = next[key];
    if (current === undefined || current === null || current === '') {
      next[key] = value;
      changed = true;
    }
  };

  setIfEmpty('promptsFile', path.join(baseRel, 'prompts.txt'));
  setIfEmpty('imagePromptsFile', path.join(baseRel, 'image_prompts.txt'));
  setIfEmpty('titlesFile', path.join(baseRel, 'titles.txt'));
  setIfEmpty('submittedLog', path.join(baseRel, 'submitted.log'));
  setIfEmpty('failedLog', path.join(baseRel, 'failed.log'));
  setIfEmpty('downloadDir', path.join(baseRel, 'downloads'));
  setIfEmpty('cleanDir', path.join(baseRel, 'clean'));
  setIfEmpty('cursorFile', path.join(baseRel, 'cursor.json'));
  setIfEmpty('maxVideos', 0);
  setIfEmpty('openDrafts', false);
  setIfEmpty('autoLaunchChrome', false);
  setIfEmpty('autoLaunchAutogen', false);
  setIfEmpty('notes', '');

  const resolve = (target: string) => (path.isAbsolute(target) ? target : path.join(sessionsRoot, target));
  const sessionDir = path.join(sessionsRoot, slug);
  await ensureDir(sessionDir);
  await ensureDir(resolve(next.downloadDir));
  await ensureDir(resolve(next.cleanDir));

  await Promise.all([
    ensureFile(resolve(next.promptsFile)),
    ensureFile(resolve(next.imagePromptsFile)),
    ensureFile(resolve(next.titlesFile)),
    ensureFile(resolve(next.submittedLog)),
    ensureFile(resolve(next.failedLog)),
    ensureFile(resolve(next.cursorFile)),
  ]);

  return { normalized: next, changed };
}

function toManagedSession(session: Session, stats?: Partial<Pick<ManagedSession, 'promptCount' | 'titleCount' | 'hasFiles'>>): ManagedSession {
  return {
    id: session.id,
    name: session.name,
    chromeProfileName: session.chromeProfileName,
    promptProfile: session.promptProfile,
    cdpPort: session.cdpPort,
    promptsFile: session.promptsFile,
    imagePromptsFile: session.imagePromptsFile,
    titlesFile: session.titlesFile,
    submittedLog: session.submittedLog,
    failedLog: session.failedLog,
    downloadDir: session.downloadDir,
    cleanDir: session.cleanDir,
    cursorFile: session.cursorFile,
    maxVideos: session.maxVideos,
    openDrafts: session.openDrafts,
    autoLaunchChrome: session.autoLaunchChrome,
    autoLaunchAutogen: session.autoLaunchAutogen,
    notes: session.notes,
    ...stats,
  };
}

function fromManagedSession(session: ManagedSession): Session {
  return {
    id: session.id || '',
    name: session.name || 'New Session',
    chromeProfileName: session.chromeProfileName ?? null,
    promptProfile: session.promptProfile ?? null,
    cdpPort: session.cdpPort ?? null,
    promptsFile: session.promptsFile ?? '',
    imagePromptsFile: session.imagePromptsFile ?? '',
    titlesFile: session.titlesFile ?? '',
    submittedLog: session.submittedLog ?? '',
    failedLog: session.failedLog ?? '',
    downloadDir: session.downloadDir ?? '',
    cleanDir: session.cleanDir ?? '',
    cursorFile: session.cursorFile ?? '',
    maxVideos: session.maxVideos ?? 0,
    openDrafts: session.openDrafts ?? false,
    autoLaunchChrome: session.autoLaunchChrome ?? false,
    autoLaunchAutogen: session.autoLaunchAutogen ?? false,
    notes: session.notes ?? '',
  };
}

async function computeSessionStats(session: Session): Promise<Partial<Pick<ManagedSession, 'promptCount' | 'titleCount' | 'hasFiles'>>> {
  try {
    const paths = await getSessionPaths(session);
    const [promptLines, titleLines] = await Promise.all([
      readFileLines(paths.promptsFile),
      readFileLines(paths.titlesFile),
    ]);

    const promptCount = promptLines.length;
    const titleCount = titleLines.length;
    const hasFiles = promptCount > 0 || titleCount > 0;

    return { promptCount, titleCount, hasFiles };
  } catch {
    return {};
  }
}

async function readFileLines(filePath: string): Promise<string[]> {
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    return raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

export async function listSessions(): Promise<ManagedSession[]> {
  const sessions = await normalizeSessions(await readSessionsFile());
  const enriched = await Promise.all(
    sessions.map(async (session) => toManagedSession(session, await computeSessionStats(session)))
  );
  return enriched;
}

export async function getSession(id: string): Promise<ManagedSession | null> {
  const sessions = await normalizeSessions(await readSessionsFile());
  const match = sessions.find((s) => s.id === id);
  if (!match) return null;
  const stats = await computeSessionStats(match);
  return toManagedSession(match, stats);
}

export async function saveSession(session: ManagedSession): Promise<ManagedSession> {
  const sessions = await normalizeSessions(await readSessionsFile());
  const nextBase: Session = {
    ...fromManagedSession(session),
    id: session.id || randomUUID(),
  };

  const { normalized: next } = await applySessionDefaults(nextBase, (await getConfig()).sessionsRoot);

  const existingIndex = sessions.findIndex((s) => s.id === next.id);
  if (existingIndex >= 0) {
    sessions[existingIndex] = next;
  } else {
    sessions.push(next);
  }

  await writeSessionsFile(sessions);
  const stats = await computeSessionStats(next);
  return toManagedSession(next, stats);
}

export async function deleteSession(id: string): Promise<void> {
  const sessions = await readSessionsFile();
  const filtered = sessions.filter((s) => s.id !== id);
  await writeSessionsFile(filtered);
}

export async function ensureSessionsRoot(): Promise<string> {
  const config = await getConfig();
  await ensureDir(config.sessionsRoot);
  return config.sessionsRoot;
}

function resolvePath(root: string, target: string): string {
  if (path.isAbsolute(target)) return target;
  return path.join(root, target);
}

export async function getSessionPaths(session: Session): Promise<Record<string, string>> {
  const root = await ensureSessionsRoot();
  const { normalized } = await applySessionDefaults(session, root);

  return {
    promptsFile: resolvePath(root, normalized.promptsFile),
    imagePromptsFile: resolvePath(root, normalized.imagePromptsFile),
    titlesFile: resolvePath(root, normalized.titlesFile),
    submittedLog: resolvePath(root, normalized.submittedLog),
    failedLog: resolvePath(root, normalized.failedLog),
    downloadDir: resolvePath(root, normalized.downloadDir),
    cleanDir: resolvePath(root, normalized.cleanDir),
    cursorFile: resolvePath(root, normalized.cursorFile),
  };
}

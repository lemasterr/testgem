// lemasterr/testgem/testgem-2/electron/sessionFiles.ts
import fs from 'fs/promises';
import path from 'path';
import type { ManagedSession, SessionFiles } from '../shared/types';
import { getConfig } from './config/config';
import { getSession as fetchSession } from './sessions/repo';

// Хелпер для получения полного пути
async function resolveSessionPath(relativePath: string): Promise<string> {
  const config = await getConfig();
  // Если путь уже абсолютный, возвращаем как есть, иначе клеим к sessionsRoot
  if (path.isAbsolute(relativePath)) return relativePath;
  return path.join(config.sessionsRoot, relativePath);
}

const getSession = async (sessionId: string): Promise<ManagedSession> => {
  // FIX: Используем fetchSession из repo.ts, так как в Config сессий нет
  const session = await fetchSession(sessionId);
  if (!session) {
    throw new Error(`Session not found: ${sessionId}`);
  }
  return session;
};

const ensureFilePath = (session: ManagedSession, key: keyof Pick<ManagedSession, 'promptsFile' | 'imagePromptsFile' | 'titlesFile'>): string => {
  const value = session[key];
  if (!value) {
    // Если пути нет, не падаем, а возвращаем пустую строку, которая потом обработается
    return '';
  }
  return value;
};

const readLines = async (filePath: string): Promise<string[]> => {
  if (!filePath) return [];
  try {
    const content = await fs.readFile(filePath, 'utf8');
    return content.split(/\r?\n/); // Возвращаем сырые строки
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
};

const writeLines = async (filePath: string, lines: string[]): Promise<void> => {
  if (!filePath) return;
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, lines.join('\n'), 'utf8');
};

export const readManagedSessionFiles = async (sessionId: string): Promise<SessionFiles> => {
  const session = await getSession(sessionId);

  // Резолвим абсолютные пути
  const promptsPath = await resolveSessionPath(ensureFilePath(session, 'promptsFile'));
  const titlesPath = await resolveSessionPath(ensureFilePath(session, 'titlesFile'));
  const imagesPathRaw = session.imagePromptsFile ? await resolveSessionPath(session.imagePromptsFile) : '';

  return {
    prompts: await readLines(promptsPath),
    imagePrompts: imagesPathRaw ? await readLines(imagesPathRaw) : [],
    titles: await readLines(titlesPath)
  };
};

export const writeManagedSessionFiles = async (
  sessionId: string,
  data: SessionFiles
): Promise<void> => {
  const session = await getSession(sessionId);

  // Резолвим абсолютные пути перед записью
  const promptsPath = await resolveSessionPath(ensureFilePath(session, 'promptsFile'));
  const titlesPath = await resolveSessionPath(ensureFilePath(session, 'titlesFile'));
  const imagesPathRaw = session.imagePromptsFile ? await resolveSessionPath(session.imagePromptsFile) : '';

  await Promise.all([
    writeLines(promptsPath, data.prompts),
    writeLines(titlesPath, data.titles),
    imagesPathRaw ? writeLines(imagesPathRaw, data.imagePrompts) : Promise.resolve()
  ]);
};
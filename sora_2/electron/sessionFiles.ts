import fs from 'fs/promises';
import path from 'path';
import type { Config, ManagedSession, SessionFiles } from '../shared/types';
import { getConfig } from './config/config';

const ensureFilePath = (session: ManagedSession, key: keyof Pick<ManagedSession, 'promptsFile' | 'imagePromptsFile' | 'titlesFile'>): string => {
  const value = session[key];
  if (!value) {
    throw new Error(`Missing ${key} for session ${session.name || session.id}`);
  }
  return value;
};

const readLines = async (filePath: string): Promise<string[]> => {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    return content.split(/\r?\n/);
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
};

const writeLines = async (filePath: string, lines: string[]): Promise<void> => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, lines.join('\n'), 'utf8');
};

const getSession = async (sessionId: string): Promise<ManagedSession> => {
  const config = (await getConfig()) as Config;
  const session = (config.sessions ?? []).find((s) => s.id === sessionId);
  if (!session) {
    throw new Error('Session not found');
  }
  return session;
};

export const readManagedSessionFiles = async (sessionId: string): Promise<SessionFiles> => {
  const session = await getSession(sessionId);
  const promptsPath = ensureFilePath(session, 'promptsFile');
  const titlesPath = ensureFilePath(session, 'titlesFile');
  const imagesPath = session.imagePromptsFile;

  return {
    prompts: await readLines(promptsPath),
    imagePrompts: imagesPath ? await readLines(imagesPath) : [],
    titles: await readLines(titlesPath)
  };
};

export const writeManagedSessionFiles = async (
  sessionId: string,
  data: SessionFiles
): Promise<void> => {
  const session = await getSession(sessionId);
  const promptsPath = ensureFilePath(session, 'promptsFile');
  const titlesPath = ensureFilePath(session, 'titlesFile');
  const imagesPath = session.imagePromptsFile;

  await Promise.all([
    writeLines(promptsPath, data.prompts),
    writeLines(titlesPath, data.titles),
    imagesPath ? writeLines(imagesPath, data.imagePrompts) : Promise.resolve()
  ]);
};

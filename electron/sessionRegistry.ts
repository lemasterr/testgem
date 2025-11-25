import { randomUUID } from 'crypto';
import type { Config, ManagedSession } from '../shared/types';
import { getConfig, updateConfig } from './config/config';

const ensureId = (session: ManagedSession | Omit<ManagedSession, 'id'>): ManagedSession => {
  if ('id' in session && session.id) return session as ManagedSession;
  return { ...(session as Omit<ManagedSession, 'id'>), id: randomUUID() };
};

export const listManagedSessions = async (): Promise<ManagedSession[]> => {
  const config = (await getConfig()) as Config;
  return config.sessions ?? [];
};

export const saveManagedSession = async (
  session: ManagedSession | Omit<ManagedSession, 'id'>
): Promise<ManagedSession[]> => {
  const config = (await getConfig()) as Config;
  const existing = config.sessions ?? [];
  const record = ensureId(session);
  const idx = existing.findIndex((s) => s.id === record.id);
  const next = [...existing];
  if (idx >= 0) {
    next[idx] = { ...existing[idx], ...record };
  } else {
    next.push(record);
  }
  await updateConfig({ sessions: next } as Partial<Config>);
  return next;
};

export const removeManagedSession = async (id: string): Promise<ManagedSession[]> => {
  const config = (await getConfig()) as Config;
  const next = (config.sessions ?? []).filter((s) => s.id !== id);
  await updateConfig({ sessions: next } as Partial<Config>);
  return next;
};

// sora_2/shared/ipc.ts
import type { Config, ManagedSession } from './types';

export interface IPCChannels {
  'config:get': () => Promise<Config>;
  'config:update': (partial: Partial<Config>) => Promise<Config>;
  'sessions:list': () => Promise<ManagedSession[]>;
  'sessions:save': (session: ManagedSession) => Promise<ManagedSession>;
  'health:check': () => Promise<{ chrome: boolean; python: boolean; storage: boolean }>;
  // ... add other channels as needed for strict typing
}
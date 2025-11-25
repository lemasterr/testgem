import { contextBridge, ipcRenderer } from 'electron';
import type { SessionCommandAction } from '../shared/types';

const logError = (message: string, error: unknown): void => {
  console.error(message, error);
};

const safeInvoke = async (channel: string, ...args: unknown[]) => {
  try {
    return await ipcRenderer.invoke(channel, ...args);
  } catch (error) {
    logError(`IPC invoke failed for ${channel}`, error);
    return { ok: false, error: (error as Error)?.message || 'IPC failed' };
  }
};

contextBridge.exposeInMainWorld('electronAPI', {
  ping: () => safeInvoke('ping'),
  config: {
    get: () => safeInvoke('config:get'),
    update: (partial: unknown) => safeInvoke('config:update', partial),
  },
  chrome: {
    scanProfiles: () => safeInvoke('chrome:scanProfiles'),
    listProfiles: () => safeInvoke('chrome:listProfiles'),
    setActiveProfile: (name: string) => safeInvoke('chrome:setActiveProfile', name),
    cloneProfile: () => safeInvoke('chrome:cloneProfile'),
  },
  sessions: {
    list: () => safeInvoke('sessions:list'),
    get: (id: string) => safeInvoke('sessions:get', id),
    save: (session: unknown) => safeInvoke('sessions:save', session),
    delete: (id: string) => safeInvoke('sessions:delete', id),
    command: (id: string, action: SessionCommandAction) => safeInvoke('sessions:command', id, action),
    runPrompts: (id: string) => safeInvoke('sessions:runPrompts', id),
    cancelPrompts: (id: string) => safeInvoke('sessions:cancelPrompts', id),
    runDownloads: (id: string, max?: number) => safeInvoke('sessions:runDownloads', id, max ?? 0),
    cancelDownloads: (id: string) => safeInvoke('sessions:cancelDownloads', id),
    subscribeLogs: (id: string, cb: (entry: unknown) => void) => {
      const handler = (_: any, sessId: string, payload: any) => {
        if (sessId === id) [].concat(payload).forEach(cb);
      };
      ipcRenderer.on('sessions:logs:init', handler);
      ipcRenderer.on('sessions:log', handler);
      safeInvoke('sessions:subscribeLogs', id);
      return () => {
        safeInvoke('sessions:unsubscribeLogs', id);
        ipcRenderer.removeListener('sessions:logs:init', handler);
        ipcRenderer.removeListener('sessions:log', handler);
      };
    },
  },
  files: {
    read: (profile: string) => safeInvoke('files:read', profile),
    save: (profile: string, files: unknown) => safeInvoke('files:save', profile, files),
    openFolder: (profile: string) => safeInvoke('files:openFolder', profile),
  },
  autogen: {
    run: (id: string) => safeInvoke('autogen:run', id),
    stop: (id: string) => safeInvoke('autogen:stop', id),
  },
  downloader: {
    run: (id: string, opts?: unknown) => safeInvoke('downloader:run', id, opts),
    stop: (id: string) => safeInvoke('downloader:stop', id),
    openDrafts: (key: string) => safeInvoke('downloader:openDrafts', key),
    scanDrafts: (key: string) => safeInvoke('downloader:scanDrafts', key),
    downloadAll: (key: string, opts?: any) => safeInvoke('downloader:downloadAll', key, opts),
  },
  pipeline: {
    run: (steps: unknown) => safeInvoke('pipeline:run', steps),
    cancel: () => safeInvoke('pipeline:cancel'),
    onProgress: (cb: (s: unknown) => void) => {
      const handler = (_: any, s: unknown) => cb(s);
      ipcRenderer.on('pipeline:progress', handler);
      return () => ipcRenderer.removeListener('pipeline:progress', handler);
    },
  },
  window: {
    minimize: () => safeInvoke('window:minimize'),
    maximize: () => safeInvoke('window:maximize'),
    isWindowMaximized: () => safeInvoke('window:isMaximized'),
    close: () => safeInvoke('window:close'),
  },
  logs: {
    subscribe: (cb: (entry: unknown) => void) => {
      const handler = (_: any, entry: unknown) => cb(entry);
      ipcRenderer.on('logging:push', handler);
      return () => ipcRenderer.removeListener('logging:push', handler);
    },
    export: () => safeInvoke('system:openLogs'),
    info: () => safeInvoke('logging:info'),
    clear: () => safeInvoke('logging:clear'),
  },
  video: {
    blurWithProfile: (i: string, o: string, pid: string) => safeInvoke('video:blurWithProfile', i, o, pid),
    runBlur: (input: string, zones: unknown[]) => safeInvoke('video:runBlur', input, zones),
    blurProfiles: {
      list: () => safeInvoke('video:blurProfiles:list'),
      save: (p: unknown) => safeInvoke('video:blurProfiles:save', p),
      delete: (id: string) => safeInvoke('video:blurProfiles:delete', id),
    },
  },
  cleanup: { run: () => safeInvoke('cleanup:run') },
  telegram: {
    test: () => safeInvoke('telegram:test'),
    sendMessage: (text: string) => safeInvoke('telegram:sendMessage', text),
  },
  analytics: {
    getDailyStats: (d: number) => safeInvoke('analytics:getDailyStats', d),
    getTopSessions: (l: number) => safeInvoke('analytics:getTopSessions', l),
  },
  system: {
    openPath: (t: string) => safeInvoke('system:openPath', t),
    openLogs: () => safeInvoke('system:openLogs'),
  },
  health: { check: () => safeInvoke('health:check') }
});
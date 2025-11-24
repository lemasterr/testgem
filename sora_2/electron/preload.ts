import { contextBridge, ipcRenderer } from 'electron';
import type { SessionCommandAction } from '../shared/types';

// Локальный безопасный логгер — без импорта из core
const logError = (message: string, error: unknown): void => {
  // eslint-disable-next-line no-console
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
  ping: (): Promise<unknown> => safeInvoke('ping'),
  config: {
    get: (): Promise<unknown> => safeInvoke('config:get'),
    update: (partial: unknown): Promise<unknown> => safeInvoke('config:update', partial),
  },
  chrome: {
    scanProfiles: (): Promise<unknown> => safeInvoke('chrome:scanProfiles'),
    listProfiles: (): Promise<unknown> => safeInvoke('chrome:listProfiles'),
    setActiveProfile: (name: string): Promise<unknown> => safeInvoke('chrome:setActiveProfile', name),
    cloneProfile: (): Promise<unknown> => safeInvoke('chrome:cloneProfile'),
  },
  sessions: {
    list: (): Promise<unknown> => safeInvoke('sessions:list'),
    get: (id: string): Promise<unknown> => safeInvoke('sessions:get', id),
    save: (session: unknown): Promise<unknown> => safeInvoke('sessions:save', session),
    delete: (id: string): Promise<unknown> => safeInvoke('sessions:delete', id),
    command: (sessionId: string, action: SessionCommandAction): Promise<unknown> =>
      safeInvoke('sessions:command', sessionId, action),
    runPrompts: (id: string): Promise<unknown> => safeInvoke('sessions:runPrompts', id),
    cancelPrompts: (id: string): Promise<unknown> => safeInvoke('sessions:cancelPrompts', id),
    runDownloads: (id: string, maxVideos?: number): Promise<unknown> =>
      safeInvoke('sessions:runDownloads', id, maxVideos ?? 0),
    cancelDownloads: (id: string): Promise<unknown> => safeInvoke('sessions:cancelDownloads', id),
    subscribeLogs: (sessionId: string, cb: (entry: unknown) => void) => {
      const handler = (_event: unknown, id: string, payload: unknown) => {
        if (id !== sessionId) return;
        if (Array.isArray(payload)) {
          payload.forEach((item) => cb(item));
        } else {
          cb(payload);
        }
      };

      ipcRenderer.on('sessions:logs:init', handler);
      ipcRenderer.on('sessions:log', handler);
      safeInvoke('sessions:subscribeLogs', sessionId);

      return () => {
        safeInvoke('sessions:unsubscribeLogs', sessionId);
        ipcRenderer.removeListener('sessions:logs:init', handler);
        ipcRenderer.removeListener('sessions:log', handler);
      };
    },
  },
  files: {
    read: (profileName?: string | null): Promise<unknown> => safeInvoke('files:read', profileName ?? null),
    save: (profileName: string | null, files: unknown): Promise<unknown> => safeInvoke('files:save', profileName, files),
    openFolder: (profileName?: string | null): Promise<unknown> => safeInvoke('files:openFolder', profileName ?? null),
  },
  sessionFiles: {
    read: (profileName?: string | null): Promise<unknown> => safeInvoke('files:read', profileName ?? null),
    save: (profileName: string | null, files: unknown): Promise<unknown> =>
      safeInvoke('files:save', profileName, files),
    openFolder: (profileName?: string | null): Promise<unknown> => safeInvoke('files:openFolder', profileName ?? null),
  },
  autogen: {
    run: (sessionId: string): Promise<unknown> => safeInvoke('autogen:run', sessionId),
    stop: (sessionId: string): Promise<unknown> => safeInvoke('autogen:stop', sessionId),
  },
  downloader: {
    run: (sessionId: string, options?: unknown): Promise<unknown> => safeInvoke('downloader:run', sessionId, options),
    stop: (sessionId: string): Promise<unknown> => safeInvoke('downloader:stop', sessionId),
    openDrafts: (sessionKey: string): Promise<unknown> => safeInvoke('downloader:openDrafts', sessionKey),
    scanDrafts: (sessionKey: string): Promise<unknown> => safeInvoke('downloader:scanDrafts', sessionKey),
    downloadAll: (sessionKey: string, options?: { limit?: number }): Promise<unknown> =>
      safeInvoke('downloader:downloadAll', sessionKey, options),
  },
  pipeline: {
    run: (steps: unknown): Promise<unknown> => safeInvoke('pipeline:run', steps),
    cancel: (): Promise<unknown> => safeInvoke('pipeline:cancel'),
    onProgress: (cb: (status: unknown) => void) => {
      ipcRenderer.removeAllListeners('pipeline:progress');
      ipcRenderer.on('pipeline:progress', (_event, status) => cb(status));
      return () => ipcRenderer.removeAllListeners('pipeline:progress');
    },
  },
  window: {
    minimize: (): Promise<unknown> => safeInvoke('window:minimize'),
    maximize: (): Promise<unknown> => safeInvoke('window:maximize'),
    isWindowMaximized: (): Promise<unknown> => safeInvoke('window:isMaximized'),
    close: (): Promise<unknown> => safeInvoke('window:close'),
  },
  logs: {
    subscribe: (cb: (entry: unknown) => void) => {
      const handler = (_event: unknown, entry: unknown) => {
        cb(entry);
      };
      ipcRenderer.on('logging:push', handler);
      return () => {
        ipcRenderer.removeListener('logging:push', handler);
      };
    },
    export: (): Promise<unknown> => safeInvoke('system:openLogs'),
    info: (): Promise<unknown> => safeInvoke('logging:info'),
    clear: (): Promise<unknown> => safeInvoke('logging:clear'),
  },
  qa: {
    batchRun: (videoDir?: string): Promise<unknown> => safeInvoke('qa:batchRun', videoDir),
  },
  video: {
    extractPreviewFrames: (videoPath: string, count: number): Promise<unknown> =>
      safeInvoke('video:extractPreviewFrames', videoPath, count),
    pickSmartPreviewFrames: (videoPath: string, count: number): Promise<unknown> =>
      safeInvoke('video:pickSmartPreviewFrames', videoPath, count),
    blurWithProfile: (input: string, output: string, profileId: string): Promise<unknown> =>
      safeInvoke('video:blurWithProfile', input, output, profileId),
    blurProfiles: {
      list: (): Promise<unknown> => safeInvoke('video:blurProfiles:list'),
      save: (profile: unknown): Promise<unknown> => safeInvoke('video:blurProfiles:save', profile),
      delete: (id: string): Promise<unknown> => safeInvoke('video:blurProfiles:delete', id),
    },
  },
  cleanup: {
    run: (): Promise<unknown> => safeInvoke('cleanup:run'),
  },
  telegram: {
    test: (): Promise<unknown> => safeInvoke('telegram:test'),
    sendMessage: (text: string): Promise<unknown> => safeInvoke('telegram:sendMessage', text),
  },
  analytics: {
    getDailyStats: (days: number): Promise<unknown> => safeInvoke('analytics:getDailyStats', days),
    getTopSessions: (limit: number): Promise<unknown> => safeInvoke('analytics:getTopSessions', limit),
  },
  selectorInspector: {
    start: (sessionId: string): Promise<unknown> => safeInvoke('selectorInspector:start', sessionId),
    getLast: (sessionId: string): Promise<unknown> => safeInvoke('selectorInspector:getLast', sessionId),
  },
  logging: {
    rendererError: (payload: unknown): Promise<unknown> => safeInvoke('logging:rendererError', payload),
    onLog: (cb: (entry: unknown) => void) => {
      ipcRenderer.removeAllListeners('logging:push');
      ipcRenderer.on('logging:push', (_event, entry) => cb(entry));
    },
  },
  system: {
    openPath: (target: string): Promise<unknown> => safeInvoke('system:openPath', target),
    openLogs: (): Promise<unknown> => safeInvoke('system:openLogs'),
  },
});

export {};

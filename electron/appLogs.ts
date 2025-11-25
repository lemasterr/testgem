import { WebContents, dialog } from 'electron';
import fs from 'fs/promises';
import path from 'path';
import type { AppLogEntry } from '../shared/types';

interface LogStream {
  entries: AppLogEntry[];
  subscribers: Map<number, WebContents>;
}

const MAX_GLOBAL_LOGS = 1000;

class AppLogBroker {
  private stream: LogStream = { entries: [], subscribers: new Map() };

  subscribe(contents: WebContents) {
    this.stream.subscribers.set(contents.id, contents);

    const cleanup = () => {
      this.unsubscribe(contents.id);
    };

    contents.once('destroyed', cleanup);

    contents.send('logs:init', this.stream.entries);
  }

  unsubscribe(contentsId: number) {
    this.stream.subscribers.delete(contentsId);
  }

  log(entry: AppLogEntry) {
    this.stream.entries.push(entry);
    if (this.stream.entries.length > MAX_GLOBAL_LOGS) {
      this.stream.entries.splice(0, this.stream.entries.length - MAX_GLOBAL_LOGS);
    }

    for (const subscriber of this.stream.subscribers.values()) {
      if (!subscriber.isDestroyed()) {
        subscriber.send('logs:entry', entry);
      }
    }
  }

  async exportLogs(defaultPath: string): Promise<{ ok: boolean; path?: string; error?: string }> {
    try {
      const { canceled, filePath } = await dialog.showSaveDialog({
        defaultPath,
        filters: [{ name: 'Text Files', extensions: ['txt', 'log'] }]
      });

      if (canceled || !filePath) {
        return { ok: false, error: 'cancelled' };
      }

      const lines = this.stream.entries
        .map((entry) => {
          const time = new Date(entry.timestamp).toISOString();
          const session = entry.sessionId ? `[${entry.sessionId}]` : '';
          return `${time} [${entry.source}]${session} ${entry.level.toUpperCase()} ${entry.message}`;
        })
        .join('\n');

      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, lines, 'utf8');

      return { ok: true, path: filePath };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to export logs';
      return { ok: false, error: message };
    }
  }
}

export const appLogBroker = new AppLogBroker();

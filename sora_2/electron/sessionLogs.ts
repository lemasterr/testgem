import { WebContents } from 'electron';
import type { SessionLogEntry } from '../shared/types';

interface SessionLogStream {
  entries: SessionLogEntry[];
  subscribers: Map<number, WebContents>;
}

const MAX_LOGS = 500;

class SessionLogBroker {
  private streams = new Map<string, SessionLogStream>();

  subscribe(sessionId: string, contents: WebContents) {
    const stream = this.getStream(sessionId);
    stream.subscribers.set(contents.id, contents);

    const cleanup = () => {
      this.unsubscribe(sessionId, contents.id);
    };

    contents.once('destroyed', cleanup);

    contents.send('sessions:logs:init', sessionId, stream.entries);
  }

  unsubscribe(sessionId: string, contentsId: number) {
    const stream = this.streams.get(sessionId);
    if (!stream) return;
    stream.subscribers.delete(contentsId);
  }

  log(sessionId: string, entry: SessionLogEntry) {
    const stream = this.getStream(sessionId);
    stream.entries.push(entry);
    if (stream.entries.length > MAX_LOGS) {
      stream.entries.splice(0, stream.entries.length - MAX_LOGS);
    }

    for (const subscriber of stream.subscribers.values()) {
      if (!subscriber.isDestroyed()) {
        subscriber.send('sessions:log', sessionId, entry);
      }
    }
  }

  private getStream(sessionId: string): SessionLogStream {
    if (!this.streams.has(sessionId)) {
      this.streams.set(sessionId, { entries: [], subscribers: new Map() });
    }
    return this.streams.get(sessionId)!;
  }
}

export const sessionLogBroker = new SessionLogBroker();

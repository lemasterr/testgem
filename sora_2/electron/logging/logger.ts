import { EventEmitter } from 'events';

export type LogEntry = {
  ts: string;
  level: 'info' | 'warn' | 'error';
  source: string;
  msg: string;
};

export const loggerEvents = new EventEmitter();

function emit(level: LogEntry['level'], source: string, msg: string): void {
  const entry: LogEntry = {
    ts: new Date().toISOString(),
    level,
    source,
    msg,
  };

  // Mirror to console for debugging and emit to subscribers.
  // eslint-disable-next-line no-console
  console[level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log'](
    `[${entry.ts}] [${entry.source}] ${entry.level.toUpperCase()}: ${entry.msg}`,
  );
  loggerEvents.emit('log', entry);
}

export function logInfo(source: string, msg: string): void {
  emit('info', source, msg);
}

export function logWarn(source: string, msg: string): void {
  emit('warn', source, msg);
}

export function logError(source: string, msg: string): void {
  emit('error', source, msg);
}

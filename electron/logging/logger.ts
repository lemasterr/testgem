// sora_2/electron/logging/logger.ts
import { EventEmitter } from 'events';
import fs from 'fs';
import { getResolvedLogPath, ensureLogDestination } from '../../core/utils/log';

export type LogEntry = {
  ts: string;
  level: 'info' | 'warn' | 'error';
  source: string;
  msg: string;
};

export const loggerEvents = new EventEmitter();

const logBuffer: LogEntry[] = [];
const FLUSH_INTERVAL = 1000;
const FLUSH_SIZE = 50;
let flushTimer: NodeJS.Timeout | null = null;

// Helper to get log file path lazily
function getLogFile(): string | null {
  const { file } = getResolvedLogPath();
  if (file) return file;
  const { file: newFile } = ensureLogDestination();
  return newFile;
}

function formatLogEntry(entry: LogEntry): string {
  return `[${entry.ts}] [${entry.source}] ${entry.level.toUpperCase()}: ${entry.msg}`;
}

async function flushLogs() {
  if (logBuffer.length === 0) return;

  const batch = logBuffer.splice(0, logBuffer.length);
  const content = batch.map(formatLogEntry).join('\n');
  const logFile = getLogFile();

  if (logFile) {
    try {
      await fs.promises.appendFile(logFile, content + '\n', 'utf-8');
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Failed to flush logs to disk', error);
    }
  }
}

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushLogs();
    flushTimer = null;
  }, FLUSH_INTERVAL);
}

function emit(level: LogEntry['level'], source: string, msg: string): void {
  const entry: LogEntry = {
    ts: new Date().toISOString(),
    level,
    source,
    msg,
  };

  // Mirror to console
  // eslint-disable-next-line no-console
  console[level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log'](
    formatLogEntry(entry)
  );

  // Push to UI
  loggerEvents.emit('log', entry);

  // Buffer for disk write
  logBuffer.push(entry);
  if (logBuffer.length >= FLUSH_SIZE) {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    flushLogs();
  } else {
    scheduleFlush();
  }
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
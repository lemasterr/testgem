import fs from 'fs';
import os from 'os';
import path from 'path';

const LOG_DIR_CANDIDATES = [
  process.env.SORA_LOG_DIR ? path.resolve(process.env.SORA_LOG_DIR) : null,
  path.resolve(process.cwd(), 'logs'),
  path.resolve(os.homedir(), '.sora_bot2', 'logs'),
  path.resolve(os.tmpdir(), 'sora_bot2', 'logs'),
].filter((entry): entry is string => Boolean(entry));

let resolvedLogFile: string | null = null;
let resolvedLogDir: string | null = null;

function prepareLogFile(): string | null {
  if (resolvedLogFile) return resolvedLogFile;

  for (const candidate of LOG_DIR_CANDIDATES) {
    const filePath = path.join(candidate, 'app.log');

    try {
      if (!fs.existsSync(candidate)) {
        fs.mkdirSync(candidate, { recursive: true });
      }
      fs.appendFileSync(filePath, '', { encoding: 'utf-8' });

      resolvedLogDir = candidate;
      resolvedLogFile = filePath;
      return resolvedLogFile;
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[log] unable to prepare log file candidate', {
        candidate,
        filePath,
        error,
      });
    }
  }

  // eslint-disable-next-line no-console
  console.error('[log] no writable log directory available; falling back to stdout only');
  return null;
}

function writeLog(level: string, message: string) {
  const entry = `[${new Date().toISOString()}] [${level}] ${message}\n`;

  const logFile = prepareLogFile();
  if (logFile) {
    try {
      fs.appendFileSync(logFile, entry, { encoding: 'utf-8' });
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[log] failed to write log entry', { logFile, error });
    }
  }

  // Mirror logs to stdout so renderer/devtools can observe activity without
  // tailing the file directly. This helps during automated runs and when
  // debugging workflows from the terminal.
  // eslint-disable-next-line no-console
  console.log(entry.trimEnd());
}

export function logInfo(message: string) {
  writeLog('INFO', message);
}

export function logError(message: string, error?: unknown) {
  const detail = error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : error ? String(error) : '';
  writeLog('ERROR', detail ? `${message} | ${detail}` : message);
}

export function logStep(message: string) {
  writeLog('STEP', message);
}

export function getResolvedLogPath() {
  return { dir: resolvedLogDir, file: resolvedLogFile };
}

export function ensureLogDestination() {
  prepareLogFile();
  return { dir: resolvedLogDir, file: resolvedLogFile };
}

/**
 * Truncate the current log file to start fresh without changing the resolved path.
 */
export function clearLogFile() {
  const destination = ensureLogDestination();
  if (!destination.file) return { ok: false, error: 'No writable log file' };

  try {
    fs.writeFileSync(destination.file, '', { encoding: 'utf-8' });
    return { ok: true, file: destination.file };
  } catch (error) {
    return { ok: false, error: (error as Error)?.message || 'Failed to clear log file' };
  }
}

// --- Structured events (JSONL) ---

export type StructuredEvent = {
  timestamp?: number;
  event_type: string;
  session_id?: string;
  step?: string;
  status?: 'started' | 'running' | 'success' | 'error' | 'skipped' | string;
  error_code?: string;
  error_message?: string;
  payload?: Record<string, unknown>;
};

export function logEvent(event: StructuredEvent) {
  const ts = event.timestamp ?? Date.now();
  const record = { ...event, timestamp: ts };
  const json = JSON.stringify(record);
  const logFile = prepareLogFile();
  if (logFile) {
    try {
      fs.appendFileSync(logFile, json + '\n', { encoding: 'utf-8' });
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[log] failed to write structured event', { error });
    }
  } else {
    // eslint-disable-next-line no-console
    console.log(json);
  }
}

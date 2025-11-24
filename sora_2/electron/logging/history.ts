import { app } from 'electron';
import fs from 'fs/promises';
import path from 'path';

import { ensureDir } from '../utils/fs';

const HISTORY_FILE = 'history.jsonl';
const MAX_HISTORY_BYTES = 10 * 1024 * 1024; // 10MB rotation threshold

export type HistoryEvent = {
  ts: string;
  type: 'sessionRun' | 'downloadRun' | 'pipelineRun';
  sessionIds?: string[];
  submitted?: number;
  failed?: number;
  downloaded?: number;
  durationMs?: number;
};

function getHistoryPath(): string {
  return path.join(app.getPath('userData'), HISTORY_FILE);
}

async function ensureHistoryDir(): Promise<void> {
  if (!app.isReady()) {
    await app.whenReady();
  }
  await ensureDir(app.getPath('userData'));
}

async function rotateIfNeeded(filePath: string): Promise<void> {
  try {
    const stats = await fs.stat(filePath);
    if (stats.size >= MAX_HISTORY_BYTES) {
      const rotated = `${filePath}.1`;
      await fs.rename(filePath, rotated).catch(() => undefined);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') {
      throw error;
    }
  }
}

export async function appendHistory(record: HistoryEvent): Promise<void> {
  const entry: HistoryEvent = {
    ...record,
    ts: record.ts ?? new Date().toISOString(),
  };

  await ensureHistoryDir();
  const filePath = getHistoryPath();
  await rotateIfNeeded(filePath);
  await fs.appendFile(filePath, `${JSON.stringify(entry)}\n`, 'utf-8');
}

async function readHistory(): Promise<HistoryEvent[]> {
  await ensureHistoryDir();
  const filePath = getHistoryPath();
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    return raw
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line) as HistoryEvent;
        } catch (error) {
          // ignore malformed lines
          return null;
        }
      })
      .filter(Boolean) as HistoryEvent[];
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

function formatLocalDate(ts: string): string {
  const d = new Date(ts);
  const year = d.getFullYear();
  const month = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export async function getDailyStats(days: number): Promise<{
  date: string;
  submitted: number;
  failed: number;
  downloaded: number;
}[]> {
  const events = await readHistory();
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const bucket = new Map<string, { submitted: number; failed: number; downloaded: number }>();

  for (const evt of events) {
    const ts = new Date(evt.ts).getTime();
    if (Number.isNaN(ts) || ts < cutoff) continue;
    const key = formatLocalDate(evt.ts);
    const current = bucket.get(key) ?? { submitted: 0, failed: 0, downloaded: 0 };
    current.submitted += evt.submitted ?? 0;
    current.failed += evt.failed ?? 0;
    current.downloaded += evt.downloaded ?? 0;
    bucket.set(key, current);
  }

  return Array.from(bucket.entries())
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, stats]) => ({ date, ...stats }));
}

export async function getTopSessions(limit: number): Promise<{ sessionId: string; downloaded: number }[]> {
  const events = await readHistory();
  const totals = new Map<string, number>();

  for (const evt of events) {
    const sessionIds = evt.sessionIds ?? [];
    for (const id of sessionIds) {
      const current = totals.get(id) ?? 0;
      totals.set(id, current + (evt.downloaded ?? 0));
    }
  }

  return Array.from(totals.entries())
    .sort(([, a], [, b]) => b - a)
    .slice(0, limit)
    .map(([sessionId, downloaded]) => ({ sessionId, downloaded }));
}

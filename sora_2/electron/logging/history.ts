// Path: sora_2/electron/logging/history.ts
import { pythonRecordEvent, pythonGetStats, pythonGetTopSessions } from '../integrations/pythonClient';

export type HistoryEvent = {
  type: 'sessionRun' | 'downloadRun' | 'pipelineRun' | 'download' | 'download_success' | 'prompt' | 'error';
  sessionIds?: string[];
  submitted?: number;
  failed?: number;
  downloaded?: number;
  durationMs?: number;
};

// Replace legacy JSONL logging with SQLite via Python
export async function appendHistory(record: HistoryEvent & { ts?: string }): Promise<void> {
  const sessionId = record.sessionIds?.[0] ?? 'global';
  const eventType = record.type;

  // Flatten payload for storage
  const payload = {
    submitted: record.submitted,
    failed: record.failed,
    downloaded: record.downloaded,
    durationMs: record.durationMs,
    sessionIds: record.sessionIds
  };

  await pythonRecordEvent(eventType, sessionId, payload);
}

export async function getDailyStats(days: number): Promise<{
  date: string;
  submitted: number;
  failed: number;
  downloaded: number;
}[]> {
  const stats = await pythonGetStats(days);
  // Python returns format: { "2023-10-27": { "download": 5, "prompt": 10 } }
  // We map it to array for the Dashboard UI

  return Object.entries(stats).map(([date, counts]: [string, any]) => ({
    date,
    submitted: counts['prompt'] || 0,
    failed: counts['error'] || 0,
    downloaded: counts['download'] || counts['download_success'] || 0
  })).sort((a, b) => a.date.localeCompare(b.date));
}

export async function getTopSessions(limit: number): Promise<{ sessionId: string; downloaded: number }[]> {
  return await pythonGetTopSessions(limit);
}
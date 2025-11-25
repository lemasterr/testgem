// sora_2/electron/telemetry.ts
export interface TelemetryEvent {
  type: 'download_started' | 'download_completed' | 'error' | 'chrome_launched';
  timestamp: number;
  sessionId?: string;
  duration?: number;
  error?: string;
}

const events: TelemetryEvent[] = [];

export function recordEvent(event: Omit<TelemetryEvent, 'timestamp'>) {
  events.push({ ...event, timestamp: Date.now() });

  // Keep last 1000 events in memory
  if (events.length > 1000) {
    events.splice(0, 500);
  }
}

export function exportTelemetry(): string {
  return JSON.stringify(events, null, 2);
}
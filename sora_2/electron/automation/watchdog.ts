import { setInterval as setIntervalSafe, clearInterval } from 'node:timers';

type WatchdogEntry = {
  lastHeartbeat: number;
  timeoutMs: number;
  interval: NodeJS.Timeout;
  onTimeout: () => Promise<void> | void;
};

const WATCHDOG_CHECK_INTERVAL_MS = 5000;
const watchers = new Map<string, WatchdogEntry>();

export function startWatchdog(
  runId: string,
  timeoutMs: number,
  onTimeout: () => Promise<void> | void
): void {
  stopWatchdog(runId);
  const entry: WatchdogEntry = {
    lastHeartbeat: Date.now(),
    timeoutMs,
    interval: setIntervalSafe(async () => {
      const now = Date.now();
      const current = watchers.get(runId);
      if (!current) return;
      if (now - current.lastHeartbeat > current.timeoutMs) {
        try {
          await current.onTimeout();
        } finally {
          stopWatchdog(runId);
        }
      }
    }, WATCHDOG_CHECK_INTERVAL_MS),
    onTimeout,
  };
  watchers.set(runId, entry);
}

export function heartbeat(runId: string): void {
  const entry = watchers.get(runId);
  if (entry) {
    entry.lastHeartbeat = Date.now();
  }
}

export function stopWatchdog(runId: string): void {
  const entry = watchers.get(runId);
  if (entry) {
    clearInterval(entry.interval);
    watchers.delete(runId);
  }
}

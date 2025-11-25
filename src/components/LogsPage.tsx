// sora_2/src/components/LogsPage.tsx
import { useEffect, useMemo, useRef, useState } from 'react';
import { FixedSizeList } from 'react-window';
import AutoSizer from 'react-virtualized-auto-sizer';
import type { AppLogEntry, LogSource } from '../../shared/types';

const SOURCES: LogSource[] = ['Chrome', 'Autogen', 'Downloader', 'Pipeline'];

const sourceColor: Record<string, string> = {
  Chrome: 'text-blue-400',
  Autogen: 'text-emerald-300',
  Downloader: 'text-sky-300',
  Pipeline: 'text-indigo-300'
};

export function LogsPage() {
  const [logs, setLogs] = useState<AppLogEntry[]>([]);
  const [filters, setFilters] = useState<Set<LogSource>>(new Set(SOURCES));
  const [actionMessage, setActionMessage] = useState<string>('');
  const [apiError, setApiError] = useState<string | null>(null);
  const [logLocation, setLogLocation] = useState<string>('');

  useEffect(() => {
    const api = (window as any).electronAPI;
    const logsApi = api?.logs;
    if (!logsApi?.subscribe) {
      setApiError('Logging API is not available. Please run the Sora desktop app.');
      return;
    }

    logsApi
      .info()
      .then((result: any) => {
        if (result?.ok && result.dir) {
          setLogLocation(result.file || result.dir);
        }
      })
      .catch(() => {});

    const unsubscribe = logsApi.subscribe((entry: AppLogEntry) => {
      // Only keep last 2000 logs for performance even with virtualization
      setLogs((prev) => [...prev.slice(-1999), entry]);
    });

    return () => {
      unsubscribe?.();
    };
  }, []);

  const toggleSource = (source: LogSource) => {
    setFilters((prev) => {
      const next = new Set(prev);
      if (next.has(source)) {
        next.delete(source);
      } else {
        next.add(source);
      }
      return next;
    });
  };

  const filtered = useMemo(() => logs.filter((log) => filters.has(log.source)), [logs, filters]);

  const formatTime = (timestamp: number) => {
    const d = new Date(timestamp);
    return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  const exportLogs = async () => {
    setActionMessage('');
    const api = (window as any).electronAPI;
    const logsApi = api?.logs;
    if (!logsApi?.export) {
      setActionMessage('Export is not available.');
      return;
    }

    const result: any = await logsApi.export();
    if (result?.ok === false) {
      setActionMessage(result.error || 'Failed to export logs');
    } else {
      setActionMessage('Opened logs folder.');
    }
  };

  const clearLogFile = async () => {
    setActionMessage('');
    const api = (window as any).electronAPI;
    const logsApi = api?.logs;
    if (!logsApi?.clear) {
      setActionMessage('Clear is not available.');
      return;
    }

    const result: any = await logsApi.clear();
    if (result?.ok === false) {
      setActionMessage(result.error || 'Failed to clear log file');
    } else {
      setLogs([]);
      setActionMessage('Log file cleared.');
    }
  };

  // Virtualized Row Component
  const LogRow = ({ index, style }: { index: number; style: any }) => {
    const entry = filtered[index];
    const tagColor = sourceColor[entry.source] || 'text-sky-300';
    const levelColor = entry.level === 'error' ? 'text-rose-400' : 'text-emerald-300';

    return (
      <div style={style} className="whitespace-pre-wrap break-words px-4 py-1 text-sm font-mono">
        <span className="text-zinc-500">[{formatTime(entry.timestamp)}]</span>{' '}
        <span className={`${tagColor}`}>[{entry.source}]</span>{' '}
        {entry.sessionId && <span className="text-blue-300">[{entry.sessionId}]</span>}{' '}
        <span className={levelColor}>[{entry.level.toUpperCase()}]</span>{' '}
        <span className="text-gray-200">{entry.message}</span>
      </div>
    );
  };

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-white">Activity Logs</h2>
          <p className="text-sm text-zinc-400">Global stream across Chrome, automation, downloads, and pipelines.</p>
          {logLocation && <p className="text-xs text-zinc-500">Location: {logLocation}</p>}
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-xs text-zinc-300">
            {SOURCES.map((source) => (
              <button
                key={source}
                onClick={() => toggleSource(source)}
                className={`rounded-full border px-3 py-1 font-semibold transition ${filters.has(source) ? 'border-blue-500 bg-blue-500/10 text-blue-200' : 'border-zinc-700 text-zinc-400 hover:border-blue-500/50'}`}
              >
                {source}
              </button>
            ))}
          </div>
          <button
            onClick={exportLogs}
            className="rounded-lg border border-zinc-700 px-3 py-2 text-sm font-semibold text-zinc-100 hover:border-blue-500 hover:text-blue-100"
          >
            Export to file
          </button>
          <button
            onClick={clearLogFile}
            className="rounded-lg border border-zinc-700 px-3 py-2 text-sm font-semibold text-zinc-100 hover:border-rose-500 hover:text-rose-100"
          >
            Clear log file
          </button>
        </div>
      </div>

      {apiError && (
        <div className="rounded-lg border border-amber-700/70 bg-amber-900/30 px-4 py-2 text-sm text-amber-200">{apiError}</div>
      )}
      {actionMessage && (
        <div className="rounded-lg border border-emerald-700/70 bg-emerald-900/30 px-4 py-2 text-sm text-emerald-200">{actionMessage}</div>
      )}

      <div className="flex-1 overflow-hidden rounded-xl border border-zinc-800 bg-black/90">
        <AutoSizer>
          {({ height, width }: { height: number; width: number }) => (
            <FixedSizeList
              height={height}
              itemCount={filtered.length}
              itemSize={28}
              width={width}
              className="scrollbar-thin"
            >
              {LogRow}
            </FixedSizeList>
          )}
        </AutoSizer>
        {filtered.length === 0 && <div className="p-4 text-zinc-500">Waiting for activity...</div>}
      </div>
    </div>
  );
}
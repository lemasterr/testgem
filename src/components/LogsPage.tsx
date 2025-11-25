import { useEffect, useState, useRef } from 'react';
import { FixedSizeList } from 'react-window';
import AutoSizer from 'react-virtualized-auto-sizer';
import type { AppLogEntry } from '../../shared/types';
import { Icons } from './Icons';

export function LogsPage() {
  const [logs, setLogs] = useState<AppLogEntry[]>([]);
  const listRef = useRef<FixedSizeList>(null);

  useEffect(() => {
    // Subscribe via IPC bridge
    const unsubscribe = window.electronAPI?.logs?.subscribe((entry: any) => {
      setLogs((prev) => {
        const next = [...prev, entry];
        // Keep buffer clean (2000 lines max)
        return next.length > 2000 ? next.slice(-2000) : next;
      });
    });

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, []);

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (listRef.current && logs.length > 0) {
      listRef.current.scrollToItem(logs.length - 1, 'end');
    }
  }, [logs.length]);

  const Row = ({ index, style }: { index: number, style: any }) => {
    const log = logs[index];
    if (!log) return null;

    const isErr = log.level === 'error';
    const isWarn = log.level === 'warn';

    return (
      <div style={style} className={`px-4 py-1 text-xs font-mono border-b border-zinc-800/50 flex gap-3 items-center hover:bg-white/5 ${isErr ? 'bg-rose-950/20 text-rose-200' : isWarn ? 'text-amber-300' : 'text-zinc-400'}`}>
        <span className="text-zinc-600 shrink-0 w-[75px] select-none">{new Date(log.timestamp).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute:'2-digit', second:'2-digit' })}</span>
        <span className={`shrink-0 w-24 font-bold truncate ${isErr ? 'text-rose-400' : isWarn ? 'text-amber-400' : 'text-blue-400'}`}>{log.source}</span>
        <span className="truncate select-text cursor-text">{log.message}</span>
      </div>
    );
  };

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)] gap-4">
      <div className="flex justify-between items-center">
        <div>
            <h2 className="text-lg font-semibold text-white">System Logs</h2>
            <p className="text-xs text-zinc-500">Real-time application events stream</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setLogs([])} className="btn-secondary text-xs"><Icons.Trash className="w-3.5 h-3.5 mr-2"/> Clear</button>
          <button onClick={() => window.electronAPI.logs.export()} className="btn-secondary text-xs"><Icons.Folder className="w-3.5 h-3.5 mr-2"/> Open File</button>
        </div>
      </div>

      <div className="flex-1 card overflow-hidden bg-[#0c0c0e] relative border border-zinc-800 shadow-inner">
        {logs.length > 0 ? (
            <AutoSizer>
            {({ height, width }: { height: number, width: number }) => (
                <FixedSizeList
                    ref={listRef}
                    height={height}
                    width={width}
                    itemCount={logs.length}
                    itemSize={28}
                >
                {Row}
                </FixedSizeList>
            )}
            </AutoSizer>
        ) : (
            <div className="absolute inset-0 flex items-center justify-center text-zinc-700 flex-col gap-3 select-none">
                <Icons.Logs className="w-12 h-12 opacity-10"/>
                <p className="text-sm font-medium opacity-40">No logs recorded yet...</p>
            </div>
        )}
      </div>
    </div>
  );
}
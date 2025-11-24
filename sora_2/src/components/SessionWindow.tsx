import { useEffect, useMemo, useRef, useState } from 'react';
import type { ManagedSession, SessionLogEntry } from '../../shared/types';

interface SessionWindowProps {
  session: ManagedSession;
  onClose: () => void;
}

const scopeColors: Record<string, string> = {
  Chrome: 'text-blue-400',
  Prompts: 'text-cyan-400',
  Download: 'text-emerald-400',
  Watermark: 'text-indigo-300',
  Worker: 'text-amber-300',
  Error: 'text-rose-400'
};

const statusDot = (status: NonNullable<ManagedSession['status']>) => {
  const color =
    status === 'running' ? 'bg-emerald-500' : status === 'warning' ? 'bg-amber-400' : status === 'error' ? 'bg-rose-500' : 'bg-zinc-600';
  return <span className={`inline-block h-3 w-3 rounded-full ${color}`} />;
};

export function SessionWindow({ session, onClose }: SessionWindowProps) {
  const [logs, setLogs] = useState<SessionLogEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>('');
  const logRef = useRef<HTMLDivElement>(null);

  const appendLog = (entry: SessionLogEntry) => {
    setLogs((prev) => [...prev, entry]);
  };

  useEffect(() => {
    if (!session.id || !window.electronAPI.sessions) return;
    setLogs([]);
    const unsubscribe = window.electronAPI.sessions.subscribeLogs(session.id, appendLog);
    return () => {
      unsubscribe?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id]);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [logs]);

  const sendCommand = async (action: 'startChrome' | 'runPrompts' | 'runDownloads' | 'cleanWatermark' | 'stop') => {
    if (!session.id || !window.electronAPI.sessions) return;
    setBusy(true);
    setMessage('');
    const result = await window.electronAPI.sessions.command(session.id, action);
    setBusy(false);
    setMessage(result.ok ? result.details || 'OK' : result.error || 'Error');
  };

  const formattedLogs = useMemo(() => logs.slice(-300), [logs]);

  const formatTime = (timestamp: number) => {
    const d = new Date(timestamp);
    return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  const renderLog = (entry: SessionLogEntry, idx: number) => {
    const scopeClass = scopeColors[entry.scope] || 'text-sky-300';
    const levelClass = entry.level === 'error' ? 'text-rose-400' : 'text-green-300';
    return (
      <div key={`${entry.timestamp}-${idx}`} className="font-mono text-sm text-green-400">
        <span className="text-zinc-400">[{formatTime(entry.timestamp)}]</span>{' '}
        <span className={scopeClass}>[{entry.scope}]</span>{' '}
        {entry.level === 'error' && <span className={levelClass}>[Error]</span>}
        <span className="ml-1 text-green-200">{entry.message}</span>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4">
      <div className="flex h-[80vh] w-[1100px] flex-col overflow-hidden rounded-xl border border-zinc-800 bg-[#0a0a0c] shadow-2xl shadow-blue-900/30">
        <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-3">
          <div>
            <div className="flex items-center gap-2 text-lg font-semibold text-white">
              {statusDot(session.status || 'idle')}
              <span>{session.name}</span>
            </div>
            <div className="text-xs text-zinc-400">Live session console</div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => sendCommand('startChrome')}
              disabled={busy}
              className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
            >
              Start Chrome
            </button>
            <button
              onClick={() => sendCommand('runPrompts')}
              disabled={busy}
              className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
            >
              Run Prompts
            </button>
            <button
              onClick={() => sendCommand('runDownloads')}
              disabled={busy}
              className="rounded-lg bg-sky-600 px-3 py-2 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-50"
            >
              Run Downloads
            </button>
            <button
              onClick={() => sendCommand('cleanWatermark')}
              disabled={busy}
              className="rounded-lg border border-zinc-700 px-3 py-2 text-sm font-medium text-zinc-200 hover:border-indigo-400 hover:text-indigo-200 disabled:opacity-50"
            >
              Clean Watermark
            </button>
            <button
              onClick={() => sendCommand('stop')}
              disabled={busy}
              className="rounded-lg border border-zinc-700 px-3 py-2 text-sm font-medium text-rose-200 hover:border-rose-500 hover:text-rose-100 disabled:opacity-50"
            >
              Stop Worker
            </button>
            <button
              onClick={onClose}
              className="rounded-lg border border-zinc-700 px-3 py-2 text-sm font-medium text-zinc-200 hover:border-zinc-500 hover:text-white"
            >
              Close
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-hidden p-4">
          <div className="h-full overflow-y-auto rounded-lg border border-zinc-800 bg-black/90 p-3" ref={logRef}>
            {formattedLogs.length === 0 && <div className="font-mono text-sm text-zinc-500">Waiting for logs...</div>}
            {formattedLogs.map(renderLog)}
          </div>
        </div>
        <div className="border-t border-zinc-800 px-5 py-3 text-sm text-zinc-300">
          {message || 'Select an action to emit logs in real time.'}
        </div>
      </div>
    </div>
  );
}

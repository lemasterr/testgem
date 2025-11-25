import { useEffect, useRef, useState } from 'react';
import type { ManagedSession, SessionLogEntry } from '../../shared/types';
import { Icons } from './Icons';

interface SessionWindowProps {
  session: ManagedSession;
  onClose: () => void;
}

export function SessionWindow({ session, onClose }: SessionWindowProps) {
  const [logs, setLogs] = useState<SessionLogEntry[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Subscribe to session specific logs
  useEffect(() => {
    // Clear previous logs on mount to avoid stale data visual mixup
    setLogs([]);

    const unsubscribe = window.electronAPI.sessions.subscribeLogs(session.id, (entry: any) => {
      setLogs(prev => {
          const next = [...prev, entry];
          // Keep window buffer sane
          return next.length > 1000 ? next.slice(-1000) : next;
      });
    });

    return () => {
        if (unsubscribe) unsubscribe();
    };
  }, [session.id]);

  // Auto-scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs.length]);

  // Command Runner with UI feedback
  const run = async (cmd: string) => {
    setIsRunning(true);
    try {
        // Immediate local log for feedback
        setLogs(prev => [...prev, { timestamp: Date.now(), scope: 'UI', level: 'info', message: `Executing command: ${cmd}...` }]);

        let res;
        if (cmd === 'runPrompts') {
            res = await window.electronAPI.autogen.run(session.id);
        } else if (cmd === 'runDownloads') {
            res = await window.electronAPI.downloader.run(session.id, { limit: session.maxVideos });
        } else if (cmd === 'stop') {
            res = await window.electronAPI.sessions.command(session.id, 'stop');
            // Explicitly call stop on workers
            await window.electronAPI.autogen.stop(session.id);
            await window.electronAPI.downloader.stop(session.id);
        } else {
            res = await window.electronAPI.sessions.command(session.id, cmd as any);
        }

        if (res && !res.ok) {
             setLogs(prev => [...prev, { timestamp: Date.now(), scope: 'UI', level: 'error', message: `Error: ${res.error || 'Command failed'}` }]);
        }
    } catch (e) {
        setLogs(prev => [...prev, {
            timestamp: Date.now(),
            scope: 'UI',
            level: 'error',
            message: `Exception: ${(e as Error).message}`
        }]);
    } finally {
        setTimeout(() => setIsRunning(false), 500);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-8 animate-fade-in">
      <div className="w-full max-w-5xl h-[85vh] bg-[#0c0c0e] border border-zinc-800 rounded-2xl shadow-2xl flex flex-col overflow-hidden ring-1 ring-white/10">

        {/* Header */}
        <div className="h-14 border-b border-zinc-800 bg-zinc-900/50 flex items-center justify-between px-6 shrink-0">
          <div className="flex items-center gap-4">
            <div className={`w-3 h-3 rounded-full shadow-[0_0_10px_currentColor] ${session.status === 'running' ? 'text-emerald-500 bg-emerald-500' : 'text-zinc-600 bg-zinc-600'}`} />
            <div>
              <div className="font-bold text-sm text-white">{session.name}</div>
              <div className="text-[10px] text-zinc-500 font-mono uppercase tracking-wider">ID: {session.id.slice(0, 8)}</div>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-zinc-800 rounded-lg text-zinc-400 hover:text-white transition-colors">
            <Icons.Close className="w-5 h-5" />
          </button>
        </div>

        {/* Toolbar */}
        <div className="p-3 border-b border-zinc-800 bg-zinc-900/20 flex gap-3 shrink-0">
          <div className="flex bg-zinc-900/50 rounded-lg p-1 border border-zinc-800">
            <button onClick={() => run('startChrome')} disabled={isRunning} className="px-3 py-1.5 text-xs font-medium text-zinc-300 hover:text-white hover:bg-zinc-800 rounded-md transition-all flex items-center gap-2 disabled:opacity-50">
              <Icons.Sessions className="w-3.5 h-3.5 text-blue-400" /> Launch Chrome
            </button>
            <div className="w-px bg-zinc-800 mx-1 my-1" />
            <button onClick={() => run('runPrompts')} disabled={isRunning} className="px-3 py-1.5 text-xs font-medium text-zinc-300 hover:text-white hover:bg-zinc-800 rounded-md transition-all flex items-center gap-2 disabled:opacity-50">
              <Icons.Play className="w-3.5 h-3.5 text-emerald-400" /> Prompts
            </button>
            <button onClick={() => run('runDownloads')} disabled={isRunning} className="px-3 py-1.5 text-xs font-medium text-zinc-300 hover:text-white hover:bg-zinc-800 rounded-md transition-all flex items-center gap-2 disabled:opacity-50">
              <Icons.Downloader className="w-3.5 h-3.5 text-purple-400" /> Download
            </button>
          </div>
          <div className="flex-1" />
          <button onClick={() => run('stop')} className="btn-danger py-1.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border-rose-500/20">
            <Icons.Stop className="w-4 h-4 mr-2" /> Stop Worker
          </button>
        </div>

        {/* Console */}
        <div className="flex-1 bg-[#050507] p-4 overflow-y-auto font-mono text-xs scrollbar-thin">
          {logs.length === 0 && (
            <div className="h-full flex flex-col items-center justify-center text-zinc-700 select-none">
              <Icons.Logs className="w-12 h-12 mb-2 opacity-20" />
              <p>Waiting for session activity...</p>
            </div>
          )}
          <div className="space-y-1">
            {logs.map((l, i) => (
              <div key={i} className="flex gap-3 group hover:bg-white/5 p-0.5 rounded items-start">
                <span className="text-zinc-600 shrink-0 select-none w-[70px]">{new Date(l.timestamp).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute:'2-digit', second:'2-digit' })}</span>
                <span className={`shrink-0 w-20 font-bold ${l.level === 'error' ? 'text-rose-500' : 'text-blue-500'}`}>{l.scope}</span>
                <span className={`${l.level === 'error' ? 'text-rose-200' : 'text-zinc-300'} break-all whitespace-pre-wrap`}>{l.message}</span>
              </div>
            ))}
          </div>
          <div ref={bottomRef} />
        </div>
      </div>
    </div>
  );
}
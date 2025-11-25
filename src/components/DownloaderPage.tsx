import { useEffect, useState } from 'react';
import { useAppStore } from '../store';
import type { RunResult } from '../../shared/types';
import { Icons } from './Icons';
import { StatCard } from './StatCard';

export function DownloaderPage() {
  const { sessions, refreshSessions } = useAppStore();
  const [selectedSession, setSelectedSession] = useState<string>('');
  const [draftsFound, setDraftsFound] = useState<number>(0);
  const [downloadedCount, setDownloadedCount] = useState<number>(0);
  const [lastFile, setLastFile] = useState<string>('');
  const [logs, setLogs] = useState<string[]>([]);
  const [status, setStatus] = useState<string>('Ready');
  const [isRunning, setIsRunning] = useState(false);

  useEffect(() => {
    refreshSessions();
  }, [refreshSessions]);

  useEffect(() => {
    if (!selectedSession && sessions.length > 0) {
      setSelectedSession(sessions[0].name);
    }
  }, [sessions, selectedSession]);

  const session = sessions.find(s => s.name === selectedSession);

  const runAction = async (action: 'scan' | 'download' | 'open') => {
    if (!selectedSession) return;
    setIsRunning(true);
    setStatus('Running...');

    try {
      let res: RunResult;
      if (action === 'open') {
        res = await window.electronAPI.downloader.openDrafts(selectedSession) as RunResult;
      } else if (action === 'scan') {
        res = await window.electronAPI.downloader.scanDrafts(selectedSession) as RunResult;
        if (res.draftsFound !== undefined) setDraftsFound(res.draftsFound);
      } else {
        res = await window.electronAPI.downloader.downloadAll(selectedSession, { limit: session?.maxVideos }) as RunResult;
        if (res.downloadedCount !== undefined) setDownloadedCount(res.downloadedCount);
        if (res.lastDownloadedFile) setLastFile(res.lastDownloadedFile);
      }

      setStatus(res.ok ? (res.details || 'Completed') : 'Failed');
      if (!res.ok && res.error) setLogs(prev => [...prev, `[Error] ${res.error}`]);
    } catch (e) {
      setStatus('Error occurred');
      setLogs(prev => [...prev, `[Exception] ${(e as Error).message}`]);
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Header Card */}
      <div className="p-6 rounded-3xl bg-gradient-to-r from-zinc-900 to-[#0c0c0e] border border-zinc-800 flex items-center justify-between shadow-xl">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-zinc-800 rounded-2xl text-white">
            <Icons.Downloader className="w-8 h-8" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-white">Manual Downloader</h2>
            <p className="text-sm text-zinc-400">Direct control over Chrome download session.</p>
          </div>
        </div>
        <div className="flex items-center gap-3 bg-black/30 p-1.5 rounded-xl border border-zinc-800">
          <span className="text-xs font-medium text-zinc-500 pl-2 uppercase tracking-wider">Session:</span>
          <select
            className="select-field bg-zinc-800 text-sm border-none hover:bg-zinc-700 w-40"
            value={selectedSession}
            onChange={e => setSelectedSession(e.target.value)}
          >
            {sessions.map(s => <option key={s.name} value={s.name}>{s.name}</option>)}
          </select>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard
          label="Drafts Detected"
          value={draftsFound}
          icon={<Icons.Content className="text-blue-400" />}
        />
        <StatCard
          label="Downloaded"
          value={downloadedCount}
          icon={<Icons.Downloader className="text-emerald-400" />}
        />
        <StatCard
          label="Last File"
          value={lastFile ? '...' + lastFile.slice(-15) : '-'}
          hint={lastFile}
          icon={<Icons.Check className="text-zinc-400" />}
        />
      </div>

      {/* Controls */}
      <div className="card p-8 bg-zinc-900/30 border-dashed">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
          <button
            onClick={() => runAction('open')}
            disabled={isRunning}
            className="btn-secondary h-32 flex flex-col items-center justify-center gap-3 hover:bg-zinc-800 hover:scale-[1.02] transition-all"
          >
            <Icons.Dashboard className="w-8 h-8 text-blue-400" />
            <span className="text-sm font-medium">Open Drafts Page</span>
          </button>

          <button
            onClick={() => runAction('scan')}
            disabled={isRunning}
            className="btn-secondary h-32 flex flex-col items-center justify-center gap-3 hover:bg-zinc-800 hover:scale-[1.02] transition-all"
          >
            <Icons.Refresh className="w-8 h-8 text-purple-400" />
            <span className="text-sm font-medium">Scan for Videos</span>
          </button>

          <button
            onClick={() => runAction('download')}
            disabled={isRunning}
            className="btn-primary h-32 flex flex-col items-center justify-center gap-3 bg-gradient-to-br from-emerald-900/50 to-emerald-800/50 border-emerald-500/30 text-emerald-100 hover:from-emerald-800/50 hover:to-emerald-700/50 hover:scale-[1.02] transition-all"
          >
            <Icons.Downloader className="w-8 h-8 text-emerald-400" />
            <span className="text-sm font-medium">Download All</span>
          </button>
        </div>

        <div className="mt-6 pt-6 border-t border-zinc-800/50 flex justify-between items-center">
          <div className="text-sm text-zinc-400">
            Status: <span className={`ml-2 font-mono ${status === 'Failed' ? 'text-rose-400' : 'text-white'}`}>{status}</span>
          </div>
          {isRunning && (
            <div className="flex items-center gap-2 text-xs text-blue-400">
              <div className="w-2 h-2 bg-blue-400 rounded-full animate-ping" />
              Operation in progress...
            </div>
          )}
        </div>
      </div>

      {/* Logs */}
      {logs.length > 0 && (
        <div className="card p-4 bg-black font-mono text-xs text-zinc-400 max-h-48 overflow-y-auto border-l-4 border-l-rose-500">
          {logs.map((l, i) => <div key={i} className="mb-1">{l}</div>)}
        </div>
      )}
    </div>
  );
}
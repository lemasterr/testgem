import { useEffect, useMemo, useState } from 'react';
import type { ManagedSession, RunResult } from '../../shared/types';
import { useAppStore } from '../store';

interface StatProps {
  label: string;
  value: string | number;
  accent?: string;
  sub?: string;
}

const StatCard = ({ label, value, accent = 'text-blue-400', sub }: StatProps) => (
  <div className="rounded-xl border border-zinc-700 bg-zinc-900/70 p-4 shadow-lg">
    <p className="text-sm uppercase tracking-wide text-zinc-400">{label}</p>
    <p className={`mt-2 text-2xl font-semibold ${accent}`}>{value}</p>
    {sub ? <p className="mt-1 text-xs text-zinc-500">{sub}</p> : null}
  </div>
);

const ActionButton = ({
  label,
  onClick,
  loading
}: {
  label: string;
  onClick: () => void;
  loading: boolean;
}) => (
  <button
    onClick={onClick}
    disabled={loading}
    className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 font-medium text-white shadow transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-blue-900"
  >
    {loading ? 'Working…' : label}
  </button>
);

export function DownloaderPage() {
  const { sessions, refreshSessions } = useAppStore();
  const [selectedSession, setSelectedSession] = useState<string>('');
  const [draftsFound, setDraftsFound] = useState<number>(0);
  const [downloadedCount, setDownloadedCount] = useState<number>(0);
  const [lastFile, setLastFile] = useState<string>('');
  const [errors, setErrors] = useState<string[]>([]);
  const [status, setStatus] = useState<string>('Ready to scan drafts.');
  const [busyAction, setBusyAction] = useState<'open' | 'scan' | 'download' | null>(null);

  useEffect(() => {
    refreshSessions();
  }, [refreshSessions]);

  useEffect(() => {
    if (!selectedSession && sessions.length > 0) {
      setSelectedSession(sessions[0].name);
    }
  }, [sessions, selectedSession]);

  const selectedSessionInfo = useMemo<ManagedSession | undefined>(() => {
    return sessions.find((s) => s.name === selectedSession);
  }, [sessions, selectedSession]);

  const updateLastDownloaded = async (sessionName: string) => {
    if (!window.electronAPI) return;
    const videos = await window.electronAPI.listDownloadedVideos();
    const latest = videos.find((video: any) => video.sessionName === sessionName);
    if (latest) {
      setLastFile(latest.fileName);
    }
  };

  const handleAction = async (
    action: 'open' | 'scan' | 'download',
    runner: () => Promise<RunResult>
  ) => {
    if (!selectedSession || !window.electronAPI) return;
    setBusyAction(action);
    setStatus('Working…');
    try {
      const result = await runner();
      if (result.ok) {
        if (typeof result.draftsFound === 'number') {
          setDraftsFound(result.draftsFound);
        }
        if (typeof result.downloadedCount === 'number') {
          setDownloadedCount(result.downloadedCount);
        }
        if (result.lastDownloadedFile) {
          setLastFile(result.lastDownloadedFile.split(/[/\\]/).pop() || result.lastDownloadedFile);
        } else if (action === 'download') {
          await updateLastDownloaded(selectedSession);
        }
        setStatus(result.details || 'Done');
      } else {
        setErrors((prev) => [...prev, result.error || 'Unknown error']);
        setStatus(result.error || 'Failed');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      setErrors((prev) => [...prev, message]);
      setStatus(message);
    } finally {
      setBusyAction(null);
    }
  };

  const progress = draftsFound > 0 ? Math.min(100, (downloadedCount / draftsFound) * 100) : 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <h2 className="text-2xl font-semibold text-white">Downloader</h2>
        <p className="text-sm text-zinc-400">Scan your Sora drafts and download all videos with automatic renaming.</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-xl border border-zinc-700 bg-zinc-900/70 p-4 lg:col-span-1">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-zinc-400">Session</p>
              <p className="text-lg font-semibold text-white">{selectedSessionInfo?.name ?? 'Select session'}</p>
            </div>
            <span className="rounded-full bg-emerald-500/20 px-3 py-1 text-xs font-semibold text-emerald-300">
              {selectedSessionInfo ? `${selectedSessionInfo.promptCount ?? 0} prompts` : 'Idle'}
            </span>
          </div>

          <div className="mt-3">
            <label className="text-xs uppercase tracking-wide text-zinc-500">Choose session</label>
            <select
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none"
              value={selectedSession}
              onChange={(e) => setSelectedSession(e.target.value)}
            >
              <option value="" disabled>
                -- select --
              </option>
              {sessions.map((session) => (
                <option key={session.name} value={session.name}>
                  {session.name}
                </option>
              ))}
            </select>
          </div>

          <div className="mt-4 space-y-2">
            <ActionButton
              label="Open Drafts"
              loading={busyAction === 'open'}
              onClick={() =>
                handleAction('open', () => window.electronAPI.downloader.openDrafts(selectedSession))
              }
            />
            <ActionButton
              label="Scan for Videos"
              loading={busyAction === 'scan'}
              onClick={() =>
                handleAction('scan', () => window.electronAPI.downloader.scanDrafts(selectedSession))
              }
            />
            <ActionButton
              label="Download All"
              loading={busyAction === 'download'}
              onClick={() =>
                handleAction('download', () => window.electronAPI.downloader.downloadAll(selectedSession))
              }
            />
          </div>

          <div className="mt-4 rounded-lg bg-blue-600/10 p-3 text-sm text-blue-200">
            <p className="font-medium">Status</p>
            <p className="text-blue-100">{status}</p>
          </div>
        </div>

        <div className="grid gap-4 lg:col-span-2 lg:grid-cols-2">
          <StatCard label="Drafts Found" value={draftsFound} sub="Detected in latest scan" />
          <StatCard label="Downloaded" value={downloadedCount} accent="text-emerald-400" sub="During last run" />
          <div className="rounded-xl border border-zinc-700 bg-zinc-900/70 p-4 lg:col-span-2">
            <p className="text-sm uppercase tracking-wide text-zinc-400">Progress</p>
            <div className="mt-3 h-3 w-full rounded-full bg-zinc-800">
              <div
                className="h-3 rounded-full bg-blue-500 transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="mt-2 text-sm text-blue-200">{progress.toFixed(0)}% complete</p>
          </div>
          <StatCard
            label="Last Downloaded"
            value={lastFile || '—'}
            accent="text-amber-300"
            sub="Most recent file name"
          />
          <div className="rounded-xl border border-zinc-700 bg-zinc-900/70 p-4">
            <p className="text-sm uppercase tracking-wide text-zinc-400">Errors</p>
            {errors.length === 0 ? (
              <p className="mt-2 text-sm text-zinc-500">No errors reported.</p>
            ) : (
              <ul className="mt-2 space-y-1 text-sm text-rose-300">
                {errors.slice(-5).map((err, idx) => (
                  <li key={`${err}-${idx}`} className="rounded bg-rose-500/10 px-2 py-1">
                    {err}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

import React, { useEffect, useMemo, useState } from 'react';
import { useAppStore } from '../store';
import { StatCard } from './StatCard';

type DailyStats = { date: string; submitted: number; failed: number; downloaded: number };
type TopSession = { sessionId: string; downloaded: number };

export const DashboardPage: React.FC = () => {
  const { sessions, config } = useAppStore();
  const [dailyStats, setDailyStats] = useState<DailyStats[]>([]);
  const [topSessions, setTopSessions] = useState<TopSession[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const totals = useMemo(() => {
    const prompts = sessions.reduce((sum, s) => sum + (s.promptCount ?? 0), 0);
    const titles = sessions.reduce((sum, s) => sum + (s.titleCount ?? 0), 0);
    const pipelineRuns = dailyStats.reduce(
      (sum, day) => sum + (day.submitted > 0 || day.downloaded > 0 || day.failed > 0 ? 1 : 0),
      0
    );
    return { prompts, titles, pipelineRuns };
  }, [dailyStats, sessions]);

  useEffect(() => {
    const load = async () => {
      const api = (window as any).electronAPI;
      const analytics = api?.analytics;
      if (!analytics) {
        setError('Analytics API unavailable. Launch inside the desktop app.');
        return;
      }
      try {
        setLoading(true);
        const statsRes = await analytics.getDailyStats?.(14);
        if (Array.isArray(statsRes)) {
          setDailyStats(statsRes as DailyStats[]);
        }
        const topRes = await analytics.getTopSessions?.(5);
        if (Array.isArray(topRes)) {
          setTopSessions(topRes as TopSession[]);
        }
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const maxDownloads = dailyStats.reduce((m, d) => Math.max(m, d.downloaded), 0) || 1;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <StatCard label="Sessions" value={sessions.length} accent="text-emerald-200" hint="Active workspaces" />
        <StatCard label="Prompts" value={totals.prompts} accent="text-sky-200" hint="Lines across sessions" />
        <StatCard label="Titles" value={totals.titles} accent="text-indigo-200" hint="Title entries ready" />
        <StatCard label="Pipeline runs" value={totals.pipelineRuns} accent="text-amber-200" hint="Activity last 2 weeks" />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border border-white/5 bg-zinc-900/60 p-5 shadow-lg shadow-blue-500/10 backdrop-blur lg:col-span-2">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold text-white">Activity</h3>
              <p className="text-xs text-zinc-400">Prompts, failures, and downloads (last 14 days)</p>
            </div>
            {loading && <span className="text-xs text-blue-300">Loading…</span>}
          </div>
          {error && <div className="mt-3 rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-100">{error}</div>}
          <div className="mt-4 space-y-2">
            {dailyStats.length === 0 && !error && (
              <div className="rounded-xl border border-white/5 bg-white/5 p-4 text-sm text-zinc-400">No activity recorded yet.</div>
            )}
            {dailyStats.map((day) => (
              <div key={day.date} className="flex items-center gap-3 text-sm">
                <div className="w-24 text-xs text-zinc-400">{day.date}</div>
                <div className="flex-1 space-y-1">
                  <div className="h-2 rounded-full bg-white/5">
                    <div
                      className="h-2 rounded-full bg-gradient-to-r from-blue-400 via-emerald-300 to-amber-300"
                      style={{ width: `${Math.min(100, (day.downloaded / maxDownloads) * 100 || 0)}%` }}
                    />
                  </div>
                  <div className="flex items-center gap-4 text-[11px] text-zinc-400">
                    <span>Submitted: {day.submitted}</span>
                    <span>Failed: {day.failed}</span>
                    <span>Downloaded: {day.downloaded}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-white/5 bg-zinc-900/60 p-5 shadow-lg shadow-blue-500/10 backdrop-blur">
          <h3 className="text-lg font-semibold text-white">Top Sessions</h3>
          <p className="text-xs text-zinc-400">By downloads</p>
          <div className="mt-4 space-y-3">
            {topSessions.length === 0 && (
              <div className="rounded-xl border border-white/5 bg-white/5 p-4 text-sm text-zinc-400">No download data yet.</div>
            )}
            {topSessions.map((item, idx) => {
              const sessionName = sessions.find((s) => s.id === item.sessionId)?.name || item.sessionId;
              return (
                <div key={item.sessionId} className="rounded-xl border border-white/5 bg-white/5 p-3">
                  <div className="flex items-center justify-between text-sm text-white">
                    <span className="flex items-center gap-2 font-semibold">
                      <span className="rounded-md bg-blue-500/20 px-2 py-1 text-xs text-blue-100">#{idx + 1}</span>
                      {sessionName}
                    </span>
                    <span className="text-sm text-emerald-200">{item.downloaded} downloads</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-white/5 bg-zinc-900/60 p-6 shadow-lg shadow-blue-500/10 backdrop-blur">
        <h3 className="text-lg font-semibold text-white">Environment</h3>
        <div className="mt-3 grid gap-3 text-sm text-zinc-300 md:grid-cols-2">
          <div>
            <div className="text-zinc-400">Sessions root</div>
            <div className="truncate font-mono text-emerald-200">{config?.sessionsRoot ?? 'Not set'}</div>
          </div>
          <div>
            <div className="text-zinc-400">Chrome executable</div>
            <div className="truncate font-mono text-sky-200">{config?.chromeExecutablePath || 'Not set'}</div>
          </div>
          <div>
            <div className="text-zinc-400">ffmpeg path</div>
            <div className="truncate font-mono text-indigo-200">{config?.ffmpegPath || 'Not set'}</div>
          </div>
          <div>
            <div className="text-zinc-400">Max parallel sessions</div>
            <div className="font-mono text-amber-200">{config?.maxParallelSessions ?? '-'}</div>
          </div>
        </div>
      </div>
    </div>
  );
};

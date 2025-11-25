import React, { useEffect, useMemo, useState } from 'react';
import { useAppStore } from '../store';
import { StatCard } from './StatCard';
import { Icons } from './Icons';

type DailyStats = { date: string; submitted: number; failed: number; downloaded: number };
type TopSession = { sessionId: string; downloaded: number };

// Simple SVG Bar Chart Component
const SimpleBarChart = ({ data }: { data: DailyStats[] }) => {
  if (data.length === 0) return <div className="flex h-48 items-center justify-center text-xs text-zinc-600">No data available</div>;

  const maxVal = Math.max(...data.map(d => Math.max(d.submitted, d.downloaded, d.failed, 1)));
  const height = 160;

  return (
    <div className="relative h-52 w-full overflow-x-auto pt-8 scrollbar-thin">
      <div className="flex items-end h-[160px] gap-6 px-4 min-w-max">
        {data.map((day, i) => {
          const hSub = (day.submitted / maxVal) * height;
          const hDown = (day.downloaded / maxVal) * height;
          const hFail = (day.failed / maxVal) * height;

          return (
            <div key={i} className="group flex flex-col items-center gap-2 relative">
              <div className="flex items-end gap-1.5 h-full">
                {/* Downloaded (Green Gradient) */}
                <div className="w-2 bg-gradient-to-t from-emerald-600 to-emerald-400 rounded-t-sm hover:to-emerald-300 transition-all shadow-[0_0_8px_rgba(52,211,153,0.3)]" style={{ height: Math.max(4, hDown) }} />
                {/* Submitted (Blue Gradient) */}
                <div className="w-2 bg-gradient-to-t from-blue-600 to-blue-400 rounded-t-sm hover:to-blue-300 transition-all" style={{ height: Math.max(4, hSub) }} />
                {/* Failed (Rose Gradient) */}
                <div className="w-2 bg-gradient-to-t from-rose-600 to-rose-400 rounded-t-sm hover:to-rose-300 transition-all" style={{ height: Math.max(4, hFail) }} />
              </div>
              <div className="text-[10px] text-zinc-600 font-mono group-hover:text-zinc-300 transition-colors">{day.date.slice(5)}</div>

              {/* Tooltip */}
              <div className="absolute bottom-full mb-2 hidden group-hover:block z-20 bg-zinc-900/90 backdrop-blur border border-zinc-700 p-2 rounded-lg shadow-xl min-w-[120px]">
                <div className="text-[10px] text-zinc-400 font-mono mb-1.5 pb-1.5 border-b border-zinc-700">{day.date}</div>
                <div className="flex justify-between text-[10px] text-emerald-400 mb-0.5"><span>Downloaded</span> <span>{day.downloaded}</span></div>
                <div className="flex justify-between text-[10px] text-blue-400 mb-0.5"><span>Submitted</span> <span>{day.submitted}</span></div>
                <div className="flex justify-between text-[10px] text-rose-400"><span>Failed</span> <span>{day.failed}</span></div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export const DashboardPage: React.FC = () => {
  const { sessions, config } = useAppStore();
  const [dailyStats, setDailyStats] = useState<DailyStats[]>([]);
  const [topSessions, setTopSessions] = useState<TopSession[]>([]);
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
      if (!api?.analytics) return;
      try {
        setLoading(true);
        const statsRes = await api.analytics.getDailyStats?.(14);
        if (Array.isArray(statsRes)) setDailyStats(statsRes);
        const topRes = await api.analytics.getTopSessions?.(5);
        if (Array.isArray(topRes)) setTopSessions(topRes);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Welcome Banner */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-indigo-900/40 via-black to-black border border-zinc-800/50 p-8">
        <div className="absolute top-0 left-0 w-full h-full bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-20"></div>
        <div className="relative z-10">
          <h1 className="text-2xl font-bold text-white mb-1">Dashboard Overview</h1>
          <p className="text-zinc-400 text-sm">System metrics and performance analytics for the last 14 days.</p>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Total Sessions"
          value={sessions.length}
          icon={<Icons.Sessions className="w-5 h-5 text-white" />}
          hint="Active profiles"
        />
        <StatCard
          label="Queued Prompts"
          value={totals.prompts}
          icon={<Icons.Content className="w-5 h-5 text-blue-400" />}
          hint="Lines waiting"
        />
        <StatCard
          label="Titles Ready"
          value={totals.titles}
          icon={<Icons.Automator className="w-5 h-5 text-purple-400" />}
          hint="Pending downloads"
        />
        <StatCard
          label="Activity Days"
          value={totals.pipelineRuns}
          icon={<Icons.Dashboard className="w-5 h-5 text-emerald-400" />}
          hint="Operational days"
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Main Chart */}
        <div className="card p-6 lg:col-span-2 bg-gradient-to-b from-zinc-900/50 to-black border-zinc-800/50">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h3 className="text-sm font-bold text-white uppercase tracking-wider">Throughput</h3>
              <p className="text-xs text-zinc-500 mt-1">Daily downloads and prompts submission</p>
            </div>
            <div className="flex gap-4 text-[10px] font-medium uppercase tracking-wider text-zinc-500">
              <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-emerald-500"></span> Download</div>
              <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-blue-500"></span> Prompt</div>
              <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-rose-500"></span> Error</div>
            </div>
          </div>
          <SimpleBarChart data={dailyStats} />
        </div>

        {/* Top Sessions List */}
        <div className="card p-6 bg-zinc-900/30">
          <h3 className="text-sm font-bold text-white uppercase tracking-wider mb-6">Top Sessions</h3>
          <div className="space-y-4">
            {topSessions.length === 0 && (
              <div className="text-xs text-zinc-600 py-10 text-center border border-dashed border-zinc-800 rounded-xl">No data available</div>
            )}
            {topSessions.map((item, idx) => {
              const sessionName = sessions.find((s) => s.id === item.sessionId)?.name || item.sessionId;
              const maxVal = topSessions[0]?.downloaded || 1;
              const percent = (item.downloaded / maxVal) * 100;

              return (
                <div key={item.sessionId} className="group relative">
                  <div className="flex items-center justify-between text-sm mb-2 relative z-10">
                    <span className="font-medium text-zinc-300 flex items-center gap-3">
                      <span className="flex h-5 w-5 items-center justify-center rounded bg-zinc-800 text-[10px] font-mono text-zinc-500 border border-zinc-700">{idx + 1}</span>
                      {sessionName}
                    </span>
                    <span className="text-xs font-mono text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded">{item.downloaded}</span>
                  </div>
                  <div className="h-1.5 w-full bg-zinc-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-blue-600 to-emerald-500 rounded-full transition-all duration-1000 ease-out"
                      style={{ width: `${percent}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
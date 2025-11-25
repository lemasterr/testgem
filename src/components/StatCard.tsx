import React from 'react';

interface StatCardProps {
  label: string;
  value: string | number;
  hint?: string;
  trend?: 'up' | 'down' | 'neutral';
  icon?: React.ReactNode;
}

export const StatCard: React.FC<StatCardProps> = ({ label, value, hint, icon }) => (
  <div className="group relative overflow-hidden rounded-xl border border-zinc-800 bg-[#09090b] p-5 transition-all hover:border-zinc-700">
    <div className="absolute right-0 top-0 -mt-4 -mr-4 h-24 w-24 rounded-full bg-zinc-800/20 blur-2xl transition-all group-hover:bg-zinc-700/20" />

    <div className="relative flex items-start justify-between">
      <div>
        <div className="text-xs font-medium uppercase tracking-wider text-zinc-500">{label}</div>
        <div className="mt-2 text-3xl font-bold text-zinc-100 tracking-tight">{value}</div>
        {hint && <div className="mt-1 text-xs text-zinc-500">{hint}</div>}
      </div>
      {icon && (
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-400">
          {icon}
        </div>
      )}
    </div>
  </div>
);
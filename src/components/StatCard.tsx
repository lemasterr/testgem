import React from 'react';

interface StatCardProps {
  label: string;
  value: string | number;
  hint?: string;
  accent?: string;
  icon?: React.ReactNode;
}

export const StatCard: React.FC<StatCardProps> = ({ label, value, hint, accent = 'text-blue-200', icon }) => (
  <div className="rounded-2xl border border-white/5 bg-gradient-to-br from-zinc-900/80 via-zinc-900/60 to-indigo-900/40 p-4 shadow-lg shadow-blue-500/10 backdrop-blur">
    <div className="flex items-start justify-between gap-3">
      <div className="space-y-1">
        <div className="text-xs uppercase tracking-[0.2em] text-zinc-400">{label}</div>
        <div className={`text-3xl font-semibold leading-tight ${accent}`}>{value}</div>
        {hint && <div className="text-xs text-zinc-500">{hint}</div>}
      </div>
      {icon && <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500/10 text-blue-300">{icon}</div>}
    </div>
  </div>
);


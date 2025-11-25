import React, { useEffect, useState } from 'react';
import { useAppStore } from '../store';
import type { Config } from '../../shared/types';
import { Icons } from './Icons';

export const SettingsPage: React.FC = () => {
  const { config, refreshConfig } = useAppStore();
  const [form, setForm] = useState<Config | null>(null);
  const [activeTab, setActiveTab] = useState<'general' | 'paths' | 'advanced'>('general');
  const [status, setStatus] = useState<string>('');
  const [cloneStatus, setCloneStatus] = useState<string>('');

  useEffect(() => { if (config) setForm(config); else refreshConfig(); }, [config, refreshConfig]);

  const save = async () => {
    if (form) {
        setStatus('Saving...');
        await window.electronAPI.config.update(form);
        await refreshConfig();
        setStatus('Saved');
        setTimeout(() => setStatus(''), 2000);
    }
  };

  const cloneProfile = async () => {
    setCloneStatus('Cloning...');
    try {
        const res = await window.electronAPI.chrome.cloneProfile();
        setCloneStatus(res.ok ? 'Done! Restart app recommended.' : `Error: ${res.error}`);
    } catch (e) { setCloneStatus('Failed'); }
  };

  if (!form) return <div className="p-10 text-center text-zinc-500 animate-pulse">Loading configuration...</div>;

  return (
    <div className="max-w-5xl mx-auto pb-10 animate-fade-in space-y-8">
      {/* Header */}
      <div className="flex justify-between items-end p-8 rounded-3xl bg-gradient-to-br from-zinc-900 to-black border border-zinc-800 shadow-2xl relative overflow-hidden">
        <div className="relative z-10">
            <h1 className="text-3xl font-bold text-white mb-2">Settings</h1>
            <p className="text-sm text-zinc-400">System configuration & presets</p>
        </div>
        <div className="relative z-10 flex flex-col items-end gap-2">
             <button onClick={save} className="btn-primary px-6 py-2.5 font-bold shadow-lg shadow-indigo-500/20"><Icons.Check className="w-4 h-4 mr-2"/> Save Changes</button>
             {status && <span className="text-xs text-emerald-400 font-mono">{status}</span>}
        </div>
        <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-500/5 blur-[80px] rounded-full pointer-events-none"/>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-zinc-800">
        {['general', 'paths', 'advanced'].map(t => (
            <button key={t} onClick={() => setActiveTab(t as any)} className={`px-6 py-3 text-sm font-medium capitalize border-b-2 transition-all ${activeTab === t ? 'border-indigo-500 text-white' : 'border-transparent text-zinc-500 hover:text-zinc-300'}`}>
                {t}
            </button>
        ))}
      </div>

      {/* General Tab */}
      {activeTab === 'general' && (
        <div className="grid md:grid-cols-2 gap-6">
            <div className="card p-6 space-y-5">
                <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-wider flex items-center gap-2"><Icons.Automator className="w-4 h-4 text-blue-400"/> Automation</h3>
                <div className="grid grid-cols-2 gap-4">
                    <div><label className="text-xs text-zinc-400 font-bold">Prompt Delay (ms)</label><input type="number" className="input-field mt-1" value={form.promptDelayMs} onChange={e => setForm({...form, promptDelayMs: +e.target.value})}/></div>
                    <div><label className="text-xs text-zinc-400 font-bold">Download Timeout</label><input type="number" className="input-field mt-1" value={form.downloadTimeoutMs} onChange={e => setForm({...form, downloadTimeoutMs: +e.target.value})}/></div>
                </div>
                <div><label className="text-xs text-zinc-400 font-bold">Max Parallel Sessions</label><input type="number" className="input-field mt-1" value={form.maxParallelSessions} onChange={e => setForm({...form, maxParallelSessions: +e.target.value})}/></div>
            </div>

            <div className="card p-6 space-y-5">
                <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-wider flex items-center gap-2"><Icons.Trash className="w-4 h-4 text-rose-400"/> Cleanup</h3>
                <div className="flex gap-4">
                    <label className="flex items-center gap-2 text-sm text-zinc-300 cursor-pointer bg-zinc-900/50 px-3 py-2 rounded border border-zinc-800"><input type="checkbox" checked={form.cleanup?.enabled} onChange={e => setForm({...form, cleanup: {...form.cleanup, enabled: e.target.checked}})} className="accent-indigo-500"/> Enabled</label>
                    <label className="flex items-center gap-2 text-sm text-zinc-300 cursor-pointer bg-zinc-900/50 px-3 py-2 rounded border border-zinc-800"><input type="checkbox" checked={form.cleanup?.dryRun} onChange={e => setForm({...form, cleanup: {...form.cleanup, dryRun: e.target.checked}})} className="accent-amber-500"/> Dry Run</label>
                </div>
                <div className="grid grid-cols-2 gap-4">
                    <div><label className="text-xs text-zinc-400 font-bold">Downloads (Days)</label><input type="number" className="input-field mt-1" value={form.cleanup?.retentionDaysDownloads} onChange={e => setForm({...form, cleanup: {...form.cleanup, retentionDaysDownloads: +e.target.value}})}/></div>
                    <div><label className="text-xs text-zinc-400 font-bold">Blurred (Days)</label><input type="number" className="input-field mt-1" value={form.cleanup?.retentionDaysBlurred} onChange={e => setForm({...form, cleanup: {...form.cleanup, retentionDaysBlurred: +e.target.value}})}/></div>
                </div>
            </div>
        </div>
      )}

      {/* Paths Tab */}
      {activeTab === 'paths' && (
        <div className="card p-6 space-y-6">
            <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-wider flex items-center gap-2"><Icons.Folder className="w-4 h-4 text-amber-400"/> System Paths</h3>

            <div>
                <label className="text-xs text-zinc-400 font-bold">Sessions Root Directory</label>
                <div className="flex gap-2 mt-1">
                    <input className="input-field font-mono text-xs bg-black/20" value={form.sessionsRoot} readOnly />
                    <button onClick={() => window.electronAPI.system.openPath(form.sessionsRoot)} className="btn-secondary whitespace-nowrap">Reveal</button>
                </div>
            </div>

            <div className="grid md:grid-cols-2 gap-6">
                <div>
                    <label className="text-xs text-zinc-400 font-bold">Chrome Executable</label>
                    <input className="input-field mt-1 font-mono text-xs" value={form.chromeExecutablePath || ''} onChange={e => setForm({...form, chromeExecutablePath: e.target.value})} placeholder="Auto-detect"/>
                </div>
                <div>
                    <label className="text-xs text-zinc-400 font-bold">User Data Directory</label>
                    <input className="input-field mt-1 font-mono text-xs" value={form.chromeUserDataDir || ''} onChange={e => setForm({...form, chromeUserDataDir: e.target.value})} placeholder="System Default"/>
                    <p className="text-[10px] text-zinc-600 mt-1">Optional: Custom path for profiles</p>
                </div>
            </div>

            <div className="p-4 rounded-xl bg-indigo-900/10 border border-indigo-500/20 flex justify-between items-center">
                <div>
                    <h4 className="text-sm font-bold text-indigo-200">Profile Cloning</h4>
                    <p className="text-xs text-indigo-300/60">Create an isolated copy of your Chrome profile for safer automation.</p>
                </div>
                <div className="flex items-center gap-3">
                    <span className="text-xs text-zinc-500">{cloneStatus}</span>
                    <button onClick={cloneProfile} className="btn-secondary border-indigo-500/30 text-indigo-300 hover:bg-indigo-500/20">Clone Active Profile</button>
                </div>
            </div>
        </div>
      )}

      {/* Advanced Tab */}
      {activeTab === 'advanced' && (
        <div className="card p-6 space-y-5">
            <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-wider">Developer</h3>
            <div className="p-4 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-200 text-xs mb-4">
                Warning: Changing CDP port ranges may cause connection failures if Chrome is already running.
            </div>
            <div className="grid md:grid-cols-3 gap-4">
                <div><label className="text-xs text-zinc-400 font-bold">Base CDP Port</label><input type="number" className="input-field mt-1" value={form.cdpPort || 9222} onChange={e => setForm({...form, cdpPort: +e.target.value})}/></div>
                <div><label className="text-xs text-zinc-400 font-bold">Draft Timeout</label><input type="number" className="input-field mt-1" value={form.draftTimeoutMs} onChange={e => setForm({...form, draftTimeoutMs: +e.target.value})}/></div>
                <div><label className="text-xs text-zinc-400 font-bold">FFmpeg Path</label><input className="input-field mt-1" value={form.ffmpegPath || ''} onChange={e => setForm({...form, ffmpegPath: e.target.value})} placeholder="System PATH"/></div>
            </div>
        </div>
      )}
    </div>
  );
};
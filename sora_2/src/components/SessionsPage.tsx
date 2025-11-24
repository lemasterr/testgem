import React, { useEffect, useMemo, useState } from 'react';
import type { ManagedSession, ChromeProfile, RunResult } from '../../shared/types';
import { SessionWindow } from './SessionWindow';

const statusColors: Record<NonNullable<ManagedSession['status']>, string> = {
  idle: 'bg-zinc-700',
  running: 'bg-emerald-500',
  warning: 'bg-amber-400',
  error: 'bg-rose-500'
};

const emptySession: ManagedSession = {
  id: '',
  name: 'New Session',
  chromeProfileName: null,
  promptProfile: null,
  cdpPort: 9222,
  promptsFile: '',
  imagePromptsFile: '',
  titlesFile: '',
  submittedLog: '',
  failedLog: '',
  downloadDir: '',
  cleanDir: '',
  cursorFile: '',
  maxVideos: 5,
  openDrafts: false,
  autoLaunchChrome: true,
  autoLaunchAutogen: false,
  notes: '',
  status: 'idle',
  enableAutoPrompts: false,
  promptDelayMs: 0,
  postLastPromptDelayMs: 120000,
  maxPromptsPerRun: 10,
  autoChainAfterPrompts: false
};

export const SessionsPage: React.FC = () => {
  const [sessions, setSessions] = useState<ManagedSession[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [form, setForm] = useState<ManagedSession>(emptySession);
  const [profiles, setProfiles] = useState<ChromeProfile[]>([]);
  const [saving, setSaving] = useState(false);
  const [actionMessage, setActionMessage] = useState<string>('');
  const [openWindowId, setOpenWindowId] = useState<string | null>(null);

  const selectedSession = useMemo(() => sessions.find((s) => s.id === selectedId), [sessions, selectedId]);
  const openSession = useMemo(() => sessions.find((s) => s.id === openWindowId) || null, [sessions, openWindowId]);

  const loadSessions = async () => {
    if (!window.electronAPI?.sessions) return;
    const list = await window.electronAPI.sessions.list();
    setSessions(list);
    const first = list[0];
    if (first) {
      setSelectedId(first.id);
      setForm(first);
    }
  };

  const loadProfiles = async () => {
    const chromeApi = window.electronAPI?.chrome;
    if (!chromeApi) return;

    const result = (await chromeApi.listProfiles?.()) ?? (await chromeApi.scanProfiles?.());
    if (Array.isArray(result)) {
      setProfiles(result);
    } else if (result && typeof result === 'object') {
      if ('ok' in result && (result as any).ok && Array.isArray((result as any).profiles)) {
        setProfiles((result as any).profiles as ChromeProfile[]);
      } else if (Array.isArray((result as any).profiles)) {
        setProfiles((result as any).profiles as ChromeProfile[]);
      }
    }
  };

  useEffect(() => {
    loadSessions();
    loadProfiles();
  }, []);

  const handleSelect = (session: ManagedSession) => {
    setSelectedId(session.id);
    setForm(session);
    setActionMessage('');
  };

  const handleChange = <K extends keyof ManagedSession>(key: K, value: ManagedSession[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handlePick = async (key: keyof ManagedSession, type: 'file' | 'folder') => {
    const picker = type === 'file' ? window.electronAPI.chooseFile : window.electronAPI.chooseSessionsRoot;
    const value = await picker();
    if (value) {
      handleChange(key, value as ManagedSession[typeof key]);
    }
  };

  const saveSession = async () => {
    if (!window.electronAPI.sessions) return;
    setSaving(true);
    const saved = await window.electronAPI.sessions.save(form);
    setSessions((prev) => {
      const existingIndex = prev.findIndex((s) => s.id === saved.id);
      if (existingIndex >= 0) {
        const next = [...prev];
        next[existingIndex] = saved;
        return next;
      }
      return [...prev, saved];
    });
    setSelectedId(saved.id);
    setForm(saved);
    setSaving(false);
    setActionMessage('Session saved');
  };

  const newSession = () => {
    setSelectedId('');
    setForm({ ...emptySession, name: 'New Session' });
    setActionMessage('');
  };

  const deleteSession = async () => {
    if (!form.id || !window.electronAPI?.sessions?.delete) return;
    const confirmed = window.confirm(`Delete session "${form.name}"? This cannot be undone.`);
    if (!confirmed) return;

    await window.electronAPI.sessions.delete(form.id);
    const nextSessions = sessions.filter((s) => s.id !== form.id);
    setSessions(nextSessions);

    const nextSelection = nextSessions[0] ?? { ...emptySession, name: 'New Session' };
    setSelectedId(nextSessions[0]?.id ?? '');
    setForm(nextSelection);
    setActionMessage('Session deleted');
  };

  const handleAction = async (action: 'prompts' | 'downloads' | 'stop' | 'open' | 'startChrome') => {
    if (!form.id || !window.electronAPI.sessions) return;
    if (action === 'open') {
      setOpenWindowId(form.id);
      setActionMessage('Session window opened');
      return;
    }

    const autogen = window.electronAPI.autogen;
    const downloader = window.electronAPI.downloader;
    let result: RunResult | undefined;

    if (action === 'prompts') {
      result = (await autogen?.run?.(form.id)) as RunResult;
      if (!result && window.electronAPI.sessions.runPrompts) {
        result = await window.electronAPI.sessions.runPrompts(form.id);
      }
    } else if (action === 'downloads') {
      result = (await downloader?.run?.(form.id, { limit: form.maxVideos ?? 0 })) as RunResult;
      if (!result && window.electronAPI.sessions.runDownloads) {
        result = await window.electronAPI.sessions.runDownloads(form.id, form.maxVideos);
      }
    } else if (action === 'startChrome') {
      if (window.electronAPI.sessions.command) {
        result = (await window.electronAPI.sessions.command(form.id, 'startChrome')) as RunResult;
      }
    } else {
      result = (await autogen?.stop?.(form.id)) as RunResult;
      await downloader?.stop?.(form.id);
      if (!result && window.electronAPI.sessions.cancelPrompts) {
        result = await window.electronAPI.sessions.cancelPrompts(form.id);
      }
    }

    if (!result) {
      setActionMessage('No response received');
      return;
    }

    const message = result.ok ? result.details ?? 'OK' : result.error ?? 'Error';
    setActionMessage(message);
    loadSessions();
  };

  const statusDot = (status: NonNullable<ManagedSession['status']>) => (
    <span className={`inline-block h-2.5 w-2.5 rounded-full ${statusColors[status] || statusColors.idle}`} />
  );

  return (
    <div className="grid h-full grid-cols-1 gap-4 lg:grid-cols-[280px,1fr]">
      <div className="flex flex-col rounded-xl border border-zinc-800 bg-zinc-900/80">
        <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
          <div className="text-sm font-semibold text-zinc-100">Sessions</div>
          <button
            onClick={newSession}
            className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500"
          >
            New
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {sessions.map((session) => (
            <button
              key={session.id}
              onClick={() => handleSelect(session)}
              className={`w-full rounded-lg border px-3 py-2 text-left transition hover:border-blue-500 ${
                selectedId === session.id ? 'border-blue-500 bg-zinc-800 text-white' : 'border-zinc-800 bg-zinc-900 text-zinc-200'
              }`}
            >
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  {statusDot(session.status || 'idle')}
                  <span className="font-semibold">{session.name}</span>
                </div>
                <span className="text-xs text-zinc-400">{session.chromeProfileName || 'No profile'}</span>
              </div>
              <div className="mt-1 text-xs text-zinc-400">{session.promptProfile || 'Prompt profile: default'}</div>
            </button>
          ))}
          {sessions.length === 0 && (
            <div className="rounded-lg border border-dashed border-zinc-700 bg-zinc-900/60 p-4 text-sm text-zinc-400">
              No sessions yet. Create one to begin.
            </div>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-4 overflow-y-auto">
        <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
          <div>
            <div className="flex items-center gap-3 text-lg font-semibold text-white">
              {form.name || 'Session Details'}
              {form.status && (
                <span className={`rounded-full px-2 py-0.5 text-xs ${
                  form.status === 'running'
                    ? 'bg-emerald-500/20 text-emerald-200'
                    : form.status === 'warning'
                    ? 'bg-amber-500/20 text-amber-200'
                    : form.status === 'error'
                    ? 'bg-rose-500/20 text-rose-100'
                    : 'bg-zinc-700/60 text-zinc-200'
                }`}>
                  {form.status}
                </span>
              )}
            </div>
            <div className="text-sm text-zinc-400">Configure automation paths and behavior per session.</div>
            <div className="mt-1 flex flex-wrap gap-3 text-xs text-zinc-500">
              <span>Prompts: {form.promptCount ?? 0}</span>
              <span>Titles: {form.titleCount ?? 0}</span>
              <span>Downloads: {form.downloadedCount ?? 0}</span>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => handleAction('open')}
              disabled={!form.id}
              className="rounded-lg border border-zinc-700 px-3 py-2 text-sm font-medium text-zinc-200 hover:border-blue-500 hover:text-blue-200 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Open Session Window
            </button>
            <button
              onClick={() => handleAction('startChrome')}
              disabled={!form.id}
              className="rounded-lg border border-sky-700 bg-sky-900/60 px-3 py-2 text-sm font-medium text-sky-100 shadow hover:border-sky-500 hover:bg-sky-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Launch Chrome (CDP port {form.cdpPort ?? 9222})
            </button>
            <button
              onClick={() => handleAction('prompts')}
              disabled={!form.id}
              className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white shadow hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Run Prompts
            </button>
            <button
              onClick={() => handleAction('downloads')}
              disabled={!form.id}
              className="rounded-lg bg-sky-600 px-3 py-2 text-sm font-medium text-white shadow hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Run Downloads
            </button>
            <button
              onClick={() => handleAction('stop')}
              disabled={!form.id}
              className="rounded-lg border border-zinc-700 px-3 py-2 text-sm font-medium text-zinc-200 hover:border-rose-400 hover:text-rose-200 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Stop Worker
            </button>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Left Column */}
          <div className="space-y-4">
            <div className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-950/30 p-4">
              <h4 className="text-sm font-semibold text-zinc-200">Basic Settings</h4>
              <label className="block text-sm text-zinc-300">
                Name
                <input
                  className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none"
                  value={form.name}
                  onChange={(e) => handleChange('name', e.target.value)}
                />
              </label>

              <label className="block text-sm text-zinc-300">
                Chrome Profile
                <select
                  className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none"
                  value={form.chromeProfileName ?? ''}
                  onChange={(e) => handleChange('chromeProfileName', e.target.value || null)}
                >
                  <option value="">Select profile</option>
                  {profiles.map((profile) => (
                    <option key={profile.name} value={profile.name}>
                      {profile.name} ({profile.profileDirectory ?? profile.profileDir})
                    </option>
                  ))}
                </select>
              </label>

              <label className="block text-sm text-zinc-300">
                CDP Port
                <input
                  type="number"
                  className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none"
                  value={form.cdpPort ?? ''}
                  onChange={(e) => handleChange('cdpPort', Number(e.target.value))}
                />
              </label>
            </div>

            <div className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-950/30 p-4">
              <h4 className="text-sm font-semibold text-zinc-200">File Paths</h4>
              <div className="grid grid-cols-[1fr,auto] items-center gap-2">
                <label className="text-sm text-zinc-300">
                  Prompts File
                  <input
                    className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none"
                    value={form.promptsFile || ''}
                    onChange={(e) => handleChange('promptsFile', e.target.value)}
                  />
                </label>
                <button
                  className="rounded-lg border border-zinc-700 px-3 py-2 text-xs text-zinc-200 hover:border-blue-500"
                  onClick={() => handlePick('promptsFile', 'file')}
                >
                  Browse
                </button>
              </div>

              <div className="grid grid-cols-[1fr,auto] items-center gap-2">
                <label className="text-sm text-zinc-300">
                  Image Prompts File
                  <input
                    className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none"
                    value={form.imagePromptsFile || ''}
                    onChange={(e) => handleChange('imagePromptsFile', e.target.value)}
                  />
                </label>
                <button
                  className="rounded-lg border border-zinc-700 px-3 py-2 text-xs text-zinc-200 hover:border-blue-500"
                  onClick={() => handlePick('imagePromptsFile', 'file')}
                >
                  Browse
                </button>
              </div>
            </div>
          </div>

          {/* Right Column */}
          <div className="space-y-4">
            {/* Auto Prompts (New Sora 9 Style Config) */}
            <div className="space-y-3 rounded-lg border border-indigo-500/20 bg-indigo-900/10 p-4">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold text-indigo-200">Auto-Prompts (Sora 9)</h4>
                <label className="flex items-center gap-2 text-xs text-indigo-100 font-medium cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.enableAutoPrompts ?? false}
                    onChange={(e) => handleChange('enableAutoPrompts', e.target.checked)}
                    className="h-4 w-4 rounded border-zinc-600 bg-zinc-800 text-indigo-500 focus:ring-indigo-500"
                  />
                  Включити авто-промпти
                </label>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <label className="block text-xs text-zinc-400">
                  Max Prompts Per Run
                  <input
                    type="number"
                    className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm text-white focus:border-indigo-500 focus:outline-none"
                    value={form.maxPromptsPerRun ?? 10}
                    onChange={(e) => handleChange('maxPromptsPerRun', Number(e.target.value))}
                  />
                </label>
                <label className="block text-xs text-zinc-400">
                  Prompt Delay (ms)
                  <input
                    type="number"
                    placeholder="0 (use global)"
                    className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm text-white focus:border-indigo-500 focus:outline-none"
                    value={form.promptDelayMs ?? 0}
                    onChange={(e) => handleChange('promptDelayMs', Number(e.target.value))}
                  />
                </label>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <label className="block text-xs text-zinc-400">
                  Post-Run Delay (ms)
                  <input
                    type="number"
                    className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm text-white focus:border-indigo-500 focus:outline-none"
                    value={form.postLastPromptDelayMs ?? 120000}
                    onChange={(e) => handleChange('postLastPromptDelayMs', Number(e.target.value))}
                  />
                </label>
                <div className="flex items-end pb-2">
                  <label className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer" title="Автоматично переходити до скачування після промптів">
                    <input
                      type="checkbox"
                      checked={form.autoChainAfterPrompts ?? false}
                      onChange={(e) => handleChange('autoChainAfterPrompts', e.target.checked)}
                      className="h-4 w-4 rounded border-zinc-600 bg-zinc-800 text-indigo-500 focus:ring-indigo-500"
                    />
                    Auto-Chain Downloads
                  </label>
                </div>
              </div>
            </div>

            {/* Standard Settings */}
            <div className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-950/30 p-4">
              <h4 className="text-sm font-semibold text-zinc-200">Automation Settings</h4>

              <div className="grid grid-cols-2 gap-3">
                <label className="block text-sm text-zinc-300">
                  Max Videos
                  <input
                    type="number"
                    className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none"
                    value={form.maxVideos ?? ''}
                    onChange={(e) => handleChange('maxVideos', Number(e.target.value))}
                  />
                  <span className="text-[10px] text-zinc-500">0 = безліміт</span>
                </label>
                <label className="block text-sm text-zinc-300">
                  Download Directory
                  <div className="flex gap-1">
                    <input
                      className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-2 text-xs text-white focus:border-blue-500 focus:outline-none"
                      value={form.downloadDir || ''}
                      onChange={(e) => handleChange('downloadDir', e.target.value)}
                    />
                    <button
                      className="mt-1 rounded border border-zinc-700 px-2 text-xs hover:border-blue-500"
                      onClick={() => handlePick('downloadDir', 'folder')}
                    >
                      ...
                    </button>
                  </div>
                </label>
              </div>

              <div className="flex flex-wrap gap-4 text-sm text-zinc-300 pt-2">
                <label className="flex items-center gap-2" title="Запускати Chrome перед виконанням">
                  <input
                    type="checkbox"
                    checked={form.autoLaunchChrome ?? false}
                    onChange={(e) => handleChange('autoLaunchChrome', e.target.checked)}
                    className="h-4 w-4 rounded border-zinc-600 bg-zinc-800 text-blue-500 focus:ring-blue-500"
                  />
                  Auto-launch Chrome
                </label>
                <label className="flex items-center gap-2" title="Відкривати драфти автоматично">
                  <input
                    type="checkbox"
                    checked={form.openDrafts ?? false}
                    onChange={(e) => handleChange('openDrafts', e.target.checked)}
                    className="h-4 w-4 rounded border-zinc-600 bg-zinc-800 text-blue-500 focus:ring-blue-500"
                  />
                  Open Drafts
                </label>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-4">
          <label className="block text-sm text-zinc-300">
            Notes
            <textarea
              rows={3}
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none"
              value={form.notes || ''}
              onChange={(e) => handleChange('notes', e.target.value)}
              placeholder="Workflow notes or reminders"
            />
          </label>
        </div>

        <div className="mt-4 flex items-center justify-between">
          <div className="text-sm text-zinc-400">{actionMessage}</div>
          <div className="flex items-center gap-2">
            <button
              onClick={deleteSession}
              disabled={!form.id}
              className="rounded-lg border border-red-700 px-4 py-2 text-sm font-medium text-red-200 shadow hover:bg-red-900/40 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Delete Session
            </button>
            <button
              onClick={saveSession}
              disabled={saving}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving ? 'Saving...' : 'Save Session'}
            </button>
          </div>
        </div>
      </div>
      {openSession && <SessionWindow session={openSession} onClose={() => setOpenWindowId(null)} />}
    </div>
  );
};
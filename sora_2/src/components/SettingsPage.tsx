import React, { useEffect, useState } from 'react';
import { useAppStore } from '../store';
import type { ChromeProfile, Config } from '../../shared/types';

const DEFAULT_CONFIG: Config = {
  sessionsRoot: '',
  chromeExecutablePath: null,
  chromeUserDataRoot: null,
  chromeUserDataDir: null,
  chromeActiveProfileName: null,
  chromeProfileId: null,
  chromeClonedProfilesRoot: null,
  cdpPort: 9222,
  promptDelayMs: 1500,
  draftTimeoutMs: 30000,
  downloadTimeoutMs: 60000,
  maxParallelSessions: 1,
  ffmpegPath: null,
  cleanup: {
    enabled: true,
    dryRun: false,
    retentionDaysDownloads: 14,
    retentionDaysBlurred: 30,
    retentionDaysTemp: 3,
  },
  telegram: {
    enabled: false,
    botToken: null,
    chatId: null,
  },
};

const normalizeProfiles = (profilesList: ChromeProfile[]): ChromeProfile[] =>
  profilesList.map((p) => ({
    ...p,
    id: (p as any).id ?? (p as any).profileDirectory ?? (p as any).profileDir ?? p.name,
    profileDirectory: (p as any).profileDirectory ?? (p as any).profileDir ?? p.name,
    profileDir: (p as any).profileDir ?? (p as any).profileDirectory ?? p.name,
  }));

export const SettingsPage: React.FC = () => {
  const { config, refreshConfig, setConfig } = useAppStore();
  const [draft, setDraft] = useState<Config | null>(config ?? DEFAULT_CONFIG);
  const [status, setStatus] = useState('');
  const [testStatus, setTestStatus] = useState('');
  const [profiles, setProfiles] = useState<ChromeProfile[]>([]);
  const [editingProfile, setEditingProfile] = useState<ChromeProfile | null>(null);
  const [scanError, setScanError] = useState('');
  const [scanning, setScanning] = useState(false);
  const [cloneStatus, setCloneStatus] = useState('');

  useEffect(() => {
    const normalized = config
      ? {
          ...DEFAULT_CONFIG,
          ...config,
          chromeActiveProfileName: (config as any).chromeActiveProfileName ?? null,
          cleanup: {
            ...DEFAULT_CONFIG.cleanup,
            ...(config.cleanup ?? {}),
          },
          telegram: {
            ...DEFAULT_CONFIG.telegram,
            ...(config.telegram ?? {}),
          },
        }
      : DEFAULT_CONFIG;
    setDraft(normalized as Config);
    if ((normalized as any)?.chromeProfiles) {
      setProfiles(normalizeProfiles((normalized as any).chromeProfiles));
    }
  }, [config]);

  const updateField = (key: keyof Config, value: string | number | boolean) => {
    if (!draft) return;
    setDraft({ ...draft, [key]: value } as Config);
  };

  const updateCleanup = (
    key: keyof NonNullable<Config['cleanup']>,
    value: string | number | boolean | null
  ) => {
    if (!draft) return;
    setDraft({
      ...draft,
      cleanup: {
        ...(draft.cleanup ?? {}),
        [key]: value,
      },
    } as Config);
  };

  const updateTelegram = (key: keyof Config['telegram'], value: string | boolean | null) => {
    if (!draft) return;
    setDraft({
      ...draft,
      telegram: {
        ...(draft.telegram ?? DEFAULT_CONFIG.telegram),
        [key]: value,
      },
    } as Config);
  };

  const extractProfiles = (result: any): ChromeProfile[] => {
    if (!result) {
      throw new Error('Chrome profile API unavailable');
    }

    if (Array.isArray(result)) return normalizeProfiles(result);
    if (typeof result === 'object') {
      if ('ok' in result) {
        if ((result as any).ok) {
          return normalizeProfiles(((result as any).profiles as ChromeProfile[]) ?? []);
        }
        throw new Error((result as any).error ?? 'Failed to load Chrome profiles');
      }

      if ('profiles' in result && Array.isArray((result as any).profiles)) {
        return normalizeProfiles((result as any).profiles as ChromeProfile[]);
      }
    }

    throw new Error('Unexpected response from Chrome profile scan');
  };

  const save = async () => {
    if (!draft) return;
    const configApi = window.electronAPI?.config ?? null;
    const update = configApi?.update ?? window.electronAPI?.updateConfig;
    if (!update) {
      setStatus('Config API unavailable');
      return;
    }
    const payload: Partial<Config> = {
      ...draft,
      chromeExecutablePath: draft.chromeExecutablePath ?? null,
      chromeUserDataRoot: draft.chromeUserDataRoot ?? null,
      chromeUserDataDir: draft.chromeUserDataDir ?? null,
      chromeActiveProfileName: draft.chromeActiveProfileName ?? null,
      chromeProfileId: draft.chromeProfileId ?? null,
      ffmpegPath: draft.ffmpegPath ?? null,
      cleanup: draft.cleanup,
      telegram: draft.telegram,
    };
    const updated = await update(payload as Config);
    setConfig(updated as Config);
    setStatus('Saved');
  };

  const browseSessions = async () => {
    const dir = await (window.electronAPI?.config as any)?.chooseSessionsRoot?.();
    if (dir) {
      updateField('sessionsRoot', dir);
    }
  };

  const loadProfiles = async () => {
    try {
      const api = (window as any).electronAPI;
      const chromeApi = api?.chrome;
      if (!chromeApi) {
        setScanError(
          'Chrome API is not available. Please run the Sora desktop app (Electron), not just open the Vite dev URL.'
        );
        return;
      }
      const response = (await chromeApi?.listProfiles?.()) ?? (await chromeApi?.scanProfiles?.());
      const list = extractProfiles(response);
      setProfiles(list);
      setScanError('');
    } catch (error) {
      setScanError((error as Error).message);
    }
  };

  const scanProfiles = async () => {
    setScanning(true);
    setScanError('');
    setStatus('');
    try {
      const api = (window as any).electronAPI;
      const chromeApi = api?.chrome;
      if (!chromeApi) {
        setScanError(
          'Chrome API is not available. Please run the Sora desktop app (Electron), not just open the Vite dev URL.'
        );
        setScanning(false);
        return;
      }
      const response = (await chromeApi?.scan?.()) ?? (await chromeApi?.scanProfiles?.());
      const list = extractProfiles(response);
      setProfiles(list);
      setStatus(
        list.length > 0
          ? 'Chrome profiles scanned successfully'
          : 'No Chrome profiles found. Please check Chrome installation or user-data-dir.'
      );
    } catch (error) {
      setScanError(`Chrome profiles scan failed: ${(error as Error).message}`);
    } finally {
      setScanning(false);
      refreshConfig();
    }
  };

  const cloneProfileForSora = async () => {
    setCloneStatus('');
    setStatus('');
    const api = (window as any).electronAPI;
    const chromeApi = api?.chrome;
    if (!chromeApi?.cloneProfile) {
      setCloneStatus(
        'Chrome clone API is not available. Please run the Sora desktop app (Electron), not just open the Vite dev URL.'
      );
      return;
    }

    try {
      setCloneStatus('Cloning profile…');
      const result: any = await chromeApi.cloneProfile();
      if (result?.ok === false) {
        setCloneStatus(result.error || 'Failed to clone profile');
      } else {
        setCloneStatus(result?.message || 'Profile cloned for Sora');
        await loadProfiles();
        await refreshConfig();
      }
    } catch (error) {
      setCloneStatus((error as Error).message);
    }
  };

  const setActiveProfile = async (name: string) => {
    const api = (window as any).electronAPI;
    const chromeApi = api?.chrome;
    if (!chromeApi) {
      setScanError('Chrome API is not available. Please run the Sora desktop app (Electron).');
      return;
    }
    const updateActive = (await chromeApi?.setActiveProfile?.(name)) ?? (await chromeApi?.setActive?.(name));
    try {
      const list = extractProfiles(updateActive);
      const selected = list.find((p) => p.name === name || p.profileDirectory === name || p.id === name);
      setProfiles(list);
      setDraft((prev) =>
        prev
          ? ({
              ...prev,
              chromeActiveProfileName: selected?.name ?? name,
              chromeProfileId: selected?.profileDirectory ?? name,
              chromeUserDataRoot: selected?.userDataDir ?? prev.chromeUserDataRoot ?? null,
            } as Config)
          : prev
      );
    } catch (error) {
      setScanError((error as Error).message);
    }
    refreshConfig();
  };

  const saveProfile = async (profile: ChromeProfile) => {
    try {
      const api = (window as any).electronAPI;
      const chromeApi = api?.chrome;
      if (!chromeApi) {
        setScanError('Chrome API is not available. Please run the Sora desktop app (Electron).');
        return;
      }
      const response = (await chromeApi?.save?.(profile)) ?? (await chromeApi?.scanProfiles?.());
      const list = extractProfiles(response);
      setProfiles(list);
      setEditingProfile(null);
    } catch (error) {
      setScanError((error as Error).message);
    }
    refreshConfig();
  };

  const removeProfile = async (name: string) => {
    try {
      const api = (window as any).electronAPI;
      const chromeApi = api?.chrome;
      if (!chromeApi) {
        setScanError('Chrome API is not available. Please run the Sora desktop app (Electron).');
        return;
      }
      const response = (await chromeApi?.remove?.(name)) ?? (await chromeApi?.scanProfiles?.());
      const list = extractProfiles(response);
      setProfiles(list);
    } catch (error) {
      setScanError((error as Error).message);
    }
    refreshConfig();
  };

  const sendTestMessage = async () => {
    if (!window.electronAPI?.telegramTest && !window.electronAPI?.telegram?.test) return;
    setTestStatus('Sending...');
    const result = (await window.electronAPI?.telegram?.test?.()) ?? (await window.electronAPI?.telegramTest?.());
    if (result.ok) {
      setTestStatus('Test message sent');
    } else {
      setTestStatus(`Error: ${result.error ?? 'Failed to send'}`);
    }
  };

  const startEditProfile = (profile: ChromeProfile) => {
    setEditingProfile({ ...profile });
  };

  const startCreateProfile = () => {
    setEditingProfile({
      id: 'custom-profile',
      name: 'Custom Profile',
      userDataDir: '',
      profileDirectory: '',
      profileDir: '',
    });
  };

  useEffect(() => {
    refreshConfig();
    loadProfiles();
  }, [refreshConfig]);

  if (!draft) {
    return <div className="text-sm text-slate-400">Loading configuration…</div>;
  }

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-lg font-semibold text-white">Settings</h3>
        <p className="text-sm text-slate-400">Configure paths, automation timings, and integration tokens.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <div className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-900/70 p-4">
          <div className="flex items-center justify-between">
            <div>
              <h4 className="text-sm font-semibold text-white">Chrome</h4>
              <p className="text-xs text-zinc-400">Executable, user data dir, and active profile.</p>
            </div>
            <button
              onClick={scanProfiles}
              disabled={scanning}
              className="rounded-lg border border-blue-500/60 bg-blue-500/20 px-3 py-2 text-xs font-semibold text-blue-100 transition hover:bg-blue-500/30 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {scanning ? 'Scanning…' : 'Scan Profiles'}
            </button>
          </div>

          <div className="space-y-2">
            <label className="text-xs text-zinc-400">Chrome executable</label>
            <input
              value={draft.chromeExecutablePath ?? ''}
              onChange={(e) => updateField('chromeExecutablePath', e.target.value)}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-blue-500 focus:outline-none"
              placeholder="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs text-zinc-400">user-data-dir</label>
            <input
              value={draft.chromeUserDataDir ?? ''}
              onChange={(e) => updateField('chromeUserDataDir', e.target.value)}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-blue-500 focus:outline-none"
              placeholder="~/Library/Application Support/Google/Chrome"
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs text-zinc-400">Active profile</label>
            <select
              value={draft.chromeActiveProfileName ?? ''}
              onChange={(e) => setActiveProfile(e.target.value)}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-blue-500 focus:outline-none"
            >
              <option value="">Select profile</option>
              {profiles.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2 rounded-lg border border-blue-500/30 bg-blue-500/5 p-3 text-xs text-blue-100">
            <div className="font-semibold text-blue-100">Clone Chrome profile for Sora</div>
            <p className="text-[11px] text-blue-200">
              We will copy your selected system Chrome profile into an isolated clone so Puppeteer can reuse your Sora login without
              locking the system profile.
            </p>
            <div className="mt-2 grid grid-cols-1 gap-1 text-[11px] text-blue-100/90">
              <div>
                Active profile: <span className="font-semibold text-white">{draft.chromeActiveProfileName || 'Not set'}</span>
              </div>
              <div>
                Automation user-data-dir: <span className="break-all text-white">{draft.chromeUserDataDir || 'System default'}</span>
              </div>
              <div>
                Clone root: <span className="break-all text-white">{draft.chromeClonedProfilesRoot || 'sessionsRoot/chrome-clones'}</span>
              </div>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button
                onClick={cloneProfileForSora}
                className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white shadow hover:bg-blue-500"
              >
                Clone current system profile for Sora
              </button>
              {cloneStatus && <span className="text-[11px] text-blue-200">{cloneStatus}</span>}
            </div>
          </div>
        </div>

        <div className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-900/70 p-4">
          <h4 className="text-sm font-semibold text-white">Paths</h4>
          <p className="text-xs text-zinc-400">Sessions root and ffmpeg binary location.</p>
          <div className="space-y-2">
            <label className="text-xs text-zinc-400">Sessions root directory</label>
            <div className="mt-1 flex gap-2">
              <input
                value={draft.sessionsRoot}
                onChange={(e) => updateField('sessionsRoot', e.target.value)}
                className="flex-1 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-blue-500 focus:outline-none"
              />
              <button
                onClick={browseSessions}
                className="rounded-lg border border-zinc-700 px-3 py-2 text-sm font-semibold text-zinc-100 hover:border-blue-500 hover:text-blue-100"
              >
                Browse…
              </button>
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-xs text-zinc-400">ffmpeg binary</label>
            <input
              value={draft.ffmpegPath ?? ''}
              onChange={(e) => updateField('ffmpegPath', e.target.value)}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-blue-500 focus:outline-none"
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <div className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-900/70 p-4">
          <h4 className="text-sm font-semibold text-white">Timings</h4>
          <p className="text-xs text-zinc-400">Prompt pacing and limits.</p>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="space-y-2">
              <label className="text-xs text-zinc-400">Prompt delay (ms)</label>
              <input
                type="number"
                value={draft.promptDelayMs}
                onChange={(e) => updateField('promptDelayMs', Number(e.target.value))}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-blue-500 focus:outline-none"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs text-zinc-400">Max parallel sessions</label>
              <input
                type="number"
                value={draft.maxParallelSessions}
                onChange={(e) => updateField('maxParallelSessions', Number(e.target.value))}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-blue-500 focus:outline-none"
              />
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="space-y-2">
              <label className="text-xs text-zinc-400">Draft timeout (ms)</label>
              <input
                type="number"
                value={draft.draftTimeoutMs}
                onChange={(e) => updateField('draftTimeoutMs', Number(e.target.value))}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-blue-500 focus:outline-none"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs text-zinc-400">Download timeout (ms)</label>
              <input
                type="number"
                value={draft.downloadTimeoutMs}
                onChange={(e) => updateField('downloadTimeoutMs', Number(e.target.value))}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-blue-500 focus:outline-none"
              />
            </div>
          </div>
        </div>

        <div className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-900/70 p-4">
          <h4 className="text-sm font-semibold text-white">Cleanup</h4>
          <p className="text-xs text-zinc-400">Retention policy for downloads and temp files.</p>
          <label className="inline-flex items-center gap-2 text-xs text-zinc-200">
            <input
              type="checkbox"
              checked={draft.cleanup?.enabled ?? false}
              onChange={(e) => updateCleanup('enabled', e.target.checked)}
              className="h-4 w-4 rounded border-zinc-700 bg-zinc-950 text-blue-500 focus:ring-blue-500"
            />
            Enable scheduled cleanup
          </label>
          <label className="inline-flex items-center gap-2 text-xs text-zinc-200">
            <input
              type="checkbox"
              checked={draft.cleanup?.dryRun ?? false}
              onChange={(e) => updateCleanup('dryRun', e.target.checked)}
              className="h-4 w-4 rounded border-zinc-700 bg-zinc-950 text-blue-500 focus:ring-blue-500"
            />
            Dry run (log only)
          </label>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div className="space-y-2">
              <label className="text-xs text-zinc-400">Downloads retention (days)</label>
              <input
                type="number"
                value={draft.cleanup?.retentionDaysDownloads ?? ''}
                onChange={(e) => updateCleanup('retentionDaysDownloads', Number(e.target.value))}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-blue-500 focus:outline-none"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs text-zinc-400">Blurred retention (days)</label>
              <input
                type="number"
                value={draft.cleanup?.retentionDaysBlurred ?? ''}
                onChange={(e) => updateCleanup('retentionDaysBlurred', Number(e.target.value))}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-blue-500 focus:outline-none"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs text-zinc-400">Temp retention (days)</label>
              <input
                type="number"
                value={draft.cleanup?.retentionDaysTemp ?? ''}
                onChange={(e) => updateCleanup('retentionDaysTemp', Number(e.target.value))}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-blue-500 focus:outline-none"
              />
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <div className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-900/70 p-4">
          <h4 className="text-sm font-semibold text-white">Telegram</h4>
          <p className="text-xs text-zinc-400">Bot credentials and test trigger.</p>
          <label className="inline-flex items-center gap-2 text-xs text-zinc-200">
            <input
              type="checkbox"
              checked={draft.telegram?.enabled ?? false}
              onChange={(e) => updateTelegram('enabled', e.target.checked)}
              className="h-4 w-4 rounded border border-zinc-700 bg-zinc-950 text-blue-500 focus:ring-blue-500"
            />
            Enable Telegram notifications
          </label>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="space-y-2">
              <label className="text-xs text-zinc-400">bot_token</label>
              <input
                value={draft.telegram?.botToken ?? ''}
                onChange={(e) => updateTelegram('botToken', e.target.value)}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-blue-500 focus:outline-none"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs text-zinc-400">chat_id</label>
              <input
                value={draft.telegram?.chatId ?? ''}
                onChange={(e) => updateTelegram('chatId', e.target.value)}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-blue-500 focus:outline-none"
              />
            </div>
          </div>
          <div className="flex items-center gap-3 text-xs">
            <button
              onClick={sendTestMessage}
              className="rounded-lg border border-emerald-500/60 bg-emerald-500/10 px-3 py-2 font-semibold text-emerald-100 transition hover:bg-emerald-500/20"
            >
              Send test message
            </button>
            {testStatus && <span className="text-[11px] text-zinc-400">{testStatus}</span>}
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-4 shadow-inner">
        <div className="flex items-center justify-between">
          <div>
            <h4 className="text-sm font-semibold text-white">Chrome Profiles</h4>
            <p className="text-xs text-zinc-400">Scan and manage Chrome user-data directories.</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={scanProfiles}
              disabled={scanning}
              className="rounded-lg border border-blue-500/60 bg-blue-500/20 px-3 py-2 text-xs font-semibold text-blue-100 transition hover:bg-blue-500/30 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {scanning ? 'Scanning…' : 'Scan Chrome Profiles'}
            </button>
            <button
              onClick={startCreateProfile}
              className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-xs font-semibold text-zinc-200 transition hover:border-emerald-400/70 hover:text-emerald-200"
            >
              Add Custom
            </button>
          </div>
        </div>

        {scanError && (
          <div className="mt-3 rounded-lg border border-rose-500/60 bg-rose-500/10 px-3 py-2 text-xs text-rose-100">
            {scanError}
          </div>
        )}
        {!scanError && status && (
          <div className="mt-3 text-xs text-zinc-300">{status}</div>
        )}

        {editingProfile && (
          <div className="mt-3 rounded-lg border border-zinc-800 bg-zinc-950 p-4">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <div>
                <label className="text-xs text-zinc-400">Name</label>
                <input
                  value={editingProfile.name}
                  onChange={(e) => setEditingProfile({ ...editingProfile, name: e.target.value })}
                  className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 focus:border-blue-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="text-xs text-zinc-400">User Data Dir</label>
                <input
                  value={editingProfile.userDataDir}
                  onChange={(e) => setEditingProfile({ ...editingProfile, userDataDir: e.target.value })}
                  className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 focus:border-blue-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="text-xs text-zinc-400">Profile Dir</label>
                <input
                  value={editingProfile.profileDirectory ?? editingProfile.profileDir ?? ''}
                  onChange={(e) =>
                    setEditingProfile({
                      ...editingProfile,
                      profileDirectory: e.target.value,
                      profileDir: e.target.value,
                    })
                  }
                  className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 focus:border-blue-500 focus:outline-none"
                />
              </div>
            </div>
            <div className="mt-3 flex gap-2">
              <button
                onClick={() => editingProfile && saveProfile(editingProfile)}
                className="rounded-md bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-500"
              >
                Save Entry
              </button>
              <button
                onClick={() => setEditingProfile(null)}
                className="rounded-md border border-zinc-700 px-3 py-2 text-xs font-semibold text-zinc-200 hover:border-zinc-500"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {profiles.map((profile) => (
            <div key={profile.name} className="rounded-xl border border-zinc-700 bg-zinc-900 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-white">{profile.name}</p>
                  {profile.isActive && (
                    <span className="mt-1 inline-flex rounded-full bg-emerald-500/20 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-emerald-200">
                      Active
                    </span>
                  )}
                </div>
                <button
                  onClick={() => setActiveProfile(profile.name)}
                  className="rounded-md border border-blue-500/60 bg-blue-500/10 px-3 py-2 text-xs font-semibold text-blue-100 hover:bg-blue-500/20"
                >
                  Set Active Profile
                </button>
              </div>
              <div className="mt-3 space-y-1 text-xs text-zinc-400">
                <div>
                  <span className="font-semibold text-zinc-300">user-data-dir:</span>
                  <div className="truncate text-[11px] text-zinc-400">{profile.userDataDir}</div>
                </div>
                <div>
                  <span className="font-semibold text-zinc-300">profile-directory:</span>
                  <div className="truncate text-[11px] text-zinc-400">{profile.profileDirectory ?? profile.profileDir}</div>
                </div>
              </div>
              <div className="mt-4 flex gap-2 text-xs">
                <button
                  onClick={() => startEditProfile(profile)}
                  className="flex-1 rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 font-semibold text-zinc-200 transition hover:border-blue-500/60 hover:text-blue-100"
                >
                  Edit
                </button>
                <button
                  onClick={() => removeProfile(profile.name)}
                  className="flex-1 rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 font-semibold text-red-200 transition hover:border-red-500 hover:bg-red-500/10"
                >
                  Delete Entry
                </button>
              </div>
            </div>
          ))}

          {profiles.length === 0 && (
            <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4 text-sm text-zinc-400">
              No profiles stored yet. Scan to import existing Chrome profiles or add one manually.
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={save}
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-emerald-500"
        >
          Save Settings
        </button>
        {status && <div className="text-xs text-slate-400">{status}</div>}
      </div>
    </div>
  );
};

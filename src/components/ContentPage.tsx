import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { ChromeProfile, SessionFiles } from '../../shared/types';
import { Icons } from './Icons';

const lineCount = (value: string) =>
  value.length === 0 ? 0 : value.split(/\r?\n/).filter((line) => line.trim().length > 0).length;

const toArrays = (values: Record<'prompts' | 'images' | 'titles', string>): SessionFiles => ({
  prompts: values.prompts.length ? values.prompts.split(/\r?\n/).filter((line) => line.trim().length > 0) : [],
  imagePrompts: values.images.length ? values.images.split(/\r?\n/).filter((line) => line.trim().length > 0) : [],
  titles: values.titles.length ? values.titles.split(/\r?\n/).filter((line) => line.trim().length > 0) : []
});

const autoResize = (el: HTMLTextAreaElement) => {
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight}px`;
};

export const ContentPage: React.FC = () => {
  const [profiles, setProfiles] = useState<ChromeProfile[]>([]);
  const [selectedProfile, setSelectedProfile] = useState<string>('');
  const [values, setValues] = useState<Record<'prompts' | 'images' | 'titles', string>>({
    prompts: '',
    images: '',
    titles: ''
  });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const hasLoadedInitial = useRef(false);

  // Load profiles on mount
  useEffect(() => {
    const loadProfiles = async () => {
      try {
        const api = (window as any).electronAPI;
        const result = await api?.chrome?.listProfiles?.();
        if (result?.profiles) {
          setProfiles(result.profiles);
          const config = await api.config.get();
          setSelectedProfile(config?.chromeActiveProfileName || result.profiles[0]?.name || '');
        } else if (Array.isArray(result)) {
          setProfiles(result);
          if (result.length > 0) setSelectedProfile(result[0].name);
        }
      } catch (err) {
        setError((err as Error).message);
      }
    };
    loadProfiles();
  }, []);

  // Load content when profile changes
  useEffect(() => {
    const fetchFiles = async () => {
      if (!selectedProfile) return;
      setLoading(true);
      setError(null);
      setStatus(null);
      try {
        const api = (window as any).electronAPI;
        const response = await api?.files?.read(selectedProfile);
        if (!response?.ok) throw new Error(response?.error);

        const files = response.files as SessionFiles;
        setValues({
          prompts: files.prompts.join('\n'),
          images: files.imagePrompts.join('\n'),
          titles: files.titles.join('\n')
        });
        setDirty(false);
        hasLoadedInitial.current = true;
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    };
    fetchFiles();
  }, [selectedProfile]);

  const counts = useMemo(() => ({
    prompts: lineCount(values.prompts),
    images: lineCount(values.images),
    titles: lineCount(values.titles)
  }), [values]);

  const handleSave = async () => {
    if (!selectedProfile) return;
    setSaving(true);
    try {
      const payload = toArrays(values);
      const res = await window.electronAPI.files.save(selectedProfile, payload);
      if (!res.ok) throw new Error(res.error);
      setDirty(false);
      setStatus('All files saved successfully');
      setTimeout(() => setStatus(null), 3000);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const renderEditor = (key: keyof typeof values, label: string, desc: string) => (
    <div className="card flex flex-col h-[600px]">
      <div className="p-3 border-b border-zinc-800 bg-zinc-900/30 flex justify-between items-center">
        <div>
          <div className="text-xs font-bold uppercase text-zinc-500 tracking-wider">{label}</div>
          <div className="text-[10px] text-zinc-600">{desc}</div>
        </div>
        <span className="text-xs font-mono text-zinc-400 bg-zinc-800 px-2 py-0.5 rounded">
          {counts[key]} lines
        </span>
      </div>
      <textarea
        className="flex-1 w-full bg-transparent p-3 font-mono text-sm text-zinc-300 resize-none focus:outline-none scrollbar-thin"
        value={values[key]}
        onChange={e => {
          setValues(prev => ({ ...prev, [key]: e.target.value }));
          setDirty(true);
        }}
        placeholder={`Enter ${label.toLowerCase()} here...`}
        spellCheck={false}
      />
    </div>
  );

  return (
    <div className="h-full flex flex-col gap-4">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            <Icons.Content className="w-5 h-5 text-blue-400" />
            Content Manager
          </h2>
          <p className="text-sm text-zinc-400">Edit source files for the selected profile.</p>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 bg-zinc-900 p-1 rounded-lg border border-zinc-800">
            <span className="text-xs text-zinc-500 pl-2">Profile:</span>
            <select
              className="bg-transparent text-sm text-white focus:outline-none py-1 pr-8"
              value={selectedProfile}
              onChange={e => setSelectedProfile(e.target.value)}
            >
              {profiles.map(p => <option key={p.id} value={p.name}>{p.name}</option>)}
            </select>
          </div>

          <button
            onClick={handleSave}
            disabled={!dirty || saving}
            className="btn-primary"
          >
            {saving ? <Icons.Refresh className="w-4 h-4 animate-spin mr-2" /> : <Icons.Check className="w-4 h-4 mr-2" />}
            {saving ? 'Saving...' : 'Save All'}
          </button>

          <button
            onClick={() => window.electronAPI.files.openFolder(selectedProfile)}
            className="btn-secondary"
            title="Open Folder"
          >
            <Icons.Folder className="w-4 h-4" />
          </button>
        </div>
      </div>

      {error && <div className="bg-rose-950/30 border border-rose-900/50 text-rose-200 px-4 py-2 rounded-lg text-sm">{error}</div>}
      {status && <div className="bg-emerald-950/30 border border-emerald-900/50 text-emerald-200 px-4 py-2 rounded-lg text-sm">{status}</div>}

      {loading ? (
        <div className="flex-1 flex items-center justify-center text-zinc-500">Loading files...</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 flex-1 min-h-0">
          {renderEditor('prompts', 'Prompts', 'Main prompt text')}
          {renderEditor('images', 'Image Paths', 'Local paths or URLs')}
          {renderEditor('titles', 'Titles', 'Output filenames')}
        </div>
      )}
    </div>
  );
};
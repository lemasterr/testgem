import React, { useEffect, useMemo, useState } from 'react';
import { buildDynamicWorkflow, type WorkflowClientStep, type WorkflowProgress, type PipelineMode } from '../../shared/types';
import { useAppStore } from '@/store'; // Use alias '@' which resolves to src

const STATUS_COLORS: Record<string, string> = {
  idle: 'bg-zinc-700',
  running: 'bg-blue-500',
  success: 'bg-emerald-500',
  error: 'bg-red-500',
  skipped: 'bg-amber-500',
};

interface SavedPreset {
  name: string;
  mode: PipelineMode;
  steps: WorkflowClientStep[];
  selectedSessionIds: string[];
}

export const AutomatorPage: React.FC = () => {
  const { sessions, refreshSessions, automator, setAutomatorState } = useAppStore();

  // Local UI state
  const [logs, setLogs] = useState<WorkflowProgress[]>([]);
  const [status, setStatus] = useState<'idle' | 'running' | 'success' | 'error'>('idle');
  const [warning, setWarning] = useState<string>('');
  const [stepStatuses, setStepStatuses] = useState<Record<string, WorkflowProgress>>({});
  const [sessionStatuses, setSessionStatuses] = useState<
    Record<string, { status: WorkflowProgress['status']; downloaded?: number; message?: string }>
  >({});
  const [draggingId, setDraggingId] = useState<string | null>(null);

  // Presets state
  const [presetName, setPresetName] = useState('');
  const [savedPresets, setSavedPresets] = useState<SavedPreset[]>([]);

  const LOG_LIMIT = 200;
  const workflowStatusColor = STATUS_COLORS[status] ?? STATUS_COLORS.idle;

  // Load presets from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem('sora_automator_presets');
    if (stored) {
      try {
        setSavedPresets(JSON.parse(stored));
      } catch { /* ignore */ }
    }
    refreshSessions().catch(() => setWarning('Unable to refresh sessions list.'));
  }, [refreshSessions]);

  // Auto-init if empty (first run)
  useEffect(() => {
    if (sessions.length > 0 && automator.selectedSessionIds.length === 0 && automator.steps.length === 0) {
      // Select all by default
      const allIds = sessions.map(s => s.id);
      const defaultSteps = buildDynamicWorkflow(sessions, allIds, automator.mode);
      setAutomatorState({ selectedSessionIds: allIds, steps: defaultSteps });
    }
  }, [sessions]); // Only run when sessions load

  // Subscribe to progress
  useEffect(() => {
    if (!window.electronAPI?.pipeline?.onProgress) {
      setWarning('Workflow IPC is unavailable in this build.');
      return;
    }
    const unsubscribe = window.electronAPI.pipeline.onProgress((progress: WorkflowProgress) => {
      const event = progress;
      setLogs((prev) => [event, ...prev].slice(0, LOG_LIMIT));

      if (event.stepId === 'workflow') {
        if (event.status === 'running') setStatus('running');
        if (event.status === 'success') setStatus('success');
        if (event.status === 'error') setStatus('error');
      } else {
        setStepStatuses((prev) => ({ ...prev, [event.stepId]: event }));
        if (event.sessionId) {
          setSessionStatuses((prev) => ({
            ...prev,
            [event.sessionId!]: {
              status: event.status,
              downloaded: event.downloadedCount ?? prev[event.sessionId!]?.downloaded,
              message: event.status === 'error' ? event.message : prev[event.sessionId!]?.message ?? event.message,
            },
          }));
        }
      }
    });

    return () => unsubscribe?.();
  }, []);

  // Actions
  const updateSteps = (newSteps: WorkflowClientStep[]) => {
    setAutomatorState({ steps: newSteps });
  };

  const toggleStep = (id: WorkflowClientStep['id']) => {
    updateSteps(automator.steps.map((step) => (step.id === id ? { ...step, enabled: !step.enabled } : step)));
  };

  const removeStep = (id: WorkflowClientStep['id']) => {
    updateSteps(automator.steps.filter((step) => step.id !== id));
  };

  const regenerateSteps = () => {
    const newSteps = buildDynamicWorkflow(sessions, automator.selectedSessionIds, automator.mode);
    setAutomatorState({ steps: newSteps });
  };

  const startWorkflow = async () => {
    if (!window.electronAPI?.pipeline?.run) {
      setWarning('Workflow run API not available.');
      return;
    }
    setStatus('running');
    setStepStatuses({});
    setLogs([]);
    await window.electronAPI.pipeline.run(automator.steps);
  };

  const stopWorkflow = async () => {
    if (!window.electronAPI?.pipeline?.cancel) return;
    await window.electronAPI.pipeline.cancel();
    setStatus('idle');
  };

  const sessionNamesById = useMemo(
    () => Object.fromEntries(sessions.map((s) => [s.id, s.name])),
    [sessions]
  );

  const handleDragStart = (id: string) => setDraggingId(id);
  const handleDrop = (targetId: string) => {
    if (!draggingId || draggingId === targetId) return;
    const current = [...automator.steps];
    const fromIndex = current.findIndex((step) => step.id === draggingId);
    const toIndex = current.findIndex((step) => step.id === targetId);
    if (fromIndex === -1 || toIndex === -1) return;
    const [moved] = current.splice(fromIndex, 1);
    current.splice(toIndex, 0, moved);
    updateSteps(current);
    setDraggingId(null);
  };

  const toggleSessionSelection = (sessionId: string) => {
    const prev = automator.selectedSessionIds;
    const next = prev.includes(sessionId) ? prev.filter((id) => id !== sessionId) : [...prev, sessionId];
    setAutomatorState({ selectedSessionIds: next });
  };

  // Preset Management
  const savePreset = () => {
    if (!presetName.trim()) return;
    const newPreset: SavedPreset = {
      name: presetName,
      mode: automator.mode,
      steps: automator.steps,
      selectedSessionIds: automator.selectedSessionIds
    };
    const nextPresets = [...savedPresets.filter(p => p.name !== presetName), newPreset];
    setSavedPresets(nextPresets);
    localStorage.setItem('sora_automator_presets', JSON.stringify(nextPresets));
    setPresetName('');
  };

  const loadPreset = (preset: SavedPreset) => {
    setAutomatorState({
      mode: preset.mode,
      steps: preset.steps,
      selectedSessionIds: preset.selectedSessionIds
    });
  };

  const deletePreset = (name: string) => {
    const next = savedPresets.filter(p => p.name !== name);
    setSavedPresets(next);
    localStorage.setItem('sora_automator_presets', JSON.stringify(next));
  };

  // Stats
  const enabledSteps = useMemo(() => automator.steps.filter((step) => step.enabled), [automator.steps]);
  const overallProgress = useMemo(() => {
    if (enabledSteps.length === 0) return 0;
    const score = enabledSteps.reduce((acc, step) => {
      const stepStatus = stepStatuses[step.id]?.status;
      if (stepStatus === 'success' || stepStatus === 'skipped' || stepStatus === 'error') return acc + 1;
      if (stepStatus === 'running') return acc + 0.5;
      return acc;
    }, 0);
    return Math.min(100, Math.round((score / enabledSteps.length) * 100));
  }, [enabledSteps, stepStatuses]);

  const sessionLimits = useMemo(
    () => Object.fromEntries(sessions.map((session) => [session.id, session.maxVideos ?? 0])),
    [sessions]
  );

  const formatTimestamp = (timestamp: number) => new Date(timestamp).toLocaleTimeString();
  const clearLogs = () => setLogs([]);

  return (
    <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
      {/* Main Column */}
      <div className="space-y-4">

        {/* Header & Controls */}
        <div className="flex flex-col gap-3 rounded-xl border border-zinc-800 bg-zinc-900/80 p-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold text-white">Workflow Runner</h3>
              <p className="text-sm text-zinc-400">Build and execute automation pipelines.</p>
            </div>
            <div className="flex items-center gap-2 text-xs text-zinc-300">
              <span className={`h-2 w-2 rounded-full ${workflowStatusColor}`} />
              <span className="capitalize">{status}</span>
            </div>
          </div>

          <div className="flex items-center gap-1 rounded-lg border border-zinc-700 bg-zinc-950/50 p-1">
            <button
              onClick={() => setAutomatorState({ mode: 'parallel-prompts' })}
              className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition ${
                automator.mode === 'parallel-prompts' ? 'bg-emerald-600/20 text-emerald-100 shadow-sm border border-emerald-500/30' : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              Parallel Prompts
            </button>
            <button
              onClick={() => setAutomatorState({ mode: 'sequential-session' })}
              className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition ${
                automator.mode === 'sequential-session' ? 'bg-blue-600/20 text-blue-100 shadow-sm border border-blue-500/30' : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              Sequential
            </button>
            <button
              onClick={() => setAutomatorState({ mode: 'parallel-phases' })}
              className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition ${
                automator.mode === 'parallel-phases' ? 'bg-zinc-800 text-white shadow-sm' : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              Phase Mode
            </button>
          </div>

          <div className="flex flex-wrap gap-2 border-t border-zinc-800 pt-3">
            <button
              onClick={regenerateSteps}
              className="rounded-lg border border-zinc-600 bg-zinc-800 px-3 py-2 text-xs font-semibold text-zinc-200 hover:bg-zinc-700 hover:text-white"
            >
              🔄 Regenerate Steps from Selection
            </button>
            <div className="flex-1" />
            <button
              onClick={stopWorkflow}
              className="rounded-lg border border-red-600/50 bg-red-900/10 px-4 py-2 text-xs font-semibold text-red-200 hover:bg-red-900/30"
            >
              Stop
            </button>
            <button
              onClick={startWorkflow}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white shadow hover:bg-emerald-500"
            >
              ▶ Start Workflow
            </button>
          </div>
        </div>

        {/* Presets Section */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-3">
          <div className="flex items-center gap-2">
            <input
              value={presetName}
              onChange={(e) => setPresetName(e.target.value)}
              placeholder="Preset name..."
              className="h-8 flex-1 rounded border border-zinc-700 bg-zinc-950 px-2 text-xs text-white focus:border-blue-500 focus:outline-none"
            />
            <button onClick={savePreset} disabled={!presetName} className="h-8 rounded border border-blue-500/50 bg-blue-500/10 px-3 text-xs text-blue-200 hover:bg-blue-500/20 disabled:opacity-50">
              Save Preset
            </button>
          </div>
          {savedPresets.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {savedPresets.map(preset => (
                <div key={preset.name} className="flex items-center gap-1 rounded bg-zinc-800 pl-2 pr-1 py-1 text-xs">
                  <span className="cursor-pointer hover:text-blue-300" onClick={() => loadPreset(preset)}>{preset.name}</span>
                  <button onClick={() => deletePreset(preset.name)} className="ml-1 rounded p-0.5 text-zinc-500 hover:bg-zinc-700 hover:text-red-300">×</button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Step List */}
        <div className="space-y-3">
          {automator.steps.map((step, index) => {
            const event = stepStatuses[step.id];
            const stepStatus = event?.status ?? 'idle';
            const color = STATUS_COLORS[stepStatus] ?? STATUS_COLORS.idle;
            return (
              <div
                key={step.id}
                draggable
                onDragStart={() => handleDragStart(step.id as string)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => handleDrop(step.id as string)}
                className={`group relative rounded-xl border border-zinc-800 bg-zinc-900 p-3 transition-all ${draggingId === step.id ? 'border-blue-500/70 bg-zinc-900/70' : 'hover:border-zinc-700'}`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-6 w-6 items-center justify-center rounded bg-zinc-800 text-[10px] font-mono text-zinc-400">
                      {index + 1}
                    </div>
                    <div className="space-y-0.5">
                      <div className="text-sm font-medium text-white">{step.label}</div>
                      {step.dependsOn && step.dependsOn.length > 0 && (
                        <div className="text-[10px] text-zinc-500">Wait for: {step.dependsOn.length} steps</div>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-2 text-[10px] text-zinc-400">
                      <span className="cursor-move p-1 hover:text-white" title="Drag to reorder">☰</span>
                    </div>

                    <label className="flex items-center gap-2 rounded bg-zinc-950/50 px-2 py-1 text-[10px] text-zinc-300 cursor-pointer hover:bg-zinc-950">
                      <input
                        type="checkbox"
                        checked={step.enabled}
                        onChange={() => toggleStep(step.id)}
                        className="h-3 w-3 accent-emerald-500"
                      />
                      Enable
                    </label>

                    <span className={`h-2 w-2 rounded-full ${color}`} title={stepStatus} />

                    <button
                      onClick={() => removeStep(step.id)}
                      className="ml-2 hidden rounded p-1 text-zinc-500 hover:bg-rose-500/10 hover:text-rose-400 group-hover:block"
                      title="Remove Step"
                    >
                      ✕
                    </button>
                  </div>
                </div>
                {event?.message && (
                  <div className="mt-2 border-t border-white/5 pt-2 text-[11px] text-zinc-400 font-mono">
                    Last log: <span className="text-zinc-200">{event.message}</span>
                  </div>
                )}
              </div>
            );
          })}

          {automator.steps.length === 0 && (
            <div className="flex h-32 flex-col items-center justify-center rounded-xl border border-dashed border-zinc-800 bg-zinc-900/30 text-zinc-500">
              <p className="text-sm">No steps configured</p>
              <button onClick={regenerateSteps} className="mt-2 text-xs text-blue-400 hover:underline">
                Generate from selected sessions
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Sidebar: Status & Logs */}
      <div className="space-y-4">
        {/* Session Selection Panel */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/80 p-4">
          <h4 className="mb-3 text-xs font-bold uppercase tracking-wider text-zinc-500">Target Sessions</h4>
          <div className="flex flex-col gap-2 max-h-60 overflow-y-auto pr-1">
            {sessions.map((session) => (
              <label key={session.id} className="flex cursor-pointer items-center gap-2 rounded-lg border border-transparent bg-zinc-950/30 p-2 text-xs transition hover:border-zinc-700 hover:bg-zinc-950">
                <input
                  type="checkbox"
                  checked={automator.selectedSessionIds.includes(session.id)}
                  onChange={() => toggleSessionSelection(session.id)}
                  className="h-3.5 w-3.5 accent-blue-500 rounded"
                />
                <div className="flex-1 truncate">
                  <div className="font-medium text-zinc-200">{session.name}</div>
                  <div className="text-[10px] text-zinc-500">{session.chromeProfileName ?? 'No profile'}</div>
                </div>
              </label>
            ))}
          </div>
        </div>

        {/* Progress Card */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/80 p-4">
          <div className="mb-2 flex justify-between text-xs">
            <span className="text-zinc-400">Total Progress</span>
            <span className="font-mono text-white">{overallProgress}%</span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-zinc-950">
            <div className="h-1.5 rounded-full bg-blue-500 transition-all duration-300" style={{ width: `${overallProgress}%` }} />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
             <div className="rounded bg-zinc-950/50 p-2 text-center">
                <div className="text-lg font-bold text-white">{enabledSteps.length}</div>
                <div className="text-[10px] text-zinc-500">Steps</div>
             </div>
             <div className="rounded bg-zinc-950/50 p-2 text-center">
                <div className="text-lg font-bold text-emerald-400">{
                  enabledSteps.filter((s) => ['success', 'skipped'].includes(stepStatuses[s.id]?.status ?? '')).length
                }</div>
                <div className="text-[10px] text-zinc-500">Completed</div>
             </div>
          </div>
        </div>

        {/* Logs */}
        <div className="flex flex-col rounded-xl border border-zinc-800 bg-zinc-900/80 h-[400px]">
          <div className="flex items-center justify-between border-b border-zinc-800 p-3">
            <span className="text-xs font-bold uppercase tracking-wider text-zinc-500">Live Logs</span>
            <button onClick={clearLogs} className="text-[10px] text-zinc-400 hover:text-white">Clear</button>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
            {logs.map((log, idx) => (
              <div key={`${log.stepId}-${idx}`} className="rounded border border-white/5 bg-white/5 p-2 text-[10px]">
                <div className="flex justify-between text-zinc-500 mb-0.5">
                  <span>{formatTimestamp(log.timestamp)}</span>
                  <span className={
                    log.status === 'error' ? 'text-red-400' :
                    log.status === 'success' ? 'text-emerald-400' : 'text-blue-400'
                  }>{log.status}</span>
                </div>
                <div className="text-zinc-300 leading-tight">{log.message}</div>
              </div>
            ))}
            {logs.length === 0 && <div className="p-4 text-center text-xs text-zinc-600">Waiting for activity...</div>}
          </div>
        </div>
      </div>
    </div>
  );
};
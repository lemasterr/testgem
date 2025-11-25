import React, { useEffect, useState } from 'react';
import { useAppStore } from '../store';
import { buildDynamicWorkflow, type WorkflowClientStep } from '../../shared/types';
import { Icons } from './Icons';

export const AutomatorPage: React.FC = () => {
  const { sessions, automator, setAutomatorState, config } = useAppStore();
  const [status, setStatus] = useState('idle');
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  // Update steps if empty
  useEffect(() => {
    if (automator.steps.length === 0 && sessions.length > 0) {
      regenerate(true);
    }
  }, [sessions.length]);

  const regenerate = (useAllIfEmpty = false) => {
    let targetIds = automator.selectedSessionIds;
    if (useAllIfEmpty && targetIds.length === 0) {
        targetIds = sessions.map(s => s.id);
        setAutomatorState({ selectedSessionIds: targetIds });
    }
    const steps = buildDynamicWorkflow(sessions, targetIds, automator.mode);
    updateSteps(steps);
  };

  const run = async () => {
    setStatus('running');
    try { await window.electronAPI.pipeline.run(automator.steps); }
    catch (e) { console.error(e); }
  };

  const stop = async () => {
    await window.electronAPI.pipeline.cancel();
    setStatus('idle');
  };

  const updateSteps = (newSteps: WorkflowClientStep[]) => setAutomatorState({ steps: newSteps });
  const removeStep = (index: number) => { const n = [...automator.steps]; n.splice(index, 1); updateSteps(n); };
  const clearSteps = () => updateSteps([]);

  const addStep = (label: string, idPrefix: string, sessionId?: string) => {
    const newStep: WorkflowClientStep = {
        id: `${idPrefix}_${Date.now()}` as any,
        label: sessionId ? `${label} (${sessions.find(s => s.id === sessionId)?.name})` : label,
        enabled: true,
        sessionId,
        dependsOn: []
    };
    updateSteps([...automator.steps, newStep]);
  };

  const handleDrop = (index: number) => {
    if (draggingId === null || parseInt(draggingId) === index) return;
    const newSteps = [...automator.steps];
    const item = newSteps.splice(parseInt(draggingId), 1)[0];
    newSteps.splice(index, 0, item);
    updateSteps(newSteps);
    setDraggingId(null);
    setDragOverIndex(null);
  };

  const activeMaskName = config?.watermarkMasks?.find(m => m.id === config.activeWatermarkMaskId)?.name || 'None';

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-[calc(100vh-8rem)]">
      <div className="lg:col-span-2 flex flex-col gap-4 min-h-0">
        <div className="p-4 rounded-2xl bg-gradient-to-r from-zinc-900 to-black border border-zinc-800 shadow-lg flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="p-2.5 bg-indigo-500/10 rounded-xl text-indigo-400"><Icons.Automator className="w-6 h-6" /></div>
            <div>
              <h3 className="text-sm font-bold text-white tracking-wide uppercase">Workflow Builder</h3>
              <p className="text-xs text-zinc-500">Using Blur Preset: <span className="text-indigo-400">{activeMaskName}</span></p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex bg-zinc-900 p-1 rounded-lg border border-zinc-800">
              <button onClick={clearSteps} className="px-3 py-1.5 text-xs font-medium text-zinc-400 hover:text-white hover:bg-zinc-800 rounded transition-colors">Clear</button>
              <div className="w-px bg-zinc-800 mx-1" />
              <button onClick={() => regenerate()} className="px-3 py-1.5 text-xs font-medium text-blue-400 hover:text-blue-300 hover:bg-blue-500/10 rounded transition-colors flex items-center gap-2">
                <Icons.Refresh className="w-3 h-3" /> Generate
              </button>
            </div>
            <button onClick={run} disabled={status === 'running'} className="btn-primary pl-3 pr-4 py-2">
              {status === 'running' ? <Icons.Refresh className="w-4 h-4 mr-2 animate-spin" /> : <Icons.Play className="w-4 h-4 mr-2 fill-current" />} Run
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto pr-2 space-y-2 scrollbar-thin">
          {automator.steps.length === 0 && (
            <div className="h-full flex flex-col items-center justify-center border-2 border-dashed border-zinc-800 rounded-2xl bg-zinc-900/20 text-zinc-500 gap-4">
              <Icons.Code className="w-8 h-8 opacity-30" />
              <p className="text-sm">Workflow is empty</p>
              <button onClick={() => regenerate(true)} className="btn-secondary">Generate Default</button>
            </div>
          )}
          {automator.steps.map((step, index) => (
            <div key={step.id} draggable onDragStart={() => setDraggingId(String(index))} onDragOver={(e) => { e.preventDefault(); setDragOverIndex(index); }} onDrop={() => handleDrop(index)}
                 className={`group relative flex items-center gap-4 p-3 rounded-xl border transition-all duration-200 select-none ${draggingId === String(index) ? 'opacity-40 border-indigo-500' : 'border-zinc-800/60 bg-[#0c0c0e]'}`}>
              <div className="cursor-grab text-zinc-600 hover:text-zinc-400 p-1"><Icons.Grip className="w-4 h-4" /></div>
              <div className="flex h-6 w-6 items-center justify-center rounded-md bg-zinc-900 text-[10px] font-mono text-zinc-500 border border-zinc-800">{index + 1}</div>
              <div className="flex-1 min-w-0"><div className="text-sm font-medium text-zinc-200 truncate">{step.label}</div></div>
              <input type="checkbox" checked={step.enabled} onChange={() => { const n = [...automator.steps]; n[index].enabled = !n[index].enabled; updateSteps(n); }} className="accent-indigo-500"/>
              <button onClick={() => removeStep(index)} className="p-1.5 text-zinc-500 hover:text-rose-400"><Icons.Trash className="w-4 h-4" /></button>
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-4 min-h-0">
        <div className="card p-4 bg-zinc-900/30 flex flex-col gap-2">
            <h4 className="text-xs font-bold text-zinc-500 uppercase">Strategy</h4>
            <select className="select-field bg-zinc-950" value={automator.mode} onChange={(e) => setAutomatorState({ mode: e.target.value as any })}>
                <option value="parallel-phases">Parallel Phases</option>
                <option value="sequential-session">Sequential Session</option>
            </select>
            <div className="flex-1 overflow-y-auto mt-2 space-y-1 max-h-32">
                {sessions.map(s => (
                    <label key={s.id} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-zinc-800 cursor-pointer">
                        <input type="checkbox" checked={automator.selectedSessionIds.includes(s.id)} onChange={() => {
                            const ids = automator.selectedSessionIds.includes(s.id) ? automator.selectedSessionIds.filter(i => i !== s.id) : [...automator.selectedSessionIds, s.id];
                            setAutomatorState({ selectedSessionIds: ids });
                        }} className="accent-indigo-500"/>
                        <span className="text-xs text-zinc-300 truncate">{s.name}</span>
                    </label>
                ))}
            </div>
        </div>

        <div className="card p-4 flex-1 flex flex-col min-h-0 bg-zinc-900/30">
            <h4 className="text-xs font-bold text-zinc-500 uppercase mb-3">Toolbox</h4>
            <div className="space-y-4 overflow-y-auto pr-1">
                <div className="space-y-1">
                    <button onClick={() => addStep('Open All', 'openSessions')} className="w-full text-left btn-secondary text-xs justify-start py-1.5">Open All</button>
                    <button onClick={() => addStep('Blur All', 'blurVideos')} className="w-full text-left btn-secondary text-xs justify-start py-1.5">Blur All</button>
                    <button onClick={() => addStep('Merge All', 'mergeVideos')} className="w-full text-left btn-secondary text-xs justify-start py-1.5">Merge All</button>
                </div>
                <div className="space-y-2">
                    <div className="text-[10px] font-bold text-zinc-600">SESSIONS</div>
                    {sessions.map(s => (
                        <div key={s.id} className="p-2 bg-black/20 rounded border border-zinc-800/50">
                            <div className="text-[10px] text-zinc-400 mb-1 truncate">{s.name}</div>
                            <div className="grid grid-cols-3 gap-1">
                                {['Prompts', 'Download', 'Process'].map(action => (
                                    <button key={action} onClick={() => addStep(action, `${action.toLowerCase()}Session`, s.id)} className="text-[9px] bg-zinc-800 hover:bg-zinc-700 rounded py-1">{action}</button>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
      </div>
    </div>
  );
};
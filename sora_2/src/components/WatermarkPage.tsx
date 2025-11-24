import React, { useEffect, useState } from 'react';
import {
  type DownloadedVideo,
  type WatermarkDetectionResult,
  type WatermarkMask,
  type WatermarkRect,
  type WatermarkCleanResult
} from '../../shared/types';
import { useAppStore } from '../store';

interface FrameCardProps {
  frame: WatermarkDetectionResult['frames'][number];
  onAddRect: (rect: WatermarkRect) => void;
  highlightRects: WatermarkRect[];
}

const FrameCard: React.FC<FrameCardProps> = ({ frame, onAddRect, highlightRects }) => {
  const handleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const relX = ((event.clientX - bounds.left) / bounds.width) * frame.width;
    const relY = ((event.clientY - bounds.top) / bounds.height) * frame.height;
    const rect: WatermarkRect = {
      x: Math.max(0, relX - 60),
      y: Math.max(0, relY - 40),
      width: 120,
      height: 80,
      label: `Zone ${highlightRects.length + 1}`
    };
    onAddRect(rect);
  };

  const renderRect = (rect: WatermarkRect, index: number) => {
    const left = (rect.x / frame.width) * 100;
    const top = (rect.y / frame.height) * 100;
    const width = (rect.width / frame.width) * 100;
    const height = (rect.height / frame.height) * 100;

    return (
      <div
        key={`${rect.label}-${index}`}
        className="absolute rounded border-2 border-blue-500/80 bg-blue-500/15 shadow-lg"
        style={{ left: `${left}%`, top: `${top}%`, width: `${width}%`, height: `${height}%` }}
      >
        <span className="absolute -top-5 left-0 rounded bg-blue-500 px-1 text-[10px] font-semibold text-white shadow">
          {rect.label ?? `Rect ${index + 1}`}
        </span>
      </div>
    );
  };

  return (
    <div className="relative overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950/60 shadow-md">
      <div className="cursor-crosshair" onClick={handleClick}>
        <img src={frame.path} alt="frame" className="w-full" />
        <div className="pointer-events-none absolute inset-0">
          {highlightRects.map(renderRect)}
        </div>
      </div>
    </div>
  );
};

export const WatermarkPage: React.FC = () => {
  const { sessions } = useAppStore();
  const [videos, setVideos] = useState<DownloadedVideo[]>([]);
  const [selected, setSelected] = useState<string>('');
  const [templatePath, setTemplatePath] = useState<string>('');
  const [detection, setDetection] = useState<WatermarkDetectionResult | null>(null);
  const [masks, setMasks] = useState<WatermarkMask[]>([]);
  const [maskName, setMaskName] = useState<string>('');
  const [activeMaskId, setActiveMaskId] = useState<string>('');
  const [rects, setRects] = useState<WatermarkRect[]>([]);
  const [status, setStatus] = useState<string>('');
  const [cleanResult, setCleanResult] = useState<WatermarkCleanResult | null>(null);
  const [busy, setBusy] = useState<boolean>(false);

  const loadVideos = async () => {
    const list = await window.electronAPI.listDownloadedVideos();
    setVideos(list);
    if (list.length > 0) {
      setSelected((current) => current || list[0].path);
    }
  };

  const loadMasks = async () => {
    const saved = await window.electronAPI.watermark.listMasks();
    setMasks(saved);
    if (saved.length > 0) {
      setActiveMaskId((current) => current || saved[0].id);
      setMaskName((current) => current || saved[0].name);
      setRects(saved[0].rects);
    }
  };

  useEffect(() => {
    loadVideos();
    loadMasks();
  }, []);

  useEffect(() => {
    const mask = masks.find((m) => m.id === activeMaskId);
    if (mask) {
      setMaskName(mask.name);
      setRects(mask.rects);
    }
  }, [activeMaskId, masks]);

  const handleDetect = async () => {
    if (!selected) return;
    setBusy(true);
    setStatus('Detecting watermark zones…');
    setCleanResult(null);
    try {
      const result = await window.electronAPI.watermark.detect(selected, templatePath || undefined);
      setDetection(result);
      if (result.suggestedMask) {
        setMaskName(result.suggestedMask.name);
        setRects(result.suggestedMask.rects);
      }
      setStatus('Detection complete');
    } catch (error) {
      setStatus((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleTemplateChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file?.path) {
      setTemplatePath(file.path);
    }
  };

  const handleSaveMask = async () => {
    if (rects.length === 0) {
      setStatus('Add at least one blur zone before saving');
      return;
    }
    const payload: WatermarkMask = {
      id: activeMaskId,
      name: maskName || 'Custom Mask',
      rects,
    };
    const saved = (await window.electronAPI.watermark.saveMask(payload)) as any[];
    setMasks(saved);
    const match = saved.find((m: any) => m.name === payload.name || m.id === payload.id);
    if (match) {
      setActiveMaskId(match.id);
      setStatus(`Saved mask "${match.name}"`);
    }
  };

  const handleClean = async () => {
    if (!selected) return;
    setBusy(true);
    setStatus('Cleaning videos…');
    try {
      const toClean = videos.map((v) => v.path);
      const result = await window.electronAPI.watermark.clean(toClean, activeMaskId || undefined);
      setCleanResult(result);
      if (!result.ok) {
        setStatus(result.error ?? 'Cleaner failed');
      } else {
        const cleaned = result.items.filter((i: any) => i.status === 'cleaned').length;
        setStatus(`Cleaner finished (${cleaned}/${result.items.length} cleaned)`);
      }
    } catch (error) {
      setStatus((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const addRect = (rect: WatermarkRect) => {
    setRects((prev) => [...prev, rect]);
  };

  const updateRect = (index: number, changes: Partial<WatermarkRect>) => {
    setRects((prev) => prev.map((r, i) => (i === index ? { ...r, ...changes } : r)));
  };

  const removeRect = (index: number) => {
    setRects((prev) => prev.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <h3 className="text-xl font-semibold text-white">Watermark Tools</h3>
          <p className="text-sm text-zinc-400">
            Detect watermark zones, define blur masks, and run the cleaner on downloaded videos.
          </p>
        </div>
        <div className="text-sm text-zinc-400">
          {status || 'Ready'}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="xl:col-span-2 space-y-4">
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-4 shadow-lg">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="text-xs uppercase tracking-wide text-zinc-400">Video</label>
                <select
                  value={selected}
                  onChange={(e) => setSelected(e.target.value)}
                  className="mt-2 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-blue-500 focus:outline-none"
                >
                  {videos.length === 0 && <option value="">No downloads found</option>}
                  {videos.map((v) => (
                    <option key={v.path} value={v.path}>
                      {v.sessionName ? `[${v.sessionName}] ` : ''}
                      {v.fileName}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs uppercase tracking-wide text-zinc-400">Template (optional)</label>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleTemplateChange}
                  className="mt-2 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 file:mr-3 file:rounded-md file:border-0 file:bg-blue-600 file:px-3 file:py-2 file:text-xs file:font-semibold file:text-white"
                />
                {templatePath && <div className="mt-1 text-[11px] text-zinc-500">{templatePath}</div>}
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-3">
              <button
                onClick={handleDetect}
                disabled={!selected || busy}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-blue-500 disabled:opacity-60"
              >
                Scan & Detect
              </button>
              <button
                onClick={loadVideos}
                className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-200 hover:border-emerald-500"
              >
                Refresh Downloads
              </button>
            </div>
          </div>

          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4 shadow-lg">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold text-white">Frames Preview</h4>
              <span className="text-xs text-zinc-500">Click a frame to add a blur zone</span>
            </div>
            {detection?.frames && detection.frames.length > 0 ? (
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                {detection.frames.map((frame: any) => (
                  <FrameCard key={frame.path} frame={frame} onAddRect={addRect} highlightRects={rects} />
                ))}
              </div>
            ) : (
              <div className="mt-3 rounded-lg border border-dashed border-zinc-700 bg-zinc-950/50 p-6 text-center text-sm text-zinc-500">
                No frames yet. Run detection to see overlays.
              </div>
            )}
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-4 shadow-lg">
            <h4 className="text-sm font-semibold text-white">Blur Mask Editor</h4>
            <div className="mt-3 space-y-2">
              <label className="text-xs uppercase tracking-wide text-zinc-500">Mask Name</label>
              <input
                value={maskName}
                onChange={(e) => setMaskName(e.target.value)}
                className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 focus:border-blue-500 focus:outline-none"
                placeholder="Top-right watermark"
              />
            </div>
            <div className="mt-3">
              <label className="text-xs uppercase tracking-wide text-zinc-500">Saved Masks</label>
              <select
                value={activeMaskId}
                onChange={(e) => setActiveMaskId(e.target.value)}
                className="mt-2 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 focus:border-blue-500 focus:outline-none"
              >
                <option value="">New mask</option>
                {masks.map((mask) => (
                  <option key={mask.id} value={mask.id}>
                    {mask.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="mt-4 space-y-3">
              {rects.map((rect, index) => (
                <div key={index} className="rounded-lg border border-zinc-800 bg-zinc-900/70 p-3">
                  <div className="flex items-center justify-between text-xs font-semibold text-zinc-200">
                    <span>{rect.label ?? `Rect ${index + 1}`}</span>
                    <button className="text-rose-400 hover:text-rose-300" onClick={() => removeRect(index)}>
                      Remove
                    </button>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-zinc-400">
                    <label className="space-y-1">
                      <span>X</span>
                      <input
                        type="number"
                        value={rect.x}
                        onChange={(e) => updateRect(index, { x: Number(e.target.value) })}
                        className="w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-zinc-100"
                      />
                    </label>
                    <label className="space-y-1">
                      <span>Y</span>
                      <input
                        type="number"
                        value={rect.y}
                        onChange={(e) => updateRect(index, { y: Number(e.target.value) })}
                        className="w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-zinc-100"
                      />
                    </label>
                    <label className="space-y-1">
                      <span>Width</span>
                      <input
                        type="number"
                        value={rect.width}
                        onChange={(e) => updateRect(index, { width: Number(e.target.value) })}
                        className="w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-zinc-100"
                      />
                    </label>
                    <label className="space-y-1">
                      <span>Height</span>
                      <input
                        type="number"
                        value={rect.height}
                        onChange={(e) => updateRect(index, { height: Number(e.target.value) })}
                        className="w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-zinc-100"
                      />
                    </label>
                  </div>
                </div>
              ))}
              {rects.length === 0 && (
                <div className="rounded-lg border border-dashed border-zinc-700 bg-zinc-900/50 p-3 text-xs text-zinc-500">
                  Click a frame to add a blur zone or manually add one.
                </div>
              )}
              <button
                onClick={() => addRect({ x: 24, y: 24, width: 180, height: 80, label: `Zone ${rects.length + 1}` })}
                className="w-full rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-200 hover:border-emerald-500"
              >
                Add Rectangle
              </button>
              <button
                onClick={handleSaveMask}
                className="w-full rounded-lg bg-emerald-500 px-3 py-2 text-sm font-semibold text-black shadow hover:bg-emerald-400"
              >
                Save Mask
              </button>
            </div>
          </div>

          <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-4 shadow-lg">
            <h4 className="text-sm font-semibold text-white">Watermark Cleaner</h4>
            <p className="mt-1 text-xs text-zinc-500">
              Processes downloaded videos using the selected blur mask and reports progress.
            </p>
            <div className="mt-3 space-y-2">
              <label className="text-xs uppercase tracking-wide text-zinc-500">Mask</label>
              <select
                value={activeMaskId}
                onChange={(e) => setActiveMaskId(e.target.value)}
                className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 focus:border-blue-500 focus:outline-none"
              >
                <option value="">None</option>
                {masks.map((mask) => (
                  <option key={mask.id} value={mask.id}>
                    {mask.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="mt-4 space-y-3">
              <button
                onClick={handleClean}
                disabled={videos.length === 0 || busy}
                className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-blue-500 disabled:opacity-50"
              >
                Run Cleaner
              </button>
              {cleanResult && (
                <div className="rounded-lg border border-zinc-800 bg-zinc-900/80 p-3 text-xs text-zinc-300">
                  {cleanResult.items.map((item: any) => (
                    <div key={item.video} className="flex items-start justify-between border-b border-zinc-800/80 py-1 last:border-none">
                      <div>
                        <div className="font-semibold text-zinc-100">{item.video.split('/').pop()}</div>
                        {item.output && <div className="text-[11px] text-emerald-400">{item.output}</div>}
                        {item.message && <div className="text-[11px] text-zinc-500">{item.message}</div>}
                      </div>
                      <span
                        className={
                          item.status === 'cleaned'
                            ? 'text-emerald-400'
                            : item.status === 'error'
                              ? 'text-rose-400'
                              : 'text-yellow-400'
                        }
                      >
                        {item.status}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {sessions.length === 0 && (
        <div className="rounded-lg border border-dashed border-zinc-800 bg-zinc-950/40 p-4 text-sm text-zinc-500">
          No sessions available. Configure in Settings.
        </div>
      )}
    </div>
  );
};

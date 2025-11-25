// sora_2.1/src/components/WatermarkPage.tsx
import React, { useEffect, useState, useRef } from 'react';
import {
  type WatermarkMask,
  type WatermarkRect,
} from '../../shared/types';
import { useAppStore } from '../store';
import { Icons } from './Icons';

interface EnhancedRect extends WatermarkRect {
  mode: 'blur' | 'delogo' | 'hybrid';
  blur_strength: number;
  band: number;
}

// Безопасная обёртка для иконок, чтобы не падать на undefined
const makeSafeIcon = (IconCandidate: React.ComponentType<any> | undefined) => {
  if (IconCandidate) return IconCandidate;
  return () => null;
};

const Wand2Icon = makeSafeIcon(Icons?.Wand2);
const FolderOpenIcon = makeSafeIcon(Icons?.FolderOpen);
const PlayIcon = makeSafeIcon(Icons?.Play);
const PlusIcon = makeSafeIcon(Icons?.Plus);
const SaveIcon = makeSafeIcon(Icons?.Save);

export const WatermarkPage: React.FC = () => {
  const { config, refreshConfig } = useAppStore();

  const [masks, setMasks] = useState<WatermarkMask[]>([]);
  const [activeMaskId, setActiveMaskId] = useState<string | null>(null);
  const [rects, setRects] = useState<EnhancedRect[]>([]);
  const [selectedVideo, setSelectedVideo] = useState<string>('');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<string>('Готово');
  const [busy, setBusy] = useState<boolean>(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // --- Helpers ---

  const findActiveMask = (): WatermarkMask | undefined => {
    const fallbackId = config?.activeWatermarkMaskId ?? null;
    const targetId = activeMaskId ?? fallbackId;
    if (!targetId) return undefined;
    return masks.find((m) => m.id === targetId);
  };

  const enhancedFromMask = (mask?: WatermarkMask | null): EnhancedRect[] => {
    if (!mask?.rects) return [];
    return mask.rects.map((r) => {
      const anyRect = r as any;
      const mode: EnhancedRect['mode'] = anyRect.mode ?? 'blur';
      const blurStrength =
        typeof anyRect.blur_strength === 'number'
          ? anyRect.blur_strength
          : 8; // более мягкий дефолт
      const band =
        typeof anyRect.band === 'number'
          ? anyRect.band
          : 4; // мягкая граница delogo
      return {
        ...r,
        mode,
        blur_strength: blurStrength,
        band,
      };
    });
  };

  // --- Initial load of masks from blurProfiles (старые профили блюра = маски) ---

  useEffect(() => {
    const load = async () => {
      try {
        const list = await window.electronAPI.video.blurProfiles.list();
        if (Array.isArray(list)) {
          const asMasks = list as WatermarkMask[];
          setMasks(asMasks);

          const cfgActive = config?.activeWatermarkMaskId ?? null;
          const initialId =
            (cfgActive &&
              asMasks.find((m) => m.id === cfgActive)?.id) ||
            asMasks[0]?.id ||
            null;

          if (initialId) {
            setActiveMaskId(initialId);
            const active = asMasks.find((m) => m.id === initialId);
            if (active && active.rects) {
              setRects(enhancedFromMask(active));
            }
          }
        }
      } catch (e) {
        console.error('Failed to load blurProfiles/masks', e);
      }
    };
    load();
  }, [config]);

  // --- Восстановление последнего видео из localStorage ---

  useEffect(() => {
    const last = localStorage.getItem('wm_last_video_path');
    if (last) setSelectedVideo(last);
  }, []);

  useEffect(() => {
    if (selectedVideo) {
      localStorage.setItem('wm_last_video_path', selectedVideo);
    }
  }, [selectedVideo]);

  // --- Handlers ---

  const handleSelectVideoFromDisk = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const fakePath = (file as any).path || file.name; // path в Electron, name в браузере
    setSelectedVideo(fakePath);
    setPreviewUrl(URL.createObjectURL(file));
    setStatus(`Выбрано видео: ${file.name}`);
  };

  const handleInputVideoPath = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSelectedVideo(e.target.value);
  };

  const handleAddRect = () => {
    const next: EnhancedRect = {
      x: 50,
      y: 50,
      width: 200,
      height: 100,
      label: `Zone ${rects.length + 1}`,
      mode: 'blur',
      blur_strength: 8, // мягкий дефолт вместо 20
      band: 4,
    };
    setRects((prev) => [...prev, next]);
  };

  const handleRectChange = <K extends keyof EnhancedRect>(
    index: number,
    key: K,
    value: EnhancedRect[K],
  ) => {
    setRects((prev) =>
      prev.map((r, i) => (i === index ? { ...r, [key]: value } : r)),
    );
  };

  const handleDeleteRect = (index: number) => {
    setRects((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSelectMask = (id: string) => {
    setActiveMaskId(id);
    const mask = masks.find((m) => m.id === id);
    setRects(enhancedFromMask(mask));
    setStatus(`Маска: ${(mask && mask.name) || id}`);
  };

  const handleCreateNewMask = () => {
    setActiveMaskId(null);
    setRects([]);
    setStatus('Новая маска: добавь зоны и нажми «Сохранить маску»');
  };

  const handleSaveMask = async () => {
    if (!rects.length) {
      setStatus('Нет зон для сохранения');
      return;
    }

    const active = findActiveMask();
    const name =
      active?.name ||
      `Mask ${new Date().toLocaleString().replace(/:/g, '-')}`;

    // ВАЖНО: оставляем mode / blur_strength / band, чтобы они реально сохранялись
    const rectPayloads = rects.map((r) => ({
      x: r.x,
      y: r.y,
      width: r.width,
      height: r.height,
      label: r.label,
      mode: r.mode,
      blur_strength: r.blur_strength,
      band: r.band,
    }));

    const maskPayload: any = {
      id: activeMaskId || undefined, // undefined => backend создаст новый id
      name,
      rects: rectPayloads,
    };

    setBusy(true);
    setStatus('Сохранение маски...');
    try {
      const updated = await window.electronAPI.video.blurProfiles.save(
        maskPayload,
      );

      if (Array.isArray(updated)) {
        const asMasks = updated as WatermarkMask[];
        setMasks(asMasks);

        const savedMask =
          asMasks.find((m) => m.name === name) ||
          (activeMaskId && asMasks.find((m) => m.id === activeMaskId));

        if (savedMask) {
          setActiveMaskId(savedMask.id);
          setRects(enhancedFromMask(savedMask));
        }
      }

      if (config) {
        const finalMaskId =
          (activeMaskId ||
            findActiveMask()?.id ||
            (maskPayload.id as string | undefined)) ??
          null;

        await window.electronAPI.config.update({
          ...config,
          activeWatermarkMaskId: finalMaskId,
        });
        await refreshConfig();
      }

      setStatus('Маска сохранена');
    } catch (e) {
      setStatus(`Ошибка сохранения маски: ${(e as Error).message}`);
    }
    setBusy(false);
  };

  const handleRunBlur = async () => {
    if (!selectedVideo || !rects.length) {
      setStatus('Выбери видео и добавь хотя бы одну зону');
      return;
    }
    setBusy(true);
    setStatus('Обработка видео...');
    try {
      const res = await window.electronAPI.video.runBlur(
        selectedVideo,
        rects,
      );
      if (res?.ok && res.output) {
        const fname = res.output.split(/[\\/]/).pop();
        setStatus(`Готово: ${fname}`);
      } else {
        setStatus(`Ошибка: ${res?.error || 'unknown'}`);
      }
    } catch (e) {
      setStatus(`Exception: ${(e as Error).message}`);
    }
    setBusy(false);
  };

  // --- Render helpers ---

  const renderOverlayRects = () => {
    if (!containerRef.current || rects.length === 0) return null;
    const container = containerRef.current;
    const vw = container.clientWidth || 1;
    const vh = container.clientHeight || 1;

    const maxX = Math.max(...rects.map((r) => r.x + r.width), vw);
    const maxY = Math.max(...rects.map((r) => r.y + r.height), vh);

    return rects.map((r, idx) => {
      const left = (r.x / maxX) * 100;
      const top = (r.y / maxY) * 100;
      const width = (r.width / maxX) * 100;
      const height = (r.height / maxY) * 100;

      const borderColor =
        r.mode === 'blur'
          ? 'border-emerald-400'
          : r.mode === 'delogo'
          ? 'border-orange-400'
          : 'border-fuchsia-400';

      return (
        <div
          key={idx}
          className={`absolute border-2 ${borderColor} pointer-events-none`}
          style={{
            left: `${left}%`,
            top: `${top}%`,
            width: `${width}%`,
            height: `${height}%`,
          }}
        />
      );
    });
  };

  // --- JSX ---

  return (
    <div className="space-y-4 h-[calc(100vh-4rem)] flex flex-col">
      <div className="flex items-center justify-between border-b border-zinc-800 pb-2">
        <div className="flex items-center gap-2">
          <Wand2Icon className="w-4 h-4 text-emerald-400" />
          <h1 className="text-sm font-semibold">Watermark cleaner</h1>
        </div>
        <div className="text-[11px] text-zinc-400">{status}</div>
      </div>

      <div className="flex gap-4 flex-1 overflow-hidden">
        {/* Левая часть — видео + оверлей */}
        <div className="flex-1 flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <input
              type="text"
              placeholder="Путь к видео или выбери файл"
              value={selectedVideo}
              onChange={handleInputVideoPath}
              className="flex-1 input-field h-8 text-xs"
            />
            <label className="inline-flex items-center gap-1 px-2 py-1 text-[11px] border border-zinc-700 rounded-md cursor-pointer hover:bg-zinc-800">
              <FolderOpenIcon className="w-3 h-3" />
              <span>Файл</span>
              <input
                type="file"
                accept="video/*"
                className="hidden"
                onChange={handleSelectVideoFromDisk}
              />
            </label>
          </div>

          <div
            ref={containerRef}
            className="relative flex-1 bg-black rounded-xl overflow-hidden border border-zinc-800"
          >
            {previewUrl ? (
              <>
                <video
                  ref={videoRef}
                  src={previewUrl}
                  className="w-full h-full object-contain"
                  controls
                />
                {renderOverlayRects()}
              </>
            ) : (
              <div className="w-full h-full flex items-center justify-center text-xs text-zinc-500">
                Выбери видео, чтобы увидеть предпросмотр
              </div>
            )}
          </div>

          <div className="flex gap-2">
            <button
              onClick={handleRunBlur}
              disabled={busy}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-[11px] rounded-md bg-emerald-500 text-black hover:bg-emerald-400 disabled:opacity-50"
            >
              <PlayIcon className="w-3 h-3" />
              Запустить очистку
            </button>
            <button
              onClick={handleAddRect}
              disabled={busy}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-[11px] rounded-md bg-zinc-800 text-zinc-100 hover:bg-zinc-700 disabled:opacity-50"
            >
              <PlusIcon className="w-3 h-3" />
              Добавить зону
            </button>
            <button
              onClick={handleSaveMask}
              disabled={busy || rects.length === 0}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-[11px] rounded-md bg-zinc-900 border border-zinc-700 text-zinc-100 hover:bg-zinc-800 disabled:opacity-50"
            >
              <SaveIcon className="w-3 h-3" />
              Сохранить маску
            </button>
          </div>
        </div>

        {/* Правая часть — список масок и параметры зон */}
        <div className="w-[320px] shrink-0 flex flex-col gap-3 border-l border-zinc-800 pl-3">
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <div className="text-[11px] font-medium text-zinc-200">
                Маски водяного знака
              </div>
              <button
                onClick={handleCreateNewMask}
                disabled={busy}
                className="text-[10px] px-2 py-0.5 rounded-md border border-zinc-700 text-zinc-300 hover:border-zinc-500 hover:bg-zinc-900/60 disabled:opacity-50"
              >
                Новая
              </button>
            </div>
            <div className="flex flex-wrap gap-1">
              {masks.map((m) => (
                <button
                  key={m.id}
                  onClick={() => handleSelectMask(m.id)}
                  className={`px-2 py-1 rounded-md text-[11px] border ${
                    m.id === activeMaskId
                      ? 'border-emerald-400 bg-emerald-500/10 text-emerald-300'
                      : 'border-zinc-700 bg-zinc-900 text-zinc-300 hover:border-zinc-500'
                  }`}
                >
                  {m.name}
                </button>
              ))}
              {masks.length === 0 && (
                <div className="text-[11px] text-zinc-500">
                  Масок нет — добавь зоны и нажми «Сохранить маску»
                </div>
              )}
            </div>
          </div>

          <div className="flex-1 overflow-auto pr-1 space-y-2">
            <div className="text-[11px] font-medium text-zinc-200">
              Зоны / параметры
            </div>
            {rects.map((r, idx) => (
              <div
                key={idx}
                className="border border-zinc-800 rounded-lg p-2 mb-1 bg-zinc-950/40 space-y-1"
              >
                <div className="flex items-center justify-between gap-1">
                  <div className="text-[11px] text-zinc-400">
                    {r.label || `Zone ${idx + 1}`}
                  </div>
                  <button
                    onClick={() => handleDeleteRect(idx)}
                    className="text-[10px] text-zinc-500 hover:text-red-400"
                  >
                    удалить
                  </button>
                </div>
                <div className="grid grid-cols-4 gap-1 text-[10px]">
                  <label className="flex flex-col gap-0.5">
                    <span className="text-zinc-500">X</span>
                    <input
                      type="number"
                      value={r.x}
                      onChange={(e) =>
                        handleRectChange(idx, 'x', Number(e.target.value) || 0)
                      }
                      className="input-field h-6 text-[10px]"
                    />
                  </label>
                  <label className="flex flex-col gap-0.5">
                    <span className="text-zinc-500">Y</span>
                    <input
                      type="number"
                      value={r.y}
                      onChange={(e) =>
                        handleRectChange(idx, 'y', Number(e.target.value) || 0)
                      }
                      className="input-field h-6 text-[10px]"
                    />
                  </label>
                  <label className="flex flex-col gap-0.5">
                    <span className="text-zinc-500">W</span>
                    <input
                      type="number"
                      value={r.width}
                      onChange={(e) =>
                        handleRectChange(
                          idx,
                          'width',
                          Number(e.target.value) || 1,
                        )
                      }
                      className="input-field h-6 text-[10px]"
                    />
                  </label>
                  <label className="flex flex-col gap-0.5">
                    <span className="text-zinc-500">H</span>
                    <input
                      type="number"
                      value={r.height}
                      onChange={(e) =>
                        handleRectChange(
                          idx,
                          'height',
                          Number(e.target.value) || 1,
                        )
                      }
                      className="input-field h-6 text-[10px]"
                    />
                  </label>
                </div>

                <div className="grid grid-cols-3 gap-1 mt-1 text-[10px]">
                  <label className="flex flex-col gap-0.5 col-span-2">
                    <span className="text-zinc-500">Режим</span>
                    <select
                      value={r.mode}
                      onChange={(e) =>
                        handleRectChange(
                          idx,
                          'mode',
                          e.target.value as EnhancedRect['mode'],
                        )
                      }
                      className="input-field h-7 text-[10px]"
                    >
                      <option value="blur">Blur</option>
                      <option value="delogo">Delogo</option>
                      <option value="hybrid">Hybrid</option>
                    </select>
                  </label>

                  {r.mode === 'blur' && (
                    <label className="flex flex-col gap-0.5">
                      <span className="text-zinc-500">Blur</span>
                      <input
                        type="number"
                        value={r.blur_strength}
                        onChange={(e) =>
                          handleRectChange(
                            idx,
                            'blur_strength',
                            Number(e.target.value) || 1,
                          )
                        }
                        className="input-field h-7 text-[10px]"
                      />
                    </label>
                  )}

                  {(r.mode === 'delogo' || r.mode === 'hybrid') && (
                    <label className="flex flex-col gap-0.5">
                      <span className="text-zinc-500">Band</span>
                      <input
                        type="number"
                        value={r.band}
                        onChange={(e) =>
                          handleRectChange(
                            idx,
                            'band',
                            Number(e.target.value) || 1,
                          )
                        }
                        className="input-field h-7 text-[10px]"
                      />
                    </label>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

// Чтобы и default-импорт тоже работал
export default WatermarkPage;

// sora_2.1/electron/watermark.ts
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import imageSize from 'image-size';
import { logError } from '../core/utils/log';
import { randomUUID } from 'crypto';
import type {
  Config,
  WatermarkCleanItemResult,
  WatermarkCleanResult,
  WatermarkDetectionFrame,
  WatermarkDetectionResult,
  WatermarkFramesResult,
  WatermarkMask,
  WatermarkRect
} from '../shared/types';
import { blurVideo, type BlurZone } from './video/ffmpegBlur';

const execFileAsync = promisify(execFile);

/**
 * Создаём временную директорию для кадров водяного знака.
 */
const ensureTempDir = async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sora-watermark-'));
  return dir;
};

/**
 * Генерация кадров из видео для анализа водяного знака.
 * Использует ffmpeg напрямую (execFile), путь к ffmpeg приходит с фронта.
 */
export const generateWatermarkFrames = async (
  videoPath: string,
  ffmpegPath: string
): Promise<WatermarkFramesResult> => {
  if (!videoPath) {
    throw new Error('Video path is required');
  }
  if (!ffmpegPath) {
    throw new Error('ffmpeg path is not configured');
  }

  const tempDir = await ensureTempDir();
  const outputPattern = path.join(tempDir, 'frame-%02d.png');

  // Берём каждый 30-й кадр (как пример), можно потом сделать настраиваемым.
  await execFileAsync(ffmpegPath, [
    '-y',
    '-i',
    videoPath,
    '-vf',
    "select='not(mod(n,30))'",
    '-vsync',
    'vfr',
    outputPattern
  ]);

  const files = await fs.readdir(tempDir);
  const frames = files
    .filter((file) => file.endsWith('.png'))
    .sort()
    .map((file) => path.join(tempDir, file));

  return { frames, tempDir };
};

/**
 * Строим «разумный» прямоугольник по краю кадра, опираясь на размер кадра
 * и (опционально) размер шаблона водяного знака.
 */
const buildSuggestedRect = (framePath: string, templatePath?: string): WatermarkRect | null => {
  try {
    const frameDims = imageSize(framePath);
    const templateDims = templatePath ? imageSize(templatePath) : undefined;

    if (!frameDims.width || !frameDims.height) return null;

    const fallbackWidth = Math.max(120, Math.floor(frameDims.width * 0.25));
    const fallbackHeight = Math.max(80, Math.floor(frameDims.height * 0.12));

    const rectWidth = templateDims?.width ?? fallbackWidth;
    const rectHeight = templateDims?.height ?? fallbackHeight;

    // Ставим прямоугольник в правый нижний угол с небольшими отступами.
    const x = Math.max(8, frameDims.width - rectWidth - Math.floor(frameDims.width * 0.04));
    const y = Math.max(8, frameDims.height - rectHeight - Math.floor(frameDims.height * 0.04));

    return {
      x,
      y,
      width: rectWidth,
      height: rectHeight,
      label: 'Auto-detected'
    };
  } catch (error) {
    logError('Failed to build suggested rect', error);
    return null;
  }
};

/**
 * Детект водяного знака:
 * 1) генерируем набор кадров,
 * 2) для каждого строим прямоугольник,
 * 3) первую валидную зону предлагаем как suggestedMask.
 */
export const detectWatermark = async (
  videoPath: string,
  templatePath: string | undefined,
  ffmpegPath: string
): Promise<WatermarkDetectionResult> => {
  const framesResult = await generateWatermarkFrames(videoPath, ffmpegPath);
  const frames: WatermarkDetectionFrame[] = [];
  let suggested: WatermarkRect | null = null;

  for (const frame of framesResult.frames) {
    const rect = buildSuggestedRect(frame, templatePath) ?? undefined;

    if (!suggested && rect) {
      suggested = rect;
    }

    const dims = imageSize(frame);
    frames.push({
      path: frame,
      width: dims.width ?? 0,
      height: dims.height ?? 0,
      rects: rect ? [rect] : []
    });
  }

  const suggestedMask: WatermarkMask | undefined = suggested
    ? {
        id: randomUUID(),
        name: 'Auto-detected',
        rects: [suggested],
        updatedAt: Date.now()
      }
    : undefined;

  return { frames, suggestedMask };
};

/**
 * Работаем с масками (зоны водяного знака) из конфига.
 */
export const listMasks = (config: Config): WatermarkMask[] => {
  return config.watermarkMasks ?? [];
};

export const saveMask = async (mask: WatermarkMask, config: Config): Promise<WatermarkMask[]> => {
  const masks = listMasks(config);

  const next: WatermarkMask = {
    ...mask,
    id: mask.id || randomUUID(),
    updatedAt: Date.now()
  };

  const existingIndex = masks.findIndex((m) => m.id === next.id || m.name === next.name);
  if (existingIndex >= 0) {
    masks[existingIndex] = next;
  } else {
    masks.push(next);
  }

  return masks;
};

export const removeMask = (id: string, config: Config): WatermarkMask[] => {
  const masks = listMasks(config).filter((m) => m.id !== id);
  return masks;
};

/**
 * Основной шаг очистки водяного знака.
 * Раньше тут было просто fs.copyFile → "Copied without mask".
 * Теперь, если есть маска, реально вызываем ffmpeg-blur и создаём
 * заблюренную версию видео по зонам из маски.
 */
export const runWatermarkCleaner = async (
  videoPaths: string[],
  maskId: string | undefined,
  config: Config
): Promise<WatermarkCleanResult> => {
  const masks = listMasks(config);

  // Если maskId не передали — пробуем взять активную маску из конфига.
  const activeId = maskId ?? config.activeWatermarkMaskId;
  const mask = activeId ? masks.find((m) => m.id === activeId) : undefined;

  if (activeId && !mask) {
    return { ok: false, items: [], error: 'Selected mask not found' };
  }

  const items: WatermarkCleanItemResult[] = [];

  for (const video of videoPaths) {
    const parsed = path.parse(video);
    const output = path.join(parsed.dir, `${parsed.name}-cleaned${parsed.ext}`);

    try {
      if (!mask || !mask.rects || mask.rects.length === 0) {
        // Маски нет — просто копируем и помечаем как "skipped" (или "cleaned", если тебе так привычнее).
        await fs.copyFile(video, output);
        items.push({
          video,
          output,
          status: 'skipped',
          message: 'No watermark mask selected — copied without changes'
        });
        continue;
      }

      // Преобразуем rects маски в BlurZone для ffmpegBlur.
      const zones: BlurZone[] = mask.rects.map((rect) => ({
        x: Math.max(0, Math.floor(rect.x)),
        y: Math.max(0, Math.floor(rect.y)),
        w: Math.max(1, Math.floor(rect.width)),
        h: Math.max(1, Math.floor(rect.height)),
        mode: 'blur',
        blur_strength: 20 // можно вынести в настройки, сейчас — дефолт
      }));

      // Реально обрабатываем видео через общий blur-пайплайн.
      await blurVideo(video, output, zones);

      items.push({
        video,
        output,
        status: 'cleaned',
        message: `Watermark cleaned using mask "${mask.name}"`
      });
    } catch (error) {
      items.push({
        video,
        status: 'error',
        message: (error as Error).message
      });
    }
  }

  return { ok: true, items };
};

// electron/video/ffmpegWatermark.ts

import { exec as execCb } from 'child_process';
import ffmpeg from 'fluent-ffmpeg';
import fs from 'fs/promises';
import path from 'path';
import { promisify } from 'util';

import { getConfig, getUserDataPath } from '../config/config';
import { BlurZone } from './ffmpegBlur';

const exec = promisify(execCb);

// Перевіряємо наявність ffmpeg: або окремий шлях у конфігурації, або з PATH
async function ensureFfmpeg(): Promise<void> {
  const config = await getConfig();
  if (config.ffmpegPath) {
    ffmpeg.setFfmpegPath(config.ffmpegPath);
    return;
  }

  try {
    await exec('ffmpeg -version');
  } catch {
    throw new Error('ffmpeg is not configured and not available in PATH');
  }
}

// Отримати тривалість відео (у секундах)
async function getDuration(videoPath: string): Promise<number> {
  await ensureFfmpeg();
  return new Promise<number>((resolve, reject) => {
    ffmpeg.ffprobe(videoPath, (err, metadata) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(metadata.format.duration ?? 0);
    });
  });
}

// Вирізати N кадрів (просто рівномірно по відео)
export async function extractPreviewFrames(videoPath: string, count: number): Promise<string[]> {
  await ensureFfmpeg();

  const tempRoot = path.join(getUserDataPath(), 'temp');
  await fs.mkdir(tempRoot, { recursive: true });
  const frameDir = await fs.mkdtemp(path.join(tempRoot, 'frames-'));

  await new Promise<void>((resolve, reject) => {
    ffmpeg(videoPath)
      .on('end', () => resolve())
      .on('error', (err) => reject(err))
      .screenshots({
        count,
        folder: frameDir,
        filename: 'frame-%i.png',
      });
  });

  const files = await fs.readdir(frameDir);
  const framePaths = files
    .filter((f) => f.toLowerCase().endsWith('.png'))
    .sort()
    .map((f) => path.join(frameDir, f));

  return framePaths;
}

// "Розумний" вибір кадрів: фіксовані відсотки + рандом
export async function pickSmartPreviewFrames(videoPath: string, count: number): Promise<string[]> {
  await ensureFfmpeg();
  const duration = await getDuration(videoPath);

  const tempRoot = path.join(getUserDataPath(), 'temp');
  await fs.mkdir(tempRoot, { recursive: true });
  const frameDir = await fs.mkdtemp(path.join(tempRoot, 'smart-frames-'));

  const basePercents = [0.02, 0.25, 0.5, 0.75, 0.95];
  const timestamps: string[] = [];

  // Основні точки (початок, чверть, середина, 3/4, кінець)
  basePercents.slice(0, Math.min(count, basePercents.length)).forEach((p) => {
    const ts = Math.max(0, duration * p);
    timestamps.push(`${ts}`);
  });

  // Якщо кадрів треба більше — додаємо випадкові позиції
  if (count > timestamps.length && duration > 0) {
    const remaining = count - timestamps.length;
    for (let i = 0; i < remaining; i++) {
      const rand = Math.random() * Math.max(duration - 1, 0);
      timestamps.push(`${rand}`);
    }
  }

  await new Promise<void>((resolve, reject) => {
    ffmpeg(videoPath)
      .on('end', () => resolve())
      .on('error', (err) => reject(err))
      .screenshots({
        timestamps,
        folder: frameDir,
        filename: 'frame-%i.png',
      });
  });

  const files = await fs.readdir(frameDir);
  return files
    .filter((f) => f.toLowerCase().endsWith('.png'))
    .sort()
    .map((f) => path.join(frameDir, f));
}

// Поки що заглушка: просто копіюємо mp4 як є
export async function cleanWatermarkBatch(inputDir: string, outputDir: string): Promise<void> {
  await ensureFfmpeg();
  await fs.mkdir(outputDir, { recursive: true });
  const entries = await fs.readdir(inputDir);

  const copies = entries
    .filter((file) => file.toLowerCase().endsWith('.mp4'))
    .map((file) =>
      fs.copyFile(path.join(inputDir, file), path.join(outputDir, file)),
    );

  await Promise.all(copies);
}

// Тип для майбутнього детекту зон водяних знаків
export type DetectedZone = {
  frame: string;
  zones: BlurZone[];
};

// Поки що детект — теж заглушка
export async function detectWatermarkOnFrames(
  frames: string[],
  _templatePath: string,
): Promise<DetectedZone[]> {
  // Placeholder для майбутньої інтеграції детектора
  return frames.map((frame) => ({ frame, zones: [] }));
}

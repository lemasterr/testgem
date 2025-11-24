import { exec as execCb } from 'child_process';
import ffmpeg, { FilterSpecification } from 'fluent-ffmpeg';
import fs from 'fs/promises';
import path from 'path';
import { promisify } from 'util';
import { randomUUID } from 'crypto';

import { getConfig, getUserDataPath } from '../config/config';

export type BlurZone = { x: number; y: number; w: number; h: number };
export type BlurProfile = {
  id: string;
  name: string;
  zones: BlurZone[];
};

const exec = promisify(execCb);
const profilesFile = path.join(getUserDataPath(), 'blur-profiles.json');

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

async function readProfiles(): Promise<BlurProfile[]> {
  try {
    const raw = await fs.readFile(profilesFile, 'utf-8');
    return JSON.parse(raw) as BlurProfile[];
  } catch (err: any) {
    if (err && err.code === 'ENOENT') {
      await fs.mkdir(path.dirname(profilesFile), { recursive: true });
      await fs.writeFile(profilesFile, '[]', 'utf-8');
      return [];
    }
    throw err;
  }
}

async function writeProfiles(profiles: BlurProfile[]): Promise<void> {
  await fs.writeFile(profilesFile, JSON.stringify(profiles, null, 2), 'utf-8');
}

export async function listBlurProfiles(): Promise<BlurProfile[]> {
  return readProfiles();
}

export async function saveBlurProfile(profile: BlurProfile): Promise<BlurProfile> {
  const profiles = await readProfiles();
  const id = profile.id || randomUUID();
  const existingIdx = profiles.findIndex((p) => p.id === id);
  const nextProfile = { ...profile, id };

  if (existingIdx >= 0) {
    profiles[existingIdx] = nextProfile;
  } else {
    profiles.push(nextProfile);
  }

  await writeProfiles(profiles);
  return nextProfile;
}

export async function deleteBlurProfile(id: string): Promise<void> {
  const profiles = await readProfiles();
  const filtered = profiles.filter((p) => p.id !== id);
  await writeProfiles(filtered);
}

export async function blurVideo(input: string, output: string, zones: BlurZone[]): Promise<void> {
  await ensureFfmpeg();
  await fs.mkdir(path.dirname(output), { recursive: true });

  if (!zones.length) {
    await fs.copyFile(input, output);
    return;
  }

  const filters: FilterSpecification[] = [];
  let lastLabel: string | undefined = '0:v';

  zones.forEach((zone, idx) => {
    const cropLabel = `crop${idx}`;
    const blurLabel = `blur${idx}`;
    const overlayLabel = `ol${idx}`;

    const baseLabel = lastLabel ?? '0:v';

    filters.push({ filter: 'crop', options: `${zone.w}:${zone.h}:${zone.x}:${zone.y}`, inputs: baseLabel, outputs: cropLabel });
    filters.push({ filter: 'boxblur', options: '20:20', inputs: cropLabel, outputs: blurLabel });
    filters.push({ filter: 'overlay', options: `${zone.x}:${zone.y}`, inputs: [baseLabel, blurLabel], outputs: overlayLabel });

    lastLabel = overlayLabel;
  });

  const mapVideo = lastLabel ?? '0:v';

  await new Promise<void>((resolve, reject) => {
    ffmpeg(input)
      .complexFilter(filters)
      .outputOptions(['-map', mapVideo, '-map', '0:a?', '-c:a', 'copy'])
      .on('end', () => resolve())
      .on('error', (err) => reject(err))
      .save(output);
  });
}

export async function blurVideoWithProfile(input: string, output: string, profileId: string): Promise<void> {
  const profiles = await readProfiles();
  const profile = profiles.find((p) => p.id === profileId);
  if (!profile) {
    throw new Error(`Blur profile not found: ${profileId}`);
  }

  await blurVideo(input, output, profile.zones || []);
}

export async function blurVideosInDir(inputDir: string, outputDir: string, profileId: string): Promise<void> {
  await ensureFfmpeg();
  await fs.mkdir(outputDir, { recursive: true });

  const entries = await fs.readdir(inputDir, { withFileTypes: true });
  const files = entries.filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.mp4'));

  for (const file of files) {
    const inputPath = path.join(inputDir, file.name);
    const outputPath = path.join(outputDir, file.name);
    await blurVideoWithProfile(inputPath, outputPath, profileId);
  }
}

// sora_2.1/electron/video/ffmpegBlur.ts
import { exec as execCb } from 'child_process';
import ffmpeg, { FilterSpecification } from 'fluent-ffmpeg';
import fs from 'fs/promises';
import path from 'path';
import { promisify } from 'util';
import { randomUUID } from 'crypto';

import { getConfig, getUserDataPath } from '../config/config';

export type BlurMode = 'blur' | 'delogo' | 'hybrid';

export type BlurZone = {
  x: number;
  y: number;
  w: number;
  h: number;
  // Enhanced optional fields coming from UI
  mode?: BlurMode;
  blur_strength?: number; // for blur/hybrid
  band?: number;          // for delogo/hybrid
};

export type BlurProfile = {
  id: string;
  name: string;
  zones: BlurZone[];
};

const exec = promisify(execCb);
const profilesFile = path.join(getUserDataPath(), 'blur-profiles.json');

async function ensureFfmpeg(): Promise<void> {
  const config = await getConfig();

  if (config.ffmpegPath && config.ffmpegPath.trim().length > 0) {
    ffmpeg.setFfmpegPath(config.ffmpegPath);
    return;
  }

  // Fallback to ffmpeg from PATH
  try {
    await exec('ffmpeg -version');
  } catch {
    throw new Error('ffmpeg is not configured and not available in PATH');
  }
}

async function readProfiles(): Promise<BlurProfile[]> {
  try {
    const raw = await fs.readFile(profilesFile, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed as BlurProfile[];
  } catch (err: any) {
    if (err && (err as any).code === 'ENOENT') {
      return [];
    }
    throw err;
  }
}

async function writeProfiles(profiles: BlurProfile[]): Promise<void> {
  await fs.mkdir(path.dirname(profilesFile), { recursive: true });
  await fs.writeFile(profilesFile, JSON.stringify(profiles, null, 2), 'utf-8');
}

export async function listBlurProfiles(): Promise<BlurProfile[]> {
  return readProfiles();
}

export async function saveBlurProfile(profile: BlurProfile): Promise<BlurProfile> {
  const profiles = await readProfiles();
  const id = profile.id || randomUUID();
  const existingIdx = profiles.findIndex((p) => p.id === id);
  const nextProfile: BlurProfile = { ...profile, id };

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

/**
 * Apply blur / delogo / hybrid zones to a single video.
 * This is the place where we had the `-map out0` bug.
 */
export async function blurVideo(input: string, output: string, zones: BlurZone[]): Promise<void> {
  await ensureFfmpeg();
  await fs.mkdir(path.dirname(output), { recursive: true });

  if (!zones.length) {
    await fs.copyFile(input, output);
    return;
  }

  // Normalize zones and build complex filter graph supporting modes
  const filters: FilterSpecification[] = [];
  let currentLabel: string = '0:v';

  const zlist = zones
    .map((z) => {
      // Defensive numeric parsing to avoid NaN/undefined breaking ffmpeg
      const x = Math.max(0, Math.floor(Number((z as any).x ?? 0)));
      const y = Math.max(0, Math.floor(Number((z as any).y ?? 0)));
      const w = Math.max(1, Math.floor(Number((z as any).w ?? (z as any).width ?? 1)));
      const h = Math.max(1, Math.floor(Number((z as any).h ?? (z as any).height ?? 1)));

      const modeRaw = (z as any).mode as BlurMode | undefined;
      const mode: BlurMode = modeRaw === 'delogo' || modeRaw === 'hybrid' || modeRaw === 'blur'
        ? modeRaw
        : 'blur';

      const blurStrengthRaw = Number((z as any).blur_strength ?? 20);
      const blur_strength = Number.isFinite(blurStrengthRaw) ? blurStrengthRaw : 20;

      const bandRaw = Number((z as any).band ?? 4);
      const band = Number.isFinite(bandRaw) ? bandRaw : 4;

      return {
        x,
        y,
        w,
        h,
        mode,
        blur_strength,
        band,
      } as BlurZone;
    })
    .filter((z) => z.w > 0 && z.h > 0);

  if (!zlist.length) {
    await fs.copyFile(input, output);
    return;
  }

  zlist.forEach((zone, idx) => {
    const base = currentLabel;
    const outLabel = `out${idx}`;

    if (zone.mode === 'delogo') {
      // Apply delogo directly to the base
      const opt = `x=${zone.x}:y=${zone.y}:w=${zone.w}:h=${zone.h}:band=${zone.band}:show=0`;
      filters.push({
        filter: 'delogo',
        options: opt,
        inputs: base,
        outputs: outLabel,
      });
      currentLabel = outLabel;
      return;
    }

    if (zone.mode === 'hybrid') {
      // First delogo, then overlay a soft blur on slightly expanded area
      const delogoLabel = `d${idx}`;
      const opt = `x=${zone.x}:y=${zone.y}:w=${zone.w}:h=${zone.h}:band=${zone.band}:show=0`;
      filters.push({
        filter: 'delogo',
        options: opt,
        inputs: base,
        outputs: delogoLabel,
      });

      const pad = 5;
      const bx = Math.max(0, zone.x - pad);
      const by = Math.max(0, zone.y - pad);
      const bw = zone.w + pad * 2;
      const bh = zone.h + pad * 2;

      const cropLabel = `crop${idx}`;
      const blurLabel = `blur${idx}`;

      filters.push({
        filter: 'crop',
        options: `${bw}:${bh}:${bx}:${by}`,
        inputs: delogoLabel,
        outputs: cropLabel,
      });

      filters.push({
        filter: 'boxblur',
        options: `10:1`,
        inputs: cropLabel,
        outputs: blurLabel,
      });

      filters.push({
        filter: 'overlay',
        options: `${bx}:${by}`,
        inputs: [delogoLabel, blurLabel],
        outputs: outLabel,
      });

      currentLabel = outLabel;
      return;
    }

    // Default: blur mode (cinematic)
    const cropLabel = `crop${idx}`;
    const blurLabel = `blur${idx}`;
    const strength = Math.max(1, Math.floor(zone.blur_strength ?? 20));

    filters.push({
      filter: 'crop',
      options: `${zone.w}:${zone.h}:${zone.x}:${zone.y}`,
      inputs: base,
      outputs: cropLabel,
    });

    filters.push({
      filter: 'boxblur',
      options: `${strength}:1`,
      inputs: cropLabel,
      outputs: blurLabel,
    });

    filters.push({
      filter: 'overlay',
      options: `${zone.x}:${zone.y}`,
      inputs: [base, blurLabel],
      outputs: outLabel,
    });

    currentLabel = outLabel;
  });

  // IMPORTANT: map the final filter output USING THE LABEL
  // In the broken version we used `-map out0`, causing
  // "Trailing garbage after stream specifier: out0"
  const mapVideo =
    currentLabel && currentLabel !== '0:v'
      ? `[${currentLabel}]`
      : '0:v';

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

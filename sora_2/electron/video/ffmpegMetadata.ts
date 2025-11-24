import { execFile } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { promisify } from 'util';

import { getConfig } from '../config/config';

const execFileAsync = promisify(execFile);

async function resolveFfmpegBinary(): Promise<string> {
  const config = await getConfig();
  return config.ffmpegPath || 'ffmpeg';
}

export async function stripMetadataInDir(inputDir: string): Promise<void> {
  const entries = await fs.readdir(inputDir, { withFileTypes: true });
  const files = entries.filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.mp4'));
  if (!files.length) return;

  const ffmpegBin = await resolveFfmpegBinary();

  for (const file of files) {
    const inputPath = path.join(inputDir, file.name);
    const tempPath = path.join(inputDir, `${path.parse(file.name).name}.nometa.tmp.mp4`);

    await execFileAsync(ffmpegBin, ['-i', inputPath, '-map_metadata', '-1', '-c', 'copy', tempPath]);
    await fs.rename(tempPath, inputPath);
  }
}

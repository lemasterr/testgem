import { execFile } from 'child_process';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { promisify } from 'util';

import { getConfig } from '../config/config';

const execFileAsync = promisify(execFile);

async function resolveFfmpegBinary(): Promise<string> {
  const config = await getConfig();
  return config.ffmpegPath || 'ffmpeg';
}

export async function mergeVideosInDir(inputDir: string, outputFile: string): Promise<void> {
  const entries = await fs.readdir(inputDir, { withFileTypes: true });
  const files = entries
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.mp4'))
    .map((e) => path.join(inputDir, e.name))
    .sort();

  if (files.length === 0) {
    throw new Error('No mp4 files to merge');
  }

  await fs.mkdir(path.dirname(outputFile), { recursive: true });
  const listFile = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'sora-merge-')), 'list.txt');
  const content = files.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join('\n');
  await fs.writeFile(listFile, content, 'utf-8');

  const ffmpegBin = await resolveFfmpegBinary();
  await execFileAsync(ffmpegBin, ['-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', outputFile]);
}

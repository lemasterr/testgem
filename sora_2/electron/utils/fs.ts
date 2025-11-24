import fs from 'fs/promises';

export async function ensureDir(target: string): Promise<void> {
  await fs.mkdir(target, { recursive: true });
}

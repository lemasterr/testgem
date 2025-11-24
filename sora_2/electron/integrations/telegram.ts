import axios from 'axios';
import FormData from 'form-data';
import fs from 'fs';
import fsp from 'fs/promises';

import { getConfig, type Config } from '../config/config';

export type TelegramResult = { ok: boolean; error?: string };

function resolveTelegramConfig(config: Config) {
  const { telegram } = config;
  if (!telegram.enabled || !telegram.botToken || !telegram.chatId) {
    return null;
  }
  return { botToken: telegram.botToken, chatId: telegram.chatId };
}

export function formatTemplate(template: string, data: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_match, key) => {
    const value = data[key];
    return value === undefined || value === null ? '' : String(value);
  });
}

export async function sendTelegramMessage(text: string): Promise<TelegramResult> {
  try {
    const config = await getConfig();
    const creds = resolveTelegramConfig(config);
    if (!creds) {
      return { ok: false, error: 'telegram disabled' };
    }

    const url = `https://api.telegram.org/bot${creds.botToken}/sendMessage`;
    await axios.post(url, { chat_id: creds.chatId, text });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}

export async function sendTelegramVideo(videoPath: string, caption?: string): Promise<TelegramResult> {
  try {
    const config = await getConfig();
    const creds = resolveTelegramConfig(config);
    if (!creds) {
      return { ok: false, error: 'telegram disabled' };
    }

    const stats = await fsp.stat(videoPath);
    if (stats.size > 50 * 1024 * 1024) {
      return { ok: false, error: 'video too large for Telegram Bot API (50MB limit)' };
    }

    const form = new FormData();
    form.append('chat_id', creds.chatId);
    if (caption) {
      form.append('caption', caption);
    }
    form.append('video', fs.createReadStream(videoPath));

    const url = `https://api.telegram.org/bot${creds.botToken}/sendVideo`;
    await axios.post(url, form, {
      headers: form.getHeaders(),
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
    });

    return { ok: true };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}

export async function testTelegram(): Promise<TelegramResult> {
  return sendTelegramMessage('Sora Suite: test message');
}

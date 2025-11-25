// sora_2/electron/config/secureStorage.ts
import { safeStorage } from 'electron';

export function encryptSensitive(value: string): string {
  if (!safeStorage.isEncryptionAvailable()) {
    console.warn('Encryption unavailable, storing in plain text');
    return value;
  }
  // Check if already encrypted (simple heuristic or metadata could be better,
  // but for now we assume raw strings passed here need encryption)
  return safeStorage.encryptString(value).toString('base64');
}

export function decryptSensitive(encrypted: string): string {
  if (!safeStorage.isEncryptionAvailable()) return encrypted;
  try {
    return safeStorage.decryptString(Buffer.from(encrypted, 'base64'));
  } catch (error) {
    // If decryption fails (e.g. it wasn't encrypted or key changed), return original
    return encrypted;
  }
}
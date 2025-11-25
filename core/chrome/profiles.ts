import fs from 'fs';
import os from 'os';
import path from 'path';

export interface ChromeProfile {
  id: string;
  name: string;
  path: string;
  isDefault?: boolean;
}

function getUserDataRoots(): string[] {
  const home = os.homedir();
  const roots: string[] = [];

  if (process.platform === 'darwin') {
    roots.push(path.join(home, 'Library', 'Application Support', 'Google', 'Chrome'));
  } else if (process.platform.startsWith('win')) {
    const base = process.env.LOCALAPPDATA || process.env.APPDATA || process.env.USERPROFILE;
    if (base) roots.push(path.join(base, 'Google', 'Chrome', 'User Data'));
  } else {
    roots.push(path.join(home, '.config', 'google-chrome'));
    roots.push(path.join(home, '.config', 'chromium'));
  }

  return roots.filter((candidate) => !!candidate && fs.existsSync(candidate));
}

function readLocalStateProfiles(root: string): ChromeProfile[] {
  const localStatePath = path.join(root, 'Local State');
  if (!fs.existsSync(localStatePath)) return [];

  try {
    const raw = fs.readFileSync(localStatePath, 'utf-8');
    const parsed = JSON.parse(raw);
    const infoCache = parsed?.profile?.info_cache ?? {};
    const lastUsed = parsed?.profile?.last_used as string | undefined;

    return Object.entries(infoCache).map(([dirName, meta]) => ({
      id: `${path.basename(root)}:${dirName}`,
      name: (meta as any)?.name || dirName,
      path: path.join(root, dirName),
      isDefault: Boolean((meta as any)?.is_default) || dirName === 'Default' || dirName === lastUsed,
    }));
  } catch {
    return [];
  }
}

function enumerateProfileDirs(root: string): ChromeProfile[] {
  try {
    const entries = fs.readdirSync(root, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .filter(
        (entry) =>
          entry.name === 'Default' ||
          entry.name.startsWith('Profile') ||
          entry.name.toLowerCase().includes('guest')
      )
      .map((entry) => ({
        id: `${path.basename(root)}:${entry.name}`,
        name: entry.name,
        path: path.join(root, entry.name),
        isDefault: entry.name === 'Default',
      }));
  } catch {
    return [];
  }
}

function dedupeProfiles(profiles: ChromeProfile[]): ChromeProfile[] {
  const seen = new Set<string>();
  const result: ChromeProfile[] = [];

  for (const profile of profiles) {
    const key = path.resolve(profile.path);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(profile);
  }

  return result;
}

export function scanProfiles(): ChromeProfile[] {
  const roots = getUserDataRoots();
  const profiles: ChromeProfile[] = [];

  for (const root of roots) {
    profiles.push(...readLocalStateProfiles(root));
    profiles.push(...enumerateProfileDirs(root));
  }

  const deduped = dedupeProfiles(profiles);
  if (deduped.length === 0) return [];

  // Ensure a single default marker with priority to "Default"
  let defaultAssigned = false;
  for (const profile of deduped) {
    if (profile.name === 'Default' || path.basename(profile.path) === 'Default') {
      profile.isDefault = true;
      defaultAssigned = true;
      break;
    }
  }

  if (!defaultAssigned) {
    for (const profile of deduped) {
      if (profile.isDefault) {
        defaultAssigned = true;
        break;
      }
    }
  }

  if (!defaultAssigned && deduped.length > 0) {
    deduped[0].isDefault = true;
  }

  return deduped;
}

export function getProfileById(id: string): ChromeProfile | undefined {
  return scanProfiles().find((profile) => profile.id === id);
}

export function resolveProfilePath(nameOrId: string): string {
  const term = nameOrId.trim().toLowerCase();
  const profiles = scanProfiles();

  const match = profiles.find((profile) => {
    const profileName = profile.name.toLowerCase();
    const profileId = profile.id.toLowerCase();
    const dirName = path.basename(profile.path).toLowerCase();
    return profileId === term || profileName === term || dirName === term;
  });

  if (match) return match.path;

  throw new Error(`Chrome profile not found for "${nameOrId}". Available: ${profiles.map((p) => p.name).join(', ')}`);
}

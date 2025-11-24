import fs from 'fs/promises';
import path from 'path';

import {
  type ChromeProfile as CoreChromeProfile,
  scanProfiles as coreScanProfiles,
} from '../../core/chrome/profiles';
import { getConfig, updateConfig } from '../config/config';
import { logError, logInfo } from '../logging/logger';
import { ensureDir } from '../utils/fs';

export type ChromeProfile = {
  id: string;
  name: string;
  userDataDir: string;
  profileDirectory: string;
  profileDir?: string;
  /** Absolute path to the specific profile directory (e.g., .../Chrome/Default). */
  path?: string;
  isDefault?: boolean;
  lastUsed?: string;
  isActive?: boolean;
};

export interface ChromeProfileInfo {
  id: string;
  name: string;
  isDefault: boolean;
  lastUsed?: string;
}

export type SessionProfilePreference = {
  chromeProfileName?: string | null;
  userDataDir?: string | null;
  profileDirectory?: string | null;
};

let cachedProfiles: ChromeProfile[] | null = null;

type VerificationResult = { ok: boolean; reason?: string };

function mapCoreProfile(profile: CoreChromeProfile): ChromeProfile {
  const profileDirectory = path.basename(profile.path);
  const userDataDir = path.dirname(profile.path);

  return {
    id: profile.id,
    name: profile.name,
    userDataDir,
    profileDirectory,
    profileDir: profileDirectory,
    isDefault: profile.isDefault ?? profileDirectory === 'Default',
    path: profile.path,
  };
}

function mapCoreProfiles(profiles: CoreChromeProfile[]): ChromeProfile[] {
  return profiles.map(mapCoreProfile);
}

function slugifyProfileName(name: string): string {
  const normalized = name.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-_]/gi, '');
  return normalized.length > 0 ? normalized : 'profile';
}

async function dirExists(candidate: string): Promise<boolean> {
  try {
    const stats = await fs.stat(candidate);
    return stats.isDirectory();
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return false;
    throw error;
  }
}

async function pathExists(candidate: string): Promise<boolean> {
  try {
    await fs.access(candidate);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return false;
    throw error;
  }
}

export async function ensureCloneSeededFromProfile(
  profile: ChromeProfile,
  cloneDir: string
): Promise<void> {
  const sourceProfileDir = path.join(
    profile.userDataDir,
    profile.profileDirectory || profile.profileDir || 'Default'
  );
  const targetProfileDir = path.join(
    cloneDir,
    profile.profileDirectory || profile.profileDir || 'Default'
  );

  const sourceLocalState = path.join(profile.userDataDir, 'Local State');
  const targetLocalState = path.join(cloneDir, 'Local State');

  const profileDirName = profile.profileDirectory || profile.profileDir || 'Default';

  const hasTargetProfile = await dirExists(targetProfileDir);
  const hasTargetLocalState = await pathExists(targetLocalState);

  // Seed Local State so Chrome recognizes the profile metadata inside the clone.
  if (!hasTargetLocalState) {
    await ensureDir(path.dirname(targetLocalState));

    if (await pathExists(sourceLocalState)) {
      await fs.copyFile(sourceLocalState, targetLocalState);
    } else {
      // Create a minimal Local State so Chrome doesn't fall back to a guest session.
      const minimalState = {
        profile: {
          info_cache: {
            [profileDirName]: {
              name: profile.name ?? profileDirName,
              is_default: true,
            },
          },
          last_used: profileDirName,
          last_active_profiles: [profileDirName],
        },
      } as Record<string, unknown>;

      await fs.writeFile(targetLocalState, JSON.stringify(minimalState, null, 2), 'utf-8');
    }
  }

  if (!hasTargetProfile) {
    const sourceExists = await dirExists(sourceProfileDir);
    if (!sourceExists) {
      throw new Error(
        `Chrome profile directory not found at ${sourceProfileDir}. Please re-select the profile in Settings.`
      );
    }

    await ensureDir(path.dirname(targetProfileDir));
    await fs.cp(sourceProfileDir, targetProfileDir, { recursive: true });
  }

  await rewriteLocalStateForClone(targetLocalState, profileDirName, profile.name);
}

async function rewriteLocalStateForClone(
  localStatePath: string,
  profileDirName: string,
  profileDisplayName?: string
): Promise<void> {
  try {
    const raw = await fs.readFile(localStatePath, 'utf-8');
    const parsed = JSON.parse(raw) as any;

    if (!parsed.profile) parsed.profile = {};
    if (!parsed.profile.info_cache) parsed.profile.info_cache = {};

    // Ensure the selected profile exists in the cache and is marked as default/last used
    const entry = parsed.profile.info_cache[profileDirName] ?? {};
    parsed.profile.info_cache[profileDirName] = {
      name: entry.name ?? profileDisplayName ?? profileDirName,
      gaia_name: entry.gaia_name ?? profileDisplayName ?? profileDirName,
      is_default: true,
      ...entry,
    };

    parsed.profile.last_used = profileDirName;
    parsed.profile.last_active_profiles = [profileDirName];

    // Mark all other profiles as non-default to avoid Chrome preferring them.
    for (const [key, value] of Object.entries(parsed.profile.info_cache)) {
      if (key !== profileDirName && typeof value === 'object' && value) {
        (value as any).is_default = false;
      }
    }

    await fs.writeFile(localStatePath, JSON.stringify(parsed, null, 2), 'utf-8');
  } catch (error) {
    logError(
      'chromeProfiles',
      `Failed to rewrite Local State for cloned profile ${profileDirName}: ${(error as Error).message}`
    );
  }
}

function annotateActive(
  profiles: ChromeProfile[],
  activeId?: string | null,
  activeUserDataDir?: string | null
): ChromeProfile[] {
  return profiles.map((profile) => {
    const matchesName = activeId ? profile.profileDirectory === activeId || profile.id === activeId : false;
    const matchesDir = activeUserDataDir ? profile.userDataDir === activeUserDataDir : true;
    return {
      ...profile,
      isActive: matchesName && matchesDir,
    };
  });
}

export async function resolveProfileLaunchTarget(
  profile: ChromeProfile
): Promise<{ userDataDir: string; profileDirectoryArg?: string }> {
  /**
   * Sora 9–style behavior:
   * We NEVER launch Chrome directly against the system user-data root like:
   *   ~/Library/Application Support/Google/Chrome
   *
   * Instead, we always use a dedicated "automation" clone directory under
   *   config.chromeClonedProfilesRoot (default: <sessionsRoot>/chrome-clones)
   * so that:
   *   - normal Chrome can stay open on the main profile,
   *   - automation Chrome instances are fully sandboxed,
   *   - each selected profile gets its own stable clone dir.
   *
   * The "profile" argument still comes from scanChromeProfiles(), which reads
   * the real profiles, but the launched Chrome will use our cloned dir.
   */

  const config = await getConfig();
  const cloneRoot =
    config.chromeClonedProfilesRoot || path.join(config.sessionsRoot, 'chrome-clones');

  // Ensure root exists
  await ensureDir(cloneRoot);

  // Build a stable slug for this profile's automation clone
  const baseName = profile.profileDirectory || profile.name || profile.id;
  const slug = slugifyProfileName(`${baseName}-sora-clone`);

  // Final cloned user-data dir for automation
  const userDataDir = path.join(cloneRoot, slug);

  // Ensure the cloned profile directory exists before launching Chrome so we
  // never fail with "profile directory not found" on first use.
  await ensureDir(userDataDir);

  // Seed the cloned directory with the selected profile's data so automation
  // starts with the user's existing cookies/extensions instead of a guest
  // profile.
  await ensureCloneSeededFromProfile(profile, userDataDir);

  // We intentionally DO NOT pass --profile-directory here.
  // Chrome will treat this userDataDir as an independent profile root.
  // All cookies/extensions/logins for Sora will live under this clone dir.
  return { userDataDir, profileDirectoryArg: undefined };
}

export async function verifyProfileClone(
  cloneDir: string,
  profileDirName = 'Default'
): Promise<VerificationResult> {
  const reasons: string[] = [];

  const profileDirPath = path.join(cloneDir, profileDirName);
  const preferencesPath = path.join(profileDirPath, 'Preferences');
  const localStatePath = path.join(cloneDir, 'Local State');

  try {
    const stats = await fs.stat(cloneDir);
    if (!stats.isDirectory()) {
      reasons.push('clone path is not a directory');
    }
  } catch (error) {
    const message = (error as Error)?.message ?? 'missing clone directory';
    reasons.push(`clone directory unavailable (${message})`);
  }

  try {
    const stats = await fs.stat(profileDirPath);
    if (!stats.isDirectory()) {
      reasons.push(`profile directory ${profileDirName} is not a folder`);
    }
  } catch (error) {
    const message = (error as Error)?.message ?? 'not found';
    reasons.push(`profile directory ${profileDirName} missing (${message})`);
  }

  try {
    const preferencesRaw = await fs.readFile(preferencesPath, 'utf-8');
    if (!preferencesRaw.trim()) {
      reasons.push('Preferences file is empty');
    } else {
      JSON.parse(preferencesRaw);
    }
  } catch (error) {
    const message = (error as Error)?.message ?? 'unreadable Preferences';
    reasons.push(`Preferences corrupted or unreadable (${message})`);
  }

  try {
    const localStateRaw = await fs.readFile(localStatePath, 'utf-8');
    if (localStateRaw.trim()) {
      JSON.parse(localStateRaw);
    }
  } catch (error) {
    const message = (error as Error)?.message ?? 'unreadable Local State';
    reasons.push(`Local State corrupted (${message})`);
  }

  if (reasons.length > 0) {
    return { ok: false, reason: reasons.join(' | ') };
  }

  return { ok: true };
}

export async function scanChromeProfiles(): Promise<ChromeProfile[]> {
  const config = await getConfig();
  const coreProfiles = coreScanProfiles();
  const mapped = mapCoreProfiles(coreProfiles);

  const annotated = annotateActive(
    mapped,
    config.chromeProfileId ?? config.chromeActiveProfileName ?? undefined,
    config.chromeUserDataRoot ?? config.chromeUserDataDir ?? undefined
  );

  cachedProfiles = annotated;
  logInfo('chromeProfiles', `Found ${annotated.length} profiles from system scan`);
  return annotated;
}

export async function setActiveChromeProfile(name: string): Promise<void> {
  const profiles = cachedProfiles ?? (await scanChromeProfiles());
  const match = profiles.find((p) => p.name === name || p.profileDirectory === name || p.id === name);

  if (!match) {
    throw new Error(`Profile "${name}" not found`);
  }

  const config = await updateConfig({
    chromeActiveProfileName: match.name,
    chromeProfileId: match.profileDirectory,
    chromeUserDataRoot: match.userDataDir,
    chromeUserDataDir: match.userDataDir,
  });

  cachedProfiles = annotateActive(profiles, match.profileDirectory, config.chromeUserDataDir ?? undefined);
  logInfo('chromeProfiles', `Active Chrome profile set to ${match.name} @ ${match.userDataDir}`);
}

export async function getActiveChromeProfile(): Promise<ChromeProfile | null> {
  const config = await getConfig();
  if (!cachedProfiles) {
    await scanChromeProfiles();
  }
  const desiredId = config.chromeProfileId ?? config.chromeActiveProfileName;
  const desiredRoot = config.chromeUserDataRoot ?? config.chromeUserDataDir;

  const profile = cachedProfiles?.find(
    (p) =>
      (p.profileDirectory === desiredId || p.id === desiredId || p.name === desiredId) &&
      (desiredRoot ? p.userDataDir === desiredRoot : true)
  );

  if (profile) return profile;

  return cachedProfiles?.find((p) => p.profileDirectory === desiredId || p.name === desiredId) ?? null;
}

export async function resolveChromeProfileForSession(
  preference?: SessionProfilePreference
): Promise<ChromeProfile | null> {
  const [profiles, config] = await Promise.all([scanChromeProfiles(), getConfig()]);

  const desiredName = preference?.chromeProfileName ?? config.chromeProfileId ?? config.chromeActiveProfileName ?? null;
  const desiredUserDataDir = preference?.userDataDir ?? config.chromeUserDataRoot ?? null;
  const desiredProfileDir = preference?.profileDirectory ?? null;

  const matchesPreference = (candidate: ChromeProfile, requireName: boolean): boolean => {
    const matchesName = desiredName
      ? candidate.name === desiredName || candidate.profileDirectory === desiredName || candidate.id === desiredName
      : !requireName;
    const matchesUserData = desiredUserDataDir ? candidate.userDataDir === desiredUserDataDir : true;
    const candidateDir = candidate.profileDirectory ?? candidate.profileDir;
    const matchesProfileDir = desiredProfileDir ? candidateDir === desiredProfileDir : true;

    const respectsConfiguredRoot = config.chromeUserDataDir ? candidate.userDataDir === config.chromeUserDataDir : true;

    return matchesName && matchesUserData && matchesProfileDir && respectsConfiguredRoot;
  };

  const strictMatch = profiles.find((profile) => matchesPreference(profile, false));
  if (strictMatch) return strictMatch;

  if (desiredName) {
    const nameOnlyMatch = profiles.find((profile) => matchesPreference(profile, true));
    if (nameOnlyMatch) return nameOnlyMatch;
  }

  const active = await getActiveChromeProfile();
  if (active) return active;

  return profiles[0] ?? null;
}

export async function cloneActiveChromeProfile(): Promise<{ ok: boolean; profile?: ChromeProfile; message?: string; error?: string }> {
  try {
    const config = await getConfig();
    const profiles = cachedProfiles ?? (await scanChromeProfiles());
    const active = profiles.find((p) => p.isActive) ?? profiles.find((p) => p.name === config.chromeActiveProfileName);
    if (!active) {
      throw new Error('Active Chrome profile not found. Please select a profile before cloning.');
    }

    const cloneRoot = config.chromeClonedProfilesRoot || path.join(config.sessionsRoot, 'chrome-clones');
    await ensureDir(cloneRoot);

    const slug = slugifyProfileName(`${active.profileDirectory || active.name}-sora-clone`);
    const targetUserDataDir = path.join(cloneRoot, slug);
    const sourceUserDataDir = active.userDataDir;

    if (sourceUserDataDir === targetUserDataDir) {
      // Already pointing at a cloned directory; just refresh cache.
      const refreshedConfig = await updateConfig({
        chromeUserDataDir: targetUserDataDir,
        chromeActiveProfileName: active.name,
        chromeClonedProfilesRoot: cloneRoot,
      });
      const refreshed = await scanChromeProfiles();
      const profile = refreshed.find((p) => p.userDataDir === targetUserDataDir && p.name === refreshedConfig.chromeActiveProfileName);
      return { ok: true, profile: profile ?? active, message: 'Using existing cloned profile' };
    }

    const targetExists = await dirExists(targetUserDataDir);
    if (!targetExists) {
      logInfo('chromeProfiles', `Cloning Chrome profile from ${sourceUserDataDir} to ${targetUserDataDir}`);
      await fs.cp(sourceUserDataDir, targetUserDataDir, { recursive: true });
    } else {
      logInfo('chromeProfiles', `Reusing existing cloned profile at ${targetUserDataDir}`);
    }

    const updatedConfig = await updateConfig({
      chromeUserDataDir: targetUserDataDir,
      chromeActiveProfileName: active.profileDirectory,
      chromeClonedProfilesRoot: cloneRoot,
    });

    const refreshed = await scanChromeProfiles();
    const profile = refreshed.find(
      (p) => p.userDataDir === targetUserDataDir && p.profileDirectory === updatedConfig.chromeActiveProfileName
    );

    return { ok: true, profile: profile ?? active, message: targetExists ? 'Cloned profile reused' : 'Profile cloned for Sora' };
  } catch (error) {
    const message = (error as Error)?.message ?? 'Failed to clone Chrome profile';
    logError('chromeProfiles', message);
    return { ok: false, error: message };
  }
}

export async function listChromeProfiles(): Promise<ChromeProfile[]> {
  const config = await getConfig();
  if (!cachedProfiles) {
    await scanChromeProfiles();
  }

  return annotateActive(
    cachedProfiles ?? [],
    config.chromeActiveProfileName ?? undefined,
    config.chromeUserDataDir ?? undefined
  );
}

export function applyConfig(): void {
  // no-op placeholder retained for compatibility
}

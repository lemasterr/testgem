# Chrome Profile System

This project uses a single, shared profile discovery module located at `core/chrome/profiles.ts`.
It scans the standard Chrome user-data roots (macOS, Windows, Linux) and returns profile entries
for the well-known directories such as `Default`, `Profile 1`, `Profile 2`, and guest profiles.

## Data model

```ts
interface ChromeProfile {
  id: string;       // stable identifier based on the user-data root and profile dir name
  name: string;     // display name from Chrome or the directory name
  path: string;     // absolute path to the specific profile directory (…/Chrome/Default)
  isDefault?: boolean; // true when the profile is the system Default
}
```

## Usage

- **Electron / automation**: use `scanChromeProfiles()` from `electron/chrome/profiles.ts`, which
  maps the core profiles into the extended shape expected by automation (adds `userDataDir`,
  `profileDirectory`, `profileDir`, `path`). All launch/automation flows should depend on this
  helper to avoid hardcoded paths.
- **Renderer UI**: the preload exposes `chrome.scanProfiles` so settings pages can populate
  profile lists. The UI shows both the profile name and full path to help users choose the right
  profile.
- **Launching Chrome**: consumers resolve the profile path from this module and pass it to the
  shared launcher (`core/chrome/chromeLauncher.ts`) which handles remote debugging flags and CDP
  readiness.

## Guarantees

- No hardcoded `/Users/...` paths; all detection is dynamic.
- Only one scanning implementation exists (the core module) and all callers reuse it via the
  Electron wrapper.
- The default profile is marked explicitly so sessions can reliably fall back when no preference
  is provided.

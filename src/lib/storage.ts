import {
  DEFAULT_CUSTOM_SHORTCUTS,
  DEFAULT_HOTKEYS,
  DEFAULT_OS_CONFIG,
} from './osDefaults';
import type { OSConfigState } from './types';

const STORAGE_KEY = 'monolith_os_config_v3';

export function loadOSConfig(): OSConfigState {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_OS_CONFIG;
    const parsed = JSON.parse(raw) as Partial<OSConfigState>;
    return {
      ...DEFAULT_OS_CONFIG,
      ...parsed,
      defaultCompositor: 'niri',
      appearance: {
        ...DEFAULT_OS_CONFIG.appearance,
        ...(parsed.appearance ?? {}),
      },
      nixSystem: {
        ...DEFAULT_OS_CONFIG.nixSystem,
        ...(parsed.nixSystem ?? {}),
      },
      storage: {
        ...DEFAULT_OS_CONFIG.storage,
        ...(parsed.storage ?? {}),
      },
      exportPaths: {
        ...DEFAULT_OS_CONFIG.exportPaths,
        ...(parsed.exportPaths ?? {}),
      },
      browser: {
        ...DEFAULT_OS_CONFIG.browser,
        ...(parsed.browser ?? {}),
      },
      hardware: {
        ...DEFAULT_OS_CONFIG.hardware,
        ...(parsed.hardware ?? {}),
      },
      hotkeys: {
        ...DEFAULT_HOTKEYS,
        ...(parsed.hotkeys ?? {}),
      },
      customShortcuts: Array.isArray(parsed.customShortcuts)
        ? parsed.customShortcuts
        : DEFAULT_CUSTOM_SHORTCUTS,
    };
  } catch {
    return DEFAULT_OS_CONFIG;
  }
}

export function saveOSConfig(config: OSConfigState): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
    // Ignore quota or storage restriction failures gracefully
  }
}

export function clearOSConfig(): OSConfigState {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore storage restriction failures
  }
  return DEFAULT_OS_CONFIG;
}

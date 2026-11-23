import { DEFAULT_OS_CONFIG } from './osDefaults';
import type { OSConfigState } from './types';

const STORAGE_KEY = 'monolith_os_config_v4';

export function loadOSConfig(): OSConfigState {
  if (typeof window === 'undefined') return DEFAULT_OS_CONFIG;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_OS_CONFIG;
    const parsed = JSON.parse(raw) as Partial<OSConfigState>;
    return {
      ...DEFAULT_OS_CONFIG,
      ...parsed,
      defaultCompositor: 'plasma6',
      appearance: {
        ...DEFAULT_OS_CONFIG.appearance,
        ...(parsed.appearance || {}),
      },
      nixSystem: {
        ...DEFAULT_OS_CONFIG.nixSystem,
        ...(parsed.nixSystem || {}),
      },
      storage: {
        ...DEFAULT_OS_CONFIG.storage,
        ...(parsed.storage || {}),
      },
      hotkeys: {
        ...DEFAULT_OS_CONFIG.hotkeys,
        ...(parsed.hotkeys || {}),
      },
      customShortcuts: Array.isArray(parsed.customShortcuts)
        ? parsed.customShortcuts
        : DEFAULT_OS_CONFIG.customShortcuts,
      exportPaths: {
        ...DEFAULT_OS_CONFIG.exportPaths,
        ...(parsed.exportPaths || {}),
      },
      browser: {
        ...DEFAULT_OS_CONFIG.browser,
        ...(parsed.browser || {}),
      },
      hardware: {
        ...DEFAULT_OS_CONFIG.hardware,
        ...(parsed.hardware || {}),
      },
    };
  } catch {
    return DEFAULT_OS_CONFIG;
  }
}

export function saveOSConfig(config: OSConfigState): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
    // Ignore quota errors in sandboxed preview environments
  }
}

export function clearOSConfig(): OSConfigState {
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Ignore
    }
  }
  return DEFAULT_OS_CONFIG;
}

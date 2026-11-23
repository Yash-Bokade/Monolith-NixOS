import { TOOLCHAIN_CATALOG } from './osDefaults';
import type { OSConfigState, UsbBootConfig } from './types';

export const TIMEZONE_OPTIONS = [
  'UTC',
  'Asia/Kolkata',
  'America/New_York',
  'America/Los_Angeles',
  'America/Chicago',
  'Europe/London',
  'Europe/Berlin',
  'Europe/Paris',
  'Asia/Tokyo',
  'Asia/Singapore',
  'Australia/Sydney',
];

export const KEYMAP_OPTIONS = [
  { code: 'us', label: 'US English (qwerty)' },
  { code: 'uk', label: 'UK English' },
  { code: 'de', label: 'German (qwertz)' },
  { code: 'fr', label: 'French (azerty)' },
  { code: 'es', label: 'Spanish' },
  { code: 'in', label: 'Indian English' },
];

export function createDefaultUsbBootConfig(osConfig: OSConfigState): UsbBootConfig {
  const stackVersions: Record<string, string> = {};
  for (const tc of TOOLCHAIN_CATALOG) {
    stackVersions[tc.id] = tc.defaultVersion;
  }
  return {
    username: osConfig.username || 'dev',
    password: '',
    hostname: osConfig.hostname || 'monolith-usb',
    timezone: 'UTC',
    keymap: 'us',
    compositor: 'plasma6',
    nixChannel: osConfig.nixSystem.channel || 'nixos-unstable',
    windowsExeSupport: osConfig.nixSystem.windowsExeSupport,
    wifiSsid: '',
    wifiPassword: '',
    gitName: '',
    gitEmail: '',
    preinstallStacks: [],
    stackVersions,
    extraPackages: '',
    autoUpdate: false,
    githubRepo: '',
    skipInteractiveWizard: false,
  };
}

export function validateUsbBootConfig(cfg: UsbBootConfig): {
  isValid: boolean;
  errors: Record<string, string>;
} {
  const errors: Record<string, string> = {};
  if (!/^[a-z_][a-z0-9_-]{0,31}$/.test(cfg.username)) {
    errors.username =
      'Username must be lowercase letters, numbers, hyphens, or underscores (max 32 chars).';
  }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9-]{0,62}$/.test(cfg.hostname)) {
    errors.hostname = 'Hostname must contain only letters, numbers, and hyphens.';
  }
  if (cfg.password && cfg.password.length < 4) {
    errors.password =
      'Password must be at least 4 characters (or leave blank to keep default "monolith").';
  }
  if (cfg.wifiPassword && !cfg.wifiSsid.trim()) {
    errors.wifiSsid = 'Enter a Wi-Fi SSID name if you provide a Wi-Fi password.';
  }
  if (cfg.githubRepo.trim() && !/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(cfg.githubRepo.trim())) {
    errors.githubRepo = 'GitHub repo must be in "owner/repo" format (e.g., yourname/monolith-os).';
  }
  return { isValid: Object.keys(errors).length === 0, errors };
}

function escapeShellDoubleQuotes(val: string): string {
  return val.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\$/g, '\\$').replace(/`/g, '\\`');
}

export function generateUsbBootConf(cfg: UsbBootConfig): string {
  const cleanExtraPkgs = cfg.extraPackages
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter((s) => /^[a-zA-Z0-9@._+-]+$/.test(s))
    .join(' ');

  const selectedVersionPairs = cfg.preinstallStacks
    .map((id) => `${id}=${cfg.stackVersions[id] || 'latest'}`)
    .join(' ');

  return `# ==============================================================================
# Monolith NixOS — Post-Rufus Boot Customizer (monolith-boot.conf)
# ==============================================================================
# Place this file on the USB drive (EFI partition or /persist/monolith-boot.conf)
# BEFORE booting on any PC. Monolith NixOS applies these settings automatically
# before KDE Plasma 6 Wayland starts.
# ==============================================================================

MONOLITH_USER="${escapeShellDoubleQuotes(cfg.username.trim())}"
MONOLITH_PASSWORD="${escapeShellDoubleQuotes(cfg.password)}"
MONOLITH_HOSTNAME="${escapeShellDoubleQuotes(cfg.hostname.trim())}"
MONOLITH_TIMEZONE="${escapeShellDoubleQuotes(cfg.timezone.trim() || 'UTC')}"
MONOLITH_KEYMAP="${escapeShellDoubleQuotes(cfg.keymap.trim() || 'us')}"
MONOLITH_COMPOSITOR="plasma6"
MONOLITH_NIX_CHANNEL="${escapeShellDoubleQuotes(cfg.nixChannel)}"
MONOLITH_WINDOWS_EXE="${cfg.windowsExeSupport ? 'true' : 'false'}"

# Optional: Auto-connect Wi-Fi on first boot (saved to NetworkManager)
MONOLITH_WIFI_SSID="${escapeShellDoubleQuotes(cfg.wifiSsid.trim())}"
MONOLITH_WIFI_PSK="${escapeShellDoubleQuotes(cfg.wifiPassword)}"

# Optional: Git global author identity
MONOLITH_GIT_NAME="${escapeShellDoubleQuotes(cfg.gitName.trim())}"
MONOLITH_GIT_EMAIL="${escapeShellDoubleQuotes(cfg.gitEmail.trim())}"

# Optional: Pre-select stacks & versions for on-demand local project environments
MONOLITH_PREINSTALL_STACKS="${cfg.preinstallStacks.join(' ')}"
MONOLITH_STACK_VERSIONS="${escapeShellDoubleQuotes(selectedVersionPairs)}"
MONOLITH_EXTRA_PKGS="${escapeShellDoubleQuotes(cleanExtraPkgs)}"

# Optional: Automatic OTA updates from your GitHub repo on boot
MONOLITH_AUTO_UPDATE="${cfg.autoUpdate ? 'true' : 'false'}"
MONOLITH_GITHUB_REPO="${escapeShellDoubleQuotes(cfg.githubRepo.trim())}"

# Optional: Skip interactive first-boot prompt and boot straight into Plasma 6 Wayland
MONOLITH_SKIP_WIZARD="${cfg.skipInteractiveWizard ? 'true' : 'false'}"
`;
}

export function generateWindowsDropHelperBat(): string {
  return `@echo off
setlocal enabledelayedexpansion
echo ============================================================================
echo   Monolith NixOS — Copy monolith-boot.conf to Flashed USB Drive
echo ============================================================================
echo.
if not exist "%~dp0monolith-boot.conf" (
  echo [ERROR] Place monolith-boot.conf in the same folder as this .bat file!
  pause
  exit /b 1
)
set /p DRIVE=Enter the drive letter of your flashed Monolith USB (e.g. E): 
set DRIVE=%DRIVE::=%
if not exist "%DRIVE%:\\" (
  echo [ERROR] Drive %DRIVE%:\\ not found.
  pause
  exit /b 1
)
copy /Y "%~dp0monolith-boot.conf" "%DRIVE%:\\monolith-boot.conf"
if %errorlevel%==0 (
  echo.
  echo [OK] Copied monolith-boot.conf to %DRIVE%:\\monolith-boot.conf
  echo You can now safely eject the USB and boot any PC into Optimized Plasma 6 Wayland!
) else (
  echo [ERROR] Could not copy file. Try running as Administrator.
)
pause
`;
}

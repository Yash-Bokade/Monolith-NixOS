import { TOOLCHAIN_CATALOG } from './osDefaults';
import type { OSConfigState, UsbBootConfig } from './types';

export const TIMEZONE_OPTIONS: string[] = [
  'UTC',
  'Asia/Kolkata',
  'America/New_York',
  'America/Chicago',
  'America/Los_Angeles',
  'Europe/London',
  'Europe/Berlin',
  'Asia/Tokyo',
  'Asia/Singapore',
  'Australia/Sydney',
];

export const KEYMAP_OPTIONS: { code: string; label: string }[] = [
  { code: 'us', label: 'US English (us)' },
  { code: 'uk', label: 'UK English (uk)' },
  { code: 'de', label: 'German (de)' },
  { code: 'fr', label: 'French (fr)' },
  { code: 'es', label: 'Spanish (es)' },
  { code: 'jp', label: 'Japanese (jp)' },
  { code: 'in', label: 'Indian English (in)' },
];

export function createDefaultUsbBootConfig(osConfig: OSConfigState): UsbBootConfig {
  return {
    username: osConfig.username || 'dev',
    password: 'monolith',
    hostname: osConfig.hostname || 'monolith-usb',
    timezone: 'UTC',
    keymap: 'us',
    compositor: 'niri',
    nixChannel: osConfig.nixSystem.channel,
    windowsExeSupport: osConfig.nixSystem.windowsExeSupport,
    wifiSsid: '',
    wifiPassword: '',
    gitName: '',
    gitEmail: '',
    preinstallStacks: ['rust', 'nodejs'],
    stackVersions: Object.fromEntries(TOOLCHAIN_CATALOG.map((t) => [t.id, t.defaultVersion])),
    extraPackages: '',
    autoUpdate: true,
    githubRepo: '',
    skipInteractiveWizard: false,
  };
}

export interface UsbBootConfigValidation {
  isValid: boolean;
  errors: Partial<Record<'username' | 'password' | 'hostname' | 'githubRepo', string>>;
}

export function validateUsbBootConfig(cfg: UsbBootConfig): UsbBootConfigValidation {
  const errors: UsbBootConfigValidation['errors'] = {};
  const user = cfg.username.trim();
  const host = cfg.hostname.trim();
  const repo = cfg.githubRepo.trim();

  if (!/^[a-z_][a-z0-9_-]{0,31}$/.test(user)) {
    errors.username = 'Use lowercase letters, numbers, underscores, or hyphens (start with a letter).';
  }
  if (cfg.password.length < 4) {
    errors.password = 'Password must be at least 4 characters.';
  }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9-]{0,62}$/.test(host)) {
    errors.hostname = 'Hostname may contain letters, numbers, and hyphens only.';
  }
  if (repo.length > 0 && !/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(repo)) {
    errors.githubRepo = 'Use owner/repo format (for example: octocat/monolith-os).';
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
  };
}

function escapeConfValue(raw: string): string {
  return raw
    .replace(/\r?\n/g, ' ')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\$/g, '\\$')
    .replace(/`/g, '\\`')
    .trim();
}

export function generateUsbBootConf(cfg: UsbBootConfig): string {
  const stackPairs = cfg.preinstallStacks
    .map((id) => `${id}:${cfg.stackVersions[id] ?? 'latest'}`)
    .join(',');

  const extraPkgs = cfg.extraPackages
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .join(' ');

  return `# =============================================================================
# Monolith NixOS — Post-Rufus First-Boot Override Config (monolith-boot.conf)
# =============================================================================
# Drop this file onto your flashed USB pendrive AFTER Rufus finishes:
#   - Rufus ISO Mode : Save directly to root of the USB drive (e.g. E:\\monolith-boot.conf)
#   - Rufus DD Mode  : Save to the USB EFI partition (or run copy-to-monolith-usb.bat)
#
# Monolith NixOS reads this file automatically at boot BEFORE login, imports it
# securely into /persist/monolith-boot.conf (chmod 600), and applies every setting.
# =============================================================================

# Account & System Identity (Niri Wayland Only)
MONOLITH_USER="${escapeConfValue(cfg.username)}"
MONOLITH_PASSWORD="${escapeConfValue(cfg.password)}"
MONOLITH_HOSTNAME="${escapeConfValue(cfg.hostname)}"
MONOLITH_TIMEZONE="${escapeConfValue(cfg.timezone)}"
MONOLITH_KEYMAP="${escapeConfValue(cfg.keymap)}"
MONOLITH_COMPOSITOR="niri"
MONOLITH_NIX_CHANNEL="${escapeConfValue(cfg.nixChannel)}"

# Windows .exe Compatibility Layer (Wine + Winetricks via Nixpkgs)
MONOLITH_WINDOWS_EXE="${cfg.windowsExeSupport ? 'true' : 'false'}"

# Optional Pre-Configured Wi-Fi (auto-connects on first boot before wizard)
MONOLITH_WIFI_SSID="${escapeConfValue(cfg.wifiSsid)}"
MONOLITH_WIFI_PSK="${escapeConfValue(cfg.wifiPassword)}"

# Optional Git Identity (auto-written to ~/.gitconfig on MONOLITH_PERSIST)
MONOLITH_GIT_NAME="${escapeConfValue(cfg.gitName)}"
MONOLITH_GIT_EMAIL="${escapeConfValue(cfg.gitEmail)}"

# First-Boot Language Toolchains & Automation
MONOLITH_PREINSTALL_STACKS="${escapeConfValue(stackPairs)}"
MONOLITH_EXTRA_PKGS="${escapeConfValue(extraPkgs)}"
MONOLITH_SKIP_WIZARD="${cfg.skipInteractiveWizard ? 'true' : 'false'}"

# Auto-Update & GitHub Release Check (used by monolith-update / Super+Alt+U)
MONOLITH_AUTO_UPDATE="${cfg.autoUpdate ? 'true' : 'false'}"
MONOLITH_GITHUB_REPO="${escapeConfValue(cfg.githubRepo)}"
`;
}

export function generateWindowsDropHelperBat(): string {
  return `@echo off
setlocal EnableDelayedExpansion
title Monolith NixOS — Copy monolith-boot.conf to Flashed USB Drive

if not exist "%~dp0monolith-boot.conf" (
  echo [ERROR] Place this script in the same folder as your downloaded monolith-boot.conf!
  pause
  exit /b 1
)

echo Searching for your flashed Monolith NixOS USB drive...
set "TARGET="

for %%D in (D E F G H I J K L M N O P Q R S T U V W X Y Z) do (
  if exist "%%D:\\" (
    for /f "tokens=5*" %%a in ('vol %%D: 2^>nul ^| find /i "Volume in drive"') do set "VLABEL=%%b"
    if exist "%%D:\\EFI\\BOOT" set "TARGET=%%D:"
    if exist "%%D:\\nix-store.squashfs" set "TARGET=%%D:"
    echo !VLABEL! | findstr /i "MONOLITH" >nul && set "TARGET=%%D:"
  )
)

if defined TARGET (
  echo Found Monolith NixOS USB partition at !TARGET!
  copy /Y "%~dp0monolith-boot.conf" "!TARGET!\\monolith-boot.conf" >nul
  if !errorlevel! equ 0 (
    echo [OK] Copied monolith-boot.conf to !TARGET!\\monolith-boot.conf
    echo Safely eject your USB drive and boot into Monolith NixOS!
  ) else (
    echo [ERROR] Could not write to !TARGET!. Run as Administrator or copy manually.
  )
) else (
  echo Could not auto-detect a writable USB drive letter.
  set /p "MANUAL_DRIVE=Enter your USB drive letter (e.g. E): "
  copy /Y "%~dp0monolith-boot.conf" "!MANUAL_DRIVE!:\\monolith-boot.conf"
)

pause
`;
}

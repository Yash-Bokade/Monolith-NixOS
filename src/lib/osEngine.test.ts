import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_OS_CONFIG } from './osDefaults';
import {
  buildOsSourceZip,
  calculatePartitions,
  detectHotkeyConflicts,
  estimateIdleRamMb,
  formatGlobalInstallCommand,
  generateOsRepositoryFiles,
  generateShortcutsText,
  resolveToolchainPlan,
} from './osEngine';
import {
  createDefaultUsbBootConfig,
  generateUsbBootConf,
  generateWindowsDropHelperBat,
  validateUsbBootConfig,
} from './usbBootConfig';

test('calculatePartitions defaults to 100% persistence (no exFAT when using LocalSend) and supports optional exFAT', () => {
  const default32 = calculatePartitions({
    ...DEFAULT_OS_CONFIG.storage,
    nominalDriveGb: 32,
    totalUsableGb: 27.25,
  });
  assert.equal(default32.isValid, true);
  assert.equal(default32.persistencePercent, 100);
  assert.equal(default32.exfatTransferGb, 0);
  assert.equal(default32.persistenceGb, 24.75);
  assert.equal(default32.warning, null);

  const optionalExfat32 = calculatePartitions({
    ...DEFAULT_OS_CONFIG.storage,
    nominalDriveGb: 32,
    totalUsableGb: 27.25,
    persistencePercent: 75,
    createExfatTransfer: true,
  });
  assert.equal(optionalExfat32.isValid, true);
  assert.equal(optionalExfat32.persistenceGb, 18.56);
  assert.equal(optionalExfat32.exfatTransferGb, 6.19);

  const tooSmall = calculatePartitions({
    ...DEFAULT_OS_CONFIG.storage,
    nominalDriveGb: 16,
    totalUsableGb: 14.4,
  });
  assert.equal(tooSmall.isValid, false);
  assert.ok(tooSmall.warning !== null);
});

test('estimateIdleRamMb stays strictly below 500 MB idle RAM budget', () => {
  const breakdown = estimateIdleRamMb(DEFAULT_OS_CONFIG);
  assert.ok(breakdown.totalIdleMb < 500, `Expected < 500 MB idle, got ${breakdown.totalIdleMb}`);
  assert.equal(breakdown.withinBudget, true);
});

test('detectHotkeyConflicts checks built-in and custom app shortcuts', () => {
  assert.deepEqual(
    detectHotkeyConflicts(DEFAULT_OS_CONFIG.hotkeys, DEFAULT_OS_CONFIG.customShortcuts),
    [],
  );

  const colliding = detectHotkeyConflicts(DEFAULT_OS_CONFIG.hotkeys, [
    ...DEFAULT_OS_CONFIG.customShortcuts,
    {
      id: 'custom-dup',
      label: 'Duplicate',
      command: 'foot',
      modifier: 'Super',
      key: 'Q',
    },
  ]);
  assert.equal(colliding.length, 1);
  assert.ok(colliding[0].actions.includes('closeWindow'));
  assert.ok(colliding[0].actions.includes('custom-dup'));
});

test('formatGlobalInstallCommand outputs exact nix profile install command', () => {
  assert.equal(
    formatGlobalInstallCommand('nixpkgs#fastfetch'),
    "nix --extra-experimental-features 'nix-command flakes' profile install nixpkgs#fastfetch",
  );
  assert.equal(
    formatGlobalInstallCommand('vlc'),
    "nix --extra-experimental-features 'nix-command flakes' profile install nixpkgs#vlc",
  );
});

test('resolveToolchainPlan maps Java + Rust + custom packages to Nixpkgs and Neovim LSPs', () => {
  const plan = resolveToolchainPlan(['java', 'rust'], 'zig, htop');
  assert.ok(plan.nixPackages.includes('jdk21'));
  assert.ok(plan.nixPackages.includes('rustup'));
  assert.ok(plan.nixPackages.includes('zig'));
  assert.ok(plan.nvimLspServers.includes('jdtls'));
  assert.ok(plan.nvimLspServers.includes('rust_analyzer'));
});

test('generateOsRepositoryFiles emits Niri-only latest NixOS config with zero Hyprland, rounded corners, JetBrains Mono, auto-hide bar, RAM cleaner, and Wine .exe prompt', () => {
  const customConfig = {
    ...DEFAULT_OS_CONFIG,
    appearance: {
      ...DEFAULT_OS_CONFIG.appearance,
      theme: 'phosphor-mono' as const,
      cornerRadiusPx: 14,
      windowOpacity: 0.86,
      taskbarAutoHide: true,
      taskbarShowOnStart: true,
    },
    nixSystem: {
      ...DEFAULT_OS_CONFIG.nixSystem,
      channel: 'nixos-unstable' as const,
      useLatestNixPackage: true,
      windowsExeSupport: true,
      globalPackages: [...DEFAULT_OS_CONFIG.nixSystem.globalPackages, 'fastfetch'],
    },
    customShortcuts: [
      ...DEFAULT_OS_CONFIG.customShortcuts,
      {
        id: 'custom-music',
        label: 'Open Spotify TUI',
        command: 'foot spotify_player',
        modifier: 'Super+Alt' as const,
        key: 'M',
      },
    ],
  };

  const files = generateOsRepositoryFiles(customConfig);
  const byPath = new Map(files.map((f) => [f.path, f.content]));

  assert.deepEqual(
    files.map((f) => f.path),
    [
      '.github/workflows/build-nixos.yml',
      'nixos/flake.nix',
      'nixos/configuration.nix',
      'README.md',
      'docs/RUFUS_FLASHING_GUIDE.md',
    ],
  );

  const flake = byPath.get('nixos/flake.nix')!;
  assert.match(flake, /github:NixOS\/nixpkgs\/nixos-unstable/);
  assert.doesNotMatch(flake, /hyprland/i);

  const nixCfg = byPath.get('nixos/configuration.nix')!;
  // Niri-only, strictly zero Hyprland
  assert.match(nixCfg, /programs\.niri\.enable = true;/);
  assert.doesNotMatch(nixCfg, /hyprland/i);
  assert.doesNotMatch(nixCfg, /hyprctl/i);

  // Latest Nix, JetBrains Mono, Wallpaper, Rounded Corners, Transparency, Auto-Hide Taskbar
  assert.match(nixCfg, /nix\.package = pkgs\.nixVersions\.latest;/);
  assert.match(nixCfg, /jetbrains-mono/);
  assert.match(nixCfg, /geometry-corner-radius 14\.0/);
  assert.match(nixCfg, /opacity 0\.86/);
  assert.match(nixCfg, /prefer-no-csd/);
  assert.match(nixCfg, /gtk-decoration-layout=/);
  assert.match(nixCfg, /"start_hidden": false/);
  assert.match(nixCfg, /"mode": "hide"/);
  assert.match(nixCfg, /swaybg/);
  assert.match(nixCfg, /swayidle/);

  // Hardware (USB, HDMI, Wi-Fi, Bluetooth), RAM Cleaner, Screensaver, Wine .exe, Global & Local Pkgs
  assert.match(nixCfg, /services\.udisks2\.enable = true;/);
  assert.match(nixCfg, /udiskie/);
  assert.match(nixCfg, /wlr-randr/);
  assert.match(nixCfg, /kanshi/);
  assert.match(nixCfg, /hardware\.bluetooth/);
  assert.match(nixCfg, /zramSwap/);
  assert.match(nixCfg, /services\.earlyoom\.enable = true;/);
  assert.match(nixCfg, /monolith-ram-clean/);
  assert.match(nixCfg, /monolith-screensaver/);
  assert.match(nixCfg, /monolith-settings/);
  assert.match(nixCfg, /monolith-pkg/);
  assert.match(nixCfg, /monolith-hardware/);
  assert.match(nixCfg, /monolith-exe/);
  assert.match(nixCfg, /wineWowPackages\.stable/);
  assert.match(nixCfg, /winetricks/);
  assert.match(nixCfg, /fastfetch/);
  assert.match(nixCfg, /Mod\+Alt\+M \{ spawn "sh" "-lc" "foot spotify_player"; \}/);
  assert.match(nixCfg, /34d399/i);

  const shortcutsTxt = generateShortcutsText(customConfig);
  assert.match(shortcutsTxt, /Open Spotify TUI/);
  assert.doesNotMatch(shortcutsTxt, /Hyprland/i);
});

test('usbBootConfig validates fields and outputs Niri-only monolith-boot.conf with Windows .exe flag', () => {
  const defaults = createDefaultUsbBootConfig(DEFAULT_OS_CONFIG);
  assert.equal(validateUsbBootConfig(defaults).isValid, true);
  assert.equal(defaults.compositor, 'niri');

  const conf = generateUsbBootConf({
    ...defaults,
    username: 'alex',
    windowsExeSupport: true,
    nixChannel: 'nixos-unstable',
  });
  assert.match(conf, /MONOLITH_COMPOSITOR="niri"/);
  assert.match(conf, /MONOLITH_WINDOWS_EXE="true"/);
  assert.match(conf, /MONOLITH_NIX_CHANNEL="nixos-unstable"/);

  const bat = generateWindowsDropHelperBat();
  assert.match(bat, /monolith-boot\.conf/);
});

test('buildOsSourceZip produces a valid non-empty zip archive blob', async () => {
  const blob = await buildOsSourceZip(DEFAULT_OS_CONFIG);
  assert.ok(blob.size > 5000);
});

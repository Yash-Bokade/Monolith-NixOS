import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
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

test('generateOsRepositoryFiles emits Optimized Graphical KDE Plasma 6 Wayland NixOS config with rounded menus, native System Settings, unified shortcuts, Baloo disabled, RAM cleaner, and Wine .exe prompt', () => {
  const customConfig = {
    ...DEFAULT_OS_CONFIG,
    appearance: {
      ...DEFAULT_OS_CONFIG.appearance,
      theme: 'phosphor-mono' as const,
      cornerRadiusPx: 14,
      windowOpacity: 0.86,
      taskbarAutoHide: true,
      taskbarShowOnStart: true,
      barPosition: 'bottom' as const,
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
        command: 'konsole -e spotify_player',
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
  // Optimized Graphical KDE Plasma 6 Wayland, strictly zero Niri/Waybar/Fuzzel/Hyprland
  assert.match(nixCfg, /services\.desktopManager\.plasma6\.enable = true;/);
  assert.match(nixCfg, /services\.displayManager\.sddm\s*=\s*\{[\s\S]*?wayland\.enable = true;/);
  assert.match(nixCfg, /services\.displayManager\.defaultSession = "plasma";/);
  assert.match(nixCfg, /environment\.plasma6\.excludePackages/);
  assert.doesNotMatch(nixCfg, /programs\.niri\.enable/);
  assert.doesNotMatch(nixCfg, /hyprland/i);
  assert.doesNotMatch(nixCfg, /hyprctl/i);
  assert.doesNotMatch(nixCfg, /tuigreet/i);

  // Latest Nix, JetBrains Mono, Native Rounded Breeze Dark, Translucent Windows, Zero Window Buttons
  assert.match(nixCfg, /nix\.package = pkgs\.nixVersions\.latest;/);
  assert.match(nixCfg, /jetbrains-mono/);
  assert.match(nixCfg, /ButtonsOnLeft=/);
  assert.match(nixCfg, /ButtonsOnRight=/);
  assert.match(nixCfg, /opacityactive=86/);
  assert.match(nixCfg, /Indexing-Enabled=false/);
  assert.match(nixCfg, /gtk-decoration-layout=/);
  assert.match(nixCfg, /p\.floating = true;/);
  assert.match(nixCfg, /p\.hiding = "autohide";/);

  // Unified Shortcut System (kglobalshortcutsrc + native System Settings)
  assert.match(nixCfg, /kglobalshortcutsrc/);
  assert.match(nixCfg, /\[services\]\[systemsettings\.desktop\]/);
  assert.match(nixCfg, /monolith-plasma-init/);
  assert.match(nixCfg, /exec systemsettings/);
  assert.match(nixCfg, /_launch=Meta\+Alt\+M/);
  assert.match(nixCfg, /52,211,153/);

  // Hardware (USB, HDMI, Wi-Fi, Bluetooth), RAM Cleaner, Screensaver, Wine .exe, Global & Local Pkgs
  assert.match(nixCfg, /services\.udisks2\.enable = true;/);
  assert.match(nixCfg, /kscreen-doctor/);
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

  const shortcutsTxt = generateShortcutsText(customConfig);
  assert.match(shortcutsTxt, /Open Spotify TUI/);
  assert.match(shortcutsTxt, /KDE Plasma 6 Wayland/);
  assert.doesNotMatch(shortcutsTxt, /Hyprland/i);
});

test('usbBootConfig validates fields and outputs Plasma 6 monolith-boot.conf with Windows .exe flag', () => {
  const defaults = createDefaultUsbBootConfig(DEFAULT_OS_CONFIG);
  assert.equal(validateUsbBootConfig(defaults).isValid, true);
  assert.equal(defaults.compositor, 'plasma6');

  const conf = generateUsbBootConf({
    ...defaults,
    username: 'alex',
    windowsExeSupport: true,
    nixChannel: 'nixos-unstable',
  });
  assert.match(conf, /MONOLITH_COMPOSITOR="plasma6"/);
  assert.match(conf, /MONOLITH_WINDOWS_EXE="true"/);
  assert.match(conf, /MONOLITH_NIX_CHANNEL="nixos-unstable"/);

  const bat = generateWindowsDropHelperBat();
  assert.match(bat, /monolith-boot\.conf/);
});

test('buildOsSourceZip produces a valid non-empty zip archive blob', async () => {
  const blob = await buildOsSourceZip(DEFAULT_OS_CONFIG);
  assert.ok(blob.size > 5000);
});

test('all generated NixOS shell scripts and systemd init script pass bash -n syntax check and CI uses cache.nixos.org cleanly', () => {
  const files = generateOsRepositoryFiles(DEFAULT_OS_CONFIG);
  const nixCfg = files.find((f) => f.path === 'nixos/configuration.nix')?.content ?? '';
  const workflow = files.find((f) => f.path === '.github/workflows/build-nixos.yml')?.content ?? '';

  assert.doesNotMatch(workflow, /magic-nix-cache-action/);
  assert.match(workflow, /--option substituters "https:\/\/cache\.nixos\.org"/);

  const q2 = "''";
  const scriptRe = new RegExp(`pkgs\\.writeShellScriptBin\\s+"([^"]+)"\\s+${q2}\\n([\\s\\S]*?)\\n\\s*${q2};`, 'g');
  let match: RegExpExecArray | null;
  let checked = 0;

  while ((match = scriptRe.exec(nixCfg)) !== null) {
    checked++;
    const name = match[1];
    const body = match[2]
      .replace(/''\$/g, '$')
      .replace(/'''/g, "''");
    const res = spawnSync('bash', ['-n'], { input: body, encoding: 'utf8' });
    assert.equal(
      res.status,
      0,
      `Shell script ${name} failed bash -n syntax check:\n${res.stderr}`,
    );
  }

  assert.ok(checked >= 15, `Expected at least 15 generated shell scripts, checked ${checked}`);

  // Also check systemd.services.monolith-init-user.script
  const initRe = new RegExp(`script = ${q2}\\n([\\s\\S]*?)\\n\\s*${q2};`);
  const initMatch = initRe.exec(nixCfg);
  assert.ok(initMatch, 'Expected monolith-init-user systemd script');
  const initBody = initMatch[1]
    .replace(/''\$/g, '$')
    .replace(/\$\{[a-zA-Z0-9_]+\}/g, '/nix/store/mock')
    .replace(/'''/g, "''");
  const initRes = spawnSync('bash', ['-n'], { input: initBody, encoding: 'utf8' });
  assert.equal(
    initRes.status,
    0,
    `systemd monolith-init-user script failed bash -n syntax check:\n${initRes.stderr}`,
  );
});



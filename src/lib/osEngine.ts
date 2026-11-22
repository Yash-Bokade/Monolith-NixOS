import JSZip from 'jszip';
import {
  DEFAULT_OS_CONFIG,
  NEOVIM_BUILTIN_SHORTCUTS,
  NIX_CHANNELS,
  THEME_PALETTES,
  TOOLCHAIN_CATALOG,
} from './osDefaults';
import type {
  CustomShortcut,
  GeneratedFileEntry,
  HotkeyActionId,
  HotkeyBinding,
  HotkeyConflict,
  IdleRamBreakdown,
  OSConfigState,
  PartitionBreakdown,
  StorageConfig,
  ToolchainOption,
} from './types';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Escapes arbitrary file contents for safe inclusion inside Nix indented strings ('' ... '').
 */
function escapeNixIndented(content: string): string {
  return content
    .replace(/''/g, "'''")
    .replace(/\$\{/g, "''${");
}

function sanitizeNixAttr(pkg: string): string {
  return pkg.trim().replace(/^nixpkgs#/, '');
}

export function isValidNixPackageName(pkg: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9._+-]*$/.test(sanitizeNixAttr(pkg));
}

export function formatGlobalInstallCommand(pkg: string): string {
  const clean = sanitizeNixAttr(pkg);
  return `nix --extra-experimental-features 'nix-command flakes' profile install nixpkgs#${clean}`;
}

export function estimateIdleRamMb(config: OSConfigState): IdleRamBreakdown {
  const kernelAndSystemdMb = 148;
  const niriWaylandMb = 52;
  const waybarAndSwaybgMb =
    config.appearance.wallpaper === 'solid-matte' ? 26 : 38;
  const hardwareServicesMb =
    72 +
    (config.hardware.bluetoothStack ? 16 : 0) +
    (config.hardware.usbAutomount ? 14 : 0) +
    (config.hardware.hdmiDisplayAudio ? 18 : 0) +
    (config.appearance.screensaverEnabled ? 8 : 0);

  const totalIdleMb =
    kernelAndSystemdMb + niriWaylandMb + waybarAndSwaybgMb + hardwareServicesMb;

  return {
    kernelAndSystemdMb,
    niriWaylandMb,
    waybarAndSwaybgMb,
    hardwareServicesMb,
    totalIdleMb,
    withinBudget: totalIdleMb <= config.nixSystem.ramIdleLimitMb,
  };
}

export function calculatePartitions(storage: StorageConfig): PartitionBreakdown {
  const totalUsableGb = Math.max(8, round2(storage.totalUsableGb));
  const nominalDriveGb = Math.max(16, Math.round(storage.nominalDriveGb));
  const efiGb = round2(storage.efiGb);
  const squashfsGb = round2(storage.squashfsGb);
  const remaining = round2(totalUsableGb - efiGb - squashfsGb);
  const clampedPercent = storage.createExfatTransfer
    ? Math.min(100, Math.max(40, Math.round(storage.persistencePercent)))
    : 100;

  let warning: string | null = null;
  if (totalUsableGb < 24) {
    warning = 'Monolith NixOS requires at least a 32 GB USB drive (~27.25 GB usable) for stable persistence.';
  } else if (remaining < 10) {
    warning = 'Remaining space after EFI + NixOS must be at least 10 GB for persistence.';
  }

  const rawPersist = remaining > 0 ? round2((remaining * clampedPercent) / 100) : 0;
  const persistenceGb =
    remaining >= 10 && storage.createExfatTransfer && clampedPercent < 100
      ? round2(Math.min(remaining, Math.max(10, rawPersist)))
      : Math.max(0, rawPersist);
  const exfatTransferGb =
    storage.createExfatTransfer && clampedPercent < 100
      ? Math.max(0, round2(remaining - persistenceGb))
      : 0;

  return {
    nominalDriveGb,
    totalUsableGb,
    efiGb,
    squashfsGb,
    persistenceGb,
    persistencePercent: clampedPercent,
    exfatTransferGb,
    isValid: totalUsableGb >= 24 && remaining >= 10,
    warning,
  };
}

export function formatHotkeyCombo(binding: Pick<HotkeyBinding, 'modifier' | 'key'>): string {
  return `${binding.modifier.replaceAll('+', ' + ')} + ${binding.key}`;
}

export function normalizeHotkeyKey(binding: Pick<HotkeyBinding, 'modifier' | 'key'>): string {
  return `${binding.modifier.toLowerCase()}+${binding.key.trim().toLowerCase()}`;
}

export function detectHotkeyConflicts(
  hotkeys: Record<HotkeyActionId, HotkeyBinding>,
  customShortcuts: CustomShortcut[] = [],
): HotkeyConflict[] {
  const byCombo = new Map<string, string[]>();
  const displayMap = new Map<string, string>();

  for (const binding of Object.values(hotkeys)) {
    const norm = normalizeHotkeyKey(binding);
    const list = byCombo.get(norm) ?? [];
    list.push(binding.action);
    byCombo.set(norm, list);
    displayMap.set(norm, formatHotkeyCombo(binding));
  }

  for (const custom of customShortcuts) {
    const norm = normalizeHotkeyKey(custom);
    const list = byCombo.get(norm) ?? [];
    list.push(custom.id);
    byCombo.set(norm, list);
    displayMap.set(norm, formatHotkeyCombo(custom));
  }

  const conflicts: HotkeyConflict[] = [];
  for (const [norm, actions] of byCombo.entries()) {
    if (actions.length > 1) {
      conflicts.push({
        combo: displayMap.get(norm) ?? norm,
        actions,
      });
    }
  }
  return conflicts;
}

export function resolveToolchainPlan(
  selectedIds: string[],
  customPackagesRaw = '',
): {
  stacks: ToolchainOption[];
  nixPackages: string[];
  nvimLspServers: string[];
  treesitterParsers: string[];
  totalEstimatedMb: number;
} {
  const selectedSet = new Set(selectedIds);
  const stacks = TOOLCHAIN_CATALOG.filter((item) => selectedSet.has(item.id));
  const customPackages = customPackagesRaw
    .split(/[\s,]+/)
    .map((token) => token.trim())
    .filter((token) => /^[a-zA-Z0-9@._+-]+$/.test(token));

  const nixPkgSet = new Set<string>();
  const lspSet = new Set<string>();
  const tsSet = new Set<string>();
  let totalEstimatedMb = 0;

  for (const stack of stacks) {
    for (const pkg of stack.nixPackages) {
      nixPkgSet.add(pkg);
    }
    lspSet.add(stack.nvimLsp);
    tsSet.add(stack.treesitterParser);
    totalEstimatedMb += stack.estimatedMb;
  }

  for (const custom of customPackages) {
    nixPkgSet.add(custom);
    totalEstimatedMb += 35;
  }

  return {
    stacks,
    nixPackages: Array.from(nixPkgSet),
    nvimLspServers: Array.from(lspSet),
    treesitterParsers: Array.from(tsSet),
    totalEstimatedMb,
  };
}

function toNiriCombo(binding: Pick<HotkeyBinding, 'modifier' | 'key'>): string {
  const modPart = binding.modifier.replace('Super', 'Mod');
  const keyMap: Record<string, string> = {
    '/': 'Slash',
    ',': 'Comma',
    '.': 'Period',
    Return: 'Return',
    BackSpace: 'BackSpace',
    Space: 'Space',
  };
  const keyPart = keyMap[binding.key] ?? binding.key.toUpperCase();
  return `${modPart}+${keyPart}`;
}

export function generateShortcutsText(config: OSConfigState): string {
  const h = config.hotkeys;
  const osRows = Object.values(h)
    .map((b) => `${formatHotkeyCombo(b).padEnd(28, ' ')} | ${b.label} — ${b.description}`)
    .join('\n');

  const customRows =
    config.customShortcuts.length > 0
      ? config.customShortcuts
          .map(
            (c) =>
              `${formatHotkeyCombo(c).padEnd(28, ' ')} | ${c.label} — exec: ${c.command}`,
          )
          .join('\n')
      : '(No custom app shortcuts added yet — add them in Settings -> Keyboard Shortcuts)';

  const nvimRows = NEOVIM_BUILTIN_SHORTCUTS.map(
    (item) => `${item.combo.padEnd(28, ' ')} | ${item.label}`,
  ).join('\n');

  return `===============================================================================
${config.osName.toUpperCase()} — COMPLETE KEYBOARD SHORTCUT REFERENCE
Compositor: Niri Scrollable Wayland (Zero GUI minimize/expand/close buttons)
Font: JetBrains Mono  |  Theme: ${THEME_PALETTES[config.appearance.theme].name}
Location on OS: ~/SHORTCUTS.txt  |  Search Menu: ${formatHotkeyCombo(h.shortcutSearch)}
===============================================================================

[1. OS, AUTO-HIDE TASKBAR, KEYBOARD-ONLY WINDOWS & CORE APPS]
${osRows}

[2. CUSTOM APPLICATION SHORTCUTS]
${customRows}

[3. NIRI SCROLLABLE WAYLAND NAVIGATION]
Super + H / J / K / L        | Focus column left / down / up / right
Super + Shift + H / L        | Move focused column left / right
Super + 1 .. 5               | Switch workspace 1 through 5
Super + Shift + E            | Exit Niri session cleanly

[4. NEOVIM IDE (PRE-INSTALLED WITH AUTO-LSP)]
${nvimRows}

[5. TUI TOOLS, PACKAGES, HARDWARE & RAM MANAGEMENT]
monolith-settings            | Open theme-synced TUI Settings (${formatHotkeyCombo(h.openSettingsTui)})
monolith-pkg install <pkg>   | Install global app via nix profile install nixpkgs#<pkg>
monolith-new-project         | Create project with on-demand RAM-only local packages (${formatHotkeyCombo(h.newProject)})
monolith-ram-clean           | Unload idle project RAM mounts & drop pagecache (<500 MB idle)
monolith-screensaver         | Launch themed TUI screensaver (${formatHotkeyCombo(h.triggerScreensaver)})
monolith-hardware            | Manage USB drives, HDMI monitors/audio, Wi-Fi & Bluetooth (Super + Alt + H)
monolith-bluetooth           | Pair / connect Bluetooth devices via bluetui (Super + Alt + B)
monolith-exe <app.exe>       | Run Windows .exe apps via Wine (when enabled in setup/settings)
monolith-update [--check]    | Update Nix flake, global profile & check latest GitHub ISO (Super + Alt + U)
Print / Super + Shift + S    | Capture region screenshot -> ~/Pictures/Screenshots + clipboard
monolith-firstboot --force   | Re-open pre-desktop setup (includes Windows .exe option)
monolith-reset               | Clean Project Reset (keeps Wi-Fi, Bluetooth, SSH, OS settings)
`;
}

export function generateOsRepositoryFiles(config: OSConfigState = DEFAULT_OS_CONFIG): GeneratedFileEntry[] {
  const palette = THEME_PALETTES[config.appearance.theme];
  const partitions = calculatePartitions(config.storage);
  const channelInfo =
    NIX_CHANNELS.find((c) => c.id === config.nixSystem.channel) ?? NIX_CHANNELS[0];
  const idleRam = estimateIdleRamMb(config);
  const h = config.hotkeys;

  const persistNote =
    config.storage.createExfatTransfer && partitions.persistencePercent < 100
      ? `**${partitions.persistencePercent}%** of remaining drive capacity on first boot (plus an optional exFAT partition)`
      : '**100%** of remaining drive capacity on first boot (LocalSend replaces exFAT)';

  const wallpaperSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${palette.bg}" />
      <stop offset="68%" stop-color="${palette.surface}" />
      <stop offset="100%" stop-color="${palette.bg}" />
    </linearGradient>
    <radialGradient id="glow" cx="50%" cy="56%" r="55%">
      <stop offset="0%" stop-color="${palette.accent}" stop-opacity="0.14" />
      <stop offset="100%" stop-color="${palette.bg}" stop-opacity="0" />
    </radialGradient>
  </defs>
  <rect width="1920" height="1080" fill="url(#bg)" />
  <rect width="1920" height="1080" fill="url(#glow)" />
  <path d="M0 740 C 320 690, 560 760, 880 715 C 1220 668, 1520 735, 1920 690 L 1920 1080 L 0 1080 Z" fill="${palette.surfaceElevated}" fill-opacity="0.72" />
  <path d="M0 820 C 420 790, 740 845, 1140 805 C 1480 770, 1720 825, 1920 795 L 1920 1080 L 0 1080 Z" fill="${palette.bg}" fill-opacity="0.86" />
  <line x1="0" y1="740" x2="1920" y2="690" stroke="${palette.accent}" stroke-opacity="0.18" stroke-width="1" />
</svg>
`;

  const customNiriBinds = config.customShortcuts
    .map((c) => {
      const escapedCmd = c.command.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      return `    // Custom App Shortcut: ${c.label}\n    ${toNiriCombo(c)} { spawn "sh" "-lc" "${escapedCmd}"; }`;
    })
    .join('\n');

  const wallpaperStartupLine =
    config.appearance.wallpaper === 'solid-matte'
      ? `// Solid matte canvas active (zero wallpaper overhead)`
      : config.appearance.wallpaper === 'custom' && config.appearance.customWallpaperPath.trim()
        ? `spawn-at-startup "swaybg" "-m" "fill" "-i" "${config.appearance.customWallpaperPath.trim()}"`
        : `spawn-at-startup "swaybg" "-m" "fill" "-i" "/home/${config.username}/.config/monolith/wallpaper.svg"`;

  const swayidleLine = config.appearance.screensaverEnabled
    ? `spawn-at-startup "swayidle" "-w" "timeout" "${Math.max(1, config.appearance.screensaverTimeoutMin) * 60}" "monolith-screensaver --idle" "timeout" "${Math.max(1, config.appearance.screensaverTimeoutMin) * 60 + 30}" "monolith-ram-clean --quiet"`
    : `spawn-at-startup "swayidle" "-w" "timeout" "300" "monolith-ram-clean --quiet"`;

  const niriKdl = `// ${config.osName} — Niri Scrollable Wayland Compositor Configuration
// Theme: ${palette.name} | Font: JetBrains Mono | Radius: ${config.appearance.cornerRadiusPx}px | Opacity: ${config.appearance.windowOpacity}
// Zero GUI [minimize/expand/close] buttons — 100% keyboard-driven window lifecycle

${wallpaperStartupLine}
spawn-at-startup "waybar"
${swayidleLine}
${config.hardware.usbAutomount ? 'spawn-at-startup "udiskie" "--no-tray" "--automount"' : '// USB automount disabled'}
${config.hardware.hdmiDisplayAudio ? 'spawn-at-startup "kanshi"' : '// HDMI auto-profile disabled'}
spawn-at-startup "/run/current-system/sw/libexec/polkit-gnome-authentication-agent-1"

// Strictly disable client-side decorations (removes GUI minimize/expand/close buttons)
prefer-no-csd

layout {
    gaps ${config.appearance.windowGapPx}
    center-focused-column "never"

    default-column-width { proportion 0.5; }

    focus-ring {
        width ${config.appearance.borderWidthPx}
        active-color "${palette.accent}"
        inactive-color "${palette.border}"
    }

    background-color "${palette.bg}"
}

window-rule {
    geometry-corner-radius ${config.appearance.cornerRadiusPx}.0
    clip-to-geometry true
    opacity ${config.appearance.windowOpacity.toFixed(2)}
}

input {
    keyboard {
        xkb { layout "us"; }
    }
    touchpad {
        tap
        natural-scroll
        dwt
    }
}

binds {
    // Auto-Hiding Wayland Taskbar Toggle (${formatHotkeyCombo(h.toggleStatusBar)})
    ${toNiriCombo(h.toggleStatusBar)} { spawn "pkill" "-SIGUSR1" "waybar"; }

    // Keyboard-Only Window Controls (NO GUI minimize / expand / close buttons)
    ${toNiriCombo(h.closeWindow)} { close-window; }
    ${toNiriCombo(h.expandWindow)} { maximize-column; }
    ${toNiriCombo(h.minimizeWindow)} { spawn "monolith-toggle-windows" "minimize-focused"; }
    ${toNiriCombo(h.toggleHideWindows)} { spawn "monolith-toggle-windows" "toggle-all"; }

    // TUI System Control, Shortcuts & Screensaver
    ${toNiriCombo(h.shortcutSearch)} { spawn "monolith-shortcut-menu"; }
    ${toNiriCombo(h.openSettingsTui)} { spawn "foot" "-T" "Monolith Settings TUI" "monolith-settings"; }
    ${toNiriCombo(h.triggerScreensaver)} { spawn "monolith-screensaver"; }

    // Core Applications & Project Workflow
    ${toNiriCombo(h.openTerminal)} { spawn "foot" "-D" "${config.exportPaths.workspaceDir}"; }
    ${toNiriCombo(h.openNeovim)} { spawn "foot" "-D" "${config.exportPaths.workspaceDir}" "nvim"; }
    ${toNiriCombo(h.openBrowser)} { spawn "firefox"; }
    ${toNiriCombo(h.openObs)} { spawn "obs"; }
    ${toNiriCombo(h.openLocalSend)} { spawn "localsend_app"; }
    ${toNiriCombo(h.newProject)} { spawn "foot" "-T" "Monolith New Project (Local RAM Pkgs)" "monolith-new-project"; }
    ${toNiriCombo(h.projectReset)} { spawn "foot" "-T" "Monolith Project Reset" "monolith-reset"; }

    // Hardware, Config & Utility TUIs
    Mod+Alt+H { spawn "foot" "-T" "Monolith Hardware (USB/HDMI/Wi-Fi/BT)" "monolith-hardware"; }
    Mod+Alt+B { spawn "foot" "-T" "Monolith Bluetooth" "monolith-bluetooth"; }
    Mod+Alt+C { spawn "foot" "-T" "Monolith Pendrive Config" "monolith-config"; }
    Mod+Alt+U { spawn "foot" "-T" "Monolith Auto-Update" "monolith-update"; }
    Print { spawn "monolith-screenshot" "region"; }
    Shift+Print { spawn "monolith-screenshot" "full"; }
    Mod+Shift+S { spawn "monolith-screenshot" "region"; }

    // Scrollable Tiling Column Navigation
    Mod+H { focus-column-left; }
    Mod+L { focus-column-right; }
    Mod+J { focus-window-down; }
    Mod+K { focus-window-up; }
    Mod+Shift+H { move-column-left; }
    Mod+Shift+L { move-column-right; }
    Mod+1 { focus-workspace 1; }
    Mod+2 { focus-workspace 2; }
    Mod+3 { focus-workspace 3; }
    Mod+4 { focus-workspace 4; }
    Mod+5 { focus-workspace 5; }
    Mod+Shift+E { quit; }

${customNiriBinds}
}
`;

  const waybarJson = `{
  "layer": "top",
  "position": "${config.appearance.barPosition}",
  "mode": "${config.appearance.taskbarAutoHide ? 'hide' : 'dock'}",
  "start_hidden": ${config.appearance.taskbarShowOnStart ? 'false' : 'true'},
  "height": ${config.appearance.taskbarHeightPx},
  "margin-top": ${config.appearance.barPosition === 'top' ? 6 : 0},
  "margin-bottom": ${config.appearance.barPosition === 'bottom' ? 6 : 0},
  "margin-left": 10,
  "margin-right": 10,
  "spacing": 12,
  "modules-left": ["custom/compositor", "niri/workspaces", "custom/shortcuts-hint"],
  "modules-center": ["cpu", "memory", "disk#persist"],
  "modules-right": ["custom/hw-ports", "bluetooth", "network", "battery", "clock"],

  "custom/compositor": {
    "exec": "echo NIRI",
    "interval": 60,
    "format": "{}",
    "on-click": "foot -T 'Monolith Settings TUI' monolith-settings"
  },
  "custom/shortcuts-hint": {
    "format": "Keys: ${formatHotkeyCombo(h.shortcutSearch)}",
    "on-click": "monolith-shortcut-menu"
  },
  "custom/hw-ports": {
    "exec": "monolith-hardware --bar",
    "interval": 5,
    "format": "{}",
    "on-click": "foot -T 'Monolith Hardware' monolith-hardware"
  },
  "cpu": {
    "interval": 2,
    "format": "CPU {usage}%"
  },
  "memory": {
    "interval": 2,
    "format": "RAM {used:0.2f}G"
  },
  "disk#persist": {
    "interval": 15,
    "path": "/persist",
    "format": "USB {free}"
  },
  "bluetooth": {
    "format": "BT {status}",
    "format-connected": "BT {device_alias}",
    "format-connected-battery": "BT {device_alias} {device_battery_percentage}%",
    "format-off": "BT OFF",
    "on-click": "foot -T 'Monolith Bluetooth' monolith-bluetooth"
  },
  "network": {
    "format-wifi": "WIFI {essid}",
    "format-ethernet": "ETH {ifname}",
    "format-disconnected": "OFFLINE",
    "on-click": "foot nmtui"
  },
  "battery": {
    "format": "BAT {capacity}%"
  },
  "clock": {
    "format": "{:%H:%M}"
  }
}
`;

  const waybarAlpha = Math.max(0.7, Math.min(1, config.appearance.windowOpacity));
  const waybarCss = `/* ${config.osName} Waybar — JetBrains Mono, Rounded Corners, Modifiable Auto-Hide */
* {
  font-family: "JetBrains Mono", monospace;
  font-size: ${Math.max(11, config.appearance.fontSizePx - 1)}px;
  min-height: 0;
}

window#waybar {
  background-color: alpha(${palette.surface}, ${waybarAlpha.toFixed(2)});
  color: ${palette.fg};
  border: ${config.appearance.borderWidthPx}px solid ${palette.border};
  border-radius: ${config.appearance.cornerRadiusPx}px;
}

#cpu, #memory, #disk, #bluetooth, #network, #battery, #clock, #custom-compositor, #custom-shortcuts-hint, #custom-hw-ports {
  padding: 0 8px;
  color: ${palette.fg};
}

#custom-compositor {
  color: ${palette.accent};
  font-weight: 700;
}

#custom-shortcuts-hint, #custom-hw-ports {
  color: ${palette.muted};
}
`;

  const footIni = `# ${config.osName} — Foot Wayland Terminal (JetBrains Mono + Unified Theme + Transparency)
[main]
font=JetBrains Mono:size=${config.appearance.fontSizePx}
pad=10x10

[colors]
alpha=${config.appearance.windowOpacity.toFixed(2)}
background=${palette.surface.replace('#', '')}
foreground=${palette.fg.replace('#', '')}
regular4=${palette.accent.replace('#', '')}
regular6=${palette.accent.replace('#', '')}
`;

  const fuzzelIni = `# ${config.osName} — Fuzzel TUI Launcher (JetBrains Mono + Unified Theme + Rounded)
[main]
font=JetBrains Mono:size=${config.appearance.fontSizePx}
border-radius=${config.appearance.cornerRadiusPx}
border-width=${config.appearance.borderWidthPx}

[colors]
background=${palette.surface.replace('#', '')}ee
text=${palette.fg.replace('#', '')}ff
match=${palette.accent.replace('#', '')}ff
selection=${palette.surfaceElevated.replace('#', '')}ff
selection-text=${palette.accent.replace('#', '')}ff
border=${palette.accent.replace('#', '')}ff
`;

  const gtkSettingsIni = `[Settings]
gtk-font-name=JetBrains Mono ${config.appearance.fontSizePx}
gtk-application-prefer-dark-theme=1
gtk-decoration-layout=
`;

  const gtkNoButtonsCss = `/* ${config.osName} — Zero GUI [minimize, expand, close] buttons + Unified Theme & Rounding */
headerbar button.minimize,
headerbar button.maximize,
headerbar button.close,
.titlebar button.minimize,
.titlebar button.maximize,
.titlebar button.close {
  display: none;
  opacity: 0;
  min-width: 0;
  min-height: 0;
  padding: 0;
  margin: 0;
}

window, .background {
  border-radius: ${config.appearance.cornerRadiusPx}px;
  background-color: ${palette.surface};
  color: ${palette.fg};
}
`;

  const nvimInitLua = `-- ${config.osName} — Minimal High-Performance Neovim Configuration (Unified Theme + Auto-LSP)
vim.g.mapleader = " "
vim.opt.number = true
vim.opt.relativenumber = true
vim.opt.termguicolors = true
vim.opt.expandtab = true
vim.opt.shiftwidth = 2
vim.opt.tabstop = 2
vim.opt.clipboard = "unnamedplus"
vim.opt.signcolumn = "yes"
vim.opt.updatetime = 200

-- Sync Neovim highlights with active ${palette.name} OS theme
vim.api.nvim_set_hl(0, "Normal", { fg = "${palette.fg}", bg = "NONE" })
vim.api.nvim_set_hl(0, "NormalFloat", { fg = "${palette.fg}", bg = "${palette.surface}" })
vim.api.nvim_set_hl(0, "FloatBorder", { fg = "${palette.accent}", bg = "${palette.surface}" })
vim.api.nvim_set_hl(0, "LineNr", { fg = "${palette.muted}" })
vim.api.nvim_set_hl(0, "CursorLineNr", { fg = "${palette.accent}", bold = true })
vim.api.nvim_set_hl(0, "StatusLine", { fg = "${palette.fg}", bg = "${palette.surfaceElevated}" })

local map = vim.keymap.set
map("n", "<leader>e", vim.cmd.Ex, { desc = "Toggle file explorer" })
map("n", "<C-s>", "<cmd>w<cr>", { desc = "Save buffer" })
map("i", "<C-s>", "<esc><cmd>w<cr>a", { desc = "Save buffer" })
map("n", "[d", vim.diagnostic.goto_prev, { desc = "Previous diagnostic" })
map("n", "]d", vim.diagnostic.goto_next, { desc = "Next diagnostic" })

local stacks_file = vim.fn.expand("~/.config/monolith/active-stacks.json")
local active_lsps = {}
if vim.fn.filereadable(stacks_file) == 1 then
  local ok, parsed = pcall(vim.fn.json_decode, table.concat(vim.fn.readfile(stacks_file), "\\n"))
  if ok and parsed and parsed.lsp_servers then
    active_lsps = parsed.lsp_servers
  end
end

vim.api.nvim_create_autocmd("LspAttach", {
  callback = function(args)
    local opts = { buffer = args.buf }
    map("n", "gd", vim.lsp.buf.definition, opts)
    map("n", "K", vim.lsp.buf.hover, opts)
    map("n", "<leader>ca", vim.lsp.buf.code_action, opts)
    map("n", "<leader>rn", vim.lsp.buf.rename, opts)
    map("n", "<leader>f", function() vim.lsp.buf.format({ async = true }) end, opts)
  end,
})

local native_lsps = {
  rust_analyzer = { cmd = { "rust-analyzer" }, filetypes = { "rust" }, root_markers = { "Cargo.toml", ".git" } },
  gopls = { cmd = { "gopls" }, filetypes = { "go", "gomod" }, root_markers = { "go.mod", ".git" } },
  pyright = { cmd = { "pyright-langserver", "--stdio" }, filetypes = { "python" }, root_markers = { "pyproject.toml", "requirements.txt", ".git" } },
  ts_ls = { cmd = { "typescript-language-server", "--stdio" }, filetypes = { "javascript", "javascriptreact", "typescript", "typescriptreact" }, root_markers = { "package.json", "tsconfig.json", ".git" } },
  clangd = { cmd = { "clangd" }, filetypes = { "c", "cpp", "objc", "objcpp" }, root_markers = { "compile_commands.json", "CMakeLists.txt", ".git" } },
  jdtls = { cmd = { "jdtls" }, filetypes = { "java" }, root_markers = { "pom.xml", "build.gradle", "build.gradle.kts", ".git" } },
}

if vim.lsp and vim.lsp.config and vim.lsp.enable then
  for _, server in ipairs(active_lsps) do
    local cfg = native_lsps[server]
    if cfg and vim.fn.executable(cfg.cmd[1]) == 1 then
      vim.lsp.config(server, cfg)
      vim.lsp.enable(server)
    end
  end
end
`;

  const firefoxUserJs = `// ${config.osName} — Minimal Firefox Low-Memory & Hardware Acceleration Profile
user_pref("dom.ipc.processCount", ${config.browser.maxContentProcesses});
user_pref("browser.cache.disk.enable", false);
user_pref("browser.cache.memory.capacity", 65536);
user_pref("media.ffmpeg.vaapi.enabled", ${config.browser.enableVaapi});
user_pref("gfx.webrender.all", true);
user_pref("toolkit.legacyUserProfileCustomizations.stylesheets", ${config.browser.minimalChromeCss});
user_pref("browser.tabs.inTitlebar", 0);
user_pref("browser.startup.homepage", "about:blank");
user_pref("browser.newtabpage.enabled", false);
user_pref("extensions.pocket.enabled", false);
user_pref("toolkit.telemetry.enabled", ${!config.browser.blockTelemetry});
user_pref("datareporting.healthreport.uploadEnabled", ${!config.browser.blockTelemetry});
user_pref("font.name.sans-serif.x-western", "JetBrains Mono");
user_pref("font.name.monospace.x-western", "JetBrains Mono");
user_pref("browser.download.dir", "${config.exportPaths.workspaceDir}/downloads");
`;

  const dialogAccent = palette.tuiAccentName.toUpperCase();
  const dialogRc = `# ${config.osName} — Theme-Synced TUI Dialog Palette (${palette.name})
use_shadow = OFF
use_colors = ON
screen_color = (WHITE,BLACK,OFF)
dialog_color = (WHITE,BLACK,OFF)
title_color = (${dialogAccent},BLACK,ON)
border_color = (${dialogAccent},BLACK,OFF)
border2_color = (${dialogAccent},BLACK,OFF)
button_active_color = (BLACK,${dialogAccent},ON)
button_inactive_color = (WHITE,BLACK,OFF)
button_key_active_color = (BLACK,${dialogAccent},ON)
button_key_inactive_color = (${dialogAccent},BLACK,ON)
button_label_active_color = (BLACK,${dialogAccent},ON)
button_label_inactive_color = (WHITE,BLACK,OFF)
item_color = (WHITE,BLACK,OFF)
item_selected_color = (BLACK,${dialogAccent},ON)
tag_color = (${dialogAccent},BLACK,ON)
tag_selected_color = (BLACK,${dialogAccent},ON)
tag_key_color = (${dialogAccent},BLACK,ON)
tag_key_selected_color = (BLACK,${dialogAccent},ON)
check_color = (WHITE,BLACK,OFF)
check_selected_color = (BLACK,${dialogAccent},ON)
`;

  const bashrcFile = `# ${config.osName} — Shell Profile (JetBrains Mono + direnv RAM-Only Project Envs + mise)
export PATH="$HOME/.local/share/mise/shims:$HOME/.local/bin:$HOME/.cargo/bin:$HOME/go/bin:$PATH"
export DIALOGRC="$HOME/.dialogrc"
export MONOLITH_THEME="${config.appearance.theme}"
if command -v mise >/dev/null 2>&1; then
  eval "$(mise activate bash)"
fi
if command -v direnv >/dev/null 2>&1; then
  eval "$(direnv hook bash)"
fi
PS1='\\[\\e[36m\\]\\u@\\h\\[\\e[0m\\] \\w \\$ '
`;

  const shortcutsTxt = generateShortcutsText(config);

  const settingsSnapshot = JSON.stringify(
    {
      osName: config.osName,
      hostname: config.hostname,
      defaultCompositor: 'niri',
      nixSystem: config.nixSystem,
      appearance: config.appearance,
      storage: partitions,
      idleRamBudgetMb: idleRam,
      exportPaths: config.exportPaths,
      browser: config.browser,
      hardware: config.hardware,
      hotkeys: Object.fromEntries(
        Object.values(config.hotkeys).map((b) => [b.action, formatHotkeyCombo(b)]),
      ),
      customShortcuts: config.customShortcuts,
    },
    null,
    2,
  );

  const firstbootScript = `#!/usr/bin/env bash
# ${config.osName} — Pre-Desktop First-Boot Network, Windows .exe Prompt & Persistent Toolchain Wizard
set -uo pipefail

STAMP_FILE="$HOME/.config/monolith/.firstboot-complete"
STACKS_JSON="$HOME/.config/monolith/active-stacks.json"
VERSIONS_JSON="$HOME/.config/monolith/selected-versions.json"
LOG_FILE="$HOME/monolith-firstboot.log"

if [[ -f "$STAMP_FILE" && "\${1:-}" != "--force" ]]; then
  exit 0
fi

sudo dmesg -n 1 2>/dev/null || true
export DIALOGRC="$HOME/.dialogrc"
export MISE_YES=1
export MISE_PYTHON_COMPILE=0
export CARGO_HOME="$HOME/.cargo"
export RUSTUP_HOME="$HOME/.rustup"
export GOPATH="$HOME/go"
export PATH="$HOME/.local/share/mise/shims:$HOME/.local/bin:$HOME/.cargo/bin:$HOME/go/bin:$PATH"

clear
echo "================================================================="
echo "  ${config.osName.toUpperCase()} — PRE-DESKTOP FIRST-BOOT SETUP (NIRI WAYLAND)"
echo "================================================================="
echo ""

# Step 1: Ensure Auto-Scaling USB Persistence Partition (${partitions.persistencePercent}% of remaining space)
if ! mountpoint -q /persist || ! mountpoint -q "$HOME"; then
  echo "[1/5] Initializing & mounting USB pendrive persistence (${config.storage.persistLabel})..."
  sudo monolith-persist-usb || true
  cd "$HOME" 2>/dev/null || true
fi

if mountpoint -q /persist && mountpoint -q "$HOME"; then
  PERSIST_SRC=$(findmnt -n -o SOURCE /persist 2>/dev/null || echo "${config.storage.persistLabel}")
  PERSIST_FREE=$(df -h /persist 2>/dev/null | awk 'NR==2 {print $4}')
  echo "[1/5] [OK] USB Persistence ACTIVE -> $PERSIST_SRC ($PERSIST_FREE free)"
else
  echo "[1/5] [WARNING] USB persistence could NOT be mounted! Running in RAM-only mode."
  dialog --clear --backtitle "${config.osName} — Persistence Warning" \\
    --title " WARNING: Pendrive Persistence Not Active " \\
    --msgbox "Monolith NixOS could not create or mount ${config.storage.persistLabel} on your USB drive.\\n\\nFix: Flash in Rufus using 'DD Image mode' on a 32 GB+ USB drive, or run 'sudo monolith-persist-usb --status'." 12 76 || true
fi

mkdir -p "$HOME/.config/monolith" "${config.exportPaths.workspaceDir}" "${config.exportPaths.obsRecordingsDir}" "${config.exportPaths.localSendDir}" "$HOME/.local/bin"

# Step 2: Connect Internet FIRST (Wi-Fi / Ethernet)
check_online() {
  curl -fsS --max-time 4 https://nixos.org >/dev/null 2>&1 || ping -c 1 -W 2 1.1.1.1 >/dev/null 2>&1
}

echo "[2/5] Checking internet connectivity..."
ONLINE=0
if check_online; then
  ONLINE=1
else
  while true; do
    dialog --clear --backtitle "${config.osName} — First-Boot Setup" \\
      --title " Step 1: Connect to the Internet " \\
      --msgbox "Connect to Wi-Fi or Ethernet first before selecting optional global packages and Windows .exe support.\\n\\nPress Enter to open nmtui." 11 72 || true
    nmtui connect || true
    clear
    echo "  Verifying internet connection..."
    for _ in 1 2 3 4 5 6; do
      if check_online; then
        ONLINE=1
        break
      fi
      sleep 2
    done
    [[ "$ONLINE" == "1" ]] && break
    if ! dialog --clear --backtitle "${config.osName} — First-Boot Setup" \\
      --title " Still Offline " \\
      --yes-label "Retry Wi-Fi" --no-label "Continue to Niri Desktop" \\
      --yesno "No internet connection detected yet.\\n\\nRetry Wi-Fi now, or boot straight into Niri Wayland?\\n(Run 'monolith-firstboot --force' anytime once online.)" 10 68; then
      break
    fi
  done
fi

if [[ "$ONLINE" == "1" ]]; then
  sudo timedatectl set-ntp true >/dev/null 2>&1 || true
fi

# Step 3: Load optional post-Rufus monolith-boot.conf overrides
BOOT_CONF_FILE="/etc/monolith/boot.conf"
[[ -f /persist/monolith-boot.conf ]] && BOOT_CONF_FILE="/persist/monolith-boot.conf"
read_bootconf_val() {
  local key="$1"
  [[ -f "$BOOT_CONF_FILE" ]] || return 0
  grep -E "^[[:space:]]*\${key}=" "$BOOT_CONF_FILE" 2>/dev/null | tail -n 1 | sed -E 's/^[^=]+=//; s/^"//; s/"$//' || true
}
CONF_STACKS=$(read_bootconf_val MONOLITH_PREINSTALL_STACKS)
CONF_EXTRA_PKGS=$(read_bootconf_val MONOLITH_EXTRA_PKGS)
CONF_SKIP_WIZARD=$(read_bootconf_val MONOLITH_SKIP_WIZARD)
CONF_WIN_EXE=$(read_bootconf_val MONOLITH_WINDOWS_EXE)

# Step 4: Ask if the user wants Windows (.exe) application support (Wine + Winetricks)
INSTALL_WINDOWS_EXE="${config.nixSystem.windowsExeSupport ? '1' : '0'}"
[[ "$CONF_WIN_EXE" == "true" ]] && INSTALL_WINDOWS_EXE="1"
[[ "$CONF_WIN_EXE" == "false" ]] && INSTALL_WINDOWS_EXE="0"

if [[ "$ONLINE" == "1" && "$CONF_SKIP_WIZARD" != "true" ]]; then
  if dialog --clear --backtitle "${config.osName} — Windows .exe Compatibility" \\
    --title " Step 2: Run Windows (.exe) Applications? " \\
    --yes-label "Yes — Install Wine + Winetricks" --no-label "No — Pure Linux Minimal" \\
    --yesno "Do you want to run Windows (.exe) apps on ${config.osName}?\\n\\nChoosing Yes installs 'wineWowPackages.stable' + 'winetricks' from Nixpkgs and enables 'monolith-exe <app.exe>' with persistent ~/.wine on ${config.storage.persistLabel}.\\n\\n(Note: Idle RAM remains < 500 MB — Wine only loads into RAM when running an .exe.)" 14 76; then
    INSTALL_WINDOWS_EXE="1"
  else
    INSTALL_WINDOWS_EXE="0"
  fi
fi

CHOICES=""
JAVA_VER="21"
RUST_VER="stable"
GO_VER="latest"
PYTHON_VER="3.12"
NODE_VER="22"
CPP_VER="gcc+clang"
SELECTED_VERSIONS_PAIRS=()
NIX_DECL_PKGS=()
NIX_PROFILE_PKGS=()
LSPS=()
HAD_ERRORS=0
DID_INSTALL=0

if [[ -n "$CONF_STACKS" ]]; then
  IFS=',' read -ra STACK_ENTRIES <<< "$CONF_STACKS"
  for entry in "\${STACK_ENTRIES[@]}"; do
    s_id="\${entry%%:*}"
    s_ver="\${entry#*:}"
    [[ -z "$s_id" ]] && continue
    [[ "$s_ver" == "$s_id" || -z "$s_ver" ]] && s_ver="latest"
    CHOICES="\${CHOICES}\${CHOICES:+ }\${s_id}"
    case "$s_id" in
      java) JAVA_VER="$s_ver"; SELECTED_VERSIONS_PAIRS+=("\\"java\\":\\"$JAVA_VER\\"") ;;
      rust) RUST_VER="$s_ver"; SELECTED_VERSIONS_PAIRS+=("\\"rust\\":\\"$RUST_VER\\"") ;;
      go) GO_VER="$s_ver"; SELECTED_VERSIONS_PAIRS+=("\\"go\\":\\"$GO_VER\\"") ;;
      python) PYTHON_VER="$s_ver"; SELECTED_VERSIONS_PAIRS+=("\\"python\\":\\"$PYTHON_VER\\"") ;;
      nodejs) NODE_VER="$s_ver"; SELECTED_VERSIONS_PAIRS+=("\\"nodejs\\":\\"$NODE_VER\\"") ;;
      cpp) CPP_VER="$s_ver"; SELECTED_VERSIONS_PAIRS+=("\\"cpp\\":\\"$CPP_VER\\"") ;;
      containers) SELECTED_VERSIONS_PAIRS+=("\\"containers\\":\\"latest\\"") ;;
    esac
  done
fi

if [[ "$ONLINE" == "1" && "$CONF_SKIP_WIZARD" != "true" ]]; then
  CHOICES=$(dialog --clear --backtitle "${config.osName} — Optional Global Languages" \\
    --title " Step 3: Select Global Stacks (Local Project Pkgs use monolith-new-project) " \\
    --stdout --separate-output --checklist \\
    "Pick global toolchains to pre-install (or leave empty and use per-project RAM-only packages):" 18 78 8 \\
    java "Java (OpenJDK 25/21/17/11 + Maven/Gradle)" off \\
    rust "Rust (Stable / Nightly + rust-analyzer)" off \\
    go "Go (Latest / 1.24 / 1.23 + gopls + delve)" off \\
    python "Python 3 (3.13 / 3.12 / 3.11 + uv + pyright)" off \\
    nodejs "Node.js (22 LTS / 20 LTS + pnpm + TS LSP)" off \\
    cpp "C / C++ (GCC + Clang + CMake + Ninja + clangd)" off \\
    containers "Podman rootless containers" off) || CHOICES=""
fi

install_step() {
  local label="$1"
  shift
  echo "  -> $label"
  if "$@" 2>&1 | tee -a "$LOG_FILE"; then
    echo "     [OK] $label"
  else
    echo "     [WARN] $label failed (see $LOG_FILE)"
    HAD_ERRORS=1
  fi
}

if [[ "$ONLINE" == "1" ]]; then
  if [[ "$INSTALL_WINDOWS_EXE" == "1" ]]; then
    DID_INSTALL=1
    NIX_PROFILE_PKGS+=(nixpkgs#wineWowPackages.stable nixpkgs#winetricks)
    NIX_DECL_PKGS+=(wineWowPackages.stable winetricks)
  fi

  for choice in $CHOICES; do
    DID_INSTALL=1
    case "$choice" in
      java)
        install_step "Java ($JAVA_VER) + Maven + Gradle" mise use -g "java@$JAVA_VER" maven@latest gradle@latest
        NIX_DECL_PKGS+=(jdk21 maven gradle)
        LSPS+=("jdtls")
        ;;
      rust)
        install_step "Rust ($RUST_VER)" mise use -g "rust@$RUST_VER"
        NIX_DECL_PKGS+=(rustup rust-analyzer)
        LSPS+=("rust_analyzer")
        ;;
      go)
        install_step "Go ($GO_VER)" mise use -g "go@$GO_VER"
        NIX_DECL_PKGS+=(go gopls delve)
        LSPS+=("gopls")
        ;;
      python)
        install_step "Python ($PYTHON_VER) + uv + ruff" mise use -g "python@$PYTHON_VER" uv@latest ruff@latest
        NIX_DECL_PKGS+=(python312 uv ruff pyright)
        LSPS+=("pyright")
        ;;
      nodejs)
        install_step "Node.js ($NODE_VER) + pnpm" mise use -g "node@$NODE_VER" pnpm@latest
        NIX_DECL_PKGS+=(nodejs_22 pnpm)
        LSPS+=("ts_ls")
        ;;
      cpp)
        NIX_PROFILE_PKGS+=(nixpkgs#gcc nixpkgs#clang-tools nixpkgs#cmake nixpkgs#ninja nixpkgs#gdb)
        NIX_DECL_PKGS+=(gcc clang-tools cmake ninja gdb)
        LSPS+=("clangd")
        ;;
      containers)
        NIX_PROFILE_PKGS+=(nixpkgs#podman nixpkgs#podman-compose nixpkgs#slirp4netns)
        NIX_DECL_PKGS+=(podman podman-compose slirp4netns)
        LSPS+=("dockerls")
        ;;
    esac
  done

  if [[ -n "\${CONF_EXTRA_PKGS:-}" ]]; then
    DID_INSTALL=1
    read -ra EXTRA_ARR <<< "$CONF_EXTRA_PKGS"
    for ep in "\${EXTRA_ARR[@]}"; do
      CLEAN_EP="\${ep#nixpkgs#}"
      NIX_DECL_PKGS+=("$CLEAN_EP")
      [[ "$ep" == *#* ]] && NIX_PROFILE_PKGS+=("$ep") || NIX_PROFILE_PKGS+=("nixpkgs#$ep")
    done
  fi

  if [[ \${#NIX_PROFILE_PKGS[@]} -gt 0 ]]; then
    install_step "Install global Nix packages (\${NIX_PROFILE_PKGS[*]})" nix --extra-experimental-features "nix-command flakes" profile install "\${NIX_PROFILE_PKGS[@]}"
    if mountpoint -q /persist; then
      sudo mkdir -p /persist/nix-cache /persist/nixos
      mapfile -t STORE_PATHS < <(nix --extra-experimental-features "nix-command flakes" profile list --json 2>/dev/null | jq -r '.. | .storePaths? // empty | .[]' | sort -u || true)
      if [[ \${#STORE_PATHS[@]} -gt 0 ]]; then
        install_step "Persist Nix store paths to /persist/nix-cache" nix --extra-experimental-features "nix-command flakes" copy --to "file:///persist/nix-cache" "\${STORE_PATHS[@]}"
        printf '%s\\n' "\${STORE_PATHS[@]}" | sudo tee /persist/nixos/profile-store-paths.txt >/dev/null
      fi
      printf '%s\\n' "\${NIX_PROFILE_PKGS[@]}" | sudo tee /persist/nixos/profile-packages.txt >/dev/null
    fi
  fi

  sudo mkdir -p /etc/nixos
  {
    echo "# ${config.osName} — Declarative Global User Packages (Persisted on ${config.storage.persistLabel})"
    echo "{ pkgs, ... }: {"
    echo "  environment.systemPackages = with pkgs; ["
    for npkg in "\${NIX_DECL_PKGS[@]}"; do
      echo "    $npkg"
    done
    echo "  ];"
    echo "}"
  } | sudo tee /etc/nixos/user-packages.nix >/dev/null
fi

if [[ \${#SELECTED_VERSIONS_PAIRS[@]} -gt 0 ]]; then
  VERSIONS_BODY=$(IFS=,; echo "\${SELECTED_VERSIONS_PAIRS[*]}")
  echo "{\${VERSIONS_BODY}}" > "$VERSIONS_JSON"
else
  echo "{}" > "$VERSIONS_JSON"
fi

if [[ \${#LSPS[@]} -gt 0 ]]; then
  LSP_JSON=$(printf '"%s",' "\${LSPS[@]}" | sed 's/,$//')
else
  LSP_JSON=""
fi
echo "{\\"lsp_servers\\": [$LSP_JSON], \\"windows_exe\\": \${INSTALL_WINDOWS_EXE}}" > "$STACKS_JSON"

touch "$STAMP_FILE"
sync
echo "Setup complete! Launching Niri Wayland desktop..."
`;

  const pkgScript = `#!/usr/bin/env bash
# ${config.osName} — Global Nix Package Manager (monolith-pkg install|remove|list|search)
set -euo pipefail

CMD="\${1:-help}"
PKG="\${2:-}"

case "$CMD" in
  install|add)
    [[ -n "$PKG" ]] || { echo "Usage: monolith-pkg install <nixpkgs-name>"; exit 1; }
    CLEAN="\${PKG#nixpkgs#}"
    echo "Installing global Nix package: nixpkgs#$CLEAN ..."
    nix --extra-experimental-features "nix-command flakes" profile install "nixpkgs#$CLEAN"
    if mountpoint -q /persist 2>/dev/null; then
      sudo mkdir -p /persist/nix-cache /persist/nixos
      mapfile -t STORE_PATHS < <(nix --extra-experimental-features "nix-command flakes" profile list --json 2>/dev/null | jq -r '.. | .storePaths? // empty | .[]' | sort -u || true)
      if [[ \${#STORE_PATHS[@]} -gt 0 ]]; then
        nix --extra-experimental-features "nix-command flakes" copy --to "file:///persist/nix-cache" "\${STORE_PATHS[@]}" || true
        printf '%s\\n' "\${STORE_PATHS[@]}" | sudo tee /persist/nixos/profile-store-paths.txt >/dev/null
      fi
      grep -qxF "nixpkgs#$CLEAN" /persist/nixos/profile-packages.txt 2>/dev/null || echo "nixpkgs#$CLEAN" | sudo tee -a /persist/nixos/profile-packages.txt >/dev/null
    fi
    sync
    echo "[OK] Installed '$CLEAN' globally and cached on ${config.storage.persistLabel}."
    ;;
  remove|rm)
    [[ -n "$PKG" ]] || { echo "Usage: monolith-pkg remove <nixpkgs-name>"; exit 1; }
    nix --extra-experimental-features "nix-command flakes" profile remove "$PKG"
    sync
    echo "[OK] Removed '$PKG' from global Nix profile."
    ;;
  list|ls)
    nix --extra-experimental-features "nix-command flakes" profile list
    ;;
  search)
    [[ -n "$PKG" ]] || { echo "Usage: monolith-pkg search <query>"; exit 1; }
    nix --extra-experimental-features "nix-command flakes" search nixpkgs "$PKG"
    ;;
  *)
    echo "${config.osName} Global Package Manager"
    echo "  monolith-pkg install <pkg>   Install global app via nix profile install nixpkgs#<pkg>"
    echo "  monolith-pkg remove <pkg>    Remove global app from Nix profile"
    echo "  monolith-pkg list            List globally installed Nix packages"
    echo "  monolith-pkg search <query>  Search latest ${config.nixSystem.channel} packages"
    ;;
esac
`;

  const ramCleanScript = `#!/usr/bin/env bash
# ${config.osName} — Idle RAM Sweeper & On-Demand Project Package Unloader (Target: < ${config.nixSystem.ramIdleLimitMb} MB Idle)
set -uo pipefail

QUIET=0
[[ "\${1:-}" == "--quiet" ]] && QUIET=1

USER_UID=$(id -u "${config.username}" 2>/dev/null || echo "1000")
RAM_ROOT="/run/user/\${USER_UID}/monolith-projects"

# Unmount inactive RAM-only project package caches when no shell is inside the project directory
if [[ -d "$RAM_ROOT" ]]; then
  for proj_ram in "$RAM_ROOT"/*; do
    [[ -d "$proj_ram" ]] || continue
    proj_name=$(basename "$proj_ram")
    if ! lsof +D "$proj_ram" >/dev/null 2>&1; then
      rm -rf "$proj_ram" 2>/dev/null || true
      [[ "$QUIET" == "0" ]] && echo "[RAM] Unloaded idle local project packages: $proj_name"
    fi
  done
fi

# Flush filesystem buffers and reclaim Linux pagecache, dentries, and inodes
sync
if [[ -w /proc/sys/vm/drop_caches ]]; then
  echo 3 > /proc/sys/vm/drop_caches 2>/dev/null || true
else
  sudo sh -c 'sync && echo 3 > /proc/sys/vm/drop_caches' 2>/dev/null || true
fi

if [[ "$QUIET" == "0" ]]; then
  USED_MB=$(free -m | awk '/^Mem:/ {print $3}')
  echo "[OK] Idle RAM cleaned. Current memory used: \${USED_MB} MB (target < ${config.nixSystem.ramIdleLimitMb} MB)."
fi
`;

  const screensaverScript = `#!/usr/bin/env bash
# ${config.osName} — Theme-Synced Minimal TUI Screensaver (${palette.name} · Style: ${config.appearance.screensaverStyle})
set -uo pipefail

if [[ "\${1:-}" == "--render" ]]; then
  STYLE="${config.appearance.screensaverStyle}"
  trap 'tput cnorm; clear; exit 0' INT TERM EXIT
  tput civis
  clear
  while true; do
    ROWS=$(tput lines)
    COLS=$(tput cols)
    MID_R=$(( ROWS / 2 ))
    NOW=$(date +"%H:%M:%S")
    DAY=$(date +"%A, %B %d")
    MEM_MB=$(free -m | awk '/^Mem:/ {print $3}')
    clear
    tput cup $((MID_R - 3)) $(( (COLS - 28) / 2 ))
    printf "\\033[1;36mMONOLITH NIXOS · NIRI WAYLAND\\033[0m"
    tput cup $((MID_R - 1)) $(( (COLS - \${#NOW}) / 2 ))
    printf "\\033[1;37m%s\\033[0m" "$NOW"
    tput cup $((MID_R + 1)) $(( (COLS - \${#DAY}) / 2 ))
    printf "\\033[0;37m%s\\033[0m" "$DAY"
    INFO="RAM \${MEM_MB} MB (IDLE CLEAN) · Press any key to resume"
    tput cup $((MID_R + 3)) $(( (COLS - \${#INFO}) / 2 ))
    printf "\\033[0;90m%s\\033[0m" "$INFO"
    if read -rsn1 -t 1 _; then
      break
    fi
  done
  exit 0
fi

# Clean idle RAM before displaying TUI screensaver
monolith-ram-clean --quiet || true
exec foot --fullscreen --title="Monolith Screensaver" monolith-screensaver --render
`;

  const hardwareScript = `#!/usr/bin/env bash
# ${config.osName} — Theme-Synced TUI Hardware & Ports Manager (USB, HDMI, Wi-Fi, Bluetooth)
set -uo pipefail
export DIALOGRC="$HOME/.dialogrc"

if [[ "\${1:-}" == "--bar" ]]; then
  USB_CNT=$(lsblk -dnpo TRAN 2>/dev/null | grep -c '^usb$' || true)
  HDMI_OUT=$(wlr-randr 2>/dev/null | grep -E '^(HDMI|DP)-' | head -n 1 | awk '{print $1}' || true)
  [[ -n "$HDMI_OUT" ]] && HDMI_TXT="$HDMI_OUT" || HDMI_TXT="eDP"
  echo "USB:\${USB_CNT} \${HDMI_TXT}"
  exit 0
fi

CHOICE=$(dialog --clear --backtitle "${config.osName} — Hardware & Ports TUI" \\
  --title " USB · HDMI · Wi-Fi · Bluetooth · Idle RAM " \\
  --stdout --menu "Select a hardware subsystem to inspect or configure:" 16 74 7 \\
  "usb"    "USB Ports & Removable Drives (lsusb + lsblk + udiskie)" \\
  "hdmi"   "HDMI / DisplayPort Monitors & Audio (wlr-randr + wpctl)" \\
  "wifi"   "Wi-Fi & Ethernet Networks (nmtui)" \\
  "bt"     "Bluetooth Devices & Audio (bluetui)" \\
  "ram"    "Inspect & Clean Idle RAM (< ${config.nixSystem.ramIdleLimitMb} MB budget)" \\
  "exe"    "Windows .exe Runtime Status (Wine + Winetricks)") || exit 0

case "$CHOICE" in
  usb)
    clear
    echo "=== USB DEVICES ==="
    lsusb || true
    echo ""
    echo "=== BLOCK & USB STORAGE ==="
    lsblk -o NAME,SIZE,TRAN,FSTYPE,MOUNTPOINT,LABEL || true
    read -rp "Press Enter to return..." _ || true
    ;;
  hdmi)
    clear
    echo "=== WAYLAND DISPLAYS (HDMI / DP / eDP) ==="
    wlr-randr || true
    echo ""
    echo "=== PIPEWIRE AUDIO SINKS (HDMI / SPEAKERS / BT) ==="
    wpctl status || true
    read -rp "Press Enter to return..." _ || true
    ;;
  wifi) exec nmtui ;;
  bt) exec monolith-bluetooth ;;
  ram)
    clear
    monolith-ram-clean
    free -h
    read -rp "Press Enter to return..." _ || true
    ;;
  exe)
    clear
    if command -v wine >/dev/null 2>&1; then
      echo "[OK] Wine active: $(wine --version)"
      echo "Run any Windows app with: monolith-exe /path/to/app.exe"
    else
      echo "Wine is not installed. Run: monolith-pkg install wineWowPackages.stable"
    fi
    read -rp "Press Enter to return..." _ || true
    ;;
esac
`;

  const settingsTuiScript = `#!/usr/bin/env bash
# ${config.osName} — Dedicated Theme-Synced TUI Settings Center (${formatHotkeyCombo(h.openSettingsTui)})
set -uo pipefail
export DIALOGRC="$HOME/.dialogrc"

ACTION=$(dialog --clear --backtitle "${config.osName} — Settings TUI (${palette.name})" \\
  --title " Monolith NixOS Dedicated Settings " \\
  --stdout --menu "Modify any OS setting directly on your pendrive:" 18 76 10 \\
  "theme"      "Theme, Wallpaper, Rounded Corners & Window Transparency" \\
  "taskbar"    "Auto-Hiding Taskbar (Waybar position, height, auto-hide)" \\
  "shortcuts"  "Keyboard Shortcuts & Custom App Shortcuts (Niri config.kdl)" \\
  "nix"        "NixOS Channel (${config.nixSystem.channel}) & Latest Nix Version" \\
  "globalpkg"  "Install / Remove Global Nix Packages (monolith-pkg)" \\
  "project"    "Create Project with Local RAM-Only Packages" \\
  "hardware"   "USB, HDMI, Wi-Fi, Bluetooth & Idle RAM Sweeper" \\
  "screensaver""Launch Theme-Synced TUI Screensaver Now" \\
  "exe"        "Install / Check Windows (.exe) Support (Wine)" \\
  "status"     "USB Persistence Status (${config.storage.persistLabel})") || exit 0

case "$ACTION" in
  theme)      exec monolith-config niri ;;
  taskbar)    exec monolith-config waybar ;;
  shortcuts)  exec monolith-config niri ;;
  nix)        exec monolith-config flake ;;
  globalpkg)
    clear
    read -rp "Enter nixpkgs package name to install globally (e.g. ripgrep, vlc, zig): " PKG
    [[ -n "$PKG" ]] && monolith-pkg install "$PKG"
    read -rp "Press Enter to close..." _ || true
    ;;
  project)    exec monolith-new-project ;;
  hardware)   exec monolith-hardware ;;
  screensaver) exec monolith-screensaver ;;
  exe)        monolith-pkg install wineWowPackages.stable && monolith-pkg install winetricks ;;
  status)     monolith-persist-usb --status; read -rp "Press Enter..." _ || true ;;
esac
`;

  const exeHelperScript = `#!/usr/bin/env bash
# ${config.osName} — Windows .exe Launcher (Wine + Persistent ~/.wine on ${config.storage.persistLabel})
set -euo pipefail
if ! command -v wine >/dev/null 2>&1; then
  echo "Windows .exe support (Wine) is not installed yet."
  echo "Install it anytime with: monolith-pkg install wineWowPackages.stable"
  exit 1
fi
export WINEPREFIX="$HOME/.wine"
exec wine "$@"
`;

  const resetScript = `#!/usr/bin/env bash
# ${config.osName} — Clean Project Reset
# Clears workspace files, local project caches, and dynamic toolchains.
# STRICTLY PRESERVES: Wi-Fi/Ethernet, Bluetooth, ~/.ssh, ~/.gitconfig, theme, wallpaper, shortcuts & OS settings.
set -euo pipefail

WORKSPACE="${config.exportPaths.workspaceDir}"
PKG_TRACK="$HOME/.config/monolith/installed-project-pkgs.txt"

echo "================================================================="
echo "  ${config.osName.toUpperCase()} — PROJECT RESET"
echo "================================================================="
echo "WILL CLEAR:"
echo "  - Workspace directory: $WORKSPACE"
echo "  - Per-project RAM caches & toolchains (~/.local/share/mise, ~/.cargo, ~/go)"
echo "  - Dynamic build caches (~/.cache, ~/.m2, ~/.npm)"
echo ""
echo "WILL PRESERVE:"
echo "  - Wi-Fi & Ethernet profiles (/etc/NetworkManager/system-connections)"
echo "  - Bluetooth paired devices (/var/lib/bluetooth -> /persist/bluetooth)"
echo "  - SSH keys (${config.exportPaths.sshDir}) & Git identity (~/.gitconfig)"
echo "  - OS theme, wallpaper, rounded corners, shortcuts & ~/SHORTCUTS.txt"
echo ""

read -rp "Type RESET to wipe this project and return to First-Boot Wizard: " CONFIRM
[[ "$CONFIRM" == "RESET" ]] || { echo "Reset cancelled."; exit 0; }

rm -rf "$WORKSPACE"/* "$HOME/.cache"/* "$HOME/.local/share/mise" "$HOME/.config/mise" \\
  "$HOME/.local/share/uv" "$HOME/.cargo" "$HOME/.rustup" "$HOME/.m2" "$HOME/.npm" "$HOME/go"

monolith-ram-clean --quiet || true

if [[ -f "$PKG_TRACK" ]]; then
  nix --extra-experimental-features "nix-command flakes" profile remove '.*' || true
  rm -f "$PKG_TRACK"
fi

rm -f "$HOME/.config/monolith/.firstboot-complete" "$HOME/.config/monolith/active-stacks.json" "$HOME/.config/monolith/selected-versions.json"
sync
echo "Project reset complete. Re-arming First-Boot Wizard..."
exec monolith-firstboot --force
`;

  const persistUsbScript = `#!/usr/bin/env bash
# ${config.osName} — Universal Auto-Scaling USB Persistence Partitioner & Mounter
# Allocates ${partitions.persistencePercent}% of remaining space to ${config.storage.persistLabel} (ext4)
# Supports Rufus DD mode (auto-appended ext4 partition) & Rufus ISO mode (loopback ext4 image fallback).
set -euo pipefail

PERSIST_LABEL="${config.storage.persistLabel}"
PERSIST_PERCENT=${partitions.persistencePercent}
CREATE_EXFAT=${config.storage.createExfatTransfer && partitions.persistencePercent < 100 ? '1' : '0'}
USER_NAME="${config.username}"
LOOP_IMG_NAME="monolith-persist.img"

show_status() {
  echo "================================================================="
  echo "  ${config.osName.toUpperCase()} — USB PENDRIVE PERSISTENCE STATUS"
  echo "================================================================="
  if mountpoint -q /persist; then
    SRC=$(findmnt -n -o SOURCE /persist 2>/dev/null || echo "unknown")
    FSTYPE=$(findmnt -n -o FSTYPE /persist 2>/dev/null || echo "unknown")
    SIZE_INFO=$(df -h /persist | awk 'NR==2 {printf "%s used / %s total (%s free)", $3, $2, $4}')
    echo "  Status     : ACTIVE (Storing directly on USB pendrive)"
    echo "  Device     : $SRC ($FSTYPE)"
    echo "  Capacity   : $SIZE_INFO"
    echo "  Home Bound : $(mountpoint -q "/home/\${USER_NAME}" && echo "YES -> /persist/home/\${USER_NAME}" || echo "NO")"
    echo "  Wi-Fi      : $(mountpoint -q /etc/NetworkManager/system-connections && echo "YES -> /persist/NetworkManager" || echo "NO")"
    echo "  Bluetooth  : $(mountpoint -q /var/lib/bluetooth && echo "YES -> /persist/bluetooth" || echo "NO")"
    echo "  NixOS Cfg  : $(mountpoint -q /etc/nixos && echo "YES -> /persist/nixos" || echo "NO")"
    if touch /persist/.write-check 2>/dev/null && sync && rm -f /persist/.write-check; then
      echo "  Write Test : PASS (flushed to USB flash)"
    else
      echo "  Write Test : FAIL (read-only mount)"
    fi
  else
    echo "  Status     : INACTIVE (RAM-ONLY tmpfs — data WILL NOT survive reboot!)"
    echo "  Hint       : Run 'sudo monolith-persist-usb' or flash ISO in Rufus DD mode."
  fi
  echo "================================================================="
}

if [[ "\${1:-}" == "--status" ]]; then
  show_status
  exit 0
fi

mount_and_bind_persist() {
  local target_src="$1"
  mkdir -p /persist "/home/\${USER_NAME}" /etc/NetworkManager/system-connections /var/lib/bluetooth /etc/nixos
  if ! mountpoint -q /persist; then
    if [[ -f "$target_src" ]]; then
      mount -o loop,rw "$target_src" /persist
    else
      mount -o rw "$target_src" /persist
    fi
  fi

  mkdir -p "/persist/home/\${USER_NAME}" "/persist/home/\${USER_NAME}/workspace" /persist/projects /persist/NetworkManager /persist/bluetooth /persist/nixos /persist/nix-cache

  local user_group
  user_group=$(id -gn "\${USER_NAME}" 2>/dev/null || echo "users")

  if ! mountpoint -q "/home/\${USER_NAME}"; then
    cp -rn "/home/\${USER_NAME}/." "/persist/home/\${USER_NAME}/" 2>/dev/null || true
    chown -R "\${USER_NAME}:\${user_group}" "/persist/home/\${USER_NAME}"
    mount --bind "/persist/home/\${USER_NAME}" "/home/\${USER_NAME}"
  fi
  chown -R "\${USER_NAME}:\${user_group}" /persist/projects 2>/dev/null || true

  local need_net_restart=0
  if ! mountpoint -q /etc/NetworkManager/system-connections; then
    cp -rn /etc/NetworkManager/system-connections/. /persist/NetworkManager/ 2>/dev/null || true
    mount --bind /persist/NetworkManager /etc/NetworkManager/system-connections
    chmod 700 /etc/NetworkManager/system-connections
    need_net_restart=1
  fi

  local need_bt_restart=0
  if ! mountpoint -q /var/lib/bluetooth; then
    cp -rn /var/lib/bluetooth/. /persist/bluetooth/ 2>/dev/null || true
    mount --bind /persist/bluetooth /var/lib/bluetooth
    need_bt_restart=1
  fi

  if ! mountpoint -q /etc/nixos; then
    cp -rn /etc/nixos/. /persist/nixos/ 2>/dev/null || true
    mount --bind /persist/nixos /etc/nixos
  fi
  chown -R "\${USER_NAME}:\${user_group}" /persist/nixos 2>/dev/null || true

  touch /persist/.monolith-persist-ok
  sync

  if [[ "$need_net_restart" == "1" ]] && systemctl is-active --quiet NetworkManager 2>/dev/null; then
    nmcli connection reload >/dev/null 2>&1 || true
  fi
  if [[ "$need_bt_restart" == "1" ]] && systemctl is-active --quiet bluetooth 2>/dev/null; then
    systemctl try-restart bluetooth >/dev/null 2>&1 || true
  fi
}

udevadm settle --timeout=10 >/dev/null 2>&1 || true

EXISTING_PERSIST=""
for _ in 1 2 3 4 5; do
  EXISTING_PERSIST=$(blkid -c /dev/null -L "$PERSIST_LABEL" 2>/dev/null || true)
  [[ -n "$EXISTING_PERSIST" ]] && break
  sleep 0.5
done

BOOT_PART=""
BOOT_MNT=""
CANDIDATE=$(findmnt -n -o SOURCE /iso 2>/dev/null || true)
if [[ -n "$CANDIDATE" && "$CANDIDATE" != /dev/loop* ]]; then
  BOOT_PART="$CANDIDATE"
  BOOT_MNT="/iso"
fi
if [[ -z "$BOOT_PART" ]]; then
  CANDIDATE=$(blkid -c /dev/null -L "MONOLITH_NIX" 2>/dev/null || true)
  if [[ -n "$CANDIDATE" ]]; then
    BOOT_PART="$CANDIDATE"
    BOOT_MNT=$(findmnt -n -o TARGET "$CANDIDATE" 2>/dev/null | head -n 1 || true)
  fi
fi
if [[ -z "$BOOT_PART" ]]; then
  USB_DISK=$(lsblk -dnpo NAME,TRAN 2>/dev/null | awk '$2=="usb" {print $1; exit}')
  [[ -n "$USB_DISK" ]] && BOOT_PART="$USB_DISK"
fi

BOOT_NAME=$(lsblk -no pkname "$BOOT_PART" 2>/dev/null | head -n 1 || true)
if [[ -z "$BOOT_NAME" && -b "$BOOT_PART" ]]; then
  BOOT_NAME=$(basename "$BOOT_PART")
fi
BOOT_DEV="/dev/\${BOOT_NAME}"

if [[ -n "$EXISTING_PERSIST" ]]; then
  mount_and_bind_persist "$EXISTING_PERSIST"
  echo "Persistence active at /persist ($EXISTING_PERSIST — $(df -h /persist | awk 'NR==2 {print $2}') total)."
  exit 0
fi

if [[ -n "$BOOT_MNT" && -f "$BOOT_MNT/$LOOP_IMG_NAME" ]]; then
  mount -o remount,rw "$BOOT_MNT" 2>/dev/null || true
  mount_and_bind_persist "$BOOT_MNT/$LOOP_IMG_NAME"
  echo "Loopback USB persistence active at /persist ($BOOT_MNT/$LOOP_IMG_NAME)."
  exit 0
fi

if [[ -z "$BOOT_NAME" || ! -b "$BOOT_DEV" ]]; then
  echo "Unable to determine USB block device (BOOT_PART=$BOOT_PART)." >&2
  exit 1
fi

sgdisk -e "$BOOT_DEV" >/dev/null 2>&1 || true
partx -a "$BOOT_DEV" >/dev/null 2>&1 || true
udevadm settle --timeout=5 >/dev/null 2>&1 || sleep 1

TOTAL_SECTORS=$(blockdev --getsz "$BOOT_DEV")
LAST_END=$(sfdisk -d "$BOOT_DEV" 2>/dev/null | awk -F'[,= ]+' '/start=/ {
  s=0; z=0;
  for (i=1; i<=NF; i++) {
    if ($i == "start") s=$(i+1);
    if ($i == "size") z=$(i+1);
  }
  if (s + z > max) max = s + z;
} END { print max + 0 }')

START_SECTOR=$(( ((LAST_END + 2047) / 2048) * 2048 ))
FREE_SECTORS=$(( TOTAL_SECTORS - START_SECTOR - 2048 ))
FREE_MIB=$(( FREE_SECTORS / 2048 ))

if [[ "$FREE_MIB" -lt 2048 ]]; then
  if [[ -n "$BOOT_MNT" ]]; then
    FSTYPE=$(findmnt -n -o FSTYPE "$BOOT_MNT" 2>/dev/null || echo "")
    if [[ "$FSTYPE" != "iso9660" && "$FSTYPE" != "udf" ]]; then
      mount -o remount,rw "$BOOT_MNT" 2>/dev/null || true
      AVAIL_MIB=$(df -m "$BOOT_MNT" 2>/dev/null | awk 'NR==2 {print $4}')
      if [[ "\${AVAIL_MIB:-0}" -ge 2048 ]]; then
        IMG_MIB=$(( AVAIL_MIB * PERSIST_PERCENT / 100 ))
        if [[ "$FSTYPE" == "vfat" && "$IMG_MIB" -gt 3900 ]]; then
          IMG_MIB=3900
        fi
        fallocate -l "\${IMG_MIB}M" "$BOOT_MNT/$LOOP_IMG_NAME" 2>/dev/null || dd if=/dev/zero of="$BOOT_MNT/$LOOP_IMG_NAME" bs=1M count=0 seek="$IMG_MIB"
        mkfs.ext4 -q -F -L "$PERSIST_LABEL" "$BOOT_MNT/$LOOP_IMG_NAME"
        mount_and_bind_persist "$BOOT_MNT/$LOOP_IMG_NAME"
        exit 0
      fi
    fi
  fi
  echo "Insufficient unallocated space (\${FREE_MIB} MiB) on $BOOT_DEV." >&2
  exit 1
fi

BEFORE_PARTS=$(lsblk -lnpo NAME "$BOOT_DEV" | tail -n +2 | sort)

if [[ "$CREATE_EXFAT" == "1" ]]; then
  PERSIST_MIB=$(( FREE_MIB * PERSIST_PERCENT / 100 ))
  PERSIST_SECTORS=$(( PERSIST_MIB * 2048 ))
  REMAINING_MIB=$(( FREE_MIB - PERSIST_MIB ))
  if [[ "$REMAINING_MIB" -lt 512 ]]; then
    CREATE_EXFAT="0"
    printf '%s,%s,L\\n' "$START_SECTOR" "$FREE_SECTORS" | sfdisk --append --force --no-reread "$BOOT_DEV" >/dev/null
  else
    printf '%s,%s,L\\n' "$START_SECTOR" "$PERSIST_SECTORS" | sfdisk --append --force --no-reread "$BOOT_DEV" >/dev/null
  fi
else
  printf '%s,%s,L\\n' "$START_SECTOR" "$FREE_SECTORS" | sfdisk --append --force --no-reread "$BOOT_DEV" >/dev/null
fi

partx -a "$BOOT_DEV" >/dev/null 2>&1 || partprobe "$BOOT_DEV" >/dev/null 2>&1 || true
udevadm settle --timeout=10 >/dev/null 2>&1 || sleep 2

AFTER_PARTS=$(lsblk -lnpo NAME "$BOOT_DEV" | tail -n +2 | sort)
PERSIST_DEV=$(comm -13 <(printf '%s\\n' "$BEFORE_PARTS") <(printf '%s\\n' "$AFTER_PARTS") | head -n 1)

if [[ -z "$PERSIST_DEV" || ! -b "$PERSIST_DEV" ]]; then
  echo "Failed to detect newly created persistence partition on $BOOT_DEV." >&2
  exit 1
fi

mkfs.ext4 -q -F -L "$PERSIST_LABEL" "$PERSIST_DEV"

if [[ "$CREATE_EXFAT" == "1" ]]; then
  BEFORE_XFER=$(lsblk -lnpo NAME "$BOOT_DEV" | tail -n +2 | sort)
  XFER_START=$(( START_SECTOR + PERSIST_SECTORS ))
  XFER_SECTORS=$(( TOTAL_SECTORS - XFER_START - 2048 ))
  XFER_TYPE="EBD0A0A2-B9E5-4433-87C0-68B6B72699C7"
  printf '%s,%s,%s\\n' "$XFER_START" "$XFER_SECTORS" "$XFER_TYPE" | sfdisk --append --force --no-reread "$BOOT_DEV" >/dev/null || true
  partx -a "$BOOT_DEV" >/dev/null 2>&1 || partprobe "$BOOT_DEV" >/dev/null 2>&1 || true
  udevadm settle --timeout=10 >/dev/null 2>&1 || sleep 2
  AFTER_XFER=$(lsblk -lnpo NAME "$BOOT_DEV" | tail -n +2 | sort)
  XFER_DEV=$(comm -13 <(printf '%s\\n' "$BEFORE_XFER") <(printf '%s\\n' "$AFTER_XFER") | head -n 1)
  if [[ -n "$XFER_DEV" && -b "$XFER_DEV" && "$XFER_DEV" != "$PERSIST_DEV" ]]; then
    mkfs.exfat -n "MONOLITH_XFER" "$XFER_DEV" >/dev/null || true
  fi
fi

mount_and_bind_persist "$PERSIST_DEV"
echo "Persistence ready at /persist ($PERSIST_DEV — $(df -h /persist | awk 'NR==2 {print $2}') total)."
`;

  const shortcutMenuScript = `#!/usr/bin/env bash
# ${config.osName} — Interactive Searchable Shortcut Menu (${formatHotkeyCombo(h.shortcutSearch)})
set -euo pipefail
SHORTCUT_FILE="$HOME/SHORTCUTS.txt"
[[ -f "$SHORTCUT_FILE" ]] || { echo "SHORTCUTS.txt missing"; exit 1; }
grep -E '\\|' "$SHORTCUT_FILE" | fuzzel --dmenu --prompt="Shortcuts > " --width=78 --lines=18 >/dev/null || true
`;

  const toggleWindowsScript = `#!/usr/bin/env bash
# ${config.osName} — Niri Keyboard-Only Minimize / Hide-All Window Helper
set -euo pipefail
MODE="\${1:-toggle-all}"
STATE_FILE="/tmp/monolith-windows-hidden"

if [[ "$MODE" == "minimize-focused" ]]; then
  niri msg action move-column-to-workspace 98
else
  if [[ -f "$STATE_FILE" ]]; then
    niri msg action focus-workspace-previous
    rm -f "$STATE_FILE"
  else
    niri msg action focus-workspace 99
    touch "$STATE_FILE"
  fi
fi
`;

  const sessionLaunchScript = `#!/usr/bin/env bash
# ${config.osName} — Pre-Desktop First-Boot Hook + Direct Niri Wayland Session Launcher
set -uo pipefail

export PATH="$HOME/.local/share/mise/shims:$HOME/.local/bin:$HOME/.cargo/bin:$HOME/go/bin:$PATH"
export XDG_SESSION_TYPE="wayland"
export XDG_CURRENT_DESKTOP="niri"
export MOZ_ENABLE_WAYLAND="1"
monolith-firstboot || true

if grep -qE '^[[:space:]]*MONOLITH_AUTO_UPDATE="?true"?' /persist/monolith-boot.conf /etc/monolith/boot.conf 2>/dev/null; then
  (monolith-update --check > "$HOME/monolith-update.log" 2>&1 &) || true
fi

clear
if [[ $# -gt 0 ]]; then
  exec "$@"
else
  exec niri-session
fi
`;

  const bluetoothScript = `#!/usr/bin/env bash
# ${config.osName} — Keyboard-Driven Bluetooth Manager (Super + Alt + B)
set -uo pipefail

if command -v rfkill >/dev/null 2>&1; then
  sudo rfkill unblock bluetooth >/dev/null 2>&1 || true
fi
if command -v bluetoothctl >/dev/null 2>&1; then
  bluetoothctl power on >/dev/null 2>&1 || true
fi

if command -v bluetui >/dev/null 2>&1; then
  exec bluetui
elif command -v bluetoothctl >/dev/null 2>&1; then
  exec bluetoothctl
fi
`;

  const configEditorScript = `#!/usr/bin/env bash
# ${config.osName} — Direct Pendrive Configuration Editor (Super + Alt + C)
set -uo pipefail

export DIALOGRC="$HOME/.dialogrc"
EDITOR_BIN="\${EDITOR:-nvim}"
command -v "$EDITOR_BIN" >/dev/null 2>&1 || EDITOR_BIN="vi"

if ! mountpoint -q /persist; then
  sudo monolith-persist-usb || true
fi

TARGET="\${1:-}"
if [[ -z "$TARGET" ]]; then
  TARGET=$(dialog --clear --backtitle "${config.osName} — Pendrive Config Editor" \\
    --title " Edit Persistent Configs on ${config.storage.persistLabel} " \\
    --stdout --menu "Select a configuration file stored on your USB pendrive:" 17 76 8 \\
    "packages" "NixOS Global Packages (/etc/nixos/user-packages.nix)" \\
    "nix"      "NixOS System Config (/etc/nixos/configuration.nix)" \\
    "flake"    "NixOS Flake Definition (/etc/nixos/flake.nix)" \\
    "niri"     "Niri Scrollable Wayland (~/.config/niri/config.kdl)" \\
    "waybar"   "Auto-Hide Taskbar (~/.config/waybar/config.jsonc)" \\
    "foot"     "Foot Terminal Theme (~/.config/foot/foot.ini)" \\
    "nvim"     "Neovim IDE Config (~/.config/nvim/init.lua)" \\
    "status"   "Check USB Pendrive Persistence & Free Space") || exit 0
fi

open_and_sync() {
  local file_path="$1"
  mkdir -p "$(dirname "$file_path")" 2>/dev/null || sudo mkdir -p "$(dirname "$file_path")"
  if [[ -w "$file_path" ]] || [[ -w "$(dirname "$file_path")" ]]; then
    "$EDITOR_BIN" "$file_path"
  else
    sudo "$EDITOR_BIN" "$file_path"
  fi
  sync
  echo "[OK] Saved & flushed '$file_path' directly to USB pendrive (${config.storage.persistLabel})."
}

case "$TARGET" in
  packages|user-packages) open_and_sync "/etc/nixos/user-packages.nix" ;;
  nix|nixos|config)       open_and_sync "/etc/nixos/configuration.nix" ;;
  flake)                  open_and_sync "/etc/nixos/flake.nix" ;;
  niri)                   open_and_sync "$HOME/.config/niri/config.kdl" ;;
  waybar)                 open_and_sync "$HOME/.config/waybar/config.jsonc" ;;
  foot)                   open_and_sync "$HOME/.config/foot/foot.ini" ;;
  nvim|neovim)            open_and_sync "$HOME/.config/nvim/init.lua" ;;
  status)
    monolith-persist-usb --status
    read -rp "Press Enter to close..." _ || true
    ;;
  *)
    echo "Usage: monolith-config [packages|nix|flake|niri|waybar|foot|nvim|status]"
    exit 1
    ;;
esac
`;

  const newProjectScript = `#!/usr/bin/env bash
# ${config.osName} — Project Generator with On-Demand RAM-Only Local Nix Packages (${formatHotkeyCombo(h.newProject)})
set -uo pipefail

export DIALOGRC="$HOME/.dialogrc"
WORKSPACE="${config.exportPaths.workspaceDir}"

if ! mountpoint -q /persist || ! mountpoint -q "$HOME"; then
  sudo monolith-persist-usb || true
fi

PROJ_NAME="\${1:-}"
STACK="\${2:-}"
LOCAL_PKGS="\${3:-}"

if [[ -z "$PROJ_NAME" ]]; then
  PROJ_NAME=$(dialog --clear --backtitle "${config.osName} — New Project (RAM-Only Local Packages)" \\
    --title " Step 1: Project Directory Name " \\
    --stdout --inputbox "Folder name under $WORKSPACE/<name>:" 10 74 "my-project") || exit 0
fi

PROJ_NAME=$(echo "$PROJ_NAME" | tr ' ' '-' | tr -cd 'a-zA-Z0-9._-')
[[ -n "$PROJ_NAME" ]] || { echo "Invalid project name." >&2; exit 1; }

if [[ -z "$STACK" ]]; then
  STACK=$(dialog --clear --backtitle "${config.osName} — Select Local Project Stack" \\
    --title " Step 2: Select Base Stack (Loaded in RAM ONLY inside this project) " \\
    --stdout --menu "Choose local devShell packages for '$PROJ_NAME':" 16 76 8 \\
    "rust"   "Rust (rustc + cargo + rust-analyzer + clippy)" \\
    "nodejs" "Node.js 22 & TypeScript (nodejs_22 + pnpm + ts-ls)" \\
    "python" "Python 3.12 (python312 + uv + ruff + pyright)" \\
    "java"   "Java 21 LTS (jdk21 + maven + gradle + jdtls)" \\
    "go"     "Go (go + gopls + delve)" \\
    "cpp"    "C / C++ (gcc + clang-tools + cmake + ninja + gdb)" \\
    "custom" "Custom local nixpkgs only") || exit 0
fi

if [[ -z "$LOCAL_PKGS" ]]; then
  LOCAL_PKGS=$(dialog --clear --backtitle "${config.osName} — Extra Local Project Packages" \\
    --title " Step 3: Additional Local Packages (RAM-Only When Project Active) " \\
    --stdout --inputbox "Optional space-separated nixpkgs only for '$PROJ_NAME' (e.g. sqlite redis jq):" 10 74 "") || LOCAL_PKGS=""
fi

NIX_PKGS=()
case "$STACK" in
  java)   NIX_PKGS+=(jdk21 maven gradle jdt-language-server) ;;
  rust)   NIX_PKGS+=(rustc cargo rustfmt clippy rust-analyzer) ;;
  go)     NIX_PKGS+=(go gopls delve) ;;
  python) NIX_PKGS+=(python312 uv ruff pyright) ;;
  nodejs) NIX_PKGS+=(nodejs_22 pnpm nodePackages.typescript nodePackages.typescript-language-server) ;;
  cpp)    NIX_PKGS+=(gcc clang-tools cmake ninja gdb) ;;
  custom) ;;
esac

if [[ -n "$LOCAL_PKGS" ]]; then
  read -ra EXTRA_LIST <<< "$LOCAL_PKGS"
  NIX_PKGS+=("\${EXTRA_LIST[@]}")
fi

PROJ_DIR="$WORKSPACE/$PROJ_NAME"
mkdir -p "$PROJ_DIR"
[[ -d /persist/projects ]] && ln -sfn "$PROJ_DIR" "/persist/projects/$PROJ_NAME" 2>/dev/null || true

PKGS_BLOCK=""
for p in "\${NIX_PKGS[@]}"; do
  PKGS_BLOCK="\${PKGS_BLOCK}          \${p}\n"
done

cat > "$PROJ_DIR/flake.nix" <<FLAKE_EOF
{
  description = "$PROJ_NAME — Monolith NixOS RAM-Only Local Project ($STACK)";
  inputs.nixpkgs.url = "github:NixOS/nixpkgs/${config.nixSystem.channel}";
  outputs = { self, nixpkgs }:
    let
      system = "x86_64-linux";
      pkgs = import nixpkgs { inherit system; config.allowUnfree = true; };
    in {
      devShells.\${system}.default = pkgs.mkShell {
        name = "$PROJ_NAME-ram-dev";
        packages = with pkgs; [
$(printf "%b" "$PKGS_BLOCK")        ];
        shellHook = ''
          export MONOLITH_ACTIVE_PROJECT="$PROJ_NAME"
          export MONOLITH_RAM_DIR="/run/user/$(id -u)/monolith-projects/$PROJ_NAME"
          mkdir -p "$MONOLITH_RAM_DIR"
          export XDG_CACHE_HOME="$MONOLITH_RAM_DIR/cache"
          export TMPDIR="$MONOLITH_RAM_DIR/tmp"
          mkdir -p "$XDG_CACHE_HOME" "$TMPDIR"
          echo "[MONOLITH] Local project packages loaded in RAM for $PROJ_NAME (auto-cleared when idle)."
        '';
      };
    };
}
FLAKE_EOF

cat > "$PROJ_DIR/.envrc" <<'ENVRC_EOF'
use flake
ENVRC_EOF

git -C "$PROJ_DIR" init -q >/dev/null 2>&1 || true
command -v direnv >/dev/null 2>&1 && direnv allow "$PROJ_DIR" >/dev/null 2>&1 || true
sync
echo "[OK] Created RAM-only local project at $PROJ_DIR (local pkgs load on cd & clear on idle)."
`;

  const screenshotScript = `#!/usr/bin/env bash
# ${config.osName} — Native Wayland Screenshot Utility (grim + slurp + wl-copy)
set -euo pipefail

MODE="\${1:-region}"
SHOT_DIR="$HOME/Pictures/Screenshots"
mkdir -p "$SHOT_DIR"
OUT_FILE="\${SHOT_DIR}/monolith-$(date +%Y%m%d-%H%M%S).png"

case "$MODE" in
  region)
    GEOM="$(slurp)" || exit 0
    [[ -n "$GEOM" ]] || exit 0
    grim -g "$GEOM" "$OUT_FILE"
    ;;
  full)
    grim "$OUT_FILE"
    ;;
  clipboard)
    GEOM="$(slurp)" || exit 0
    [[ -n "$GEOM" ]] || exit 0
    grim -g "$GEOM" - | wl-copy --type image/png
    exit 0
    ;;
  *)
    echo "Usage: monolith-screenshot [region|full|clipboard]"
    exit 1
    ;;
esac

wl-copy --type image/png < "$OUT_FILE" || true
sync
echo "Screenshot saved to $OUT_FILE and copied to clipboard."
`;

  const updateScript = `#!/usr/bin/env bash
# ${config.osName} — Persistent Auto-Updater (Latest Nix Flake + Global Profile + GitHub ISO)
set -uo pipefail

MODE="\${1:-interactive}"
export PATH="$HOME/.local/share/mise/shims:$HOME/.local/bin:$HOME/.cargo/bin:$HOME/go/bin:$PATH"

BOOT_CONF="/etc/monolith/boot.conf"
[[ -f /persist/monolith-boot.conf ]] && BOOT_CONF="/persist/monolith-boot.conf"
GITHUB_REPO=""
if [[ -f "$BOOT_CONF" ]]; then
  GITHUB_REPO=$(grep -E '^[[:space:]]*MONOLITH_GITHUB_REPO=' "$BOOT_CONF" 2>/dev/null | tail -n 1 | sed -E 's/^[^=]+=//; s/^"//; s/"$//' || true)
fi

if ! (curl -fsS --max-time 4 https://api.github.com >/dev/null 2>&1 || ping -c 1 -W 2 1.1.1.1 >/dev/null 2>&1); then
  echo "[OFFLINE] Connect to Wi-Fi/Ethernet first (nmtui) and re-run monolith-update."
  exit 0
fi

if [[ -n "$GITHUB_REPO" ]]; then
  LATEST_JSON=$(curl -fsSL --max-time 8 "https://api.github.com/repos/\${GITHUB_REPO}/releases/latest" 2>/dev/null || true)
  LATEST_TAG=$(printf '%s' "$LATEST_JSON" | jq -r '.tag_name // empty' 2>/dev/null || true)
  if [[ -n "$LATEST_TAG" ]]; then
    echo "Latest GitHub Release: $LATEST_TAG"
    mkdir -p "$HOME/.config/monolith"
    printf '%s\\n' "$LATEST_TAG" > "$HOME/.config/monolith/latest-release.txt"
  fi
fi

if [[ "$MODE" == "--check" ]]; then
  command -v mise >/dev/null 2>&1 && mise outdated || true
  exit 0
fi

command -v mise >/dev/null 2>&1 && mise upgrade || true

if [[ -f /etc/nixos/flake.nix ]]; then
  (cd /etc/nixos && nix --extra-experimental-features 'nix-command flakes' flake update) || true
fi
nix --extra-experimental-features 'nix-command flakes' profile upgrade --all || true
if [[ -d /persist/nix-cache ]]; then
  mapfile -t UPDATED_PATHS < <(nix --extra-experimental-features 'nix-command flakes' profile list --json 2>/dev/null | jq -r '.. | .storePaths? // empty | .[]' | sort -u || true)
  if [[ "\${#UPDATED_PATHS[@]}" -gt 0 ]]; then
    nix --extra-experimental-features 'nix-command flakes' copy --to 'file:///persist/nix-cache' "\${UPDATED_PATHS[@]}" || true
    printf '%s\\n' "\${UPDATED_PATHS[@]}" | sudo tee /persist/nixos/profile-store-paths.txt >/dev/null
  fi
fi

sync
echo "[OK] ${config.osName} update complete & synced to USB pendrive!"
if [[ "$MODE" == "interactive" && -t 0 ]]; then
  read -rp "Press Enter to close..." _ || true
fi
`;

  const applyBootconfScript = `#!/usr/bin/env bash
# ${config.osName} — Post-Rufus First-Boot Customizer (monolith-boot.conf)
set -uo pipefail

SKEL_DIR="\${1:-/etc/skel}"
DEFAULT_USER="${config.username}"
PERSIST_CONF="/persist/monolith-boot.conf"
ACTIVE_CONF="/etc/monolith/boot.conf"
mkdir -p /etc/monolith

FOUND_CONF=""
for candidate in "/iso/monolith-boot.conf" "$PERSIST_CONF"; do
  if [[ -f "$candidate" ]]; then
    FOUND_CONF="$candidate"
    break
  fi
done

if [[ -z "$FOUND_CONF" ]]; then
  BOOT_PART=$(findmnt -n -o SOURCE /iso 2>/dev/null || true)
  BOOT_NAME=$(lsblk -no pkname "$BOOT_PART" 2>/dev/null | head -n 1 || true)
  if [[ -n "$BOOT_NAME" && -b "/dev/\${BOOT_NAME}" ]]; then
    SCAN_MNT="/tmp/monolith-bootconf-scan"
    mkdir -p "$SCAN_MNT"
    for part in $(lsblk -lnpo NAME "/dev/\${BOOT_NAME}" | tail -n +2); do
      EXISTING_MNT=$(findmnt -n -o TARGET "$part" 2>/dev/null | head -n 1 || true)
      if [[ -n "$EXISTING_MNT" ]]; then
        for sub in "monolith-boot.conf" "EFI/monolith-boot.conf"; do
          [[ -f "\${EXISTING_MNT}/\${sub}" ]] && FOUND_CONF="\${EXISTING_MNT}/\${sub}" && break 2
        done
      elif mount -o ro "$part" "$SCAN_MNT" 2>/dev/null; then
        for sub in "monolith-boot.conf" "EFI/monolith-boot.conf"; do
          if [[ -f "\${SCAN_MNT}/\${sub}" ]]; then
            cp "\${SCAN_MNT}/\${sub}" "$ACTIVE_CONF"
            FOUND_CONF="$ACTIVE_CONF"
            break
          fi
        done
        umount "$SCAN_MNT" 2>/dev/null || true
        [[ -n "$FOUND_CONF" ]] && break
      fi
    done
    rmdir "$SCAN_MNT" 2>/dev/null || true
  fi
fi

[[ -z "$FOUND_CONF" || ! -f "$FOUND_CONF" ]] && exit 0

tr -d '\\r' < "$FOUND_CONF" > "$ACTIVE_CONF"
chmod 600 "$ACTIVE_CONF"
if mountpoint -q /persist 2>/dev/null; then
  cp "$ACTIVE_CONF" "$PERSIST_CONF"
  chmod 600 "$PERSIST_CONF"
fi

get_val() {
  local key="$1"
  grep -E "^[[:space:]]*\${key}=" "$ACTIVE_CONF" 2>/dev/null | tail -n 1 | sed -E 's/^[^=]+=//; s/^"//; s/"$//' || true
}

CFG_USER=$(get_val MONOLITH_USER)
CFG_PASS=$(get_val MONOLITH_PASSWORD)
CFG_HOST=$(get_val MONOLITH_HOSTNAME)
CFG_TZ=$(get_val MONOLITH_TIMEZONE)
CFG_KEYMAP=$(get_val MONOLITH_KEYMAP)
CFG_WIFI_SSID=$(get_val MONOLITH_WIFI_SSID)
CFG_WIFI_PSK=$(get_val MONOLITH_WIFI_PSK)
CFG_GIT_NAME=$(get_val MONOLITH_GIT_NAME)
CFG_GIT_EMAIL=$(get_val MONOLITH_GIT_EMAIL)

TARGET_USER="$DEFAULT_USER"
if [[ -n "$CFG_USER" && "$CFG_USER" =~ ^[a-z_][a-z0-9_-]{0,31}$ ]]; then
  TARGET_USER="$CFG_USER"
  if ! id "$TARGET_USER" >/dev/null 2>&1; then
    useradd -m -G wheel,networkmanager,video,audio,input,render -s /bin/bash "$TARGET_USER" 2>/dev/null || true
  fi
  if mountpoint -q /persist 2>/dev/null; then
    mkdir -p "/persist/home/\${TARGET_USER}" "/home/\${TARGET_USER}"
    mountpoint -q "/home/\${TARGET_USER}" || mount --bind "/persist/home/\${TARGET_USER}" "/home/\${TARGET_USER}" || true
  fi
  cp -rn "\${SKEL_DIR}/." "/home/\${TARGET_USER}/" 2>/dev/null || true
  TARGET_GROUP=$(id -gn "$TARGET_USER" 2>/dev/null || echo "users")
  chown -R "\${TARGET_USER}:\${TARGET_GROUP}" "/home/\${TARGET_USER}" 2>/dev/null || true
fi
printf '%s\\n' "$TARGET_USER" > /etc/monolith/active-user

if [[ -n "$CFG_PASS" ]] && id "$TARGET_USER" >/dev/null 2>&1; then
  printf '%s:%s\\n' "$TARGET_USER" "$CFG_PASS" | chpasswd 2>/dev/null || true
fi

if [[ -n "$CFG_HOST" && "$CFG_HOST" =~ ^[a-zA-Z0-9][a-zA-Z0-9-]{0,62}$ ]]; then
  hostname "$CFG_HOST" 2>/dev/null || true
fi

if [[ -n "$CFG_TZ" && -f "/usr/share/zoneinfo/\${CFG_TZ}" ]]; then
  ln -sf "/usr/share/zoneinfo/\${CFG_TZ}" /etc/localtime 2>/dev/null || true
fi

if [[ -n "$CFG_KEYMAP" && "$CFG_KEYMAP" =~ ^[a-z]{2,8}$ ]]; then
  loadkeys "$CFG_KEYMAP" 2>/dev/null || true
  if [[ -f "/home/\${TARGET_USER}/.config/niri/config.kdl" ]]; then
    sed -i -E "s/xkb \\{ layout \"[^\"]+\"; \\}/xkb { layout \"\${CFG_KEYMAP}\"; }/" "/home/\${TARGET_USER}/.config/niri/config.kdl" 2>/dev/null || true
  fi
fi

if [[ -n "$CFG_WIFI_SSID" ]]; then
  mkdir -p /etc/NetworkManager/system-connections
  SAFE_NM=$(printf '%s' "$CFG_WIFI_SSID" | tr -cd 'a-zA-Z0-9_-')
  [[ -z "$SAFE_NM" ]] && SAFE_NM="monolith-wifi"
  NM_FILE="/etc/NetworkManager/system-connections/\${SAFE_NM}.nmconnection"
  {
    echo "[connection]"
    echo "id=\${CFG_WIFI_SSID}"
    echo "type=wifi"
    echo "autoconnect=true"
    echo ""
    echo "[wifi]"
    echo "mode=infrastructure"
    echo "ssid=\${CFG_WIFI_SSID}"
    if [[ -n "$CFG_WIFI_PSK" ]]; then
      echo ""
      echo "[wifi-security]"
      echo "key-mgmt=wpa-psk"
      echo "psk=\${CFG_WIFI_PSK}"
    fi
    echo ""
    echo "[ipv4]"
    echo "method=auto"
    echo ""
    echo "[ipv6]"
    echo "method=auto"
  } > "$NM_FILE"
  chmod 600 "$NM_FILE"
fi

if [[ -n "$CFG_GIT_NAME" || -n "$CFG_GIT_EMAIL" ]]; then
  GIT_CFG="/home/\${TARGET_USER}/.gitconfig"
  {
    echo "[user]"
    [[ -n "$CFG_GIT_NAME" ]] && echo "  name = \${CFG_GIT_NAME}"
    [[ -n "$CFG_GIT_EMAIL" ]] && echo "  email = \${CFG_GIT_EMAIL}"
    echo "[init]"
    echo "  defaultBranch = main"
  } > "$GIT_CFG"
  TARGET_GROUP=$(id -gn "$TARGET_USER" 2>/dev/null || echo "users")
  chown "\${TARGET_USER}:\${TARGET_GROUP}" "$GIT_CFG" 2>/dev/null || true
fi

sync
`;

  const flakeNix = `{
  description = "${config.osName} — Minimal Declarative Portable NixOS Live ISO (Niri Wayland Only)";

  inputs = {
    # Latest NixOS channel selected in Monolith Settings (${config.nixSystem.channel})
    nixpkgs.url = "github:NixOS/nixpkgs/${config.nixSystem.channel}";
  };

  outputs = { self, nixpkgs, ... }:
    let
      system = "x86_64-linux";
      monolithSystem = nixpkgs.lib.nixosSystem {
        inherit system;
        modules = [
          ./configuration.nix
        ];
      };
    in {
      nixosConfigurations.monolith = monolithSystem;
      packages.\${system} = {
        iso = monolithSystem.config.system.build.isoImage;
        default = monolithSystem.config.system.build.isoImage;
      };
    };
}
`;

  const validExtraGlobalPkgs = config.nixSystem.globalPackages
    .map(sanitizeNixAttr)
    .filter(isValidNixPackageName)
    .filter(
      (p) =>
        ![
          'firefox',
          'neovim',
          'git',
          'gh',
          'openssh',
          'localsend',
          'obs-studio',
          'mise',
          'bluez',
          'bluetui',
          'waybar',
          'fuzzel',
          'foot',
          'swaybg',
          'swayidle',
          'btop',
          'yazi',
          'ripgrep',
          'fd',
          'jq',
        ].includes(p),
    );

  const extraGlobalPkgsNix =
    validExtraGlobalPkgs.length > 0
      ? `\n    # User-selected Global Packages\n${validExtraGlobalPkgs.map((p) => `    ${p}`).join('\n')}`
      : '';

  const winePackagesNix = config.nixSystem.windowsExeSupport
    ? `\n    # Windows .exe Compatibility Layer (Wine + Winetricks)\n    wineWowPackages.stable\n    winetricks`
    : '';

  const nixConfiguration = `{ config, pkgs, lib, modulesPath, ... }:

let
  monolithFirstboot = pkgs.writeShellScriptBin "monolith-firstboot" ''
${escapeNixIndented(firstbootScript)}
  '';

  monolithPkg = pkgs.writeShellScriptBin "monolith-pkg" ''
${escapeNixIndented(pkgScript)}
  '';

  monolithRamClean = pkgs.writeShellScriptBin "monolith-ram-clean" ''
${escapeNixIndented(ramCleanScript)}
  '';

  monolithScreensaver = pkgs.writeShellScriptBin "monolith-screensaver" ''
${escapeNixIndented(screensaverScript)}
  '';

  monolithHardware = pkgs.writeShellScriptBin "monolith-hardware" ''
${escapeNixIndented(hardwareScript)}
  '';

  monolithSettings = pkgs.writeShellScriptBin "monolith-settings" ''
${escapeNixIndented(settingsTuiScript)}
  '';

  monolithExe = pkgs.writeShellScriptBin "monolith-exe" ''
${escapeNixIndented(exeHelperScript)}
  '';

  monolithReset = pkgs.writeShellScriptBin "monolith-reset" ''
${escapeNixIndented(resetScript)}
  '';

  monolithPersistUsb = pkgs.writeShellScriptBin "monolith-persist-usb" ''
${escapeNixIndented(persistUsbScript)}
  '';

  monolithShortcutMenu = pkgs.writeShellScriptBin "monolith-shortcut-menu" ''
${escapeNixIndented(shortcutMenuScript)}
  '';

  monolithToggleWindows = pkgs.writeShellScriptBin "monolith-toggle-windows" ''
${escapeNixIndented(toggleWindowsScript)}
  '';

  monolithSessionLaunch = pkgs.writeShellScriptBin "monolith-session-launch" ''
${escapeNixIndented(sessionLaunchScript)}
  '';

  monolithBluetooth = pkgs.writeShellScriptBin "monolith-bluetooth" ''
${escapeNixIndented(bluetoothScript)}
  '';

  monolithConfig = pkgs.writeShellScriptBin "monolith-config" ''
${escapeNixIndented(configEditorScript)}
  '';

  monolithNewProject = pkgs.writeShellScriptBin "monolith-new-project" ''
${escapeNixIndented(newProjectScript)}
  '';

  monolithScreenshot = pkgs.writeShellScriptBin "monolith-screenshot" ''
${escapeNixIndented(screenshotScript)}
  '';

  monolithUpdate = pkgs.writeShellScriptBin "monolith-update" ''
${escapeNixIndented(updateScript)}
  '';

  monolithApplyBootconf = pkgs.writeShellScriptBin "monolith-apply-bootconf" ''
${escapeNixIndented(applyBootconfScript)}
  '';

  localSendCompat = pkgs.writeShellScriptBin "localsend_app" ''
    exec \${pkgs.localsend}/bin/localsend "$@"
  '';

  monolithNixSeed = pkgs.runCommand "monolith-nix-seed" {} ''
    mkdir -p $out
    cp \${./flake.nix} $out/flake.nix
    cp \${./configuration.nix} $out/configuration.nix
    cat > $out/user-packages.nix <<'USER_PKGS_EOF'
# ${config.osName} — Declarative Global User Packages (Persisted on ${config.storage.persistLabel})
# Install anytime via: monolith-pkg install <pkg>  or  nix profile install nixpkgs#<pkg>
{ pkgs, ... }: {
  environment.systemPackages = with pkgs; [
  ];
}
USER_PKGS_EOF
  '';

  monolithSkel = pkgs.runCommand "monolith-skel" {} ''
    mkdir -p $out/.config/niri $out/.config/waybar $out/.config/foot $out/.config/fuzzel $out/.config/nvim $out/.config/gtk-3.0 $out/.config/gtk-4.0 $out/.config/monolith $out/.mozilla/firefox/monolith.default

    cat > $out/.config/niri/config.kdl <<'MONOLITH_EOF'
${escapeNixIndented(niriKdl)}
MONOLITH_EOF

    cat > $out/.config/waybar/config.jsonc <<'MONOLITH_EOF'
${escapeNixIndented(waybarJson)}
MONOLITH_EOF

    cat > $out/.config/waybar/style.css <<'MONOLITH_EOF'
${escapeNixIndented(waybarCss)}
MONOLITH_EOF

    cat > $out/.config/foot/foot.ini <<'MONOLITH_EOF'
${escapeNixIndented(footIni)}
MONOLITH_EOF

    cat > $out/.config/fuzzel/fuzzel.ini <<'MONOLITH_EOF'
${escapeNixIndented(fuzzelIni)}
MONOLITH_EOF

    cat > $out/.config/gtk-3.0/settings.ini <<'MONOLITH_EOF'
${escapeNixIndented(gtkSettingsIni)}
MONOLITH_EOF

    cat > $out/.config/gtk-4.0/settings.ini <<'MONOLITH_EOF'
${escapeNixIndented(gtkSettingsIni)}
MONOLITH_EOF

    cat > $out/.config/gtk-3.0/gtk.css <<'MONOLITH_EOF'
${escapeNixIndented(gtkNoButtonsCss)}
MONOLITH_EOF

    cat > $out/.config/gtk-4.0/gtk.css <<'MONOLITH_EOF'
${escapeNixIndented(gtkNoButtonsCss)}
MONOLITH_EOF

    cat > $out/.config/monolith/wallpaper.svg <<'MONOLITH_EOF'
${escapeNixIndented(wallpaperSvg)}
MONOLITH_EOF

    cat > $out/.config/nvim/init.lua <<'MONOLITH_EOF'
${escapeNixIndented(nvimInitLua)}
MONOLITH_EOF

    cat > $out/.mozilla/firefox/monolith.default/user.js <<'MONOLITH_EOF'
${escapeNixIndented(firefoxUserJs)}
MONOLITH_EOF

    cat > $out/SHORTCUTS.txt <<'MONOLITH_EOF'
${escapeNixIndented(shortcutsTxt)}
MONOLITH_EOF

    cat > $out/.config/monolith/settings.json <<'MONOLITH_EOF'
${escapeNixIndented(settingsSnapshot)}
MONOLITH_EOF

    cat > $out/.dialogrc <<'MONOLITH_EOF'
${escapeNixIndented(dialogRc)}
MONOLITH_EOF

    cat > $out/.bashrc <<'MONOLITH_EOF'
${escapeNixIndented(bashrcFile)}
MONOLITH_EOF
  '';
in
{
  imports = [
    "\${modulesPath}/installer/cd-dvd/installation-cd-minimal.nix"
  ];

  # Portable ISO identity & fast multi-threaded zstd compression
  isoImage.isoBaseName = lib.mkForce "monolith-nixos";
  isoImage.volumeID = lib.mkForce "MONOLITH_NIX";
  isoImage.squashfsCompression = lib.mkForce "zstd -Xcompression-level 15";
  isoImage.makeEfiBootable = true;
  isoImage.makeUsbBootable = true;

  # Latest Nix package manager & flakes
  ${config.nixSystem.useLatestNixPackage ? 'nix.package = pkgs.nixVersions.latest;' : '# Using channel default Nix package'}
  nix.settings = {
    experimental-features = [ "nix-command" "flakes" ];
    auto-optimise-store = false;
  };
  nixpkgs.config.allowUnfree = true;
  hardware.enableRedistributableFirmware = true;

  # Strict < ${config.nixSystem.ramIdleLimitMb} MB Idle RAM Tuning (ZRAM + earlyoom + aggressive cache reclaim)
  zramSwap = {
    enable = true;
    algorithm = "zstd";
    memoryPercent = 50;
  };
  services.earlyoom.enable = true;
  boot.kernelParams = [ "quiet" "loglevel=3" ];
  boot.kernel.sysctl = {
    "kernel.printk" = "3 3 3 3";
    "vm.swappiness" = 10;
    "vm.vfs_cache_pressure" = 150;
    "vm.dirty_ratio" = 10;
  };

  console = {
    earlySetup = true;
    keyMap = "us";
    font = "\${pkgs.terminus_font}/share/consolefonts/ter-v24n.psf.gz";
    packages = [ pkgs.terminus_font ];
  };

  # Universal Hardware: CPUs, GPUs, HDMI/DP, USB-A/C/Thunderbolt, Wi-Fi, Bluetooth, Audio
  hardware.cpu.intel.updateMicrocode = true;
  hardware.cpu.amd.updateMicrocode = true;
  hardware.graphics.enable = true;
  services.udisks2.enable = ${config.hardware.usbAutomount ? 'true' : 'false'};
  services.hardware.bolt.enable = ${config.hardware.usbAutomount ? 'true' : 'false'};
  hardware.bluetooth = {
    enable = ${config.hardware.bluetoothStack ? 'true' : 'false'};
    powerOnBoot = true;
    settings = {
      General = {
        Experimental = true;
        FastConnectable = true;
      };
      Policy = {
        AutoEnable = true;
      };
    };
  };

  networking.hostName = lib.mkForce "${config.hostname}";
  networking.wireless.enable = lib.mkForce false;
  networking.networkmanager = {
    enable = true;
    wifi.backend = "iwd";
  };
  # Open LocalSend port (53317) for zero-cable LAN file sharing
  networking.firewall.allowedTCPPorts = [ 53317 ];
  networking.firewall.allowedUDPPorts = [ 53317 ];
  services.timesyncd.enable = true;

  security.rtkit.enable = true;
  services.pulseaudio.enable = lib.mkForce false;
  services.pipewire = {
    enable = true;
    alsa.enable = true;
    pulse.enable = true;
    jack.enable = true;
  };

  # Dedicated Niri Wayland Compositor (Wayland already active on start)
  programs.niri.enable = true;
  programs.direnv = {
    enable = true;
    nix-direnv.enable = true;
  };
  xdg.portal = {
    enable = true;
    extraPortals = [
      pkgs.xdg-desktop-portal-gtk
      pkgs.xdg-desktop-portal-gnome
    ];
  };

  programs.nix-ld = {
    enable = true;
    libraries = with pkgs; [
      stdenv.cc.cc
      zlib
      openssl
      curl
      expat
      libxcrypt
      nss
      nspr
    ];
  };

  services.getty.autologinUser = lib.mkForce null;

  # Direct Niri Wayland Session via tuigreet (boots straight into Niri Wayland)
  services.greetd = {
    enable = true;
    settings = {
      initial_session = {
        user = "${config.username}";
        command = "/run/current-system/sw/bin/monolith-session-launch niri-session";
      };
      default_session = {
        user = "greeter";
        command = lib.concatStringsSep " " [
          "\${lib.getExe (pkgs.tuigreet or pkgs.greetd.tuigreet)}"
          "--time"
          "--remember"
          "--asterisks"
          "--greeting '${config.osName} (Niri Wayland)  |  user: ${config.username}  |  pass: monolith'"
          "--cmd '/run/current-system/sw/bin/monolith-session-launch niri-session'"
          "--theme 'border=${palette.tuiAccentName};text=white;prompt=${palette.tuiAccentName};time=gray;action=${palette.tuiAccentName};button=${palette.tuiAccentName};container=black;input=white;title=${palette.tuiAccentName};greet=white'"
        ];
      };
    };
  };

  systemd.services.greetd.serviceConfig = {
    Type = "idle";
    StandardInput = "tty";
    StandardOutput = "tty";
    StandardError = "journal";
    TTYReset = true;
    TTYVHangup = true;
    TTYVTDisallocate = true;
  };

  # Periodic Idle RAM Sweeper Timer (keeps idle memory strictly < ${config.nixSystem.ramIdleLimitMb} MB)
  systemd.services.monolith-ram-clean = {
    description = "Monolith NixOS Idle RAM & Project Cache Cleaner";
    serviceConfig = {
      Type = "oneshot";
      ExecStart = "\${monolithRamClean}/bin/monolith-ram-clean --quiet";
    };
  };
  systemd.timers.monolith-ram-clean = {
    wantedBy = [ "timers.target" ];
    enable = ${config.nixSystem.autoClearIdleRam ? 'true' : 'false'};
    timerConfig = {
      OnBootSec = "3m";
      OnUnitActiveSec = "5m";
    };
  };

  users.users.${config.username} = {
    isNormalUser = true;
    description = "${config.osName} Developer";
    initialPassword = "monolith";
    extraGroups = [ "wheel" "networkmanager" "video" "audio" "input" "render" ];
  };
  security.sudo.wheelNeedsPassword = false;

  systemd.services.monolith-init-user = {
    description = "Monolith NixOS User Initialization, Hardware & Pendrive Persistence";
    after = [ "local-fs.target" "systemd-udev-settle.service" ];
    before = [ "NetworkManager.service" "bluetooth.service" "greetd.service" ];
    wantedBy = [ "multi-user.target" ];
    path = with pkgs; [
      util-linux
      coreutils
      gnugrep
      gnused
      gawk
      shadow
      parted
      gptfdisk
      e2fsprogs
      exfatprogs
      systemd
      networkmanager
      nix
      monolithPersistUsb
      monolithApplyBootconf
    ];
    serviceConfig = {
      Type = "oneshot";
      RemainAfterExit = true;
    };
    script = ''
      dmesg -n 1 2>/dev/null || true
      mkdir -p /var/cache/tuigreet /home/${config.username} /etc/NetworkManager/system-connections /var/lib/bluetooth /etc/nixos /etc/monolith
      chown -R greeter:greeter /var/cache/tuigreet 2>/dev/null || true

      udevadm settle --timeout=10 2>/dev/null || true
      \${monolithPersistUsb}/bin/monolith-persist-usb || true

      cp -rn \${monolithNixSeed}/. /etc/nixos/ 2>/dev/null || true
      chmod -R u+w /etc/nixos 2>/dev/null || true
      chown -R ${config.username}:users /etc/nixos 2>/dev/null || true

      cp -rn \${monolithSkel}/. /home/${config.username}/ 2>/dev/null || true
      chmod -R u+w /home/${config.username} 2>/dev/null || true
      chown -R ${config.username}:users /home/${config.username}

      \${monolithApplyBootconf}/bin/monolith-apply-bootconf \${monolithSkel} || true
      sync

      ACTIVE_USER="${config.username}"
      if [ -f /etc/monolith/active-user ]; then
        ACTIVE_USER=$(cat /etc/monolith/active-user 2>/dev/null || echo "${config.username}")
      fi
      if [ -s /persist/nixos/profile-store-paths.txt ] && [ -d /persist/nix-cache ]; then
        mapfile -t SAVED_PATHS < <(grep -v '^$' /persist/nixos/profile-store-paths.txt || true)
        if [ "''\${#SAVED_PATHS[@]}" -gt 0 ]; then
          nix --extra-experimental-features 'nix-command flakes' copy --from 'file:///persist/nix-cache' --no-check-sigs "''\${SAVED_PATHS[@]}" >/dev/null 2>&1 || true
          /run/wrappers/bin/su - "$ACTIVE_USER" -c "nix --extra-experimental-features 'nix-command flakes' --offline profile install ''\${SAVED_PATHS[*]}" >/dev/null 2>&1 || true
        fi
      fi
    '';
  };

  # JetBrains Mono enforced across every UI, TUI, terminal, and browser
  fonts = {
    packages = with pkgs; [
      jetbrains-mono
      nerd-fonts.jetbrains-mono
      noto-fonts
      terminus_font
    ];
    fontconfig.defaultFonts = {
      monospace = [ "JetBrains Mono" ];
      sansSerif = [ "JetBrains Mono" ];
      serif = [ "JetBrains Mono" ];
    };
  };

  environment.systemPackages = with pkgs; [
    firefox
    neovim
    git
    gh
    openssh
    localsend
    obs-studio
    mise
    direnv
    nix-direnv
    bluez
    bluetui
    usbutils
    udiskie
    wlr-randr
    kanshi
    waybar
    swaybg
    swayidle
    fuzzel
    foot
    yazi
    btop
    wl-clipboard
    grim
    slurp
    brightnessctl
    polkit_gnome
    ripgrep
    fd
    jq
    lsof
    curl
    rsync
    unzip
    gnutar
    dialog
    parted
    gptfdisk
    dosfstools
    e2fsprogs
    exfatprogs
    util-linux${extraGlobalPkgsNix}${winePackagesNix}
    monolithFirstboot
    monolithPkg
    monolithRamClean
    monolithScreensaver
    monolithHardware
    monolithSettings
    monolithExe
    monolithReset
    monolithPersistUsb
    monolithShortcutMenu
    monolithToggleWindows
    monolithSessionLaunch
    monolithBluetooth
    monolithConfig
    monolithNewProject
    monolithScreenshot
    monolithUpdate
    monolithApplyBootconf
    localSendCompat
  ];

  system.stateVersion = "${channelInfo.stateVersion}";
}
`;

  const nixosWorkflow = `name: Build ${config.osName} ISO

on:
  push:
    branches:
      - main
    paths:
      - 'nixos/**'
      - '.github/workflows/build-nixos.yml'
  workflow_dispatch:
    inputs:
      release_tag:
        description: 'Optional release tag (defaults to nixos-vYYYY.MM.DD-<sha>)'
        required: false
        default: ''

concurrency:
  group: monolith-nixos-\${{ github.ref }}
  cancel-in-progress: true

permissions:
  contents: write

jobs:
  build-nixos:
    name: Build & Release Niri NixOS Flake ISO
    runs-on: ubuntu-latest
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Free runner disk space
        run: |
          sudo rm -rf /usr/share/dotnet /opt/ghc /usr/local/lib/android /opt/hostedtoolcache/CodeQL
          df -h

      - name: Install Determinate Nix
        uses: DeterminateSystems/nix-installer-action@main

      - name: Enable Magic Nix Cache
        uses: DeterminateSystems/magic-nix-cache-action@main

      - name: Build declarative Monolith NixOS Live ISO (${config.nixSystem.channel} + Niri + zstd)
        id: meta
        run: |
          mkdir -p out release-assets
          nix build ./nixos#packages.x86_64-linux.iso \\
            --cores 0 --max-jobs auto \\
            --option max-substitution-jobs 32 \\
            --option http-connections 64 \\
            --print-build-logs
          RAW_ISO=$(ls -1 result/iso/*.iso | head -n 1)
          ISO_FILE="monolith-nixos-$(date +%Y.%m.%d)-x86_64.iso"
          cp "$RAW_ISO" "out/$ISO_FILE"
          ISO_BYTES=$(stat -c%s "out/$ISO_FILE")
          (cd out && sha256sum "$ISO_FILE") > "release-assets/$ISO_FILE.sha256"
          if [ "$ISO_BYTES" -lt 2100000000 ]; then
            mv "out/$ISO_FILE" "release-assets/$ISO_FILE"
          else
            split -b 1800M "out/$ISO_FILE" "release-assets/$ISO_FILE.part-"
            printf '@echo off\\r\\ncopy /b "%s.part-*" "%s"\\r\\necho Assembled %s! Flash with Rufus (DD mode).\\r\\npause\\r\\n' "$ISO_FILE" "$ISO_FILE" "$ISO_FILE" > "release-assets/combine-nixos-iso.bat"
          fi
          TAG="\${{ github.event.inputs.release_tag }}"
          if [ -z "$TAG" ]; then
            TAG="nixos-v$(date +%Y.%m.%d)-\${GITHUB_SHA::7}"
          fi
          echo "release_tag=$TAG" >> "$GITHUB_OUTPUT"
          ls -lh release-assets/

      - name: Publish NixOS Flake ISO Release
        uses: softprops/action-gh-release@v2
        with:
          tag_name: \${{ steps.meta.outputs.release_tag }}
          name: "${config.osName} \${{ steps.meta.outputs.release_tag }}"
          draft: false
          prerelease: false
          files: release-assets/*
          body: |
            ## ${config.osName} — Declarative Portable Niri Wayland ISO (\`${config.nixSystem.channel}\`)
            - **Compositor**: Niri Scrollable Wayland (auto-started, JetBrains Mono, ${config.appearance.cornerRadiusPx}px rounded corners, minimal wallpaper, zero GUI window buttons)
            - **Idle RAM**: ~${idleRam.totalIdleMb} MB idle (< ${config.nixSystem.ramIdleLimitMb} MB budget with ZRAM, earlyoom, and on-demand RAM-only local project packages)
            - **Persistence**: Auto-scales ${persistNote} into \`${config.storage.persistLabel}\`
            - **Hardware & Apps**: USB automount (\`udiskie\`), HDMI/DP (\`wlr-randr\` + \`kanshi\`), Wi-Fi (\`iwd\`), Bluetooth (\`bluetui\`), LocalSend, OBS, Neovim, Minimal Firefox, optional Wine \`.exe\` support
`;

  const readme = `# ${config.osName}

A minimal, declarative portable **NixOS (${config.nixSystem.channel} + latest Nix)** Live ISO built strictly around **Niri Scrollable Wayland**, **JetBrains Mono**, **minimal wallpaper**, **keyboard-only window controls**, and **< ${config.nixSystem.ramIdleLimitMb} MB idle RAM** for any 32 GB+ USB drive.

## Minimal Repository Structure

\`\`\`
.github/workflows/build-nixos.yml   # Automated GitHub Actions NixOS ISO release build
nixos/flake.nix                     # Latest NixOS Flake (${config.nixSystem.channel}) exporting .#iso
nixos/configuration.nix             # Complete declarative Niri OS, TUIs, scripts & persistence
docs/RUFUS_FLASHING_GUIDE.md        # Windows Rufus DD-mode flashing & boot instructions
\`\`\`

## Core Architecture

- **Niri Wayland Only**: Boots straight into Niri with Waybar already visible on start (modifiable auto-hide), minimal wallpaper (\`swaybg\`), \`${config.appearance.cornerRadiusPx}px\` rounded corners, \`${Math.round(config.appearance.windowOpacity * 100)}%\` window opacity, and **zero GUI minimize/expand/close buttons** (100% keyboard shortcuts).
- **JetBrains Mono + Unified Theme**: Every UI, terminal (\`foot\`), launcher (\`fuzzel\`), status bar (\`waybar\`), Neovim, TUI dialog, and TUI screensaver shares the exact same \`${palette.name}\` palette.
- **< ${config.nixSystem.ramIdleLimitMb} MB Idle RAM + RAM-Only Local Project Packages**: Estimated \`~${idleRam.totalIdleMb} MB\` idle. Global apps install via \`monolith-pkg install <pkg>\` (\`nix profile install\`). Per-project packages load into RAM only while working inside the project (\`direnv\` + \`flake.nix\`) and clear automatically on idle via \`monolith-ram-clean\`.
- **Full Hardware + Optional Windows \`.exe\`**: USB-A/C automount (\`udisks2\` + \`udiskie\`), HDMI/DP (\`wlr-randr\` + \`kanshi\`), Wi-Fi (\`iwd\`), Bluetooth (\`bluez\` + \`bluetui\`), PipeWire audio, and interactive first-boot prompt for Windows \`.exe\` support (\`wineWowPackages.stable\` + \`winetricks\`).
- **100% USB Persistence (No exFAT Needed)**: Since **LocalSend** handles cross-device file sharing over LAN, 100% of remaining USB capacity scales into \`${config.storage.persistLabel}\` (\`ext4\`) by default.
`;

  const rufusGuide = `# Rufus Flashing Guide — ${config.osName} (Any 32 GB+ USB Drive)

Flash \`monolith-nixos-*.iso\` onto any **32 GB, 64 GB, 128 GB, 256 GB, 512 GB, or 1 TB+ USB drive / external SSD** from Windows using **Rufus**.

## 1. Exact Rufus Settings

| Rufus Setting | Required Value | Why |
| :--- | :--- | :--- |
| **Device** | Any **32 GB+** USB drive / SSD | Persistence scales automatically to 100% of remaining space |
| **Boot selection** | \`monolith-nixos-*-x86_64.iso\` | Built automatically in GitHub Releases |
| **Partition scheme** | **GPT** | Universal UEFI boot on modern x86_64 PCs |
| **Target system** | **UEFI (non CSM)** | Fast native UEFI boot (Legacy BIOS also supported) |
| **Write mode** | **Write in DD Image mode** | Preserves \`MONOLITH_NIX\` labels & leaves drive tail clean for auto-scaling |

## 2. Auto-Scaling Persistence (${partitions.persistencePercent}% of Remaining Space)

> **Why exFAT is OFF by default**: Because **LocalSend** is pre-installed for wireless LAN file transfers to Windows, macOS, Android, and iOS, you don't need to sacrifice USB storage to a separate exFAT partition. All remaining drive space goes straight to \`${config.storage.persistLabel}\` (ext4).

| Drive Size (Usable) | EFI + NixOS | Auto-Scaled \`${config.storage.persistLabel}\` (ext4) | Optional exFAT |
| :--- | :--- | :--- | :--- |
| **32 GB** (~27.25 GB) | ${(partitions.efiGb + partitions.squashfsGb).toFixed(1)} GB | **${calculatePartitions({ ...config.storage, nominalDriveGb: 32, totalUsableGb: 27.25 }).persistenceGb.toFixed(1)} GB** | ${calculatePartitions({ ...config.storage, nominalDriveGb: 32, totalUsableGb: 27.25 }).exfatTransferGb.toFixed(1)} GB |
| **64 GB** (~57.6 GB) | ${(partitions.efiGb + partitions.squashfsGb).toFixed(1)} GB | **${calculatePartitions({ ...config.storage, nominalDriveGb: 64, totalUsableGb: 57.6 }).persistenceGb.toFixed(1)} GB** | ${calculatePartitions({ ...config.storage, nominalDriveGb: 64, totalUsableGb: 57.6 }).exfatTransferGb.toFixed(1)} GB |
| **128 GB** (~115.2 GB) | ${(partitions.efiGb + partitions.squashfsGb).toFixed(1)} GB | **${calculatePartitions({ ...config.storage, nominalDriveGb: 128, totalUsableGb: 115.2 }).persistenceGb.toFixed(1)} GB** | ${calculatePartitions({ ...config.storage, nominalDriveGb: 128, totalUsableGb: 115.2 }).exfatTransferGb.toFixed(1)} GB |
| **1 TB** (~931.3 GB) | ${(partitions.efiGb + partitions.squashfsGb).toFixed(1)} GB | **${calculatePartitions({ ...config.storage, nominalDriveGb: 1024, totalUsableGb: 931.3 }).persistenceGb.toFixed(1)} GB** | ${calculatePartitions({ ...config.storage, nominalDriveGb: 1024, totalUsableGb: 931.3 }).exfatTransferGb.toFixed(1)} GB |

## 3. Booting on Any x86_64 PC

1. Disable **Secure Boot** once in UEFI/BIOS settings.
2. Open your machine's Boot Menu (\`F12\` Dell/Lenovo/Acer, \`F9\` HP, \`F8\` ASUS, \`F10\` Samsung, \`F11\` MSI).
3. Select your **UEFI USB Drive** — Niri Wayland launches automatically (default user: **\`${config.username}\`**, password: **\`monolith\`**).
`;

  return [
    {
      path: '.github/workflows/build-nixos.yml',
      group: 'GitHub Actions',
      language: 'yaml',
      description: `Automated GitHub Actions CI workflow building the ${config.nixSystem.channel} Niri NixOS Flake ISO`,
      content: nixosWorkflow,
    },
    {
      path: 'nixos/flake.nix',
      group: 'NixOS Flake',
      language: 'nix',
      description: `Latest NixOS Flake (${config.nixSystem.channel}) exporting the bootable Niri Wayland portable ISO`,
      content: flakeNix,
    },
    {
      path: 'nixos/configuration.nix',
      group: 'NixOS Flake',
      language: 'nix',
      description: 'Self-contained Niri-only declarative NixOS module (JetBrains Mono, wallpaper, auto-hide bar, RAM cleaner, USB/HDMI/Wi-Fi/BT, Wine .exe prompt, TUIs)',
      content: nixConfiguration,
    },
    {
      path: 'README.md',
      group: 'Documentation',
      language: 'markdown',
      description: 'Minimal Niri NixOS repository overview, <500 MB idle RAM architecture, and CI release flow',
      content: readme,
    },
    {
      path: 'docs/RUFUS_FLASHING_GUIDE.md',
      group: 'Documentation',
      language: 'markdown',
      description: 'Windows Rufus DD-mode flashing, 100% persistence layout (LocalSend), and UEFI boot guide',
      content: rufusGuide,
    },
  ];
}

export async function buildOsSourceZip(config: OSConfigState): Promise<Blob> {
  const zip = new JSZip();
  const files = generateOsRepositoryFiles(config);

  for (const file of files) {
    zip.file(file.path, file.content, {
      unixPermissions: file.executable ? '755' : '644',
    });
  }

  return zip.generateAsync({ type: 'blob' });
}

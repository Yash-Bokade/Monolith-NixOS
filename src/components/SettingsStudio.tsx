import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  Copy,
  Cpu,
  HardDrive,
  Keyboard,
  Package,
  Palette,
  Plus,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import {
  DEFAULT_OS_CONFIG,
  DRIVE_PRESETS,
  NIX_CHANNELS,
  THEME_PALETTES,
  TOOLCHAIN_CATALOG,
  WALLPAPER_PRESETS,
} from '../lib/osDefaults';
import {
  calculatePartitions,
  detectHotkeyConflicts,
  estimateIdleRamMb,
  formatGlobalInstallCommand,
  formatHotkeyCombo,
  isValidNixPackageName,
} from '../lib/osEngine';
import type {
  CustomShortcut,
  HotkeyActionId,
  HotkeyModifier,
  NixChannelId,
  OSConfigState,
  OSThemeId,
  ProjectEnvConfig,
  ScreensaverStyleId,
  WallpaperPresetId,
} from '../lib/types';

interface SettingsStudioProps {
  config: OSConfigState;
  onChange: (next: OSConfigState) => void;
  onResetDefaults: () => void;
}

type SettingsTabId = 'appearance' | 'packages' | 'shortcuts' | 'hardware' | 'storage';

const MODIFIER_OPTIONS: HotkeyModifier[] = ['Super', 'Super+Shift', 'Super+Ctrl', 'Super+Alt'];

const QUICK_GLOBAL_PKGS = [
  'tmux',
  'fzf',
  'bat',
  'eza',
  'lazygit',
  'htop',
  'vlc',
  'mpv',
  'zoxide',
  'tldr',
];

export const SettingsStudio: React.FC<SettingsStudioProps> = ({
  config,
  onChange,
  onResetDefaults,
}) => {
  const [activeTab, setActiveTab] = useState<SettingsTabId>('appearance');
  const [globalPkgInput, setGlobalPkgInput] = useState('');
  const [globalPkgError, setGlobalPkgError] = useState<string | null>(null);
  const [copiedPkg, setCopiedPkg] = useState<string | null>(null);

  // New local project state
  const [projName, setProjName] = useState('');
  const [projStack, setProjStack] = useState('rust');
  const [projPkgsInput, setProjPkgsInput] = useState('rustc, cargo, rust-analyzer, clippy');
  const [projError, setProjError] = useState<string | null>(null);

  // Per-project add-package input
  const [projAddInputs, setProjAddInputs] = useState<Record<string, string>>({});

  // New custom shortcut state
  const [customLabel, setCustomLabel] = useState('');
  const [customCommand, setCustomCommand] = useState('');
  const [customMod, setCustomMod] = useState<HotkeyModifier>('Super+Shift');
  const [customKey, setCustomKey] = useState('');
  const [customError, setCustomError] = useState<string | null>(null);

  const partitions = useMemo(() => calculatePartitions(config.storage), [config.storage]);
  const idleRam = useMemo(() => estimateIdleRamMb(config), [config]);
  const conflicts = useMemo(
    () => detectHotkeyConflicts(config.hotkeys, config.customShortcuts),
    [config.hotkeys, config.customShortcuts],
  );

  const tabs: { id: SettingsTabId; label: string; icon: React.ReactNode }[] = [
    { id: 'appearance', label: 'Theme, Wallpaper & UI', icon: <Palette className="h-4 w-4" /> },
    { id: 'packages', label: 'Nix & Packages', icon: <Package className="h-4 w-4" /> },
    { id: 'shortcuts', label: 'Keyboard Shortcuts', icon: <Keyboard className="h-4 w-4" /> },
    { id: 'hardware', label: 'Hardware, RAM & .exe', icon: <Cpu className="h-4 w-4" /> },
    { id: 'storage', label: 'Storage & Paths', icon: <HardDrive className="h-4 w-4" /> },
  ];

  const updateAppearance = (patch: Partial<OSConfigState['appearance']>) => {
    onChange({ ...config, appearance: { ...config.appearance, ...patch } });
  };

  const updateNixSystem = (patch: Partial<OSConfigState['nixSystem']>) => {
    onChange({ ...config, nixSystem: { ...config.nixSystem, ...patch } });
  };

  const updateStorage = (patch: Partial<OSConfigState['storage']>) => {
    onChange({ ...config, storage: { ...config.storage, ...patch } });
  };

  const updateHardware = (patch: Partial<OSConfigState['hardware']>) => {
    onChange({ ...config, hardware: { ...config.hardware, ...patch } });
  };

  const updateBrowser = (patch: Partial<OSConfigState['browser']>) => {
    onChange({ ...config, browser: { ...config.browser, ...patch } });
  };

  const updateExportPaths = (patch: Partial<OSConfigState['exportPaths']>) => {
    onChange({ ...config, exportPaths: { ...config.exportPaths, ...patch } });
  };

  const handleAddGlobalPkg = (rawPkg?: string) => {
    const pkg = (rawPkg ?? globalPkgInput).trim();
    if (!pkg) return;
    if (!isValidNixPackageName(pkg)) {
      setGlobalPkgError('Invalid nixpkgs attribute name (use letters, numbers, -, _, or .)');
      return;
    }
    if (config.nixSystem.globalPackages.includes(pkg)) {
      setGlobalPkgError(`${pkg} is already in your global Nix packages.`);
      return;
    }
    setGlobalPkgError(null);
    updateNixSystem({ globalPackages: [...config.nixSystem.globalPackages, pkg] });
    if (!rawPkg) setGlobalPkgInput('');
  };

  const handleRemoveGlobalPkg = (pkg: string) => {
    updateNixSystem({
      globalPackages: config.nixSystem.globalPackages.filter((item) => item !== pkg),
    });
  };

  const handleCopyCmd = async (pkg: string) => {
    try {
      await navigator.clipboard.writeText(formatGlobalInstallCommand(pkg));
      setCopiedPkg(pkg);
      window.setTimeout(() => setCopiedPkg(null), 1600);
    } catch {
      setCopiedPkg(null);
    }
  };

  const handleStackSelect = (stackId: string) => {
    setProjStack(stackId);
    const tc = TOOLCHAIN_CATALOG.find((t) => t.id === stackId);
    if (tc) {
      setProjPkgsInput(tc.nixPackages.join(', '));
    }
  };

  const handleAddProject = () => {
    const cleanName = projName.trim().toLowerCase().replace(/[^a-z0-9-_]/g, '-');
    if (!cleanName) {
      setProjError('Enter a project name (e.g. api-service or ml-lab).');
      return;
    }
    const parsedPkgs = projPkgsInput
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (parsedPkgs.length === 0) {
      setProjError('Specify at least one local nixpkgs package for this project.');
      return;
    }
    const invalid = parsedPkgs.find((p) => !isValidNixPackageName(p));
    if (invalid) {
      setProjError(`Invalid package name: ${invalid}`);
      return;
    }
    const tc = TOOLCHAIN_CATALOG.find((t) => t.id === projStack);
    const newProj: ProjectEnvConfig = {
      id: `proj-${Date.now()}`,
      name: cleanName,
      stack: projStack,
      version: tc?.defaultVersion ?? 'latest',
      localPackages: Array.from(new Set(parsedPkgs)),
      ramOnly: true,
    };
    setProjError(null);
    setProjName('');
    updateNixSystem({ projects: [...config.nixSystem.projects, newProj] });
  };

  const handleAddPkgToProject = (projectId: string) => {
    const raw = (projAddInputs[projectId] || '').trim();
    if (!raw || !isValidNixPackageName(raw)) return;
    updateNixSystem({
      projects: config.nixSystem.projects.map((p) =>
        p.id === projectId && !p.localPackages.includes(raw)
          ? { ...p, localPackages: [...p.localPackages, raw] }
          : p,
      ),
    });
    setProjAddInputs((prev) => ({ ...prev, [projectId]: '' }));
  };

  const handleRemovePkgFromProject = (projectId: string, pkg: string) => {
    updateNixSystem({
      projects: config.nixSystem.projects.map((p) =>
        p.id === projectId
          ? { ...p, localPackages: p.localPackages.filter((item) => item !== pkg) }
          : p,
      ),
    });
  };

  const handleRemoveProject = (projectId: string) => {
    updateNixSystem({
      projects: config.nixSystem.projects.filter((p) => p.id !== projectId),
    });
  };

  const updateHotkey = (
    action: HotkeyActionId,
    patch: Partial<{ modifier: HotkeyModifier; key: string }>,
  ) => {
    onChange({
      ...config,
      hotkeys: {
        ...config.hotkeys,
        [action]: {
          ...config.hotkeys[action],
          ...patch,
        },
      },
    });
  };

  const handleAddCustomShortcut = () => {
    const label = customLabel.trim();
    const command = customCommand.trim();
    const key = customKey.trim();
    if (!label || !command || !key) {
      setCustomError('Fill in an app label, launch command, and shortcut key.');
      return;
    }
    const nextShortcut: CustomShortcut = {
      id: `custom-${Date.now()}`,
      label,
      command,
      modifier: customMod,
      key,
    };
    setCustomError(null);
    setCustomLabel('');
    setCustomCommand('');
    setCustomKey('');
    onChange({
      ...config,
      customShortcuts: [...config.customShortcuts, nextShortcut],
    });
  };

  const updateCustomShortcut = (id: string, patch: Partial<CustomShortcut>) => {
    onChange({
      ...config,
      customShortcuts: config.customShortcuts.map((item) =>
        item.id === id ? { ...item, ...patch } : item,
      ),
    });
  };

  const removeCustomShortcut = (id: string) => {
    onChange({
      ...config,
      customShortcuts: config.customShortcuts.filter((item) => item.id !== id),
    });
  };

  const applyDrivePreset = (nominalGb: number, usableGb: number) => {
    updateStorage({ nominalDriveGb: nominalGb, totalUsableGb: usableGb });
  };

  const hotkeyCategories: ('Window Management' | 'System' | 'Applications' | 'Lifecycle')[] = [
    'Window Management',
    'System',
    'Applications',
    'Lifecycle',
  ];

  return (
    <div className="mx-auto max-w-[1440px] px-4 py-8 sm:px-6">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b border-[var(--os-border)] pb-5">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--os-accent)]">
            Dedicated OS Configuration · JetBrains Mono · Optimized Plasma 6 Wayland
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-[var(--os-fg)]">
            Settings Studio
          </h1>
          <p className="mt-1 text-xs text-[var(--os-muted)]">
            Every change updates the unified Plasma 6 theme, Live Desktop Preview, NixOS Flake, and USB boot config instantly.
          </p>
        </div>

        <button
          type="button"
          onClick={onResetDefaults}
          className="os-control inline-flex items-center gap-2 border border-[var(--os-border)] bg-[var(--os-surface)] px-3.5 py-2 text-xs text-[var(--os-muted)] hover:border-[var(--os-fg)] hover:text-[var(--os-fg)]"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Reset All to Defaults
        </button>
      </div>

      <div className="grid gap-6 lg:grid-cols-[240px_1fr]">
        {/* Settings Sidebar */}
        <aside className="space-y-1.5">
          {tabs.map((tab) => {
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`os-control flex w-full items-center gap-2.5 border px-3.5 py-2.5 text-left text-xs font-medium transition-colors ${
                  active
                    ? 'border-[var(--os-accent)] bg-[var(--os-surface-elevated)] text-[var(--os-fg)]'
                    : 'border-transparent text-[var(--os-muted)] hover:border-[var(--os-border)] hover:bg-[var(--os-surface)] hover:text-[var(--os-fg)]'
                }`}
              >
                <span className={active ? 'text-[var(--os-accent)]' : 'text-[var(--os-muted)]'}>
                  {tab.icon}
                </span>
                <span>{tab.label}</span>
              </button>
            );
          })}

          <div className="os-card mt-5 border border-[var(--os-border)] bg-[var(--os-surface)] p-4 text-[11px] text-[var(--os-muted)]">
            <div className="font-semibold uppercase tracking-wider text-[var(--os-fg)]">
              Live Build Telemetry
            </div>
            <div className="mt-2.5 space-y-1.5 tabular-nums">
              <div className="flex justify-between">
                <span>Desktop</span>
                <span className="text-[var(--os-fg)]">Plasma 6 Wayland</span>
              </div>
              <div className="flex justify-between">
                <span>Nix Channel</span>
                <span className="text-[var(--os-accent)]">{config.nixSystem.channel}</span>
              </div>
              <div className="flex justify-between">
                <span>Idle RAM</span>
                <span className={idleRam.withinBudget ? 'text-[var(--os-accent)]' : 'text-red-400'}>
                  {idleRam.totalIdleMb} / {config.nixSystem.ramIdleLimitMb} MB
                </span>
              </div>
              <div className="flex justify-between">
                <span>Corner Radius</span>
                <span className="text-[var(--os-fg)]">{config.appearance.cornerRadiusPx} px</span>
              </div>
              <div className="flex justify-between">
                <span>Window Opacity</span>
                <span className="text-[var(--os-fg)]">
                  {Math.round(config.appearance.windowOpacity * 100)}%
                </span>
              </div>
              <div className="flex justify-between">
                <span>Persistence</span>
                <span className="text-[var(--os-fg)]">{partitions.persistenceGb} GB</span>
              </div>
            </div>
          </div>
        </aside>

        {/* Settings Main Content */}
        <div className="space-y-6">
          {/* TAB 1: APPEARANCE */}
          {activeTab === 'appearance' && (
            <>
              {/* Unified Theme Selector */}
              <section className="os-card border border-[var(--os-border)] bg-[var(--os-surface)] p-5">
                <div className="mb-4">
                  <h2 className="text-sm font-semibold text-[var(--os-fg)]">
                    Unified Plasma 6 &amp; TUI Theme
                  </h2>
                  <p className="mt-0.5 text-xs text-[var(--os-muted)]">
                    Applies identically across KDE Plasma 6 Breeze Dark, rounded menus, System Settings, Konsole, Neovim, GTK, and TUI dialogs.
                  </p>
                </div>

                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {(Object.keys(THEME_PALETTES) as OSThemeId[]).map((themeId) => {
                    const p = THEME_PALETTES[themeId];
                    const selected = config.appearance.theme === themeId;
                    return (
                      <button
                        key={themeId}
                        type="button"
                        onClick={() => updateAppearance({ theme: themeId })}
                        className={`os-control flex flex-col justify-between border p-3.5 text-left transition-colors ${
                          selected
                            ? 'border-[var(--os-accent)] bg-[var(--os-surface-elevated)]'
                            : 'border-[var(--os-border)] bg-[var(--os-bg)] hover:border-[var(--os-muted)]'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-semibold text-[var(--os-fg)]">
                            {p.name}
                          </span>
                          <div className="flex items-center gap-1.5">
                            <span
                              className="h-3.5 w-3.5 rounded-full border border-white/15"
                              style={{ backgroundColor: p.bg }}
                            />
                            <span
                              className="h-3.5 w-3.5 rounded-full border border-white/15"
                              style={{ backgroundColor: p.surfaceElevated }}
                            />
                            <span
                              className="h-3.5 w-3.5 rounded-full border border-white/15"
                              style={{ backgroundColor: p.accent }}
                            />
                          </div>
                        </div>
                        <p className="mt-2 text-[11px] leading-relaxed text-[var(--os-muted)]">
                          {p.subtitle}
                        </p>
                      </button>
                    );
                  })}
                </div>
              </section>

              {/* Minimal Wallpaper Selector */}
              <section className="os-card border border-[var(--os-border)] bg-[var(--os-surface)] p-5">
                <div className="mb-4">
                  <h2 className="text-sm font-semibold text-[var(--os-fg)]">
                    Minimal Wallpaper (Plasma 6)
                  </h2>
                  <p className="mt-0.5 text-xs text-[var(--os-muted)]">
                    Low-distraction dark wallpapers applied automatically via <code className="text-[var(--os-fg)]">plasma-apply-wallpaperimage</code> beneath translucent rounded windows.
                  </p>
                </div>

                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {WALLPAPER_PRESETS.map((wp) => {
                    const selected = config.appearance.wallpaper === wp.id;
                    return (
                      <button
                        key={wp.id}
                        type="button"
                        onClick={() => updateAppearance({ wallpaper: wp.id })}
                        className={`os-control overflow-hidden border text-left transition-colors ${
                          selected
                            ? 'border-[var(--os-accent)] bg-[var(--os-surface-elevated)]'
                            : 'border-[var(--os-border)] bg-[var(--os-bg)] hover:border-[var(--os-muted)]'
                        }`}
                      >
                        <div className="relative h-24 w-full overflow-hidden border-b border-[var(--os-border)] bg-[var(--os-bg)]">
                          {wp.imageUrl ? (
                            <img
                              src={wp.imageUrl}
                              alt={wp.name}
                              className="h-full w-full object-cover"
                            />
                          ) : wp.id === 'contour-svg' ? (
                            <div
                              className="h-full w-full"
                              style={{
                                backgroundImage:
                                  'radial-gradient(circle at 25% 30%, color-mix(in srgb, var(--os-accent) 20%, transparent), transparent 65%), repeating-radial-gradient(circle at 70% 80%, transparent 0 12px, color-mix(in srgb, var(--os-border) 55%, transparent) 12px 13px)',
                              }}
                            />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center text-[10px] text-[var(--os-muted)]">
                              PURE MATTE CANVAS
                            </div>
                          )}
                        </div>
                        <div className="p-3">
                          <div className="text-xs font-semibold text-[var(--os-fg)]">{wp.name}</div>
                          <p className="mt-1 text-[11px] leading-snug text-[var(--os-muted)]">
                            {wp.description}
                          </p>
                        </div>
                      </button>
                    );
                  })}
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-[180px_1fr]">
                  <button
                    type="button"
                    onClick={() => updateAppearance({ wallpaper: 'custom' as WallpaperPresetId })}
                    className={`os-control border px-3 py-2 text-xs font-medium ${
                      config.appearance.wallpaper === 'custom'
                        ? 'border-[var(--os-accent)] bg-[var(--os-surface-elevated)] text-[var(--os-accent)]'
                        : 'border-[var(--os-border)] bg-[var(--os-bg)] text-[var(--os-muted)] hover:text-[var(--os-fg)]'
                    }`}
                  >
                    Use Custom Image Path
                  </button>
                  <input
                    type="text"
                    value={config.appearance.customWallpaperPath}
                    onChange={(e) =>
                      updateAppearance({
                        wallpaper: 'custom',
                        customWallpaperPath: e.target.value,
                      })
                    }
                    placeholder="/home/dev/Pictures/minimal-wall.jpg"
                    className="os-control border border-[var(--os-border)] bg-[var(--os-bg)] px-3 py-2 text-xs text-[var(--os-fg)] placeholder:text-[var(--os-muted)] focus:border-[var(--os-accent)] focus:outline-none"
                  />
                </div>
              </section>

              {/* Corner Radius, Window Transparency & Geometry */}
              <section className="os-card border border-[var(--os-border)] bg-[var(--os-surface)] p-5">
                <h2 className="text-sm font-semibold text-[var(--os-fg)]">
                  Rounded Menus &amp; Windows, Transparency &amp; JetBrains Mono
                </h2>
                <p className="mt-0.5 mb-5 text-xs text-[var(--os-muted)]">
                  Directly updates KWin <code className="text-[var(--os-fg)]">kwinrulesrc</code> window opacity, Breeze Dark rounded menus, floating Plasma panel, and live Studio radii.
                </p>

                <div className="grid gap-5 md:grid-cols-2">
                  <div>
                    <div className="mb-1.5 flex justify-between text-xs">
                      <label htmlFor="radius-slider" className="text-[var(--os-fg)]">
                        Corner Radius
                      </label>
                      <span className="tabular-nums text-[var(--os-accent)]">
                        {config.appearance.cornerRadiusPx} px
                      </span>
                    </div>
                    <input
                      id="radius-slider"
                      type="range"
                      min={0}
                      max={18}
                      step={1}
                      value={config.appearance.cornerRadiusPx}
                      onChange={(e) =>
                        updateAppearance({ cornerRadiusPx: Number(e.target.value) })
                      }
                      className="w-full accent-[var(--os-accent)]"
                    />
                  </div>

                  <div>
                    <div className="mb-1.5 flex justify-between text-xs">
                      <label htmlFor="opacity-slider" className="text-[var(--os-fg)]">
                        Window Opacity (Transparency)
                      </label>
                      <span className="tabular-nums text-[var(--os-accent)]">
                        {Math.round(config.appearance.windowOpacity * 100)}%
                      </span>
                    </div>
                    <input
                      id="opacity-slider"
                      type="range"
                      min={70}
                      max={100}
                      step={1}
                      value={Math.round(config.appearance.windowOpacity * 100)}
                      onChange={(e) =>
                        updateAppearance({ windowOpacity: Number(e.target.value) / 100 })
                      }
                      className="w-full accent-[var(--os-accent)]"
                    />
                  </div>

                  <div>
                    <div className="mb-1.5 flex justify-between text-xs">
                      <label htmlFor="font-slider" className="text-[var(--os-fg)]">
                        JetBrains Mono Base Size
                      </label>
                      <span className="tabular-nums text-[var(--os-accent)]">
                        {config.appearance.fontSizePx} px
                      </span>
                    </div>
                    <input
                      id="font-slider"
                      type="range"
                      min={11}
                      max={16}
                      step={1}
                      value={config.appearance.fontSizePx}
                      onChange={(e) => updateAppearance({ fontSizePx: Number(e.target.value) })}
                      className="w-full accent-[var(--os-accent)]"
                    />
                  </div>

                  <div>
                    <div className="mb-1.5 flex justify-between text-xs">
                      <label htmlFor="gap-slider" className="text-[var(--os-fg)]">
                        Window Tile Spacing
                      </label>
                      <span className="tabular-nums text-[var(--os-accent)]">
                        {config.appearance.windowGapPx} px
                      </span>
                    </div>
                    <input
                      id="gap-slider"
                      type="range"
                      min={0}
                      max={16}
                      step={2}
                      value={config.appearance.windowGapPx}
                      onChange={(e) => updateAppearance({ windowGapPx: Number(e.target.value) })}
                      className="w-full accent-[var(--os-accent)]"
                    />
                  </div>
                </div>
              </section>

              {/* Auto-Hiding Taskbar & TUI Screensaver */}
              <section className="grid gap-5 md:grid-cols-2">
                <div className="os-card border border-[var(--os-border)] bg-[var(--os-surface)] p-5">
                  <h2 className="text-sm font-semibold text-[var(--os-fg)]">
                    Floating Rounded Auto-Hide Plasma Panel
                  </h2>
                  <p className="mt-0.5 mb-4 text-xs text-[var(--os-muted)]">
                    Configured via <code className="text-[var(--os-fg)]">monolith-plasma-init</code> as a floating rounded panel that auto-hides cleanly when not hovered.
                  </p>

                  <div className="space-y-3 text-xs">
                    <label className="flex items-center justify-between gap-3">
                      <span className="text-[var(--os-fg)]">Auto-hide taskbar when idle</span>
                      <input
                        type="checkbox"
                        checked={config.appearance.taskbarAutoHide}
                        onChange={(e) => updateAppearance({ taskbarAutoHide: e.target.checked })}
                        className="h-4 w-4 accent-[var(--os-accent)]"
                      />
                    </label>

                    <label className="flex items-center justify-between gap-3">
                      <span className="text-[var(--os-fg)]">Show taskbar on Wayland start</span>
                      <input
                        type="checkbox"
                        checked={config.appearance.taskbarShowOnStart}
                        onChange={(e) =>
                          updateAppearance({ taskbarShowOnStart: e.target.checked })
                        }
                        className="h-4 w-4 accent-[var(--os-accent)]"
                      />
                    </label>

                    <div className="flex items-center justify-between gap-3 pt-1">
                      <span className="text-[var(--os-muted)]">Bar Position</span>
                      <div className="flex gap-2">
                        {(['top', 'bottom'] as const).map((pos) => (
                          <button
                            key={pos}
                            type="button"
                            onClick={() => updateAppearance({ barPosition: pos })}
                            className={`os-control border px-3 py-1 text-xs capitalize ${
                              config.appearance.barPosition === pos
                                ? 'border-[var(--os-accent)] bg-[var(--os-surface-elevated)] text-[var(--os-accent)]'
                                : 'border-[var(--os-border)] text-[var(--os-muted)]'
                            }`}
                          >
                            {pos}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <div className="mb-1 flex justify-between">
                        <span className="text-[var(--os-muted)]">Taskbar Height</span>
                        <span className="tabular-nums text-[var(--os-fg)]">
                          {config.appearance.taskbarHeightPx} px
                        </span>
                      </div>
                      <input
                        type="range"
                        min={28}
                        max={56}
                        step={2}
                        value={config.appearance.taskbarHeightPx}
                        onChange={(e) =>
                          updateAppearance({ taskbarHeightPx: Number(e.target.value) })
                        }
                        className="w-full accent-[var(--os-accent)]"
                      />
                    </div>

                    <div>
                      <div className="mb-1 flex justify-between">
                        <span className="text-[var(--os-muted)]">Auto-Hide Delay</span>
                        <span className="tabular-nums text-[var(--os-fg)]">
                          {(config.appearance.taskbarHideDelayMs / 1000).toFixed(1)} s
                        </span>
                      </div>
                      <input
                        type="range"
                        min={800}
                        max={5000}
                        step={200}
                        value={config.appearance.taskbarHideDelayMs}
                        onChange={(e) =>
                          updateAppearance({ taskbarHideDelayMs: Number(e.target.value) })
                        }
                        className="w-full accent-[var(--os-accent)]"
                      />
                    </div>
                  </div>
                </div>

                <div className="os-card border border-[var(--os-border)] bg-[var(--os-surface)] p-5">
                  <h2 className="text-sm font-semibold text-[var(--os-fg)]">
                    Screen Locker &amp; Theme-Synced Screensaver
                  </h2>
                  <p className="mt-0.5 mb-4 text-xs text-[var(--os-muted)]">
                    Configured in <code className="text-[var(--os-fg)]">kscreenlockerrc</code> and invokes <code className="text-[var(--os-fg)]">monolith-ram-clean</code> to free idle project RAM.
                  </p>

                  <div className="space-y-3 text-xs">
                    <label className="flex items-center justify-between gap-3">
                      <span className="text-[var(--os-fg)]">Enable idle TUI screensaver</span>
                      <input
                        type="checkbox"
                        checked={config.appearance.screensaverEnabled}
                        onChange={(e) =>
                          updateAppearance({ screensaverEnabled: e.target.checked })
                        }
                        className="h-4 w-4 accent-[var(--os-accent)]"
                      />
                    </label>

                    <div>
                      <div className="mb-1 flex justify-between">
                        <span className="text-[var(--os-muted)]">Idle Timeout</span>
                        <span className="tabular-nums text-[var(--os-fg)]">
                          {config.appearance.screensaverTimeoutMin} min
                        </span>
                      </div>
                      <input
                        type="range"
                        min={1}
                        max={30}
                        step={1}
                        value={config.appearance.screensaverTimeoutMin}
                        onChange={(e) =>
                          updateAppearance({ screensaverTimeoutMin: Number(e.target.value) })
                        }
                        className="w-full accent-[var(--os-accent)]"
                      />
                    </div>

                    <div className="pt-1">
                      <div className="mb-2 text-[var(--os-muted)]">Screensaver Style</div>
                      <div className="grid grid-cols-3 gap-2">
                        {(
                          [
                            { id: 'clock', label: 'TUI Clock' },
                            { id: 'matrix', label: 'Nix Matrix' },
                            { id: 'monolith-wave', label: 'Horizon Wave' },
                          ] as { id: ScreensaverStyleId; label: string }[]
                        ).map((s) => (
                          <button
                            key={s.id}
                            type="button"
                            onClick={() => updateAppearance({ screensaverStyle: s.id })}
                            className={`os-control border px-2.5 py-2 text-center text-[11px] font-medium ${
                              config.appearance.screensaverStyle === s.id
                                ? 'border-[var(--os-accent)] bg-[var(--os-surface-elevated)] text-[var(--os-accent)]'
                                : 'border-[var(--os-border)] text-[var(--os-muted)]'
                            }`}
                          >
                            {s.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </section>
            </>
          )}

          {/* TAB 2: NIX VERSION & PACKAGES */}
          {activeTab === 'packages' && (
            <>
              {/* Nix Channel & Latest Nix Version */}
              <section className="os-card border border-[var(--os-border)] bg-[var(--os-surface)] p-5">
                <h2 className="text-sm font-semibold text-[var(--os-fg)]">
                  NixOS Channel & Nix Package Manager Version
                </h2>
                <p className="mt-0.5 mb-4 text-xs text-[var(--os-muted)]">
                  Defaults to latest <code className="text-[var(--os-fg)]">nixos-unstable</code> and{' '}
                  <code className="text-[var(--os-fg)]">pkgs.nixVersions.latest</code>.
                </p>

                <div className="grid gap-3 md:grid-cols-3">
                  {NIX_CHANNELS.map((ch) => {
                    const selected = config.nixSystem.channel === ch.id;
                    return (
                      <button
                        key={ch.id}
                        type="button"
                        onClick={() => updateNixSystem({ channel: ch.id as NixChannelId })}
                        className={`os-control border p-3.5 text-left transition-colors ${
                          selected
                            ? 'border-[var(--os-accent)] bg-[var(--os-surface-elevated)]'
                            : 'border-[var(--os-border)] bg-[var(--os-bg)] hover:border-[var(--os-muted)]'
                        }`}
                      >
                        <div className="text-xs font-semibold text-[var(--os-fg)]">{ch.label}</div>
                        <p className="mt-1.5 text-[11px] leading-relaxed text-[var(--os-muted)]">
                          {ch.detail}
                        </p>
                      </button>
                    );
                  })}
                </div>

                <label className="mt-4 flex items-center justify-between gap-3 border-t border-[var(--os-border)] pt-4 text-xs">
                  <div>
                    <div className="font-medium text-[var(--os-fg)]">
                      Pin latest Nix binary (<code className="text-[var(--os-accent)]">nix.package = pkgs.nixVersions.latest</code>)
                    </div>
                    <div className="text-[11px] text-[var(--os-muted)]">
                      Enables the newest Nix CLI, Flakes evaluator, and <code className="text-[var(--os-fg)]">nix profile install</code> support.
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={config.nixSystem.useLatestNixPackage}
                    onChange={(e) => updateNixSystem({ useLatestNixPackage: e.target.checked })}
                    className="h-4 w-4 accent-[var(--os-accent)]"
                  />
                </label>
              </section>

              {/* Global Packages (Nix Command) */}
              <section className="os-card border border-[var(--os-border)] bg-[var(--os-surface)] p-5">
                <div className="mb-3">
                  <h2 className="text-sm font-semibold text-[var(--os-fg)]">
                    Global Packages (Nix Command)
                  </h2>
                  <p className="mt-0.5 text-xs text-[var(--os-muted)]">
                    Always available system-wide. On the running OS you can install any extra global app at any time with{' '}
                    <code className="text-[var(--os-accent)]">monolith-pkg install &lt;name&gt;</code>{' '}
                    or{' '}
                    <code className="text-[var(--os-fg)]">nix profile install nixpkgs#&lt;name&gt;</code>.
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  <input
                    type="text"
                    value={globalPkgInput}
                    onChange={(e) => setGlobalPkgInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleAddGlobalPkg();
                    }}
                    placeholder="nixpkgs attribute (e.g. lazygit, vlc, tmux)"
                    className="os-control min-w-[240px] flex-1 border border-[var(--os-border)] bg-[var(--os-bg)] px-3 py-2 text-xs text-[var(--os-fg)] placeholder:text-[var(--os-muted)] focus:border-[var(--os-accent)] focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => handleAddGlobalPkg()}
                    className="os-control inline-flex items-center gap-1.5 bg-[var(--os-accent)] px-4 py-2 text-xs font-semibold text-[var(--os-accent-fg)]"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Add Global Pkg
                  </button>
                </div>
                {globalPkgError && (
                  <p className="mt-2 text-xs text-red-400">{globalPkgError}</p>
                )}

                <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-[var(--os-muted)]">
                  <span>Quick add:</span>
                  {QUICK_GLOBAL_PKGS.filter(
                    (p) => !config.nixSystem.globalPackages.includes(p),
                  ).map((pkg) => (
                    <button
                      key={pkg}
                      type="button"
                      onClick={() => handleAddGlobalPkg(pkg)}
                      className="os-control border border-[var(--os-border)] bg-[var(--os-bg)] px-2 py-1 text-[11px] text-[var(--os-fg)] hover:border-[var(--os-accent)]"
                    >
                      + {pkg}
                    </button>
                  ))}
                </div>

                <div className="mt-4 divide-y divide-[var(--os-border)] border border-[var(--os-border)] bg-[var(--os-bg)]">
                  {config.nixSystem.globalPackages.map((pkg) => (
                    <div
                      key={pkg}
                      className="flex flex-wrap items-center justify-between gap-3 px-3.5 py-2.5 text-xs"
                    >
                      <div className="flex flex-wrap items-center gap-3">
                        <span className="font-semibold text-[var(--os-fg)]">{pkg}</span>
                        <code className="text-[11px] text-[var(--os-muted)]">
                          {formatGlobalInstallCommand(pkg)}
                        </code>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleCopyCmd(pkg)}
                          className="os-control inline-flex items-center gap-1 border border-[var(--os-border)] px-2 py-1 text-[11px] text-[var(--os-muted)] hover:text-[var(--os-fg)]"
                        >
                          {copiedPkg === pkg ? (
                            <>
                              <Check className="h-3 w-3 text-[var(--os-accent)]" />
                              Copied
                            </>
                          ) : (
                            <>
                              <Copy className="h-3 w-3" />
                              Copy Nix Cmd
                            </>
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRemoveGlobalPkg(pkg)}
                          aria-label={`Remove ${pkg}`}
                          className="os-control border border-[var(--os-border)] p-1 text-[var(--os-muted)] hover:border-red-500/60 hover:text-red-400"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              {/* Local Project-Based Packages (On-Demand RAM Only) */}
              <section className="os-card border border-[var(--os-border)] bg-[var(--os-surface)] p-5">
                <div className="mb-4">
                  <h2 className="text-sm font-semibold text-[var(--os-fg)]">
                    Local Project Packages (On-Demand RAM Only)
                  </h2>
                  <p className="mt-0.5 text-xs text-[var(--os-muted)]">
                    Each project defines its own isolated Nix flake packages. They load into{' '}
                    <code className="text-[var(--os-fg)]">tmpfs</code> RAM only when you open that project and are automatically evicted when idle so RAM stays below {config.nixSystem.ramIdleLimitMb} MB.
                  </p>
                </div>

                {/* Add Project Form */}
                <div className="os-control mb-5 border border-[var(--os-border)] bg-[var(--os-bg)] p-4">
                  <div className="mb-3 text-xs font-semibold text-[var(--os-fg)]">
                    Create New Project Environment
                  </div>
                  <div className="grid gap-3 md:grid-cols-3">
                    <div>
                      <label className="mb-1 block text-[11px] text-[var(--os-muted)]">
                        Project Name
                      </label>
                      <input
                        type="text"
                        value={projName}
                        onChange={(e) => setProjName(e.target.value)}
                        placeholder="e.g. billing-service"
                        className="os-control w-full border border-[var(--os-border)] bg-[var(--os-surface)] px-3 py-2 text-xs text-[var(--os-fg)] focus:border-[var(--os-accent)] focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="mb-1 block text-[11px] text-[var(--os-muted)]">
                        Base Stack Preset
                      </label>
                      <select
                        value={projStack}
                        onChange={(e) => handleStackSelect(e.target.value)}
                        className="os-control w-full border border-[var(--os-border)] bg-[var(--os-surface)] px-3 py-2 text-xs text-[var(--os-fg)] focus:border-[var(--os-accent)] focus:outline-none"
                      >
                        {TOOLCHAIN_CATALOG.map((tc) => (
                          <option key={tc.id} value={tc.id}>
                            {tc.name}
                          </option>
                        ))}
                        <option value="custom">Custom Local Packages</option>
                      </select>
                    </div>

                    <div>
                      <label className="mb-1 block text-[11px] text-[var(--os-muted)]">
                        Local Nix Packages (comma-separated)
                      </label>
                      <input
                        type="text"
                        value={projPkgsInput}
                        onChange={(e) => setProjPkgsInput(e.target.value)}
                        placeholder="python312, uv, ruff"
                        className="os-control w-full border border-[var(--os-border)] bg-[var(--os-surface)] px-3 py-2 text-xs text-[var(--os-fg)] focus:border-[var(--os-accent)] focus:outline-none"
                      />
                    </div>
                  </div>
                  {projError && <p className="mt-2 text-xs text-red-400">{projError}</p>}
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <span className="text-[11px] text-[var(--os-muted)]">
                      CLI equivalent: <code className="text-[var(--os-fg)]">monolith-new-project</code>
                    </span>
                    <button
                      type="button"
                      onClick={handleAddProject}
                      className="os-control inline-flex items-center gap-1.5 bg-[var(--os-accent)] px-3.5 py-2 text-xs font-semibold text-[var(--os-accent-fg)]"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Add Project
                    </button>
                  </div>
                </div>

                {/* Existing Projects List */}
                <div className="space-y-3">
                  {config.nixSystem.projects.map((proj) => (
                    <div
                      key={proj.id}
                      className="os-control border border-[var(--os-border)] bg-[var(--os-bg)] p-4"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <span className="text-xs font-semibold text-[var(--os-fg)]">
                            ~/workspace/{proj.name}
                          </span>
                          <span className="ml-3 text-[11px] text-[var(--os-muted)]">
                            {proj.stack} · {proj.version} · RAM-only tmpfs (cleared on idle)
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleRemoveProject(proj.id)}
                          className="os-control inline-flex items-center gap-1 border border-[var(--os-border)] px-2.5 py-1 text-[11px] text-[var(--os-muted)] hover:border-red-500/60 hover:text-red-400"
                        >
                          <Trash2 className="h-3 w-3" />
                          Remove
                        </button>
                      </div>

                      <div className="mt-3 flex flex-wrap gap-2">
                        {proj.localPackages.map((pkg) => (
                          <div
                            key={pkg}
                            className="os-control inline-flex items-center gap-1.5 border border-[var(--os-border)] bg-[var(--os-surface)] px-2.5 py-1 text-[11px] text-[var(--os-fg)]"
                          >
                            <span>{pkg}</span>
                            <button
                              type="button"
                              onClick={() => handleRemovePkgFromProject(proj.id, pkg)}
                              aria-label={`Remove ${pkg} from ${proj.name}`}
                              className="text-[var(--os-muted)] hover:text-red-400"
                            >
                              ×
                            </button>
                          </div>
                        ))}
                      </div>

                      <div className="mt-3 flex gap-2">
                        <input
                          type="text"
                          value={projAddInputs[proj.id] || ''}
                          onChange={(e) =>
                            setProjAddInputs((prev) => ({ ...prev, [proj.id]: e.target.value }))
                          }
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleAddPkgToProject(proj.id);
                          }}
                          placeholder="Add local nixpkgs package (e.g. postgresql, redis)"
                          className="os-control flex-1 border border-[var(--os-border)] bg-[var(--os-surface)] px-2.5 py-1.5 text-[11px] text-[var(--os-fg)] focus:border-[var(--os-accent)] focus:outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => handleAddPkgToProject(proj.id)}
                          className="os-control border border-[var(--os-border)] px-3 py-1.5 text-[11px] text-[var(--os-fg)] hover:border-[var(--os-accent)]"
                        >
                          Add Local Pkg
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            </>
          )}

          {/* TAB 3: KEYBOARD SHORTCUTS & CUSTOM APPS */}
          {activeTab === 'shortcuts' && (
            <>
              <section className="os-card border border-[var(--os-border)] bg-[var(--os-surface)] p-5">
                <div className="mb-4">
                  <h2 className="text-sm font-semibold text-[var(--os-fg)]">
                    Unified Global Shortcuts (Plasma 6 kglobalshortcutsrc)
                  </h2>
                  <p className="mt-1 text-xs text-[var(--os-muted)]">
                    One single shortcut system — no duplicate or broken menus. Window buttons stay hidden via KWin (<code className="text-[var(--os-fg)]">ButtonsOnLeft=</code> / <code className="text-[var(--os-fg)]">ButtonsOnRight=</code>). Edit here or visually inside native <strong className="text-[var(--os-fg)]">System Settings → Keyboard → Shortcuts</strong>.
                  </p>
                </div>

                {conflicts.length > 0 && (
                  <div className="os-control mb-4 flex items-start gap-2.5 border border-amber-500/50 bg-amber-500/10 p-3 text-xs text-amber-200">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                    <div>
                      <div className="font-semibold">Shortcut Conflict Detected</div>
                      {conflicts.map((c) => (
                        <div key={c.combo} className="mt-0.5 text-[11px]">
                          <strong>{c.combo}</strong> is assigned to: {c.actions.join(', ')}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="space-y-5">
                  {hotkeyCategories.map((cat) => {
                    const bindings = Object.values(config.hotkeys).filter(
                      (b) => b.category === cat,
                    );
                    if (bindings.length === 0) return null;
                    return (
                      <div key={cat}>
                        <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--os-accent)]">
                          {cat}
                        </div>
                        <div className="divide-y divide-[var(--os-border)] border border-[var(--os-border)] bg-[var(--os-bg)]">
                          {bindings.map((binding) => (
                            <div
                              key={binding.action}
                              className="flex flex-wrap items-center justify-between gap-3 px-3.5 py-2.5"
                            >
                              <div className="min-w-[220px] flex-1">
                                <div className="text-xs font-medium text-[var(--os-fg)]">
                                  {binding.label}
                                </div>
                                <div className="text-[11px] text-[var(--os-muted)]">
                                  {binding.description}
                                </div>
                              </div>
                              <div className="flex items-center gap-2">
                                <select
                                  aria-label={`${binding.label} modifier`}
                                  value={binding.modifier}
                                  onChange={(e) =>
                                    updateHotkey(binding.action, {
                                      modifier: e.target.value as HotkeyModifier,
                                    })
                                  }
                                  className="os-control border border-[var(--os-border)] bg-[var(--os-surface)] px-2.5 py-1.5 text-xs text-[var(--os-fg)] focus:border-[var(--os-accent)] focus:outline-none"
                                >
                                  {MODIFIER_OPTIONS.map((mod) => (
                                    <option key={mod} value={mod}>
                                      {mod}
                                    </option>
                                  ))}
                                </select>
                                <span className="text-xs text-[var(--os-muted)]">+</span>
                                <input
                                  aria-label={`${binding.label} key`}
                                  type="text"
                                  value={binding.key}
                                  onChange={(e) =>
                                    updateHotkey(binding.action, { key: e.target.value })
                                  }
                                  className="os-control w-24 border border-[var(--os-border)] bg-[var(--os-surface)] px-2.5 py-1.5 text-center text-xs text-[var(--os-fg)] focus:border-[var(--os-accent)] focus:outline-none"
                                />
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>

              {/* Custom App Launch Shortcuts */}
              <section className="os-card border border-[var(--os-border)] bg-[var(--os-surface)] p-5">
                <h2 className="text-sm font-semibold text-[var(--os-fg)]">
                  Custom App Shortcuts
                </h2>
                <p className="mt-0.5 mb-4 text-xs text-[var(--os-muted)]">
                  Generates standard <code className="text-[var(--os-fg)]">.desktop</code> launchers + <code className="text-[var(--os-fg)]">kglobalshortcutsrc</code> bindings so every custom app shortcut works reliably in Plasma 6.
                </p>

                <div className="os-control mb-4 grid gap-3 border border-[var(--os-border)] bg-[var(--os-bg)] p-4 md:grid-cols-12">
                  <div className="md:col-span-3">
                    <label className="mb-1 block text-[11px] text-[var(--os-muted)]">
                      App Label
                    </label>
                    <input
                      type="text"
                      value={customLabel}
                      onChange={(e) => setCustomLabel(e.target.value)}
                      placeholder="e.g. Lazygit TUI"
                      className="os-control w-full border border-[var(--os-border)] bg-[var(--os-surface)] px-2.5 py-1.5 text-xs text-[var(--os-fg)] focus:border-[var(--os-accent)] focus:outline-none"
                    />
                  </div>
                  <div className="md:col-span-4">
                    <label className="mb-1 block text-[11px] text-[var(--os-muted)]">
                      Launch Command
                    </label>
                    <input
                      type="text"
                      value={customCommand}
                      onChange={(e) => setCustomCommand(e.target.value)}
                      placeholder="konsole -e lazygit"
                      className="os-control w-full border border-[var(--os-border)] bg-[var(--os-surface)] px-2.5 py-1.5 text-xs text-[var(--os-fg)] focus:border-[var(--os-accent)] focus:outline-none"
                    />
                  </div>
                  <div className="md:col-span-2">
                    <label className="mb-1 block text-[11px] text-[var(--os-muted)]">
                      Modifier
                    </label>
                    <select
                      value={customMod}
                      onChange={(e) => setCustomMod(e.target.value as HotkeyModifier)}
                      className="os-control w-full border border-[var(--os-border)] bg-[var(--os-surface)] px-2 py-1.5 text-xs text-[var(--os-fg)] focus:border-[var(--os-accent)] focus:outline-none"
                    >
                      {MODIFIER_OPTIONS.map((mod) => (
                        <option key={mod} value={mod}>
                          {mod}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="md:col-span-1">
                    <label className="mb-1 block text-[11px] text-[var(--os-muted)]">Key</label>
                    <input
                      type="text"
                      value={customKey}
                      onChange={(e) => setCustomKey(e.target.value)}
                      placeholder="G"
                      className="os-control w-full border border-[var(--os-border)] bg-[var(--os-surface)] px-2 py-1.5 text-center text-xs text-[var(--os-fg)] focus:border-[var(--os-accent)] focus:outline-none"
                    />
                  </div>
                  <div className="flex items-end md:col-span-2">
                    <button
                      type="button"
                      onClick={handleAddCustomShortcut}
                      className="os-control inline-flex w-full items-center justify-center gap-1.5 bg-[var(--os-accent)] px-3 py-1.5 text-xs font-semibold text-[var(--os-accent-fg)]"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Add App
                    </button>
                  </div>
                  {customError && (
                    <div className="text-xs text-red-400 md:col-span-12">{customError}</div>
                  )}
                </div>

                <div className="divide-y divide-[var(--os-border)] border border-[var(--os-border)] bg-[var(--os-bg)]">
                  {config.customShortcuts.map((cs) => (
                    <div
                      key={cs.id}
                      className="flex flex-wrap items-center justify-between gap-3 px-3.5 py-2.5 text-xs"
                    >
                      <div className="min-w-[200px] flex-1">
                        <div className="font-medium text-[var(--os-fg)]">{cs.label}</div>
                        <code className="text-[11px] text-[var(--os-muted)]">{cs.command}</code>
                      </div>
                      <div className="flex items-center gap-2">
                        <select
                          aria-label={`${cs.label} modifier`}
                          value={cs.modifier}
                          onChange={(e) =>
                            updateCustomShortcut(cs.id, {
                              modifier: e.target.value as HotkeyModifier,
                            })
                          }
                          className="os-control border border-[var(--os-border)] bg-[var(--os-surface)] px-2 py-1 text-xs text-[var(--os-fg)]"
                        >
                          {MODIFIER_OPTIONS.map((mod) => (
                            <option key={mod} value={mod}>
                              {mod}
                            </option>
                          ))}
                        </select>
                        <span className="text-[var(--os-muted)]">+</span>
                        <input
                          aria-label={`${cs.label} key`}
                          type="text"
                          value={cs.key}
                          onChange={(e) => updateCustomShortcut(cs.id, { key: e.target.value })}
                          className="os-control w-20 border border-[var(--os-border)] bg-[var(--os-surface)] px-2 py-1 text-center text-xs text-[var(--os-fg)]"
                        />
                        <span className="hidden text-[11px] text-[var(--os-muted)] sm:inline">
                          ({formatHotkeyCombo(cs)})
                        </span>
                        <button
                          type="button"
                          onClick={() => removeCustomShortcut(cs.id)}
                          aria-label={`Remove ${cs.label}`}
                          className="os-control border border-[var(--os-border)] p-1 text-[var(--os-muted)] hover:border-red-500/60 hover:text-red-400"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            </>
          )}

          {/* TAB 4: HARDWARE, IDLE RAM & WINDOWS .EXE */}
          {activeTab === 'hardware' && (
            <>
              {/* Idle RAM Budget (< 500 MB) */}
              <section className="os-card border border-[var(--os-border)] bg-[var(--os-surface)] p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-semibold text-[var(--os-fg)]">
                      Idle RAM Guard (Target &lt; {config.nixSystem.ramIdleLimitMb} MB)
                    </h2>
                    <p className="mt-0.5 text-xs text-[var(--os-muted)]">
                      Baloo file indexing disabled, KDE bloat excluded, zramSwap + earlyoom + <code className="text-[var(--os-fg)]">monolith-ram-clean</code> keep Plasma 6 crisp and under budget on USB.
                    </p>
                  </div>
                  <div
                    className={`text-right text-lg font-semibold tabular-nums ${
                      idleRam.withinBudget ? 'text-[var(--os-accent)]' : 'text-red-400'
                    }`}
                  >
                    {idleRam.totalIdleMb} MB idle
                    <div className="text-[11px] font-normal text-[var(--os-muted)]">
                      {idleRam.withinBudget ? 'Under 500 MB budget' : 'Exceeds target'}
                    </div>
                  </div>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-4">
                  {[
                    { label: 'Kernel + systemd', value: `${idleRam.kernelAndSystemdMb} MB` },
                    { label: 'KWin Wayland', value: `${idleRam.kwinWaylandMb} MB` },
                    { label: 'Plasma Shell (Trimmed)', value: `${idleRam.plasmaShellMb} MB` },
                    { label: 'USB/HDMI/Wi-Fi/BT', value: `${idleRam.hardwareServicesMb} MB` },
                  ].map((item) => (
                    <div
                      key={item.label}
                      className="os-control border border-[var(--os-border)] bg-[var(--os-bg)] p-3"
                    >
                      <div className="text-[11px] text-[var(--os-muted)]">{item.label}</div>
                      <div className="mt-1 text-sm font-semibold tabular-nums text-[var(--os-fg)]">
                        {item.value}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="mt-4 grid gap-4 border-t border-[var(--os-border)] pt-4 md:grid-cols-2">
                  <label className="flex items-center justify-between gap-3 text-xs">
                    <div>
                      <div className="font-medium text-[var(--os-fg)]">
                        Auto-clear idle RAM & project tmpfs caches
                      </div>
                      <div className="text-[11px] text-[var(--os-muted)]">
                        Runs every 5 minutes and immediately on screensaver activation.
                      </div>
                    </div>
                    <input
                      type="checkbox"
                      checked={config.nixSystem.autoClearIdleRam}
                      onChange={(e) => updateNixSystem({ autoClearIdleRam: e.target.checked })}
                      className="h-4 w-4 accent-[var(--os-accent)]"
                    />
                  </label>

                  <div>
                    <div className="mb-1 flex justify-between text-xs">
                      <span className="text-[var(--os-muted)]">Idle RAM Ceiling</span>
                      <span className="tabular-nums text-[var(--os-fg)]">
                        {config.nixSystem.ramIdleLimitMb} MB
                      </span>
                    </div>
                    <input
                      type="range"
                      min={400}
                      max={640}
                      step={10}
                      value={config.nixSystem.ramIdleLimitMb}
                      onChange={(e) =>
                        updateNixSystem({ ramIdleLimitMb: Number(e.target.value) })
                      }
                      className="w-full accent-[var(--os-accent)]"
                    />
                  </div>
                </div>
              </section>

              {/* Windows .exe Support */}
              <section className="os-card border border-[var(--os-border)] bg-[var(--os-surface)] p-5">
                <label className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="text-sm font-semibold text-[var(--os-fg)]">
                      Windows (.exe) Application Runner (Wine + Winetricks)
                    </h2>
                    <p className="mt-1 text-xs leading-relaxed text-[var(--os-muted)]">
                      Includes <code className="text-[var(--os-fg)]">wineWowPackages.stable</code>,{' '}
                      <code className="text-[var(--os-fg)]">winetricks</code>, and the{' '}
                      <code className="text-[var(--os-accent)]">monolith-exe &lt;file.exe&gt;</code>{' '}
                      launcher. Users are also explicitly asked whether they want Windows .exe support during the First-Boot installer.
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={config.nixSystem.windowsExeSupport}
                    onChange={(e) => updateNixSystem({ windowsExeSupport: e.target.checked })}
                    className="mt-1 h-4 w-4 accent-[var(--os-accent)]"
                  />
                </label>
              </section>

              {/* Ports, Radios & GPU Drivers */}
              <section className="os-card border border-[var(--os-border)] bg-[var(--os-surface)] p-5">
                <h2 className="text-sm font-semibold text-[var(--os-fg)]">
                  USB, HDMI, Wi-Fi, Bluetooth & Host Hardware Support
                </h2>
                <p className="mt-0.5 mb-4 text-xs text-[var(--os-muted)]">
                  Preloaded kernel modules & lightweight daemons so any laptop/desktop boots with full I/O.
                </p>

                <div className="grid gap-3 md:grid-cols-2">
                  {(
                    [
                      {
                        key: 'usbAutomount',
                        label: 'USB-A / USB-C / Thunderbolt Ports',
                        desc: 'udisks2 + Plasma Device Notifier + bolt + exfatprogs/ntfs3g',
                      },
                      {
                        key: 'hdmiDisplayAudio',
                        label: 'HDMI / DisplayPort Video & Audio',
                        desc: 'KWin Wayland + kscreen-doctor + PipeWire HDMI audio',
                      },
                      {
                        key: 'universalWifiEthernet',
                        label: 'Wi-Fi & Ethernet (iwd + NetworkManager)',
                        desc: 'linux-firmware + nmtui TUI network configuration',
                      },
                      {
                        key: 'bluetoothStack',
                        label: 'Bluetooth 5.x + bluetui',
                        desc: 'bluez hardware power-on + lightweight TUI pairing manager',
                      },
                      {
                        key: 'intelGraphicsVaapi',
                        label: 'Intel Graphics & VA-API Decode',
                        desc: 'intel-media-driver + hardware video acceleration',
                      },
                      {
                        key: 'amdRadeonVulkan',
                        label: 'AMD Radeon / Mesa Vulkan',
                        desc: 'mesa RADV Vulkan & open-source kernel display modesetting',
                      },
                      {
                        key: 'nvidiaOpenNvk',
                        label: 'NVIDIA Open / NVK Wayland',
                        desc: 'Zero-proprietary fallback support for host NVIDIA GPUs',
                      },
                      {
                        key: 'sofAudioFirmware',
                        label: 'PipeWire + SOF Laptop Audio',
                        desc: 'sof-firmware + wireplumber + wiremix TUI volume mixer',
                      },
                      {
                        key: 'laptopAcpiSupport',
                        label: 'Laptop Battery, Brightness & ACPI',
                        desc: 'upower + brightnessctl + thermald power efficiency',
                      },
                    ] as const
                  ).map((item) => (
                    <label
                      key={item.key}
                      className="os-control flex items-start justify-between gap-3 border border-[var(--os-border)] bg-[var(--os-bg)] p-3 text-xs"
                    >
                      <div>
                        <div className="font-medium text-[var(--os-fg)]">{item.label}</div>
                        <div className="mt-0.5 text-[11px] text-[var(--os-muted)]">{item.desc}</div>
                      </div>
                      <input
                        type="checkbox"
                        checked={config.hardware[item.key]}
                        onChange={(e) => updateHardware({ [item.key]: e.target.checked })}
                        className="mt-0.5 h-4 w-4 accent-[var(--os-accent)]"
                      />
                    </label>
                  ))}
                </div>
              </section>

              {/* Minimal Firefox RAM Tuning */}
              <section className="os-card border border-[var(--os-border)] bg-[var(--os-surface)] p-5">
                <h2 className="text-sm font-semibold text-[var(--os-fg)]">
                  Minimal Firefox Browser Tuning
                </h2>
                <div className="mt-3 grid gap-4 md:grid-cols-2 text-xs">
                  <div>
                    <div className="mb-1 flex justify-between">
                      <span className="text-[var(--os-muted)]">Max Content Processes</span>
                      <span className="tabular-nums text-[var(--os-fg)]">
                        {config.browser.maxContentProcesses}
                      </span>
                    </div>
                    <input
                      type="range"
                      min={1}
                      max={4}
                      step={1}
                      value={config.browser.maxContentProcesses}
                      onChange={(e) =>
                        updateBrowser({ maxContentProcesses: Number(e.target.value) })
                      }
                      className="w-full accent-[var(--os-accent)]"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="flex items-center justify-between">
                      <span className="text-[var(--os-fg)]">Hardware VA-API Video Decode</span>
                      <input
                        type="checkbox"
                        checked={config.browser.enableVaapi}
                        onChange={(e) => updateBrowser({ enableVaapi: e.target.checked })}
                        className="h-4 w-4 accent-[var(--os-accent)]"
                      />
                    </label>
                    <label className="flex items-center justify-between">
                      <span className="text-[var(--os-fg)]">Strip Window Buttons & Minimal Chrome CSS</span>
                      <input
                        type="checkbox"
                        checked={config.browser.minimalChromeCss}
                        onChange={(e) => updateBrowser({ minimalChromeCss: e.target.checked })}
                        className="h-4 w-4 accent-[var(--os-accent)]"
                      />
                    </label>
                    <label className="flex items-center justify-between">
                      <span className="text-[var(--os-fg)]">Block Telemetry & Pocket</span>
                      <input
                        type="checkbox"
                        checked={config.browser.blockTelemetry}
                        onChange={(e) => updateBrowser({ blockTelemetry: e.target.checked })}
                        className="h-4 w-4 accent-[var(--os-accent)]"
                      />
                    </label>
                  </div>
                </div>
              </section>
            </>
          )}

          {/* TAB 5: STORAGE & EXPORT PATHS */}
          {activeTab === 'storage' && (
            <>
              <section className="os-card border border-[var(--os-border)] bg-[var(--os-surface)] p-5">
                <h2 className="text-sm font-semibold text-[var(--os-fg)]">
                  Auto-Scaling USB Partition Layout
                </h2>
                <p className="mt-0.5 mb-4 text-xs text-[var(--os-muted)]">
                  The USB image scales to any drive size automatically on first boot. Because{' '}
                  <strong className="text-[var(--os-fg)]">LocalSend</strong> handles peer-to-peer file sharing over Wi-Fi/LAN, the legacy Windows/macOS exFAT transfer partition is disabled by default—giving 100% of remaining drive capacity to Linux ext4 persistence.
                </p>

                <div className="mb-4 flex flex-wrap gap-2">
                  {DRIVE_PRESETS.map((preset) => {
                    const selected = config.storage.nominalDriveGb === preset.nominalGb;
                    return (
                      <button
                        key={preset.label}
                        type="button"
                        onClick={() => applyDrivePreset(preset.nominalGb, preset.usableGb)}
                        className={`os-control border px-3 py-1.5 text-xs font-medium tabular-nums ${
                          selected
                            ? 'border-[var(--os-accent)] bg-[var(--os-surface-elevated)] text-[var(--os-accent)]'
                            : 'border-[var(--os-border)] bg-[var(--os-bg)] text-[var(--os-muted)] hover:text-[var(--os-fg)]'
                        }`}
                      >
                        {preset.label}
                      </button>
                    );
                  })}
                </div>

                {/* Live Partition Visual Bar */}
                <div className="os-control overflow-hidden border border-[var(--os-border)] bg-[var(--os-bg)] p-3.5">
                  <div className="mb-2 flex h-3 w-full overflow-hidden rounded bg-[var(--os-surface-elevated)]">
                    <div
                      style={{
                        width: `${Math.max(3, (partitions.efiGb / partitions.totalUsableGb) * 100)}%`,
                      }}
                      className="bg-zinc-500"
                      title={`EFI ${partitions.efiGb} GB`}
                    />
                    <div
                      style={{
                        width: `${Math.max(5, (partitions.squashfsGb / partitions.totalUsableGb) * 100)}%`,
                      }}
                      className="bg-zinc-400"
                      title={`NixOS SquashFS ${partitions.squashfsGb} GB`}
                    />
                    <div
                      style={{
                        width: `${Math.max(15, (partitions.persistenceGb / partitions.totalUsableGb) * 100)}%`,
                      }}
                      className="bg-[var(--os-accent)]"
                      title={`Persistence ext4 ${partitions.persistenceGb} GB`}
                    />
                    {partitions.exfatTransferGb > 0 && (
                      <div
                        style={{
                          width: `${(partitions.exfatTransferGb / partitions.totalUsableGb) * 100}%`,
                        }}
                        className="bg-amber-500/80"
                        title={`Optional exFAT ${partitions.exfatTransferGb} GB`}
                      />
                    )}
                  </div>
                  <div className="flex flex-wrap gap-x-5 gap-y-1 text-[11px] tabular-nums text-[var(--os-muted)]">
                    <span>EFI: {partitions.efiGb} GB</span>
                    <span>NixOS Live ISO: {partitions.squashfsGb} GB</span>
                    <span className="font-semibold text-[var(--os-accent)]">
                      {config.storage.persistLabel} (ext4): {partitions.persistenceGb} GB (
                      {partitions.persistencePercent}%)
                    </span>
                    {partitions.exfatTransferGb > 0 ? (
                      <span className="text-amber-300">
                        Optional exFAT: {partitions.exfatTransferGb} GB
                      </span>
                    ) : (
                      <span>exFAT Transfer: Disabled (LocalSend active)</span>
                    )}
                  </div>
                </div>

                <div className="mt-4 space-y-4 text-xs">
                  <label className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-medium text-[var(--os-fg)]">
                        Optional Windows/macOS exFAT Transfer Partition
                      </div>
                      <div className="text-[11px] text-[var(--os-muted)]">
                        Off by default because LocalSend handles cross-device transfers cleanly without splitting your USB. Enable only if you need offline USB plug-in reads on Windows/macOS.
                      </div>
                    </div>
                    <input
                      type="checkbox"
                      checked={config.storage.createExfatTransfer}
                      onChange={(e) =>
                        updateStorage({
                          createExfatTransfer: e.target.checked,
                          persistencePercent: e.target.checked ? 75 : 100,
                        })
                      }
                      className="mt-0.5 h-4 w-4 accent-[var(--os-accent)]"
                    />
                  </label>

                  {config.storage.createExfatTransfer && (
                    <div>
                      <div className="mb-1 flex justify-between">
                        <span className="text-[var(--os-muted)]">
                          Linux Persistence Share (remainder becomes exFAT)
                        </span>
                        <span className="tabular-nums text-[var(--os-accent)]">
                          {config.storage.persistencePercent}% ext4 /{' '}
                          {100 - config.storage.persistencePercent}% exFAT
                        </span>
                      </div>
                      <input
                        type="range"
                        min={50}
                        max={95}
                        step={5}
                        value={config.storage.persistencePercent}
                        onChange={(e) =>
                          updateStorage({ persistencePercent: Number(e.target.value) })
                        }
                        className="w-full accent-[var(--os-accent)]"
                      />
                    </div>
                  )}
                </div>
              </section>

              {/* Host Identity & Export Paths */}
              <section className="os-card border border-[var(--os-border)] bg-[var(--os-surface)] p-5">
                <h2 className="text-sm font-semibold text-[var(--os-fg)]">
                  System Identity & Export Paths
                </h2>
                <div className="mt-4 grid gap-4 md:grid-cols-2 text-xs">
                  <div>
                    <label className="mb-1 block text-[11px] text-[var(--os-muted)]">
                      Hostname
                    </label>
                    <input
                      type="text"
                      value={config.hostname}
                      onChange={(e) => onChange({ ...config, hostname: e.target.value })}
                      className="os-control w-full border border-[var(--os-border)] bg-[var(--os-bg)] px-3 py-2 text-xs text-[var(--os-fg)]"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] text-[var(--os-muted)]">
                      Default Username
                    </label>
                    <input
                      type="text"
                      value={config.username}
                      onChange={(e) => onChange({ ...config, username: e.target.value })}
                      className="os-control w-full border border-[var(--os-border)] bg-[var(--os-bg)] px-3 py-2 text-xs text-[var(--os-fg)]"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] text-[var(--os-muted)]">
                      Workspace Directory
                    </label>
                    <input
                      type="text"
                      value={config.exportPaths.workspaceDir}
                      onChange={(e) => updateExportPaths({ workspaceDir: e.target.value })}
                      className="os-control w-full border border-[var(--os-border)] bg-[var(--os-bg)] px-3 py-2 text-xs text-[var(--os-fg)]"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] text-[var(--os-muted)]">
                      LocalSend Drop Directory
                    </label>
                    <input
                      type="text"
                      value={config.exportPaths.localSendDir}
                      onChange={(e) => updateExportPaths({ localSendDir: e.target.value })}
                      className="os-control w-full border border-[var(--os-border)] bg-[var(--os-bg)] px-3 py-2 text-xs text-[var(--os-fg)]"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] text-[var(--os-muted)]">
                      OBS Recordings Export Path
                    </label>
                    <input
                      type="text"
                      value={config.exportPaths.obsRecordingsDir}
                      onChange={(e) => updateExportPaths({ obsRecordingsDir: e.target.value })}
                      className="os-control w-full border border-[var(--os-border)] bg-[var(--os-bg)] px-3 py-2 text-xs text-[var(--os-fg)]"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] text-[var(--os-muted)]">
                      Dotfiles Git Sync Remote
                    </label>
                    <input
                      type="text"
                      value={config.exportPaths.dotfilesSyncRemote}
                      onChange={(e) => updateExportPaths({ dotfilesSyncRemote: e.target.value })}
                      className="os-control w-full border border-[var(--os-border)] bg-[var(--os-bg)] px-3 py-2 text-xs text-[var(--os-fg)]"
                    />
                  </div>
                </div>
                <div className="mt-4 text-[11px] text-[var(--os-muted)]">
                  Default persistence label: <code className="text-[var(--os-fg)]">{DEFAULT_OS_CONFIG.storage.persistLabel}</code>
                </div>
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bluetooth,
  Check,
  Cpu,
  FolderPlus,
  Globe,
  HardDrive,
  Keyboard,
  Monitor,
  Moon,
  Plus,
  Search,
  Send,
  Settings2,
  Sliders,
  Terminal,
  Trash2,
  Usb,
  Video,
  Wifi,
} from 'lucide-react';
import {
  NEOVIM_BUILTIN_SHORTCUTS,
  OS_VISUAL_ASSETS,
  THEME_PALETTES,
  TOOLCHAIN_CATALOG,
  WALLPAPER_PRESETS,
} from '../lib/osDefaults';
import {
  calculatePartitions,
  estimateIdleRamMb,
  formatHotkeyCombo,
  isValidNixPackageName,
  resolveToolchainPlan,
} from '../lib/osEngine';
import type {
  DesktopWindowId,
  OSConfigState,
  OSThemeId,
  ProjectEnvConfig,
  ScreensaverStyleId,
  WallpaperPresetId,
} from '../lib/types';

interface LiveOSPreviewProps {
  config: OSConfigState;
  initialMode: 'first-boot' | 'desktop-plasma';
  onUpdateConfig: (next: OSConfigState) => void;
  onOpenSettings: () => void;
}

const WINDOW_RAM_MB: Record<DesktopWindowId, number> = {
  neovim: 44,
  terminal: 22,
  firefox: 135,
  obs: 110,
  localsend: 42,
  hardware: 14,
  'system-settings': 28,
};

const WINDOW_META: Record<DesktopWindowId, { title: string; subtitle: string }> = {
  neovim: { title: 'Neovim IDE', subtitle: 'Konsole · Auto-LSP · JetBrains Mono' },
  terminal: { title: 'Konsole', subtitle: 'Plasma 6 Wayland Terminal' },
  hardware: { title: 'Hardware & Ports', subtitle: 'USB · HDMI · Wi-Fi · BT · RAM' },
  'system-settings': { title: 'System Settings', subtitle: 'Plasma 6 Graphical Settings (Super+,)' },
  firefox: { title: 'Firefox', subtitle: 'Minimal VA-API · Zero Window Buttons' },
  localsend: { title: 'LocalSend', subtitle: 'LAN Peer Transfer (No exFAT Needed)' },
  obs: { title: 'OBS Studio', subtitle: 'Wayland PipeWire Recorder' },
};

export const LiveOSPreview: React.FC<LiveOSPreviewProps> = ({
  config,
  initialMode,
  onUpdateConfig,
  onOpenSettings,
}) => {
  const [phase, setPhase] = useState<'first-boot' | 'desktop-plasma'>(initialMode);
  const [openWindows, setOpenWindows] = useState<DesktopWindowId[]>(['system-settings', 'terminal']);
  const [minimizedWindows, setMinimizedWindows] = useState<DesktopWindowId[]>([]);
  const [focusedWindow, setFocusedWindow] = useState<DesktopWindowId>('system-settings');
  const [expandedWindow, setExpandedWindow] = useState<DesktopWindowId | null>(null);
  const [windowsHidden, setWindowsHidden] = useState(false);
  const [settingsSection, setSettingsSection] = useState<'appearance' | 'panel' | 'shortcuts'>('appearance');

  // Floating rounded auto-hiding Plasma panel state
  const [barVisible, setBarVisible] = useState<boolean>(config.appearance.taskbarShowOnStart);
  const [barPinned, setBarPinned] = useState<boolean>(!config.appearance.taskbarAutoHide);
  const hideTimerRef = useRef<number | null>(null);

  // Active RAM-only local project state
  const [activeProjectId, setActiveProjectId] = useState<string | null>(
    config.nixSystem.projects[0]?.id ?? null,
  );
  const [showNewProjectModal, setShowNewProjectModal] = useState(false);
  const [newProjName, setNewProjName] = useState('');
  const [newProjStack, setNewProjStack] = useState('python');
  const [newProjPkgs, setNewProjPkgs] = useState('python312, uv, ruff, pyright');

  // Unified shortcut menu & modals
  const [showShortcutSearch, setShowShortcutSearch] = useState(false);
  const [shortcutQuery, setShortcutQuery] = useState('');
  const [showResetModal, setShowResetModal] = useState(false);
  const [screensaverActive, setScreensaverActive] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  // First-boot wizard state
  const [fbStep, setFbStep] = useState<1 | 2 | 3>(1);
  const [fbSelectedStacks, setFbSelectedStacks] = useState<string[]>(['rust', 'nodejs']);

  // Interactive Konsole terminal state
  const [termInput, setTermInput] = useState('');
  const [termLines, setTermLines] = useState<string[]>([
    `Monolith NixOS (${config.nixSystem.channel}) · Optimized Plasma 6 Wayland · JetBrains Mono`,
    `Type: monolith-pkg install <pkg> | monolith-ram-clean | monolith-exe app.exe | monolith-persist-usb --status`,
  ]);

  // Clock
  const [clockText, setClockText] = useState(() => {
    const d = new Date();
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  });

  useEffect(() => {
    setPhase(initialMode);
  }, [initialMode]);

  useEffect(() => {
    setBarVisible(config.appearance.taskbarShowOnStart || !config.appearance.taskbarAutoHide);
    setBarPinned(!config.appearance.taskbarAutoHide);
  }, [config.appearance.taskbarAutoHide, config.appearance.taskbarShowOnStart]);

  useEffect(() => {
    const id = window.setInterval(() => {
      const d = new Date();
      setClockText(d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    }, 15000);
    return () => window.clearInterval(id);
  }, []);

  const palette = THEME_PALETTES[config.appearance.theme];
  const idleRam = useMemo(() => estimateIdleRamMb(config), [config]);
  const partitions = useMemo(() => calculatePartitions(config.storage), [config.storage]);
  const fbPlan = useMemo(() => resolveToolchainPlan(fbSelectedStacks, ''), [fbSelectedStacks]);

  const activeProject: ProjectEnvConfig | null = useMemo(
    () => config.nixSystem.projects.find((p) => p.id === activeProjectId) ?? null,
    [config.nixSystem.projects, activeProjectId],
  );

  const visibleWindows = useMemo(
    () =>
      windowsHidden
        ? []
        : openWindows.filter((w) => !minimizedWindows.includes(w)),
    [openWindows, minimizedWindows, windowsHidden],
  );

  // Live RAM calculation: strictly matches idle (<500 MB) when no windows/project loaded
  const projectRamMb = activeProject ? activeProject.localPackages.length * 14 : 0;
  const openWinRamMb = visibleWindows.reduce((acc, w) => acc + WINDOW_RAM_MB[w], 0);
  const currentRamMb = idleRam.totalIdleMb + projectRamMb + openWinRamMb;
  const isIdleState = visibleWindows.length === 0 && !activeProject;

  const notify = (msg: string) => {
    setToastMsg(msg);
    window.setTimeout(() => {
      setToastMsg((curr) => (curr === msg ? null : curr));
    }, 2400);
  };

  // Auto-hide taskbar edge handlers
  const handleRevealBar = () => {
    if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
    setBarVisible(true);
  };

  const handleScheduleHideBar = () => {
    if (!config.appearance.taskbarAutoHide || barPinned) return;
    if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
    hideTimerRef.current = window.setTimeout(() => {
      setBarVisible(false);
    }, config.appearance.taskbarHideDelayMs);
  };

  // Window actions (keyboard-driven — ZERO GUI min/max/close buttons!)
  const openOrFocusWindow = (id: DesktopWindowId) => {
    setWindowsHidden(false);
    setMinimizedWindows((prev) => prev.filter((w) => w !== id));
    setOpenWindows((prev) => (prev.includes(id) ? prev : [...prev, id]));
    setFocusedWindow(id);
  };

  const closeFocusedWindow = () => {
    if (visibleWindows.length === 0) return;
    const target = visibleWindows.includes(focusedWindow)
      ? focusedWindow
      : visibleWindows[visibleWindows.length - 1];
    const nextOpen = openWindows.filter((w) => w !== target);
    setOpenWindows(nextOpen);
    setMinimizedWindows((prev) => prev.filter((w) => w !== target));
    if (expandedWindow === target) setExpandedWindow(null);
    const remaining = nextOpen.filter((w) => !minimizedWindows.includes(w));
    if (remaining.length > 0) setFocusedWindow(remaining[remaining.length - 1]);
    notify(`Closed ${WINDOW_META[target].title} via keyboard shortcut`);
  };

  const toggleExpandFocused = () => {
    if (visibleWindows.length === 0) return;
    const target = visibleWindows.includes(focusedWindow) ? focusedWindow : visibleWindows[0];
    setExpandedWindow((curr) => (curr === target ? null : target));
    notify(
      expandedWindow === target
        ? `Restored ${WINDOW_META[target].title} column`
        : `Expanded ${WINDOW_META[target].title} full width`,
    );
  };

  const minimizeFocusedWindow = () => {
    if (visibleWindows.length === 0) return;
    const target = visibleWindows.includes(focusedWindow) ? focusedWindow : visibleWindows[0];
    setMinimizedWindows((prev) => (prev.includes(target) ? prev : [...prev, target]));
    if (expandedWindow === target) setExpandedWindow(null);
    const remaining = visibleWindows.filter((w) => w !== target);
    if (remaining.length > 0) setFocusedWindow(remaining[0]);
    notify(`Minimized ${WINDOW_META[target].title} (Alt+D or taskbar to restore)`);
  };

  const toggleHideAllWindows = () => {
    if (windowsHidden || minimizedWindows.length > 0) {
      setWindowsHidden(false);
      setMinimizedWindows([]);
      notify('Restored Plasma 6 windows');
    } else {
      setWindowsHidden(true);
      notify('Peek at desktop — wallpaper view');
    }
  };

  const triggerRamClean = () => {
    setActiveProjectId(null);
    setOpenWindows([]);
    setMinimizedWindows([]);
    setExpandedWindow(null);
    setWindowsHidden(false);
    notify(`RAM cleaned: tmpfs project unloaded · ${idleRam.totalIdleMb} MB idle (< 500 MB)`);
  };

  const activateScreensaver = () => {
    if (config.nixSystem.autoClearIdleRam) {
      setActiveProjectId(null);
    }
    setScreensaverActive(true);
  };

  // Keyboard listener (mirrors Super+<key> using Alt+<key> in browser)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (screensaverActive) {
        setScreensaverActive(false);
        return;
      }
      if (e.key === 'Escape') {
        setShowShortcutSearch(false);
        setShowResetModal(false);
        setShowNewProjectModal(false);
        return;
      }
      if (phase !== 'desktop-plasma') return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) {
        return;
      }
      if (!e.altKey) return;

      const k = e.key.toLowerCase();
      if (k === 'q') {
        e.preventDefault();
        closeFocusedWindow();
      } else if (k === 'f') {
        e.preventDefault();
        toggleExpandFocused();
      } else if (k === 'm') {
        e.preventDefault();
        minimizeFocusedWindow();
      } else if (k === 'd') {
        e.preventDefault();
        toggleHideAllWindows();
      } else if (k === ' ' || k === 's') {
        e.preventDefault();
        setShowShortcutSearch((v) => !v);
      } else if (k === '/') {
        e.preventDefault();
        setShowShortcutSearch((v) => !v);
      } else if (k === ',') {
        e.preventDefault();
        openOrFocusWindow('system-settings');
      } else if (k === 'l' && e.shiftKey) {
        e.preventDefault();
        activateScreensaver();
      } else if (k === 'h' || k === 'l') {
        e.preventDefault();
        if (visibleWindows.length > 1) {
          const idx = visibleWindows.indexOf(focusedWindow);
          const nextIdx =
            k === 'l'
              ? (idx + 1) % visibleWindows.length
              : (idx - 1 + visibleWindows.length) % visibleWindows.length;
          setFocusedWindow(visibleWindows[nextIdx]);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  // Execute interactive terminal commands
  const runTerminalCommand = (rawCmd: string) => {
    const cmd = rawCmd.trim();
    if (!cmd) return;
    const out: string[] = [`$ ${cmd}`];

    if (cmd === 'clear') {
      setTermLines([]);
      setTermInput('');
      return;
    }

    const pkgMatch = cmd.match(
      /^(?:monolith-pkg\s+install|nix\s+profile\s+install\s+nixpkgs#)\s*([a-zA-Z0-9._-]+)$/,
    );
    if (pkgMatch) {
      const pkg = pkgMatch[1];
      if (!isValidNixPackageName(pkg)) {
        out.push(`error: invalid nixpkgs attribute '${pkg}'`);
      } else if (config.nixSystem.globalPackages.includes(pkg)) {
        out.push(`[nix] nixpkgs#${pkg} is already installed globally.`);
      } else {
        onUpdateConfig({
          ...config,
          nixSystem: {
            ...config.nixSystem,
            globalPackages: [...config.nixSystem.globalPackages, pkg],
          },
        });
        out.push(`[nix] evaluating nixpkgs#${pkg} (${config.nixSystem.channel})...`);
        out.push(`[ok] Installed '${pkg}' globally into ~/.nix-profile & Settings Studio.`);
      }
    } else if (cmd === 'monolith-ram-clean') {
      setActiveProjectId(null);
      out.push('[ram-clean] Unmounted idle project tmpfs mounts & dropped page caches.');
      out.push(`[ram-clean] Idle baseline: ${idleRam.totalIdleMb} MB (< ${config.nixSystem.ramIdleLimitMb} MB budget).`);
    } else if (cmd.startsWith('monolith-exe')) {
      const exeName = cmd.replace(/^monolith-exe\s*/, '').trim() || 'app.exe';
      if (config.nixSystem.windowsExeSupport) {
        out.push(`[wine] Launching ${exeName} via wineWowPackages.stable...`);
        out.push(`[ok] Prefix ~/.wine initialized (Wayland driver active).`);
      } else {
        out.push(`[warn] Windows .exe support is OFF. Enable in Settings -> Hardware & .exe or First-Boot.`);
      }
    } else if (cmd.startsWith('monolith-persist-usb')) {
      out.push(`Drive: ${partitions.nominalDriveGb} GB (${partitions.totalUsableGb} GB usable)`);
      out.push(`  p1 EFI: ${partitions.efiGb} GB | p2 NixOS ISO: ${partitions.squashfsGb} GB`);
      out.push(
        `  p3 ${config.storage.persistLabel} (ext4): ${partitions.persistenceGb} GB (${partitions.persistencePercent}%)`,
      );
      out.push(
        partitions.exfatTransferGb > 0
          ? `  p4 EXFAT_XFER: ${partitions.exfatTransferGb} GB`
          : `  p4 exFAT: Disabled (using LocalSend for sharing — 100% persistence)`,
      );
    } else if (cmd === 'help') {
      out.push('Commands:');
      out.push('  monolith-pkg install <pkg>          Install global nixpkgs app');
      out.push('  nix profile install nixpkgs#<pkg>   Install global nixpkgs app');
      out.push('  monolith-ram-clean                  Evict idle project RAM (<500 MB)');
      out.push('  monolith-exe <file.exe>             Run Windows .exe via Wine');
      out.push('  monolith-persist-usb --status       Show USB auto-scaled partitions');
    } else {
      out.push(`monolith-sh: ran '${cmd}' (type 'help' for built-in OS commands)`);
    }

    setTermLines((prev) => [...prev.slice(-14), ...out]);
    setTermInput('');
  };

  const handleCreateProject = () => {
    const clean = newProjName.trim().toLowerCase().replace(/[^a-z0-9-_]/g, '-');
    const pkgs = newProjPkgs
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && isValidNixPackageName(s));
    if (!clean || pkgs.length === 0) return;

    const proj: ProjectEnvConfig = {
      id: `proj-${Date.now()}`,
      name: clean,
      stack: newProjStack,
      version: 'latest',
      localPackages: Array.from(new Set(pkgs)),
      ramOnly: true,
    };
    onUpdateConfig({
      ...config,
      nixSystem: {
        ...config.nixSystem,
        projects: [...config.nixSystem.projects, proj],
      },
    });
    setActiveProjectId(proj.id);
    setShowNewProjectModal(false);
    setNewProjName('');
    notify(`Created ~/workspace/${proj.name} — loaded ${proj.localPackages.length} local pkgs into tmpfs RAM`);
  };

  const handleProjectReset = () => {
    setActiveProjectId(null);
    setShowResetModal(false);
    notify('Project Reset complete — workspace wiped; Wi-Fi, BT, SSH & theme preserved');
  };

  // Wallpaper background styling
  const wallpaperStyle = useMemo<React.CSSProperties>(() => {
    const wp = config.appearance.wallpaper;
    if (wp === 'obsidian-horizon') {
      return {
        backgroundImage: `linear-gradient(to bottom, rgba(0,0,0,0.34), rgba(0,0,0,0.52)), url(${OS_VISUAL_ASSETS.wallpaperObsidianHorizon})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      };
    }
    if (wp === 'monolith-grid') {
      return {
        backgroundImage: `linear-gradient(to bottom, rgba(0,0,0,0.38), rgba(0,0,0,0.56)), url(${OS_VISUAL_ASSETS.wallpaperMonolithGrid})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      };
    }
    if (wp === 'contour-svg') {
      return {
        backgroundColor: palette.bg,
        backgroundImage: `radial-gradient(circle at 22% 28%, color-mix(in srgb, ${palette.accent} 18%, transparent), transparent 60%), repeating-radial-gradient(circle at 74% 78%, transparent 0 18px, color-mix(in srgb, ${palette.border} 60%, transparent) 18px 19px)`,
      };
    }
    return { backgroundColor: palette.bg };
  }, [config.appearance.wallpaper, palette.accent, palette.bg, palette.border]);

  // All shortcuts for search modal
  const allShortcuts = useMemo(() => {
    const builtIn = Object.values(config.hotkeys).map((h) => ({
      combo: formatHotkeyCombo(h),
      label: h.label,
      category: h.category,
    }));
    const custom = config.customShortcuts.map((c) => ({
      combo: formatHotkeyCombo(c),
      label: `${c.label} (${c.command})`,
      category: 'Custom App',
    }));
    const nvim = NEOVIM_BUILTIN_SHORTCUTS.map((n) => ({
      combo: n.combo,
      label: n.label,
      category: 'Neovim',
    }));
    return [...builtIn, ...custom, ...nvim].filter(
      (item) =>
        !shortcutQuery.trim() ||
        item.label.toLowerCase().includes(shortcutQuery.toLowerCase()) ||
        item.combo.toLowerCase().includes(shortcutQuery.toLowerCase()),
    );
  }, [config.hotkeys, config.customShortcuts, shortcutQuery]);

  const winBgCss = `color-mix(in srgb, ${palette.surface} ${Math.round(
    config.appearance.windowOpacity * 100,
  )}%, transparent)`;

  const renderTaskbar = () => (
    <div
      onMouseEnter={handleRevealBar}
      onMouseLeave={handleScheduleHideBar}
      style={{
        height: `${config.appearance.taskbarHeightPx}px`,
        borderRadius: `${Math.max(10, Math.min(config.appearance.cornerRadiusPx + 4, 18))}px`,
        backgroundColor: `color-mix(in srgb, ${palette.surfaceElevated} ${Math.round(
          Math.max(0.84, config.appearance.windowOpacity) * 100,
        )}%, transparent)`,
        borderColor: palette.border,
      }}
      className={`mx-3 my-2 flex items-center justify-between border px-3 text-[11px] shadow-lg backdrop-blur-md transition-all duration-200 ${
        barVisible
          ? 'opacity-100 translate-y-0'
          : config.appearance.barPosition === 'bottom'
            ? 'pointer-events-none opacity-0 translate-y-2'
            : 'pointer-events-none opacity-0 -translate-y-2'
      }`}
    >
      <div className="flex items-center gap-2 overflow-hidden">
        <button
          type="button"
          onClick={() => setShowShortcutSearch(true)}
          className="os-control inline-flex items-center gap-1.5 border px-2 py-1 text-[11px] font-semibold transition-opacity hover:opacity-90"
          style={{
            borderColor: palette.accent,
            backgroundColor: `color-mix(in srgb, ${palette.accent} 14%, transparent)`,
            color: palette.accent,
          }}
          title="Application Launcher & Unified Shortcuts (Super + Space / Super + /)"
        >
          <span>PLASMA 6</span>
        </button>

        <button
          type="button"
          onClick={() => openOrFocusWindow('system-settings')}
          className="os-control inline-flex items-center gap-1 border px-2 py-1 text-[11px] transition-opacity hover:opacity-90"
          style={{
            borderColor: visibleWindows.includes('system-settings') ? palette.accent : palette.border,
            color: visibleWindows.includes('system-settings') ? palette.fg : palette.muted,
          }}
        >
          <Settings2 className="h-3 w-3" style={{ color: palette.accent }} />
          <span className="hidden sm:inline">System Settings</span>
        </button>

        <button
          type="button"
          onClick={() => openOrFocusWindow('terminal')}
          className="os-control inline-flex items-center gap-1 border px-2 py-1 text-[11px] transition-opacity hover:opacity-90"
          style={{
            borderColor: visibleWindows.includes('terminal') ? palette.accent : palette.border,
            color: visibleWindows.includes('terminal') ? palette.fg : palette.muted,
          }}
        >
          <Terminal className="h-3 w-3" />
          <span className="hidden md:inline">Konsole</span>
        </button>

        {activeProject ? (
          <span className="hidden truncate text-[10px] lg:inline" style={{ color: palette.muted }}>
            RAM: {activeProject.name} ({activeProject.localPackages.length} pkgs)
          </span>
        ) : (
          <span className="hidden text-[10px] lg:inline" style={{ color: palette.muted }}>
            IDLE · tmpfs clean
          </span>
        )}
        {minimizedWindows.length > 0 && (
          <button
            type="button"
            onClick={() => setMinimizedWindows([])}
            className="underline decoration-dotted"
            style={{ color: palette.accent }}
          >
            {minimizedWindows.length} minimized
          </button>
        )}
      </div>

      <div className="flex items-center gap-3 tabular-nums" style={{ color: palette.muted }}>
        <span
          className="font-medium"
          style={{
            color:
              currentRamMb <= config.nixSystem.ramIdleLimitMb ? palette.accent : palette.fg,
          }}
        >
          RAM {currentRamMb} MB
          {isIdleState ? ' (idle)' : ''}
        </span>
        {config.hardware.usbAutomount && <span className="hidden sm:inline">USB</span>}
        {config.hardware.hdmiDisplayAudio && <span className="hidden sm:inline">HDMI</span>}
        {config.hardware.universalWifiEthernet && <span className="hidden sm:inline">WI-FI</span>}
        {config.hardware.bluetoothStack && <span className="hidden md:inline">BT</span>}
        <span style={{ color: palette.fg }}>{clockText}</span>
      </div>
    </div>
  );

  const renderWindowBody = (id: DesktopWindowId) => {
    if (id === 'neovim') {
      return (
        <div className="flex h-full flex-col justify-between p-3 text-[11px] leading-relaxed">
          <div className="space-y-1">
            <div style={{ color: palette.muted }}>
              {activeProject
                ? `~/workspace/${activeProject.name}/src/main.${activeProject.stack === 'rust' ? 'rs' : activeProject.stack === 'python' ? 'py' : 'ts'}`
                : '~/workspace/README.md'}
            </div>
            <div className="mt-2 space-y-0.5 font-mono">
              <div>
                <span style={{ color: palette.muted }}> 1 </span>
                <span style={{ color: palette.accent }}>// Monolith NixOS · Optimized Plasma 6 Wayland</span>
              </div>
              <div>
                <span style={{ color: palette.muted }}> 2 </span>
                <span style={{ color: palette.fg }}>
                  {activeProject
                    ? `// Local RAM pkgs loaded: ${activeProject.localPackages.join(', ')}`
                    : '// No project active — idle RAM < 500 MB'}
                </span>
              </div>
              <div>
                <span style={{ color: palette.muted }}> 3 </span>
                <span style={{ color: palette.fg }}>pub fn boot_environment() -&gt; SystemState {'{'}</span>
              </div>
              <div>
                <span style={{ color: palette.muted }}> 4 </span>
                <span style={{ color: palette.fg }}>
                  {'  '}desktop: &quot;plasma6-wayland&quot;, font: &quot;JetBrains Mono&quot;,
                </span>
              </div>
              <div>
                <span style={{ color: palette.muted }}> 5 </span>
                <span style={{ color: palette.fg }}>
                  {'  '}window_buttons: false, baloo: false, idle_ram_mb: {idleRam.totalIdleMb},
                </span>
              </div>
              <div>
                <span style={{ color: palette.muted }}> 6 </span>
                <span style={{ color: palette.fg }}>{'}'}</span>
              </div>
            </div>
          </div>
          <div
            className="mt-3 flex items-center justify-between border-t pt-2 text-[10px]"
            style={{ borderColor: palette.border, color: palette.muted }}
          >
            <span>NORMAL · LSP: {activeProject ? activeProject.stack : 'standby'}</span>
            <span>JetBrains Mono · {config.appearance.fontSizePx}px</span>
          </div>
        </div>
      );
    }

    if (id === 'terminal') {
      return (
        <div className="flex h-full flex-col justify-between p-3 text-[11px]">
          <div className="space-y-1 overflow-y-auto">
            {termLines.map((line, idx) => (
              <div
                key={idx}
                className="break-words"
                style={{
                  color: line.startsWith('$')
                    ? palette.accent
                    : line.startsWith('[ok]')
                      ? palette.fg
                      : palette.muted,
                }}
              >
                {line}
              </div>
            ))}
          </div>

          <div className="mt-2 space-y-2 border-t pt-2" style={{ borderColor: palette.border }}>
            <div className="flex flex-wrap gap-1.5 text-[10px]">
              <button
                type="button"
                onClick={() => runTerminalCommand('monolith-pkg install lazygit')}
                className="os-control border px-2 py-0.5 hover:opacity-90"
                style={{ borderColor: palette.border, color: palette.accent }}
              >
                monolith-pkg install lazygit
              </button>
              <button
                type="button"
                onClick={() => runTerminalCommand('monolith-ram-clean')}
                className="os-control border px-2 py-0.5 hover:opacity-90"
                style={{ borderColor: palette.border, color: palette.fg }}
              >
                monolith-ram-clean
              </button>
              <button
                type="button"
                onClick={() => runTerminalCommand('monolith-persist-usb --status')}
                className="os-control border px-2 py-0.5 hover:opacity-90"
                style={{ borderColor: palette.border, color: palette.muted }}
              >
                persist --status
              </button>
              <button
                type="button"
                onClick={() => runTerminalCommand('monolith-exe setup.exe')}
                className="os-control border px-2 py-0.5 hover:opacity-90"
                style={{ borderColor: palette.border, color: palette.muted }}
              >
                monolith-exe
              </button>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                runTerminalCommand(termInput);
              }}
              className="flex items-center gap-2"
            >
              <span style={{ color: palette.accent }}>{config.username}@monolith:~$</span>
              <input
                type="text"
                value={termInput}
                onChange={(e) => setTermInput(e.target.value)}
                placeholder="nix profile install nixpkgs#tmux"
                className="w-full bg-transparent text-[11px] focus:outline-none"
                style={{ color: palette.fg }}
              />
            </form>
          </div>
        </div>
      );
    }

    if (id === 'hardware') {
      return (
        <div className="space-y-3 p-3 text-[11px]">
          <div className="grid grid-cols-2 gap-2">
            <div className="os-control border p-2.5" style={{ borderColor: palette.border }}>
              <div className="flex items-center gap-1.5 font-semibold" style={{ color: palette.fg }}>
                <Usb className="h-3.5 w-3.5" style={{ color: palette.accent }} />
                USB-A / C / TB
              </div>
              <div className="mt-1" style={{ color: palette.muted }}>
                {config.hardware.usbAutomount
                  ? 'udisks2 + Plasma Device Notifier + bolt active'
                  : 'Disabled in Settings'}
              </div>
            </div>
            <div className="os-control border p-2.5" style={{ borderColor: palette.border }}>
              <div className="flex items-center gap-1.5 font-semibold" style={{ color: palette.fg }}>
                <Monitor className="h-3.5 w-3.5" style={{ color: palette.accent }} />
                HDMI / DisplayPort
              </div>
              <div className="mt-1" style={{ color: palette.muted }}>
                {config.hardware.hdmiDisplayAudio
                  ? 'KWin Wayland + kscreen-doctor + PipeWire HDMI audio'
                  : 'Disabled in Settings'}
              </div>
            </div>
            <div className="os-control border p-2.5" style={{ borderColor: palette.border }}>
              <div className="flex items-center gap-1.5 font-semibold" style={{ color: palette.fg }}>
                <Wifi className="h-3.5 w-3.5" style={{ color: palette.accent }} />
                Wi-Fi (Plasma + iwd)
              </div>
              <div className="mt-1" style={{ color: palette.muted }}>
                {config.hardware.universalWifiEthernet
                  ? 'Connected · 5GHz · LocalSend ready'
                  : 'Offline'}
              </div>
            </div>
            <div className="os-control border p-2.5" style={{ borderColor: palette.border }}>
              <div className="flex items-center gap-1.5 font-semibold" style={{ color: palette.fg }}>
                <Bluetooth className="h-3.5 w-3.5" style={{ color: palette.accent }} />
                Bluetooth (Plasma + bluetui)
              </div>
              <div className="mt-1" style={{ color: palette.muted }}>
                {config.hardware.bluetoothStack
                  ? 'bluez powered · A2DP PipeWire sink ready'
                  : 'Disabled'}
              </div>
            </div>
          </div>

          <div className="os-control border p-2.5" style={{ borderColor: palette.border }}>
            <div className="flex items-center justify-between">
              <span className="font-semibold" style={{ color: palette.fg }}>
                Idle RAM Budget (Baloo OFF · zram · earlyoom)
              </span>
              <span className="tabular-nums font-semibold" style={{ color: palette.accent }}>
                {idleRam.totalIdleMb} / {config.nixSystem.ramIdleLimitMb} MB idle
              </span>
            </div>
            <div className="mt-1 text-[10px]" style={{ color: palette.muted }}>
              Kernel {idleRam.kernelAndSystemdMb}M · KWin {idleRam.kwinWaylandMb}M · Plasma{' '}
              {idleRam.plasmaShellMb}M · Hardware {idleRam.hardwareServicesMb}M
            </div>
          </div>
        </div>
      );
    }

    if (id === 'system-settings') {
      return (
        <div className="grid h-full grid-cols-[120px_1fr] text-[11px]">
          {/* Native KDE Plasma 6 System Settings Sidebar */}
          <div
            className="flex flex-col justify-between border-r p-2"
            style={{ borderColor: palette.border, backgroundColor: `color-mix(in srgb, ${palette.bg} 55%, transparent)` }}
          >
            <div className="space-y-1">
              {(
                [
                  { id: 'appearance', label: 'Appearance' },
                  { id: 'panel', label: 'Panel & UI' },
                  { id: 'shortcuts', label: 'Shortcuts' },
                ] as const
              ).map((sec) => (
                <button
                  key={sec.id}
                  type="button"
                  onClick={() => setSettingsSection(sec.id)}
                  className="os-control block w-full border px-2 py-1.5 text-left text-[10px] font-medium"
                  style={{
                    borderColor: settingsSection === sec.id ? palette.accent : 'transparent',
                    backgroundColor:
                      settingsSection === sec.id ? palette.surfaceElevated : 'transparent',
                    color: settingsSection === sec.id ? palette.accent : palette.muted,
                  }}
                >
                  {sec.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={onOpenSettings}
              className="os-control border px-2 py-1 text-[10px] font-medium"
              style={{ borderColor: palette.border, color: palette.accent }}
            >
              Full Studio →
            </button>
          </div>

          {/* System Settings Content Area */}
          <div className="space-y-3 overflow-y-auto p-3">
            {settingsSection === 'appearance' && (
              <>
                <div>
                  <div className="mb-1 text-[10px] font-semibold" style={{ color: palette.fg }}>
                    Colors &amp; Unified Theme (kdeglobals)
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {(Object.keys(THEME_PALETTES) as OSThemeId[]).map((tId) => (
                      <button
                        key={tId}
                        type="button"
                        onClick={() =>
                          onUpdateConfig({
                            ...config,
                            appearance: { ...config.appearance, theme: tId },
                          })
                        }
                        className="os-control border px-2 py-0.5 text-[10px]"
                        style={{
                          borderColor:
                            config.appearance.theme === tId ? palette.accent : palette.border,
                          color: config.appearance.theme === tId ? palette.accent : palette.muted,
                        }}
                      >
                        {THEME_PALETTES[tId].name.split(' ')[0]}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="mb-1 text-[10px] font-semibold" style={{ color: palette.fg }}>
                    Minimal Wallpaper
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {WALLPAPER_PRESETS.map((wp) => (
                      <button
                        key={wp.id}
                        type="button"
                        onClick={() =>
                          onUpdateConfig({
                            ...config,
                            appearance: {
                              ...config.appearance,
                              wallpaper: wp.id as WallpaperPresetId,
                            },
                          })
                        }
                        className="os-control border px-2 py-0.5 text-[10px]"
                        style={{
                          borderColor:
                            config.appearance.wallpaper === wp.id ? palette.accent : palette.border,
                          color:
                            config.appearance.wallpaper === wp.id ? palette.accent : palette.muted,
                        }}
                      >
                        {wp.name}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 pt-1">
                  <div>
                    <div className="flex justify-between text-[10px]" style={{ color: palette.muted }}>
                      <span>Corner Radius</span>
                      <span>{config.appearance.cornerRadiusPx}px</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={18}
                      value={config.appearance.cornerRadiusPx}
                      onChange={(e) =>
                        onUpdateConfig({
                          ...config,
                          appearance: {
                            ...config.appearance,
                            cornerRadiusPx: Number(e.target.value),
                          },
                        })
                      }
                      className="w-full accent-[var(--os-accent)]"
                    />
                  </div>
                  <div>
                    <div className="flex justify-between text-[10px]" style={{ color: palette.muted }}>
                      <span>Window Opacity</span>
                      <span>{Math.round(config.appearance.windowOpacity * 100)}%</span>
                    </div>
                    <input
                      type="range"
                      min={70}
                      max={100}
                      value={Math.round(config.appearance.windowOpacity * 100)}
                      onChange={(e) =>
                        onUpdateConfig({
                          ...config,
                          appearance: {
                            ...config.appearance,
                            windowOpacity: Number(e.target.value) / 100,
                          },
                        })
                      }
                      className="w-full accent-[var(--os-accent)]"
                    />
                  </div>
                </div>
              </>
            )}

            {settingsSection === 'panel' && (
              <div className="space-y-2.5 text-[10px]">
                <div className="font-semibold" style={{ color: palette.fg }}>
                  Floating Rounded Plasma Panel
                </div>
                <label className="flex items-center justify-between">
                  <span style={{ color: palette.muted }}>Auto-hide floating panel</span>
                  <input
                    type="checkbox"
                    checked={config.appearance.taskbarAutoHide}
                    onChange={(e) =>
                      onUpdateConfig({
                        ...config,
                        appearance: { ...config.appearance, taskbarAutoHide: e.target.checked },
                      })
                    }
                    className="h-3.5 w-3.5 accent-[var(--os-accent)]"
                  />
                </label>
                <div className="flex items-center justify-between">
                  <span style={{ color: palette.muted }}>Panel Edge</span>
                  <div className="flex gap-1.5">
                    {(['bottom', 'top'] as const).map((pos) => (
                      <button
                        key={pos}
                        type="button"
                        onClick={() =>
                          onUpdateConfig({
                            ...config,
                            appearance: { ...config.appearance, barPosition: pos },
                          })
                        }
                        className="os-control border px-2 py-0.5 capitalize"
                        style={{
                          borderColor:
                            config.appearance.barPosition === pos ? palette.accent : palette.border,
                          color:
                            config.appearance.barPosition === pos ? palette.accent : palette.muted,
                        }}
                      >
                        {pos}
                      </button>
                    ))}
                  </div>
                </div>
                <p style={{ color: palette.muted }}>
                  Native Breeze Dark menus and popups are rounded automatically; titlebar buttons are disabled via KWin (<code style={{ color: palette.fg }}>ButtonsOnLeft=</code>).
                </p>
              </div>
            )}

            {settingsSection === 'shortcuts' && (
              <div className="space-y-1.5 text-[10px]">
                <div className="font-semibold" style={{ color: palette.fg }}>
                  Unified Global Shortcuts (kglobalshortcutsrc)
                </div>
                {Object.values(config.hotkeys)
                  .slice(0, 6)
                  .map((b) => (
                    <div
                      key={b.action}
                      className="flex items-center justify-between border-b py-1"
                      style={{ borderColor: palette.border }}
                    >
                      <span style={{ color: palette.muted }}>{b.label}</span>
                      <code style={{ color: palette.accent }}>{formatHotkeyCombo(b)}</code>
                    </div>
                  ))}
              </div>
            )}
          </div>
        </div>
      );
    }

    if (id === 'localsend') {
      return (
        <div className="space-y-2.5 p-3 text-[11px]">
          <div className="font-semibold" style={{ color: palette.fg }}>
            LocalSend · Peer-to-Peer LAN Drop
          </div>
          <p style={{ color: palette.muted }}>
            Receiving directory: <code style={{ color: palette.accent }}>{config.exportPaths.localSendDir}</code>
          </p>
          <p style={{ color: palette.muted }}>
            Because LocalSend transfers files wirelessly across Windows, macOS, Android, and iOS, your USB uses 100% ({partitions.persistenceGb} GB) for Linux ext4 persistence instead of splitting off an exFAT partition.
          </p>
        </div>
      );
    }

    if (id === 'firefox') {
      return (
        <div className="space-y-2 p-3 text-[11px]">
          <div className="os-control border px-2.5 py-1 text-[10px]" style={{ borderColor: palette.border, color: palette.muted }}>
            https://search.nixos.org/packages?channel={config.nixSystem.channel === 'nixos-unstable' ? 'unstable' : config.nixSystem.channel.replace('nixos-', '')}
          </div>
          <p style={{ color: palette.fg }}>
            Minimal Firefox · {config.browser.maxContentProcesses} content processes · VA-API{' '}
            {config.browser.enableVaapi ? 'ON' : 'OFF'}
          </p>
          <p style={{ color: palette.muted }}>
            No window titlebar [min/max/close] chrome buttons — controlled cleanly via unified KWin shortcuts.
          </p>
        </div>
      );
    }

    return (
      <div className="space-y-2 p-3 text-[11px]">
        <div className="font-semibold" style={{ color: palette.fg }}>
          OBS Studio · Wayland PipeWire Screen Capture
        </div>
        <div style={{ color: palette.muted }}>
          Export path: <code style={{ color: palette.accent }}>{config.exportPaths.obsRecordingsDir}</code>
        </div>
        <div style={{ color: palette.muted }}>
          VA-API hardware encoder active · 1080p60 · HDMI/mic PipeWire audio routing
        </div>
      </div>
    );
  };

  const renderScreensaver = () => {
    const style: ScreensaverStyleId = config.appearance.screensaverStyle;
    return (
      <div
        onClick={() => setScreensaverActive(false)}
        className="absolute inset-0 z-30 flex cursor-pointer flex-col items-center justify-center p-6 text-center backdrop-blur-md"
        style={{ backgroundColor: `color-mix(in srgb, ${palette.bg} 95%, transparent)` }}
      >
        <div className="text-[10px] uppercase tracking-[0.22em]" style={{ color: palette.muted }}>
          monolith-screensaver · {style} · theme-synced TUI
        </div>
        {style === 'clock' && (
          <div
            className="mt-4 text-5xl font-semibold tracking-[0.12em] tabular-nums sm:text-6xl"
            style={{ color: palette.accent }}
          >
            {clockText}
          </div>
        )}
        {style === 'matrix' && (
          <pre
            className="mt-4 text-left text-xs leading-5"
            style={{ color: palette.accent }}
          >
{`0xNIX  ::  flake.lock  ::  plasma6-wayland  ::  tmpfs-clean
  10110010  nixpkgs#neovim   [idle: ${idleRam.totalIdleMb} MB]   01001101
  01101001  kscreenlocker    [budget: <${config.nixSystem.ramIdleLimitMb} MB]   11010010
  11000101  jetbrains-mono   [theme: ${config.appearance.theme}]   00110101`}
          </pre>
        )}
        {style === 'monolith-wave' && (
          <pre className="mt-4 text-xs leading-5" style={{ color: palette.accent }}>
{`        ___---~~~---___         ___---~~~---___
    _--~               ~--___--~               ~--_
___~    MONOLITH NIXOS · PLASMA 6 WAYLAND · ${clockText}    ~___`}
          </pre>
        )}
        <div className="mt-5 text-xs tabular-nums" style={{ color: palette.fg }}>
          Idle RAM cleaned · {idleRam.totalIdleMb} MB / {config.nixSystem.ramIdleLimitMb} MB
        </div>
        <div className="mt-2 text-[11px]" style={{ color: palette.muted }}>
          Press any key or click anywhere to return to KDE Plasma 6 Wayland
        </div>
      </div>
    );
  };

  return (
    <div className="mx-auto max-w-[1440px] px-4 py-6 sm:px-6">
      {/* Top Preview Control Header */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.16em] text-[var(--os-accent)]">
            Interactive Wayland Simulator · Optimized Plasma 6 · Native System Settings
          </p>
          <h1 className="text-xl font-semibold text-[var(--os-fg)]">
            Live OS Preview
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setPhase('desktop-plasma')}
            className={`os-control border px-3 py-1.5 text-xs font-medium ${
              phase === 'desktop-plasma'
                ? 'border-[var(--os-accent)] bg-[var(--os-surface-elevated)] text-[var(--os-accent)]'
                : 'border-[var(--os-border)] bg-[var(--os-surface)] text-[var(--os-muted)]'
            }`}
          >
            Plasma 6 Wayland Desktop
          </button>
          <button
            type="button"
            onClick={() => setPhase('first-boot')}
            className={`os-control border px-3 py-1.5 text-xs font-medium ${
              phase === 'first-boot'
                ? 'border-[var(--os-accent)] bg-[var(--os-surface-elevated)] text-[var(--os-accent)]'
                : 'border-[var(--os-border)] bg-[var(--os-surface)] text-[var(--os-muted)]'
            }`}
          >
            First-Boot Wizard
          </button>
          <button
            type="button"
            onClick={onOpenSettings}
            className="os-control inline-flex items-center gap-1.5 border border-[var(--os-border)] bg-[var(--os-surface)] px-3 py-1.5 text-xs text-[var(--os-fg)] hover:border-[var(--os-accent)]"
          >
            <Sliders className="h-3.5 w-3.5 text-[var(--os-accent)]" />
            Settings Studio
          </button>
        </div>
      </div>

      {/* Simulated Monitor Frame */}
      <div
        className="os-card relative overflow-hidden border border-[var(--os-border)] shadow-2xl"
        style={{
          minHeight: '560px',
          backgroundColor: palette.bg,
        }}
      >
        {phase === 'first-boot' ? (
          /* FIRST-BOOT TUI WIZARD (WITH WINDOWS .EXE PROMPT) */
          <div
            className="flex min-h-[560px] flex-col justify-between p-6 sm:p-8"
            style={{ backgroundColor: palette.bg, color: palette.fg }}
          >
            <div>
              <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-3 text-xs" style={{ borderColor: palette.border }}>
                <span style={{ color: palette.accent }}>
                  MONOLITH NIXOS · FIRST-BOOT TUI ({config.nixSystem.channel})
                </span>
                <span style={{ color: palette.muted }}>Step {fbStep} of 3 · Theme-Synced TUI</span>
              </div>

              {fbStep === 1 && (
                <div className="mt-6 max-w-2xl space-y-4 text-xs">
                  <h2 className="text-base font-semibold">
                    1. Persistence Mount & Host Network Ready
                  </h2>
                  <p style={{ color: palette.muted }}>
                    Auto-scaled <code style={{ color: palette.fg }}>{config.storage.persistLabel}</code>{' '}
                    ({partitions.persistenceGb} GB ext4 · {partitions.persistencePercent}% of remaining USB space).
                    {partitions.exfatTransferGb === 0
                      ? ' Legacy exFAT transfer is skipped because LocalSend handles sharing.'
                      : ` Optional exFAT partition: ${partitions.exfatTransferGb} GB.`}
                  </p>
                  <div className="os-control grid gap-2 border p-4 sm:grid-cols-2" style={{ borderColor: palette.border, backgroundColor: palette.surface }}>
                    <div>Desktop: <strong>KDE Plasma 6 Wayland (auto-login)</strong></div>
                    <div>Font: <strong>JetBrains Mono</strong></div>
                    <div>Idle RAM Baseline: <strong style={{ color: palette.accent }}>{idleRam.totalIdleMb} MB (&lt;500 MB)</strong></div>
                    <div>Nix Version: <strong>{config.nixSystem.useLatestNixPackage ? 'nixVersions.latest' : 'channel default'}</strong></div>
                  </div>
                </div>
              )}

              {fbStep === 2 && (
                <div className="mt-6 max-w-2xl space-y-4 text-xs">
                  <h2 className="text-base font-semibold">
                    2. Do you want to run Windows (.exe) applications?
                  </h2>
                  <p style={{ color: palette.muted }}>
                    Monolith NixOS can install <code style={{ color: palette.fg }}>wineWowPackages.stable</code> +{' '}
                    <code style={{ color: palette.fg }}>winetricks</code> +{' '}
                    <code style={{ color: palette.accent }}>monolith-exe</code> from latest Nixpkgs so you can execute Windows .exe software directly.
                  </p>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <button
                      type="button"
                      onClick={() =>
                        onUpdateConfig({
                          ...config,
                          nixSystem: { ...config.nixSystem, windowsExeSupport: true },
                        })
                      }
                      className="os-control border p-4 text-left"
                      style={{
                        borderColor: config.nixSystem.windowsExeSupport
                          ? palette.accent
                          : palette.border,
                        backgroundColor: palette.surface,
                      }}
                    >
                      <div className="flex items-center justify-between font-semibold">
                        <span>Yes — Enable Windows .exe Apps</span>
                        {config.nixSystem.windowsExeSupport && (
                          <Check className="h-4 w-4" style={{ color: palette.accent }} />
                        )}
                      </div>
                      <p className="mt-1.5 text-[11px]" style={{ color: palette.muted }}>
                        Installs Wine (WoW64) + Winetricks. Zero idle RAM cost until you launch a .exe file.
                      </p>
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        onUpdateConfig({
                          ...config,
                          nixSystem: { ...config.nixSystem, windowsExeSupport: false },
                        })
                      }
                      className="os-control border p-4 text-left"
                      style={{
                        borderColor: !config.nixSystem.windowsExeSupport
                          ? palette.accent
                          : palette.border,
                        backgroundColor: palette.surface,
                      }}
                    >
                      <div className="flex items-center justify-between font-semibold">
                        <span>No — Pure Linux Minimal</span>
                        {!config.nixSystem.windowsExeSupport && (
                          <Check className="h-4 w-4" style={{ color: palette.accent }} />
                        )}
                      </div>
                      <p className="mt-1.5 text-[11px]" style={{ color: palette.muted }}>
                        Keeps the USB image slimmer. You can still add Wine later via Settings or Nix.
                      </p>
                    </button>
                  </div>
                </div>
              )}

              {fbStep === 3 && (
                <div className="mt-6 max-w-3xl space-y-4 text-xs">
                  <h2 className="text-base font-semibold">
                    3. Optional Initial Toolchains & Local Project Flakes
                  </h2>
                  <p style={{ color: palette.muted }}>
                    Project toolchains load on-demand into RAM when entering a project folder and auto-clear when idle.
                  </p>
                  <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-3">
                    {TOOLCHAIN_CATALOG.map((tc) => {
                      const checked = fbSelectedStacks.includes(tc.id);
                      return (
                        <button
                          key={tc.id}
                          type="button"
                          onClick={() =>
                            setFbSelectedStacks((prev) =>
                              prev.includes(tc.id)
                                ? prev.filter((id) => id !== tc.id)
                                : [...prev, tc.id],
                            )
                          }
                          className="os-control border p-3 text-left"
                          style={{
                            borderColor: checked ? palette.accent : palette.border,
                            backgroundColor: palette.surface,
                          }}
                        >
                          <div className="font-semibold">{tc.name}</div>
                          <div className="mt-0.5 text-[10px]" style={{ color: palette.muted }}>
                            LSP: {tc.nvimLsp} · ~{tc.estimatedMb} MB
                          </div>
                        </button>
                      );
                    })}
                  </div>
                  <div className="text-[11px]" style={{ color: palette.muted }}>
                    Selected Neovim LSPs:{' '}
                    <span style={{ color: palette.accent }}>
                      {fbPlan.nvimLspServers.join(', ') || 'none'}
                    </span>{' '}
                    · Windows .exe:{' '}
                    <span style={{ color: palette.fg }}>
                      {config.nixSystem.windowsExeSupport ? 'Enabled (Wine)' : 'Disabled'}
                    </span>
                  </div>
                </div>
              )}
            </div>

            <div className="mt-8 flex items-center justify-between border-t pt-4 text-xs" style={{ borderColor: palette.border }}>
              <button
                type="button"
                disabled={fbStep === 1}
                onClick={() => setFbStep((s) => (s > 1 ? ((s - 1) as 1 | 2 | 3) : s))}
                className="os-control border px-4 py-2 disabled:opacity-40"
                style={{ borderColor: palette.border, color: palette.muted }}
              >
                Back
              </button>
              {fbStep < 3 ? (
                <button
                  type="button"
                  onClick={() => setFbStep((s) => ((s + 1) as 1 | 2 | 3))}
                  className="os-control px-4 py-2 font-semibold"
                  style={{ backgroundColor: palette.accent, color: palette.accentFg }}
                >
                  Continue →
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setPhase('desktop-plasma');
                    notify('First-boot complete — Optimized KDE Plasma 6 Wayland session active');
                  }}
                  className="os-control px-4 py-2 font-semibold"
                  style={{ backgroundColor: palette.accent, color: palette.accentFg }}
                >
                  Boot into Plasma 6 Wayland →
                </button>
              )}
            </div>
          </div>
        ) : (
          /* OPTIMIZED KDE PLASMA 6 WAYLAND DESKTOP (DEFAULT ON START) */
          <div
            className="relative flex min-h-[560px] flex-col justify-between"
            style={wallpaperStyle}
          >
            {/* Top Auto-Hide Edge Trigger & Floating Plasma Panel */}
            {config.appearance.barPosition === 'top' && (
              <div onMouseEnter={handleRevealBar} className="relative z-20 min-h-[14px]">
                {renderTaskbar()}
              </div>
            )}

            {/* Main Plasma 6 Wayland Viewport */}
            <div
              className="relative z-10 flex flex-1 flex-col p-3"
              style={{ gap: `${config.appearance.windowGapPx}px` }}
            >
              {visibleWindows.length === 0 ? (
                <div className="flex flex-1 flex-col items-center justify-center text-center">
                  <div
                    className="os-card border px-6 py-5 backdrop-blur-md"
                    style={{
                      backgroundColor: winBgCss,
                      borderColor: palette.border,
                      borderRadius: `${config.appearance.cornerRadiusPx}px`,
                    }}
                  >
                    <div className="text-xs font-semibold" style={{ color: palette.fg }}>
                      Clean KDE Plasma 6 Wayland Canvas · {idleRam.totalIdleMb} MB Idle RAM
                    </div>
                    <p className="mt-1 text-[11px]" style={{ color: palette.muted }}>
                      Zero background clutter. Open System Settings from the floating panel, or press{' '}
                      <code style={{ color: palette.accent }}>Alt+/</code> for unified shortcuts.
                    </p>
                  </div>
                </div>
              ) : (
                <div
                  className={`grid flex-1 ${
                    expandedWindow || visibleWindows.length === 1
                      ? 'grid-cols-1'
                      : 'grid-cols-1 md:grid-cols-2'
                  }`}
                  style={{ gap: `${config.appearance.windowGapPx}px` }}
                >
                  {(expandedWindow ? [expandedWindow] : visibleWindows).map((winId) => {
                    const isFocused = focusedWindow === winId;
                    const meta = WINDOW_META[winId];
                    return (
                      <div
                        key={winId}
                        onClick={() => setFocusedWindow(winId)}
                        style={{
                          backgroundColor: winBgCss,
                          borderColor: isFocused ? palette.accent : palette.border,
                          borderWidth: `${Math.max(1, config.appearance.borderWidthPx)}px`,
                          borderRadius: `${config.appearance.cornerRadiusPx}px`,
                        }}
                        className="flex min-h-[340px] flex-col overflow-hidden border backdrop-blur-md transition-all"
                      >
                        {/* ZERO GUI [minimize, expand, close] BUTTONS IN TITLEBAR */}
                        <div
                          className="flex items-center justify-between border-b px-3 py-2 text-[11px]"
                          style={{
                            borderColor: palette.border,
                            backgroundColor: `color-mix(in srgb, ${palette.surfaceElevated} 75%, transparent)`,
                          }}
                        >
                          <div className="flex items-center gap-2 truncate">
                            <span
                              className="font-semibold"
                              style={{ color: isFocused ? palette.accent : palette.fg }}
                            >
                              {meta.title}
                            </span>
                            <span className="truncate text-[10px]" style={{ color: palette.muted }}>
                              {meta.subtitle}
                            </span>
                          </div>
                          <span
                            className="hidden text-[10px] sm:inline"
                            style={{ color: palette.muted }}
                          >
                            {isFocused
                              ? `${formatHotkeyCombo(config.hotkeys.closeWindow)} close · ${formatHotkeyCombo(config.hotkeys.expandWindow)} expand · ${formatHotkeyCombo(config.hotkeys.minimizeWindow)} min`
                              : 'click to focus'}
                          </span>
                        </div>

                        <div className="flex-1 overflow-auto">{renderWindowBody(winId)}</div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Toast Feedback */}
              {toastMsg && (
                <div
                  className="os-control pointer-events-none absolute bottom-3 left-1/2 z-20 -translate-x-1/2 border px-3.5 py-1.5 text-[11px] backdrop-blur-md"
                  style={{
                    backgroundColor: palette.surfaceElevated,
                    borderColor: palette.accent,
                    color: palette.fg,
                  }}
                >
                  {toastMsg}
                </div>
              )}
            </div>

            {/* Bottom Auto-Hide Edge Trigger & Taskbar */}
            {config.appearance.barPosition === 'bottom' && (
              <div onMouseEnter={handleRevealBar} className="relative z-20 min-h-[14px]">
                {renderTaskbar()}
              </div>
            )}

            {/* Theme-Synced TUI Screensaver Overlay */}
            {screensaverActive && renderScreensaver()}

            {/* Single Unified Shortcut Menu Overlay */}
            {showShortcutSearch && (
              <div
                className="absolute inset-0 z-30 flex items-center justify-center p-4 backdrop-blur-sm"
                style={{ backgroundColor: 'rgba(0,0,0,0.65)' }}
              >
                <div
                  className="os-card w-full max-w-xl border p-4"
                  style={{
                    backgroundColor: palette.surface,
                    borderColor: palette.accent,
                  }}
                >
                  <div className="mb-3 flex items-center justify-between text-xs">
                    <span className="font-semibold" style={{ color: palette.accent }}>
                      Unified Plasma 6 Shortcuts (kglobalshortcutsrc · ~/SHORTCUTS.txt)
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowShortcutSearch(false)}
                      className="text-[11px] underline"
                      style={{ color: palette.muted }}
                    >
                      Esc to dismiss
                    </button>
                  </div>
                  <input
                    type="text"
                    autoFocus
                    value={shortcutQuery}
                    onChange={(e) => setShortcutQuery(e.target.value)}
                    placeholder="Filter unified shortcuts (close, settings, krunner, screensaver, dolphin)..."
                    className="os-control mb-3 w-full border px-3 py-2 text-xs focus:outline-none"
                    style={{
                      backgroundColor: palette.bg,
                      borderColor: palette.border,
                      color: palette.fg,
                    }}
                  />
                  <div className="max-h-60 divide-y overflow-y-auto text-xs" style={{ borderColor: palette.border }}>
                    {allShortcuts.map((s, idx) => (
                      <div key={idx} className="flex items-center justify-between py-2">
                        <span style={{ color: palette.fg }}>{s.label}</span>
                        <code style={{ color: palette.accent }}>{s.combo}</code>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* New Project (Local RAM-Only Packages) Modal */}
            {showNewProjectModal && (
              <div
                className="absolute inset-0 z-30 flex items-center justify-center p-4 backdrop-blur-sm"
                style={{ backgroundColor: 'rgba(0,0,0,0.65)' }}
              >
                <div
                  className="os-card w-full max-w-lg border p-5 text-xs"
                  style={{
                    backgroundColor: palette.surface,
                    borderColor: palette.accent,
                  }}
                >
                  <div className="mb-3 flex items-center justify-between">
                    <span className="font-semibold" style={{ color: palette.accent }}>
                      monolith-new-project (On-Demand RAM Local Pkgs)
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowNewProjectModal(false)}
                      className="text-[11px] underline"
                      style={{ color: palette.muted }}
                    >
                      Esc
                    </button>
                  </div>
                  <p className="mb-3 text-[11px]" style={{ color: palette.muted }}>
                    Selected local packages mount into tmpfs RAM only while this project is active and auto-clear on idle.
                  </p>
                  <div className="space-y-3">
                    <input
                      type="text"
                      value={newProjName}
                      onChange={(e) => setNewProjName(e.target.value)}
                      placeholder="Project name (e.g. ml-pipeline)"
                      className="os-control w-full border px-3 py-2 text-xs"
                      style={{
                        backgroundColor: palette.bg,
                        borderColor: palette.border,
                        color: palette.fg,
                      }}
                    />
                    <select
                      value={newProjStack}
                      onChange={(e) => {
                        setNewProjStack(e.target.value);
                        const tc = TOOLCHAIN_CATALOG.find((t) => t.id === e.target.value);
                        if (tc) setNewProjPkgs(tc.nixPackages.join(', '));
                      }}
                      className="os-control w-full border px-3 py-2 text-xs"
                      style={{
                        backgroundColor: palette.bg,
                        borderColor: palette.border,
                        color: palette.fg,
                      }}
                    >
                      {TOOLCHAIN_CATALOG.map((tc) => (
                        <option key={tc.id} value={tc.id}>
                          {tc.name}
                        </option>
                      ))}
                    </select>
                    <input
                      type="text"
                      value={newProjPkgs}
                      onChange={(e) => setNewProjPkgs(e.target.value)}
                      placeholder="Local nixpkgs (comma-separated)"
                      className="os-control w-full border px-3 py-2 text-xs"
                      style={{
                        backgroundColor: palette.bg,
                        borderColor: palette.border,
                        color: palette.fg,
                      }}
                    />
                    <button
                      type="button"
                      onClick={handleCreateProject}
                      className="os-control w-full py-2 font-semibold"
                      style={{ backgroundColor: palette.accent, color: palette.accentFg }}
                    >
                      Create Project & Load into RAM
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Project Reset Modal */}
            {showResetModal && (
              <div
                className="absolute inset-0 z-30 flex items-center justify-center p-4 backdrop-blur-sm"
                style={{ backgroundColor: 'rgba(0,0,0,0.65)' }}
              >
                <div
                  className="os-card w-full max-w-md border p-5 text-xs"
                  style={{ backgroundColor: palette.surface, borderColor: palette.accent }}
                >
                  <div className="font-semibold" style={{ color: palette.fg }}>
                    Project Reset (monolith-reset)
                  </div>
                  <p className="mt-2 leading-relaxed" style={{ color: palette.muted }}>
                    Wipes temporary project workspaces & toolchains while preserving Wi-Fi, Bluetooth, SSH keys, theme, wallpaper, and global settings.
                  </p>
                  <div className="mt-4 flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setShowResetModal(false)}
                      className="os-control border px-3 py-1.5"
                      style={{ borderColor: palette.border, color: palette.muted }}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleProjectReset}
                      className="os-control px-3 py-1.5 font-semibold"
                      style={{ backgroundColor: palette.accent, color: palette.accentFg }}
                    >
                      Confirm Reset
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* External App Launcher & Keyboard-Only Window Action Strip (Outside Simulated OS Chrome) */}
      {phase === 'desktop-plasma' && (
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {/* Open Plasma Apps & Active RAM Project */}
          <div className="os-card border border-[var(--os-border)] bg-[var(--os-surface)] p-3.5">
            <div className="mb-2 flex items-center justify-between text-[11px]">
              <span className="font-semibold uppercase tracking-wider text-[var(--os-fg)]">
                Launch Apps &amp; Active RAM Project
              </span>
              <span className="tabular-nums text-[var(--os-muted)]">
                Current RAM: <strong className="text-[var(--os-accent)]">{currentRamMb} MB</strong>
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {(
                [
                  { id: 'system-settings', label: 'System Settings', icon: <Settings2 className="h-3 w-3" /> },
                  { id: 'terminal', label: 'Konsole', icon: <Terminal className="h-3 w-3" /> },
                  { id: 'neovim', label: 'Neovim', icon: <Terminal className="h-3 w-3" /> },
                  { id: 'hardware', label: 'Hardware', icon: <Cpu className="h-3 w-3" /> },
                  { id: 'firefox', label: 'Firefox', icon: <Globe className="h-3 w-3" /> },
                  { id: 'localsend', label: 'LocalSend', icon: <Send className="h-3 w-3" /> },
                  { id: 'obs', label: 'OBS', icon: <Video className="h-3 w-3" /> },
                ] as { id: DesktopWindowId; label: string; icon: React.ReactNode }[]
              ).map((app) => (
                <button
                  key={app.id}
                  type="button"
                  onClick={() => openOrFocusWindow(app.id)}
                  className={`os-control inline-flex items-center gap-1.5 border px-2.5 py-1 text-[11px] ${
                    visibleWindows.includes(app.id)
                      ? 'border-[var(--os-accent)] bg-[var(--os-surface-elevated)] text-[var(--os-fg)]'
                      : 'border-[var(--os-border)] bg-[var(--os-bg)] text-[var(--os-muted)] hover:text-[var(--os-fg)]'
                  }`}
                >
                  {app.icon}
                  {app.label}
                </button>
              ))}
            </div>

            <div className="mt-2.5 flex flex-wrap items-center gap-1.5 border-t border-[var(--os-border)] pt-2.5 text-[11px]">
              <span className="text-[var(--os-muted)]">Local Project (RAM):</span>
              {config.nixSystem.projects.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    setActiveProjectId(p.id);
                    notify(`Loaded ~/workspace/${p.name} local pkgs into tmpfs RAM`);
                  }}
                  className={`os-control border px-2 py-0.5 text-[11px] ${
                    activeProjectId === p.id
                      ? 'border-[var(--os-accent)] text-[var(--os-accent)]'
                      : 'border-[var(--os-border)] text-[var(--os-muted)]'
                  }`}
                >
                  {p.name}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setShowNewProjectModal(true)}
                className="os-control inline-flex items-center gap-1 border border-[var(--os-border)] px-2 py-0.5 text-[11px] text-[var(--os-fg)] hover:border-[var(--os-accent)]"
              >
                <FolderPlus className="h-3 w-3 text-[var(--os-accent)]" />
                New Project
              </button>
              <button
                type="button"
                onClick={triggerRamClean}
                className="os-control inline-flex items-center gap-1 border border-[var(--os-border)] px-2 py-0.5 text-[11px] text-[var(--os-muted)] hover:border-[var(--os-accent)] hover:text-[var(--os-fg)]"
              >
                <HardDrive className="h-3 w-3" />
                Clear Idle RAM (&lt;500 MB)
              </button>
            </div>
          </div>

          {/* Keyboard-Only Window Operations (Simulates Super+<Key> via Alt+<Key>) */}
          <div className="os-card border border-[var(--os-border)] bg-[var(--os-surface)] p-3.5">
            <div className="mb-2 flex items-center justify-between text-[11px]">
              <span className="inline-flex items-center gap-1.5 font-semibold uppercase tracking-wider text-[var(--os-fg)]">
                <Keyboard className="h-3.5 w-3.5 text-[var(--os-accent)]" />
                Keyboard-Only Window Actions (Alt in browser = Super in OS)
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5 text-[11px]">
              <button
                type="button"
                onClick={closeFocusedWindow}
                className="os-control border border-[var(--os-border)] bg-[var(--os-bg)] px-2.5 py-1 text-[var(--os-fg)] hover:border-[var(--os-accent)]"
              >
                Close ({formatHotkeyCombo(config.hotkeys.closeWindow)})
              </button>
              <button
                type="button"
                onClick={toggleExpandFocused}
                className="os-control border border-[var(--os-border)] bg-[var(--os-bg)] px-2.5 py-1 text-[var(--os-fg)] hover:border-[var(--os-accent)]"
              >
                Expand ({formatHotkeyCombo(config.hotkeys.expandWindow)})
              </button>
              <button
                type="button"
                onClick={minimizeFocusedWindow}
                className="os-control border border-[var(--os-border)] bg-[var(--os-bg)] px-2.5 py-1 text-[var(--os-fg)] hover:border-[var(--os-accent)]"
              >
                Minimize ({formatHotkeyCombo(config.hotkeys.minimizeWindow)})
              </button>
              <button
                type="button"
                onClick={toggleHideAllWindows}
                className="os-control border border-[var(--os-border)] bg-[var(--os-bg)] px-2.5 py-1 text-[var(--os-fg)] hover:border-[var(--os-accent)]"
              >
                Hide/Show All ({formatHotkeyCombo(config.hotkeys.toggleHideWindows)})
              </button>
              <button
                type="button"
                onClick={() => {
                  setBarVisible((v) => !v);
                  setBarPinned((p) => !p);
                }}
                className="os-control border border-[var(--os-border)] bg-[var(--os-bg)] px-2.5 py-1 text-[var(--os-fg)] hover:border-[var(--os-accent)]"
              >
                Toggle Panel
              </button>
              <button
                type="button"
                onClick={() => setShowShortcutSearch(true)}
                className="os-control inline-flex items-center gap-1 border border-[var(--os-border)] bg-[var(--os-bg)] px-2.5 py-1 text-[var(--os-fg)] hover:border-[var(--os-accent)]"
              >
                <Search className="h-3 w-3 text-[var(--os-accent)]" />
                Unified Shortcuts ({formatHotkeyCombo(config.hotkeys.shortcutSearch)})
              </button>
              <button
                type="button"
                onClick={activateScreensaver}
                className="os-control inline-flex items-center gap-1 border border-[var(--os-border)] bg-[var(--os-bg)] px-2.5 py-1 text-[var(--os-fg)] hover:border-[var(--os-accent)]"
              >
                <Moon className="h-3 w-3 text-[var(--os-accent)]" />
                Screensaver
              </button>
              <button
                type="button"
                onClick={() => setShowResetModal(true)}
                className="os-control inline-flex items-center gap-1 border border-[var(--os-border)] bg-[var(--os-bg)] px-2.5 py-1 text-[var(--os-muted)] hover:border-[var(--os-accent)] hover:text-[var(--os-fg)]"
              >
                <Trash2 className="h-3 w-3" />
                Project Reset
              </button>
            </div>
            <div className="mt-2 flex items-center gap-1 text-[10px] text-[var(--os-muted)]">
              <Plus className="h-3 w-3 text-[var(--os-accent)]" />
              <span>
                Zero [minimize, expand, close] buttons on windows via KWin (ButtonsOnLeft= / ButtonsOnRight=).
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

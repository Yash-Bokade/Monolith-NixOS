export type OSThemeId =
  | 'obsidian-matte'
  | 'carbon-mono'
  | 'slate-graphite'
  | 'phosphor-mono'
  | 'nordic-frost'
  | 'warm-ash';

export type CompositorId = 'niri';

export type WallpaperPresetId =
  | 'obsidian-horizon'
  | 'monolith-grid'
  | 'contour-svg'
  | 'solid-matte'
  | 'custom';

export type NixChannelId = 'nixos-unstable' | 'nixos-25.11' | 'nixos-25.05';

export type ScreensaverStyleId = 'clock' | 'matrix' | 'monolith-wave';

export type AppViewId = 'overview' | 'live-os' | 'usb-config' | 'settings' | 'source';

export type HotkeyActionId =
  | 'toggleStatusBar'
  | 'closeWindow'
  | 'expandWindow'
  | 'minimizeWindow'
  | 'toggleHideWindows'
  | 'shortcutSearch'
  | 'openSettingsTui'
  | 'openTerminal'
  | 'openNeovim'
  | 'openBrowser'
  | 'openObs'
  | 'openLocalSend'
  | 'newProject'
  | 'triggerScreensaver'
  | 'projectReset';

export type HotkeyModifier = 'Super' | 'Super+Shift' | 'Super+Ctrl' | 'Super+Alt';

export interface HotkeyBinding {
  action: HotkeyActionId;
  label: string;
  description: string;
  category: 'System' | 'Window Management' | 'Applications' | 'Lifecycle';
  modifier: HotkeyModifier;
  key: string;
}

export interface CustomShortcut {
  id: string;
  label: string;
  command: string;
  modifier: HotkeyModifier;
  key: string;
}

export interface ProjectEnvConfig {
  id: string;
  name: string;
  stack: string;
  version: string;
  localPackages: string[];
  ramOnly: boolean;
}

export interface NixSystemConfig {
  channel: NixChannelId;
  useLatestNixPackage: boolean;
  globalPackages: string[];
  projects: ProjectEnvConfig[];
  windowsExeSupport: boolean;
  ramIdleLimitMb: number;
  autoClearIdleRam: boolean;
}

export interface DrivePreset {
  label: string;
  nominalGb: number;
  usableGb: number;
}

export interface StorageConfig {
  nominalDriveGb: number;
  totalUsableGb: number;
  efiGb: number;
  squashfsGb: number;
  /** Percentage (40–100) of remaining unallocated space assigned to ext4 persistence */
  persistencePercent: number;
  persistLabel: string;
  createExfatTransfer: boolean;
}

export interface ExportPathsConfig {
  workspaceDir: string;
  obsRecordingsDir: string;
  localSendDir: string;
  backupExportDir: string;
  sshDir: string;
  dotfilesSyncRemote: string;
}

export interface BrowserConfig {
  maxContentProcesses: number;
  enableVaapi: boolean;
  blockTelemetry: boolean;
  minimalChromeCss: boolean;
}

export interface HardwareDriversConfig {
  intelGraphicsVaapi: boolean;
  amdRadeonVulkan: boolean;
  nvidiaOpenNvk: boolean;
  universalWifiEthernet: boolean;
  bluetoothStack: boolean;
  usbAutomount: boolean;
  hdmiDisplayAudio: boolean;
  sofAudioFirmware: boolean;
  laptopAcpiSupport: boolean;
}

export interface AppearanceConfig {
  theme: OSThemeId;
  wallpaper: WallpaperPresetId;
  customWallpaperPath: string;
  fontSizePx: number;
  cornerRadiusPx: number;
  windowOpacity: number;
  borderWidthPx: number;
  windowGapPx: number;
  barPosition: 'top' | 'bottom';
  taskbarAutoHide: boolean;
  taskbarShowOnStart: boolean;
  taskbarHeightPx: number;
  taskbarHideDelayMs: number;
  screensaverEnabled: boolean;
  screensaverTimeoutMin: number;
  screensaverStyle: ScreensaverStyleId;
}

export interface OSConfigState {
  osName: string;
  hostname: string;
  username: string;
  defaultCompositor: CompositorId;
  appearance: AppearanceConfig;
  nixSystem: NixSystemConfig;
  storage: StorageConfig;
  hotkeys: Record<HotkeyActionId, HotkeyBinding>;
  customShortcuts: CustomShortcut[];
  exportPaths: ExportPathsConfig;
  browser: BrowserConfig;
  hardware: HardwareDriversConfig;
}

export interface PartitionBreakdown {
  nominalDriveGb: number;
  totalUsableGb: number;
  efiGb: number;
  squashfsGb: number;
  persistenceGb: number;
  persistencePercent: number;
  exfatTransferGb: number;
  isValid: boolean;
  warning: string | null;
}

export interface HotkeyConflict {
  combo: string;
  actions: string[];
}

export interface IdleRamBreakdown {
  kernelAndSystemdMb: number;
  niriWaylandMb: number;
  waybarAndSwaybgMb: number;
  hardwareServicesMb: number;
  totalIdleMb: number;
  withinBudget: boolean;
}

export interface ToolchainOption {
  id: string;
  name: string;
  latestLabel: string;
  versions: string[];
  defaultVersion: string;
  nixPackages: string[];
  nvimLsp: string;
  treesitterParser: string;
  estimatedMb: number;
  postInstallCmd?: string;
}

export interface GeneratedFileEntry {
  path: string;
  group: 'GitHub Actions' | 'NixOS Flake' | 'Documentation';
  language: 'yaml' | 'markdown' | 'nix';
  description: string;
  executable?: boolean;
  content: string;
}

export type DesktopWindowId =
  | 'neovim'
  | 'firefox'
  | 'obs'
  | 'localsend'
  | 'terminal'
  | 'hardware'
  | 'settings-tui';

export interface ThemePalette {
  id: OSThemeId;
  name: string;
  subtitle: string;
  bg: string;
  surface: string;
  surfaceElevated: string;
  border: string;
  fg: string;
  muted: string;
  accent: string;
  accentFg: string;
  tuiAccentName: string;
}

export interface UsbBootConfig {
  username: string;
  password: string;
  hostname: string;
  timezone: string;
  keymap: string;
  compositor: CompositorId;
  nixChannel: NixChannelId;
  windowsExeSupport: boolean;
  wifiSsid: string;
  wifiPassword: string;
  gitName: string;
  gitEmail: string;
  preinstallStacks: string[];
  stackVersions: Record<string, string>;
  extraPackages: string;
  autoUpdate: boolean;
  githubRepo: string;
  skipInteractiveWizard: boolean;
}

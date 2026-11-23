import { useState } from 'react';
import {
  ArrowRight,
  Download,
  HardDrive,
  Monitor,
  SlidersHorizontal,
  Terminal,
} from 'lucide-react';
import { DRIVE_PRESETS, OS_VISUAL_ASSETS } from '../lib/osDefaults';
import { calculatePartitions, estimateIdleRamMb, formatHotkeyCombo } from '../lib/osEngine';
import type { AppViewId, OSConfigState } from '../lib/types';

interface OverviewPageProps {
  config: OSConfigState;
  onNavigate: (view: AppViewId) => void;
  onLaunchLivePreset: (mode: 'first-boot' | 'desktop-plasma') => void;
  onDownloadZip: () => void;
  onSelectDrivePreset: (nominalDriveGb: number, totalUsableGb: number) => void;
}

function ShowcaseImage({
  src,
  alt,
  fallbackTitle,
  className = '',
}: {
  src: string;
  alt: string;
  fallbackTitle: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <div
        className={`flex flex-col items-center justify-center gap-2 border p-8 text-center ${className}`}
        style={{
          backgroundColor: 'var(--os-surface)',
          borderColor: 'var(--os-border)',
        }}
      >
        <Monitor className="h-7 w-7" style={{ color: 'var(--os-muted)' }} aria-hidden="true" />
        <p className="font-mono text-xs" style={{ color: 'var(--os-muted)' }}>
          {fallbackTitle}
        </p>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={className}
    />
  );
}

export function OverviewPage({
  config,
  onNavigate,
  onLaunchLivePreset,
  onDownloadZip,
  onSelectDrivePreset,
}: OverviewPageProps) {
  const partitions = calculatePartitions(config.storage);
  const idleRam = estimateIdleRamMb(config);
  const efiPct = (partitions.efiGb / partitions.totalUsableGb) * 100;
  const squashPct = (partitions.squashfsGb / partitions.totalUsableGb) * 100;
  const persistPct = (partitions.persistenceGb / partitions.totalUsableGb) * 100;
  const exfatPct = Math.max(0, 100 - efiPct - squashPct - persistPct);

  const screenshots = [
    {
      title: 'Plasma 6 Wayland on Start',
      meta: 'Native rounded menus · Graphical System Settings · Floating auto-hide taskbar · Zero GUI buttons',
      src: OS_VISUAL_ASSETS.niriTuiMinimal,
      alt: 'Optimized KDE Plasma 6 Wayland desktop with rounded translucent windows, minimal dark wallpaper, and floating auto-hiding panel',
      cta: 'Open Live Plasma 6 Desktop',
      action: () => onLaunchLivePreset('desktop-plasma'),
    },
    {
      title: 'First-Boot Setup + .exe Prompt',
      meta: 'Wi-Fi check first · Optional Wine Windows .exe support · Latest Nixpkgs',
      src: OS_VISUAL_ASSETS.firstBootTui,
      alt: 'Monolith NixOS first-boot setup wizard with internet setup and Windows .exe Wine selection',
      cta: 'Run First-Boot Wizard',
      action: () => onLaunchLivePreset('first-boot'),
    },
    {
      title: 'Unified Shortcuts & Local RAM Pkgs',
      meta: `Close ${formatHotkeyCombo(config.hotkeys.closeWindow)} · Settings ${formatHotkeyCombo(config.hotkeys.openSettingsTui)} · Local RAM-only project pkgs`,
      src: OS_VISUAL_ASSETS.niriWorkspace,
      alt: 'Optimized Graphical NixOS workspace with Neovim LSP, Konsole, and System Settings in JetBrains Mono',
      cta: 'Customize in Settings',
      action: () => onNavigate('settings'),
    },
  ];

  const driverRows = [
    {
      component: 'USB-A, USB-C & Thunderbolt Ports',
      packages: 'services.udisks2, services.hardware.bolt, Plasma Device Notifier, usbutils',
      coverage: 'Instant graphical & CLI USB automount, serial/MTP devices & Thunderbolt docks',
    },
    {
      component: 'HDMI & DisplayPort + Multi-Monitor',
      packages: 'hardware.graphics, KWin Wayland, kscreen-doctor, services.pipewire',
      coverage: 'Plug-and-play HDMI/DP external displays, graphical Display Settings & HDMI audio routing',
    },
    {
      component: 'Wi-Fi, Ethernet & Bluetooth',
      packages: 'networkmanager (iwd), Plasma Network/BT trays, nmtui, bluez, bluetui',
      coverage: 'Universal Intel, Realtek, Broadcom, Qualcomm, MediaTek & persistent BT pairings',
    },
    {
      component: 'Optimized RAM (< 500 MB) & Optional .exe',
      packages: 'Baloo OFF, KDE bloat excluded, zramSwap, earlyoom, optional wineWowPackages.stable',
      coverage: `~${idleRam.totalIdleMb} MB idle footprint; local project pkgs mount in RAM on-demand & clear on idle`,
    },
  ];

  const rufusSpecs = [
    {
      setting: 'Device',
      value: 'Any 32 GB, 64 GB, 128 GB, 256 GB, 512 GB, or 1 TB+ USB / SSD',
      note: '100% of remaining drive space scales into MONOLITH_PERSIST (LocalSend replaces exFAT)',
    },
    {
      setting: 'Boot selection',
      value: 'monolith-nixos-x86_64.iso',
      note: `Built declaratively from ${config.nixSystem.channel} with latest Nix & zstd SquashFS`,
    },
    { setting: 'Partition scheme', value: 'GPT', note: 'Universal UEFI boot on modern laptops & desktops' },
    { setting: 'Target system', value: 'UEFI (non CSM)', note: 'Fast native UEFI boot (Legacy BIOS also supported)' },
    {
      setting: 'ISOHybrid write prompt',
      value: 'Write in DD Image mode',
      note: 'Preserves MONOLITH_NIX labels & leaves the drive tail clean for auto-scaling',
    },
    {
      setting: 'Universal PC Boot Keys',
      value: 'F12 Dell/Lenovo/Acer · F9 HP · F8 ASUS · F10 Samsung · F11 MSI',
      note: 'Disable Secure Boot once in BIOS, then pick your UEFI USB drive',
    },
  ];

  const driveLabel =
    partitions.nominalDriveGb >= 1024
      ? `${(partitions.nominalDriveGb / 1024).toFixed(partitions.nominalDriveGb % 1024 === 0 ? 0 : 1)} TB`
      : `${partitions.nominalDriveGb} GB`;

  return (
    <div className="mx-auto max-w-[1280px] px-6 pb-24 pt-12 md:pt-16">
      {/* 1. Hero Section — Balanced 2-column split with single primary CTA */}
      <section className="grid grid-cols-1 items-stretch gap-10 lg:grid-cols-12">
        <div className="flex flex-col justify-between gap-8 lg:col-span-6 lg:py-2">
          <div className="space-y-6">
            <p className="font-mono text-xs tracking-wide" style={{ color: 'var(--os-muted)' }}>
              {config.nixSystem.channel} · Latest Nix · Optimized KDE Plasma 6 Wayland · JetBrains Mono
            </p>

            <h1
              className="font-display font-bold tracking-tight"
              style={{
                fontSize: 'clamp(2rem, 3.4vw, 3.15rem)',
                lineHeight: 1.12,
                textWrap: 'balance',
                color: 'var(--os-fg)',
              }}
            >
              Optimized Graphical NixOS on any 32 GB+ USB drive.
            </h1>

            <p className="max-w-[58ch] text-sm leading-relaxed" style={{ color: 'var(--os-muted)' }}>
              Boots straight into an optimized KDE Plasma 6 Wayland desktop with native rounded
              menus, real graphical System Settings, floating auto-hiding panel, unified working
              shortcuts, zero window buttons, and{' '}
              <span className="font-mono tabular-nums" style={{ color: 'var(--os-fg)' }}>
                ~{idleRam.totalIdleMb} MB
              </span>{' '}
              idle RAM (Baloo off, bloat stripped, ZRAM active). Global apps install with a single
              Nix command, while local project packages load into RAM only when needed.
            </p>
          </div>

          <div className="space-y-6">
            <div className="flex flex-wrap items-center gap-4">
              <button
                type="button"
                onClick={() => onLaunchLivePreset('desktop-plasma')}
                className="os-control inline-flex min-h-[44px] items-center gap-2 whitespace-nowrap px-5 py-2.5 text-xs font-semibold transition-opacity duration-150 hover:opacity-90"
                style={{
                  backgroundColor: 'var(--os-accent)',
                  color: 'var(--os-accent-fg)',
                }}
              >
                <span>Open Live Plasma 6 Desktop</span>
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </button>

              <button
                type="button"
                onClick={() => onNavigate('settings')}
                className="os-control inline-flex min-h-[44px] items-center gap-2 whitespace-nowrap border px-5 py-2.5 text-xs font-medium transition-colors duration-150 hover:opacity-90"
                style={{
                  borderColor: 'var(--os-border-strong)',
                  backgroundColor: 'var(--os-surface)',
                  color: 'var(--os-fg)',
                }}
              >
                <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
                <span>Dedicated OS Settings</span>
              </button>
            </div>

            <div
              className="grid grid-cols-3 gap-6 border-t pt-6"
              style={{ borderColor: 'var(--os-border)' }}
            >
              <div>
                <p className="font-mono text-lg font-semibold tabular-nums" style={{ color: 'var(--os-fg)' }}>
                  ~{idleRam.totalIdleMb} MB
                </p>
                <p className="mt-1 text-xs" style={{ color: 'var(--os-muted)' }}>
                  Idle RAM (&lt; 500 MB cap)
                </p>
              </div>
              <div>
                <p className="font-mono text-lg font-semibold tabular-nums" style={{ color: 'var(--os-fg)' }}>
                  {partitions.persistenceGb.toFixed(1)} GB
                </p>
                <p className="mt-1 text-xs" style={{ color: 'var(--os-muted)' }}>
                  {partitions.persistencePercent}% on {driveLabel} USB
                </p>
              </div>
              <div>
                <p className="font-mono text-lg font-semibold tabular-nums" style={{ color: 'var(--os-fg)' }}>
                  0 Buttons
                </p>
                <p className="mt-1 text-xs" style={{ color: 'var(--os-muted)' }}>
                  Keyboard-only windows
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="lg:col-span-6">
          <div
            className="os-card h-full overflow-hidden border"
            style={{
              borderColor: 'var(--os-border)',
              backgroundColor: 'var(--os-surface)',
            }}
          >
            <ShowcaseImage
              src={OS_VISUAL_ASSETS.heroHardware}
              alt="Minimal dark laptop running Monolith NixOS with a portable USB drive plugged into its side port"
              fallbackTitle="Monolith NixOS Portable USB Hardware"
              className="h-full min-h-[300px] w-full object-cover"
            />
          </div>
        </div>
      </section>

      {/* 2. 100% USB Persistence Partition Map & Universal Hardware Matrix */}
      <section className="mt-20 border-t pt-14" style={{ borderColor: 'var(--os-border)' }}>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="max-w-2xl space-y-2">
            <h2
              className="font-display text-xl font-bold tracking-[-0.015em] [text-wrap:balance] md:text-2xl"
              style={{ color: 'var(--os-fg)' }}
            >
              100% USB persistence (no exFAT waste) &amp; full hardware support
            </h2>
            <p className="text-xs leading-relaxed" style={{ color: 'var(--os-muted)' }}>
              Because <strong style={{ color: 'var(--os-fg)' }}>LocalSend</strong> handles wireless
              file transfers to Windows, macOS, and phones, the optional exFAT transfer partition is
              now <strong style={{ color: 'var(--os-fg)' }}>OFF by default</strong> — reclaiming
              every spare gigabyte into{' '}
              <code className="font-mono" style={{ color: 'var(--os-fg)' }}>
                {config.storage.persistLabel}
              </code>{' '}
              (ext4).
            </p>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('settings')}
            className="inline-flex min-h-[40px] items-center gap-2 whitespace-nowrap text-xs font-medium transition-opacity hover:opacity-80"
            style={{ color: 'var(--os-accent)' }}
          >
            <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
            <span>Configure Storage &amp; Ports</span>
          </button>
        </div>

        {/* Live Partition Allocation Bar */}
        <div
          className="os-card mt-8 border p-6"
          style={{
            borderColor: 'var(--os-border)',
            backgroundColor: 'var(--os-surface)',
          }}
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <HardDrive className="h-4 w-4" style={{ color: 'var(--os-accent)' }} aria-hidden="true" />
              <span className="font-mono text-xs font-medium" style={{ color: 'var(--os-fg)' }}>
                {driveLabel} Portable USB / SSD ({partitions.totalUsableGb.toFixed(2)} GB Usable)
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Simulate USB drive capacity">
              {DRIVE_PRESETS.map((preset) => {
                const active = config.storage.nominalDriveGb === preset.nominalGb;
                return (
                  <button
                    key={preset.nominalGb}
                    type="button"
                    onClick={() => onSelectDrivePreset(preset.nominalGb, preset.usableGb)}
                    aria-pressed={active}
                    className="os-control min-h-[30px] border px-2.5 font-mono text-[11px] font-medium transition-colors"
                    style={{
                      borderColor: active ? 'var(--os-accent)' : 'var(--os-border-strong)',
                      backgroundColor: active ? 'var(--os-accent)' : 'var(--os-bg)',
                      color: active ? 'var(--os-accent-fg)' : 'var(--os-muted)',
                    }}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div
            className="os-control mt-4 flex h-9 w-full overflow-hidden border font-mono text-[11px]"
            style={{ borderColor: 'var(--os-border-strong)' }}
            role="img"
            aria-label={`USB drive layout: EFI ${partitions.efiGb} GB, NixOS SquashFS ${partitions.squashfsGb} GB, Persistence ${partitions.persistenceGb} GB`}
          >
            <div
              style={{ width: `${efiPct}%`, backgroundColor: '#27272A', color: '#E4E4E7' }}
              className="flex items-center justify-center overflow-hidden border-r border-black/40 px-1"
              title={`EFI Boot: ${partitions.efiGb.toFixed(2)} GB`}
            >
              <span className="truncate">EFI</span>
            </div>
            <div
              style={{ width: `${squashPct}%`, backgroundColor: '#1E293B', color: '#E2E8F0' }}
              className="flex items-center justify-center overflow-hidden border-r border-black/40 px-2"
              title={`NixOS SquashFS: ${partitions.squashfsGb.toFixed(2)} GB`}
            >
              <span className="truncate">NixOS {partitions.squashfsGb.toFixed(1)}G</span>
            </div>
            <div
              style={{
                width: `${persistPct}%`,
                backgroundColor: 'var(--os-accent)',
                color: 'var(--os-accent-fg)',
              }}
              className="flex items-center justify-center overflow-hidden px-2 font-semibold"
              title={`Persistence (${config.storage.persistLabel}): ${partitions.persistenceGb.toFixed(2)} GB`}
            >
              <span className="truncate">
                {config.storage.persistLabel} ({partitions.persistenceGb.toFixed(2)} GB · {partitions.persistencePercent}%)
              </span>
            </div>
            {partitions.exfatTransferGb > 0 && (
              <div
                style={{ width: `${exfatPct}%`, backgroundColor: '#18181B', color: '#A1A1AA' }}
                className="flex items-center justify-center overflow-hidden border-l border-black/40 px-2"
                title={`Optional exFAT Transfer: ${partitions.exfatTransferGb.toFixed(2)} GB`}
              >
                <span className="truncate">exFAT ({partitions.exfatTransferGb.toFixed(2)} GB)</span>
              </div>
            )}
          </div>

          <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <p className="font-mono text-xs tabular-nums" style={{ color: 'var(--os-fg)' }}>
                {partitions.efiGb.toFixed(2)} GB · FAT32
              </p>
              <p className="mt-0.5 text-xs" style={{ color: 'var(--os-muted)' }}>
                UEFI systemd-boot loader
              </p>
            </div>
            <div>
              <p className="font-mono text-xs tabular-nums" style={{ color: 'var(--os-fg)' }}>
                {partitions.squashfsGb.toFixed(2)} GB · SquashFS
              </p>
              <p className="mt-0.5 text-xs" style={{ color: 'var(--os-muted)' }}>
                {config.nixSystem.channel} Plasma 6 Wayland, drivers, tools
              </p>
            </div>
            <div>
              <p className="font-mono text-xs tabular-nums" style={{ color: 'var(--os-accent)' }}>
                {partitions.persistenceGb.toFixed(2)} GB · ext4 ({partitions.persistencePercent}%)
              </p>
              <p className="mt-0.5 text-xs" style={{ color: 'var(--os-muted)' }}>
                Full /home, projects, global pkgs (LocalSend handles sharing)
              </p>
            </div>
          </div>
        </div>

        {/* Hardware & Ports Coverage Table */}
        <div
          className="os-card mt-6 overflow-x-auto border"
          style={{
            borderColor: 'var(--os-border)',
            backgroundColor: 'var(--os-surface)',
          }}
        >
          <table className="w-full min-w-[640px] border-collapse text-left text-xs">
            <thead>
              <tr className="border-b" style={{ borderColor: 'var(--os-border)' }}>
                <th className="px-5 py-3.5 font-semibold" style={{ color: 'var(--os-muted)' }}>
                  Hardware &amp; Runtime Subsystem
                </th>
                <th className="px-5 py-3.5 font-semibold" style={{ color: 'var(--os-muted)' }}>
                  NixOS Modules &amp; Packages
                </th>
                <th className="px-5 py-3.5 font-semibold" style={{ color: 'var(--os-muted)' }}>
                  Behavior
                </th>
              </tr>
            </thead>
            <tbody>
              {driverRows.map((row, idx) => (
                <tr
                  key={row.component}
                  className={idx < driverRows.length - 1 ? 'border-b' : ''}
                  style={{ borderColor: 'var(--os-border)' }}
                >
                  <td className="px-5 py-3.5 font-medium" style={{ color: 'var(--os-fg)' }}>
                    {row.component}
                  </td>
                  <td className="px-5 py-3.5 font-mono text-[11px]" style={{ color: 'var(--os-accent)' }}>
                    {row.packages}
                  </td>
                  <td className="px-5 py-3.5" style={{ color: 'var(--os-muted)' }}>
                    {row.coverage}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* 3. Core Capabilities — Niri-Only Architecture */}
      <section className="mt-20 border-t pt-14" style={{ borderColor: 'var(--os-border)' }}>
        <div className="max-w-2xl space-y-2">
          <h2
            className="font-display text-xl font-bold tracking-[-0.015em] [text-wrap:balance] md:text-2xl"
            style={{ color: 'var(--os-fg)' }}
          >
            Built for keyboard speed, unified TUI aesthetics, and low RAM
          </h2>
          <p className="text-xs leading-relaxed" style={{ color: 'var(--os-muted)' }}>
            Every surface shares your active theme, JetBrains Mono font, and configurable corner
            radius — with zero window chrome clutter.
          </p>
        </div>

        <div className="mt-8 grid grid-cols-1 gap-5 md:grid-cols-6">
          <article
            className="os-card flex flex-col justify-between border p-6 md:col-span-3"
            style={{
              borderColor: 'var(--os-border)',
              backgroundColor: 'var(--os-surface)',
            }}
          >
            <div>
              <p className="font-mono text-[11px]" style={{ color: 'var(--os-muted)' }}>
                01. Optimized KDE Plasma 6 Wayland + Rounded Menus
              </p>
              <h3 className="mt-2 font-display text-base font-semibold" style={{ color: 'var(--os-fg)' }}>
                Native graphical Settings, floating auto-hide panel &amp; zero window buttons
              </h3>
              <p className="mt-2 text-xs leading-relaxed" style={{ color: 'var(--os-muted)' }}>
                Auto-boots straight into KDE Plasma 6 Wayland with native rounded Breeze Dark menus,
                real graphical System Settings (<code style={{ color: 'var(--os-fg)' }}>Super + ,</code>),
                and one unified <code style={{ color: 'var(--os-fg)' }}>kglobalshortcutsrc</code> shortcut
                table — no broken or duplicate menus. Window titlebar buttons stay stripped via KWin.
              </p>
            </div>
            <p className="mt-5 font-mono text-[11px]" style={{ color: 'var(--os-accent)' }}>
              {formatHotkeyCombo(config.hotkeys.closeWindow)} Close · {formatHotkeyCombo(config.hotkeys.openSettingsTui)} System Settings · {formatHotkeyCombo(config.hotkeys.shortcutSearch)} Shortcuts
            </p>
          </article>

          <article
            className="os-card flex flex-col justify-between border p-6 md:col-span-3"
            style={{
              borderColor: 'var(--os-border)',
              backgroundColor: 'var(--os-surface)',
            }}
          >
            <div>
              <p className="font-mono text-[11px]" style={{ color: 'var(--os-muted)' }}>
                02. Global Nix Pkgs &amp; RAM-Only Local Project Pkgs
              </p>
              <h3 className="mt-2 font-display text-base font-semibold" style={{ color: 'var(--os-fg)' }}>
                Local packages load into RAM only when needed
              </h3>
              <p className="mt-2 text-xs leading-relaxed" style={{ color: 'var(--os-muted)' }}>
                Install global apps anytime with{' '}
                <code style={{ color: 'var(--os-fg)' }}>monolith-pkg install &lt;pkg&gt;</code>.
                Project-specific packages stay isolated in each project&apos;s{' '}
                <code style={{ color: 'var(--os-fg)' }}>flake.nix</code>, mount into RAM tmpfs
                only while working inside that folder, and clear automatically when idle.
              </p>
            </div>
            <p className="mt-5 font-mono text-[11px]" style={{ color: 'var(--os-accent)' }}>
              {formatHotkeyCombo(config.hotkeys.newProject)} · New Project with local packages
            </p>
          </article>

          <article
            className="os-card flex flex-col justify-between border p-6 md:col-span-2"
            style={{
              borderColor: 'var(--os-border)',
              backgroundColor: 'var(--os-surface)',
            }}
          >
            <div>
              <p className="font-mono text-[11px]" style={{ color: 'var(--os-muted)' }}>
                03. TUI-First &amp; Screensaver
              </p>
              <h3 className="mt-2 font-display text-base font-semibold" style={{ color: 'var(--os-fg)' }}>
                Unified theme across every TUI
              </h3>
              <p className="mt-2 text-xs leading-relaxed" style={{ color: 'var(--os-muted)' }}>
                Settings, Bluetooth, Hardware, Neovim, Yazi, btop, and the animated TUI screensaver
                all inherit your active theme, JetBrains Mono font, and opacity automatically.
              </p>
            </div>
          </article>

          <article
            className="os-card flex flex-col justify-between border p-6 md:col-span-2"
            style={{
              borderColor: 'var(--os-border)',
              backgroundColor: 'var(--os-surface)',
            }}
          >
            <div>
              <p className="font-mono text-[11px]" style={{ color: 'var(--os-muted)' }}>
                04. Optional Windows .exe
              </p>
              <h3 className="mt-2 font-display text-base font-semibold" style={{ color: 'var(--os-fg)' }}>
                Prompted cleanly on first boot
              </h3>
              <p className="mt-2 text-xs leading-relaxed" style={{ color: 'var(--os-muted)' }}>
                During OS setup, Monolith asks if you want to run Windows{' '}
                <code style={{ color: 'var(--os-fg)' }}>.exe</code> apps — installing{' '}
                <code style={{ color: 'var(--os-fg)' }}>wineWowPackages.stable</code> + Winetricks
                only when requested.
              </p>
            </div>
          </article>

          <article
            className="os-card flex flex-col justify-between border p-6 md:col-span-2"
            style={{
              borderColor: 'var(--os-border)',
              backgroundColor: 'var(--os-surface)',
            }}
          >
            <div>
              <p className="font-mono text-[11px]" style={{ color: 'var(--os-muted)' }}>
                05. Clean Project Reset
              </p>
              <h3 className="mt-2 font-display text-base font-semibold" style={{ color: 'var(--os-fg)' }}>
                Reset repos without losing keys
              </h3>
              <p className="mt-2 text-xs leading-relaxed" style={{ color: 'var(--os-muted)' }}>
                Keep Wi-Fi, Bluetooth, SSH keys, theme, wallpaper, and custom shortcuts intact while
                clearing project folders and build caches between repositories.
              </p>
            </div>
          </article>
        </div>
      </section>

      {/* 4. Visual Showcase */}
      <section className="mt-20 border-t pt-14" style={{ borderColor: 'var(--os-border)' }}>
        <div className="max-w-2xl space-y-2">
          <h2 className="font-display text-xl font-bold tracking-tight md:text-2xl" style={{ color: 'var(--os-fg)' }}>
            Interface showcase
          </h2>
          <p className="text-xs leading-relaxed" style={{ color: 'var(--os-muted)' }}>
            Jump straight into the interactive KDE Plasma 6 Wayland desktop preview with native
            graphical System Settings, run the first-boot Windows .exe wizard, or tune every visual
            token in Settings Studio.
          </p>
        </div>

        <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-3">
          {screenshots.map((shot) => (
            <div
              key={shot.title}
              className="os-card flex flex-col overflow-hidden border"
              style={{
                borderColor: 'var(--os-border)',
                backgroundColor: 'var(--os-surface)',
              }}
            >
              <div className="aspect-video w-full overflow-hidden border-b" style={{ borderColor: 'var(--os-border)' }}>
                <ShowcaseImage
                  src={shot.src}
                  alt={shot.alt}
                  fallbackTitle={shot.title}
                  className="h-full w-full object-cover"
                />
              </div>
              <div className="flex flex-1 flex-col justify-between gap-4 p-5">
                <div>
                  <h3 className="font-display text-sm font-semibold" style={{ color: 'var(--os-fg)' }}>
                    {shot.title}
                  </h3>
                  <p className="mt-1 font-mono text-[11px] leading-relaxed" style={{ color: 'var(--os-muted)' }}>
                    {shot.meta}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={shot.action}
                  className="inline-flex min-h-[38px] w-fit items-center gap-1.5 text-xs font-semibold transition-opacity hover:opacity-80"
                  style={{ color: 'var(--os-accent)' }}
                >
                  <span>{shot.cta}</span>
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* 5. Automated GitHub Actions ISO Pipeline + Rufus Guide */}
      <section className="mt-20 border-t pt-14" style={{ borderColor: 'var(--os-border)' }}>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="max-w-2xl space-y-2">
            <h2 className="font-display text-xl font-bold tracking-tight md:text-2xl" style={{ color: 'var(--os-fg)' }}>
              Build in GitHub Actions, flash on Windows with Rufus
            </h2>
            <p className="text-xs leading-relaxed" style={{ color: 'var(--os-muted)' }}>
              Push the 5-file NixOS Flake repo to{' '}
              <code className="font-mono" style={{ color: 'var(--os-fg)' }}>main</code>, download
              your compiled ISO from GitHub Releases, and write it in Rufus DD Image mode.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => onNavigate('source')}
              className="os-control inline-flex min-h-[42px] items-center gap-2 whitespace-nowrap border px-4 py-2 text-xs font-medium"
              style={{
                borderColor: 'var(--os-border-strong)',
                backgroundColor: 'var(--os-surface)',
                color: 'var(--os-fg)',
              }}
            >
              <Terminal className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Inspect Flake &amp; CI</span>
            </button>
            <button
              type="button"
              onClick={onDownloadZip}
              className="os-control inline-flex min-h-[42px] items-center gap-2 whitespace-nowrap px-4 py-2 text-xs font-semibold transition-opacity hover:opacity-90"
              style={{
                backgroundColor: 'var(--os-accent)',
                color: 'var(--os-accent-fg)',
              }}
            >
              <Download className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Download Repo (.zip)</span>
            </button>
          </div>
        </div>

        {/* Rufus Settings Reference Table */}
        <div
          className="os-card mt-8 overflow-x-auto border"
          style={{
            borderColor: 'var(--os-border)',
            backgroundColor: 'var(--os-surface)',
          }}
        >
          <div className="border-b px-5 py-4" style={{ borderColor: 'var(--os-border)' }}>
            <h3 className="font-display text-sm font-semibold" style={{ color: 'var(--os-fg)' }}>
              Exact Rufus Configuration ({driveLabel} USB Preview)
            </h3>
            <p className="mt-1 text-xs" style={{ color: 'var(--os-muted)' }}>
              DD Image mode leaves{' '}
              <span className="font-mono tabular-nums" style={{ color: 'var(--os-fg)' }}>
                {(partitions.totalUsableGb - partitions.efiGb - partitions.squashfsGb).toFixed(2)} GB
              </span>{' '}
              clean at the tail so <code className="font-mono">monolith-persist-usb</code> allocates{' '}
              {partitions.persistenceGb.toFixed(2)} GB ({partitions.persistencePercent}%) to{' '}
              <code className="font-mono">{config.storage.persistLabel}</code>.
            </p>
          </div>
          <table className="w-full min-w-[600px] border-collapse text-left text-xs">
            <tbody>
              {rufusSpecs.map((row, idx) => (
                <tr
                  key={row.setting}
                  className={idx < rufusSpecs.length - 1 ? 'border-b' : ''}
                  style={{ borderColor: 'var(--os-border)' }}
                >
                  <td className="w-56 px-5 py-3 font-medium" style={{ color: 'var(--os-muted)' }}>
                    {row.setting}
                  </td>
                  <td className="px-5 py-3 font-mono font-semibold" style={{ color: 'var(--os-fg)' }}>
                    {row.value}
                  </td>
                  <td className="px-5 py-3" style={{ color: 'var(--os-muted)' }}>
                    {row.note}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Quiet Footer */}
      <footer
        className="mt-20 flex flex-wrap items-center justify-between gap-4 border-t pt-8 text-xs"
        style={{
          borderColor: 'var(--os-border)',
          color: 'var(--os-muted)',
        }}
      >
        <span className="font-display font-semibold" style={{ color: 'var(--os-fg)' }}>
          Monolith NixOS · Optimized Plasma 6 Wayland
        </span>
        <div className="flex flex-wrap items-center gap-6">
          <button type="button" onClick={() => onNavigate('live-os')} className="hover:underline">
            Live OS Preview
          </button>
          <button type="button" onClick={() => onNavigate('settings')} className="hover:underline">
            OS Settings
          </button>
          <button type="button" onClick={() => onNavigate('source')} className="hover:underline">
            NixOS Flake &amp; Actions
          </button>
        </div>
      </footer>
    </div>
  );
}

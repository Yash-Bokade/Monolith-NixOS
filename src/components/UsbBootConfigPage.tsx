import { useMemo, useState } from 'react';
import {
  Check,
  Copy,
  Download,
  Eye,
  EyeOff,
  FileCode2,
  HardDrive,
  RotateCcw,
  Terminal,
} from 'lucide-react';
import { NIX_CHANNELS, TOOLCHAIN_CATALOG } from '../lib/osDefaults';
import type { NixChannelId, OSConfigState, UsbBootConfig } from '../lib/types';
import {
  KEYMAP_OPTIONS,
  TIMEZONE_OPTIONS,
  createDefaultUsbBootConfig,
  generateUsbBootConf,
  generateWindowsDropHelperBat,
  validateUsbBootConfig,
} from '../lib/usbBootConfig';

interface UsbBootConfigPageProps {
  config: OSConfigState;
}

export function UsbBootConfigPage({ config }: UsbBootConfigPageProps) {
  const [bootConfig, setBootConfig] = useState<UsbBootConfig>(() =>
    createDefaultUsbBootConfig(config),
  );
  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [showWifiPassword, setShowWifiPassword] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);
  const [downloadNotice, setDownloadNotice] = useState<string | null>(null);

  const validation = useMemo(() => validateUsbBootConfig(bootConfig), [bootConfig]);
  const generatedConf = useMemo(() => generateUsbBootConf(bootConfig), [bootConfig]);

  const updateField = <K extends keyof UsbBootConfig>(key: K, value: UsbBootConfig[K]) => {
    setBootConfig((prev) => ({ ...prev, [key]: value }));
  };

  const toggleStack = (stackId: string) => {
    setBootConfig((prev) => {
      const exists = prev.preinstallStacks.includes(stackId);
      return {
        ...prev,
        preinstallStacks: exists
          ? prev.preinstallStacks.filter((id) => id !== stackId)
          : [...prev.preinstallStacks, stackId],
      };
    });
  };

  const updateStackVersion = (stackId: string, version: string) => {
    setBootConfig((prev) => ({
      ...prev,
      stackVersions: {
        ...prev.stackVersions,
        [stackId]: version,
      },
    }));
  };

  const triggerDownload = (filename: string, content: string, notice: string) => {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
    setDownloadNotice(notice);
    window.setTimeout(() => setDownloadNotice(null), 3500);
  };

  const handleDownloadConf = () => {
    if (!validation.isValid) return;
    triggerDownload(
      'monolith-boot.conf',
      generatedConf,
      'Downloaded monolith-boot.conf — copy it to your flashed USB pendrive after Rufus finishes.',
    );
  };

  const handleDownloadBat = () => {
    triggerDownload(
      'copy-to-monolith-usb.bat',
      generateWindowsDropHelperBat(),
      'Downloaded copy-to-monolith-usb.bat — keep it beside monolith-boot.conf and double-click on Windows.',
    );
  };

  const handleCopyConf = async () => {
    try {
      await navigator.clipboard.writeText(generatedConf);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Ignore clipboard failures
    }
  };

  const handleReset = () => {
    setBootConfig(createDefaultUsbBootConfig(config));
    setDownloadNotice('Reset USB boot override config to defaults.');
    window.setTimeout(() => setDownloadNotice(null), 2500);
  };

  return (
    <div className="mx-auto max-w-[1280px] px-6 pb-24 pt-10">
      {/* Page Header */}
      <div
        className="flex flex-wrap items-end justify-between gap-4 border-b pb-6"
        style={{ borderColor: 'var(--os-border)' }}
      >
        <div className="max-w-2xl">
          <h1
            className="font-display text-xl font-bold tracking-[-0.015em] md:text-2xl"
            style={{ color: 'var(--os-fg)' }}
          >
            Post-Rufus USB First-Boot Config
          </h1>
          <p className="mt-1.5 text-xs leading-relaxed" style={{ color: 'var(--os-muted)' }}>
            Customize credentials, Wi-Fi, Git identity, Windows .exe Wine support, and Nix channel
            without rebuilding the ISO. Drop{' '}
            <code className="font-mono" style={{ color: 'var(--os-fg)' }}>
              monolith-boot.conf
            </code>{' '}
            onto your flashed USB drive after Rufus finishes — Monolith NixOS applies it before
            KDE Plasma 6 Wayland launches.
          </p>
        </div>

        <button
          type="button"
          onClick={handleReset}
          className="os-control inline-flex min-h-[40px] items-center gap-2 border px-3.5 text-xs font-medium transition-colors hover:opacity-90"
          style={{
            borderColor: 'var(--os-border-strong)',
            backgroundColor: 'var(--os-surface)',
            color: 'var(--os-fg)',
          }}
        >
          <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Reset Defaults</span>
        </button>
      </div>

      {downloadNotice && (
        <div
          role="status"
          aria-live="polite"
          className="os-card mt-6 border px-4 py-3 font-mono text-xs"
          style={{
            borderColor: 'var(--os-accent)',
            backgroundColor: 'var(--os-surface)',
            color: 'var(--os-fg)',
          }}
        >
          {downloadNotice}
        </div>
      )}

      {/* Main 2-Column Builder + Live Output */}
      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="space-y-6 lg:col-span-7">
          {/* Card 1: Account & System Identity */}
          <section
            aria-labelledby="usb-account-heading"
            className="os-card border p-6"
            style={{
              borderColor: 'var(--os-border)',
              backgroundColor: 'var(--os-surface)',
            }}
          >
            <h2
              id="usb-account-heading"
              className="font-display text-sm font-semibold"
              style={{ color: 'var(--os-fg)' }}
            >
              Account, Plasma 6 Wayland &amp; Nix Channel
            </h2>
            <p className="mt-1 text-xs" style={{ color: 'var(--os-muted)' }}>
              Applied on boot before KDE Plasma 6 Wayland starts. Stored securely at{' '}
              <code className="font-mono">/persist/monolith-boot.conf</code> (chmod 600).
            </p>

            <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label
                  htmlFor="usb-username"
                  className="block font-mono text-xs font-medium"
                  style={{ color: 'var(--os-fg)' }}
                >
                  Login Username
                </label>
                <input
                  id="usb-username"
                  type="text"
                  autoComplete="off"
                  value={bootConfig.username}
                  onChange={(e) => updateField('username', e.target.value)}
                  placeholder="dev"
                  className="os-control mt-1.5 min-h-[40px] w-full border px-3 py-2 font-mono text-xs focus:outline-none"
                  style={{
                    borderColor: validation.errors.username ? '#ef4444' : 'var(--os-border-strong)',
                    backgroundColor: 'var(--os-bg)',
                    color: 'var(--os-fg)',
                  }}
                />
                {validation.errors.username && (
                  <p role="alert" className="mt-1 font-mono text-[11px] text-red-400">
                    {validation.errors.username}
                  </p>
                )}
              </div>

              <div>
                <label
                  htmlFor="usb-password"
                  className="block font-mono text-xs font-medium"
                  style={{ color: 'var(--os-fg)' }}
                >
                  Login &amp; Sudo Password
                </label>
                <div className="relative mt-1.5">
                  <input
                    id="usb-password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    value={bootConfig.password}
                    onChange={(e) => updateField('password', e.target.value)}
                    placeholder="monolith"
                    className="os-control min-h-[40px] w-full border py-2 pl-3 pr-10 font-mono text-xs focus:outline-none"
                    style={{
                      borderColor: validation.errors.password ? '#ef4444' : 'var(--os-border-strong)',
                      backgroundColor: 'var(--os-bg)',
                      color: 'var(--os-fg)',
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((prev) => !prev)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    className="absolute inset-y-0 right-0 flex w-10 items-center justify-center"
                    style={{ color: 'var(--os-muted)' }}
                  >
                    {showPassword ? (
                      <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />
                    ) : (
                      <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                    )}
                  </button>
                </div>
                {validation.errors.password && (
                  <p role="alert" className="mt-1 font-mono text-[11px] text-red-400">
                    {validation.errors.password}
                  </p>
                )}
              </div>

              <div>
                <label
                  htmlFor="usb-hostname"
                  className="block font-mono text-xs font-medium"
                  style={{ color: 'var(--os-fg)' }}
                >
                  Machine Hostname
                </label>
                <input
                  id="usb-hostname"
                  type="text"
                  value={bootConfig.hostname}
                  onChange={(e) => updateField('hostname', e.target.value)}
                  placeholder="monolith-usb"
                  className="os-control mt-1.5 min-h-[40px] w-full border px-3 py-2 font-mono text-xs focus:outline-none"
                  style={{
                    borderColor: validation.errors.hostname ? '#ef4444' : 'var(--os-border-strong)',
                    backgroundColor: 'var(--os-bg)',
                    color: 'var(--os-fg)',
                  }}
                />
                {validation.errors.hostname && (
                  <p role="alert" className="mt-1 font-mono text-[11px] text-red-400">
                    {validation.errors.hostname}
                  </p>
                )}
              </div>

              <div>
                <label
                  htmlFor="usb-timezone"
                  className="block font-mono text-xs font-medium"
                  style={{ color: 'var(--os-fg)' }}
                >
                  Timezone
                </label>
                <select
                  id="usb-timezone"
                  value={bootConfig.timezone}
                  onChange={(e) => updateField('timezone', e.target.value)}
                  className="os-control mt-1.5 min-h-[40px] w-full border px-3 py-2 font-mono text-xs focus:outline-none"
                  style={{
                    borderColor: 'var(--os-border-strong)',
                    backgroundColor: 'var(--os-bg)',
                    color: 'var(--os-fg)',
                  }}
                >
                  {TIMEZONE_OPTIONS.map((tz) => (
                    <option key={tz} value={tz}>
                      {tz}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label
                  htmlFor="usb-keymap"
                  className="block font-mono text-xs font-medium"
                  style={{ color: 'var(--os-fg)' }}
                >
                  Keyboard Layout
                </label>
                <select
                  id="usb-keymap"
                  value={bootConfig.keymap}
                  onChange={(e) => updateField('keymap', e.target.value)}
                  className="os-control mt-1.5 min-h-[40px] w-full border px-3 py-2 font-mono text-xs focus:outline-none"
                  style={{
                    borderColor: 'var(--os-border-strong)',
                    backgroundColor: 'var(--os-bg)',
                    color: 'var(--os-fg)',
                  }}
                >
                  {KEYMAP_OPTIONS.map((km) => (
                    <option key={km.code} value={km.code}>
                      {km.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label
                  htmlFor="usb-nix-channel"
                  className="block font-mono text-xs font-medium"
                  style={{ color: 'var(--os-fg)' }}
                >
                  NixOS Channel (Optimized Plasma 6 Wayland)
                </label>
                <select
                  id="usb-nix-channel"
                  value={bootConfig.nixChannel}
                  onChange={(e) => updateField('nixChannel', e.target.value as NixChannelId)}
                  className="os-control mt-1.5 min-h-[40px] w-full border px-3 py-2 font-mono text-xs focus:outline-none"
                  style={{
                    borderColor: 'var(--os-border-strong)',
                    backgroundColor: 'var(--os-bg)',
                    color: 'var(--os-fg)',
                  }}
                >
                  {NIX_CHANNELS.map((ch) => (
                    <option key={ch.id} value={ch.id}>
                      {ch.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="mt-5 border-t pt-4" style={{ borderColor: 'var(--os-border)' }}>
              <label htmlFor="usb-windows-exe" className="flex cursor-pointer items-start gap-3">
                <input
                  id="usb-windows-exe"
                  type="checkbox"
                  checked={bootConfig.windowsExeSupport}
                  onChange={(e) => updateField('windowsExeSupport', e.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-sky-400"
                />
                <span>
                  <span className="block font-mono text-xs font-medium" style={{ color: 'var(--os-fg)' }}>
                    Enable Windows (.exe) App Execution (Wine + Winetricks)
                  </span>
                  <span className="block text-xs" style={{ color: 'var(--os-muted)' }}>
                    Pre-answers the first-boot Windows .exe prompt and installs{' '}
                    <code className="font-mono">wineWowPackages.stable</code> +{' '}
                    <code className="font-mono">monolith-exe</code>.
                  </span>
                </span>
              </label>
            </div>
          </section>

          {/* Card 2: Pre-Configured Wi-Fi & Git Identity */}
          <section
            aria-labelledby="usb-network-heading"
            className="os-card border p-6"
            style={{
              borderColor: 'var(--os-border)',
              backgroundColor: 'var(--os-surface)',
            }}
          >
            <h2
              id="usb-network-heading"
              className="font-display text-sm font-semibold"
              style={{ color: 'var(--os-fg)' }}
            >
              Pre-Configured Wi-Fi &amp; Git Identity
            </h2>
            <p className="mt-1 text-xs" style={{ color: 'var(--os-muted)' }}>
              Optional. Auto-connects Wi-Fi via NetworkManager + iwd and writes{' '}
              <code className="font-mono">~/.gitconfig</code> on {config.storage.persistLabel}.
            </p>

            <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label
                  htmlFor="usb-wifi-ssid"
                  className="block font-mono text-xs font-medium"
                  style={{ color: 'var(--os-fg)' }}
                >
                  Wi-Fi Network Name (SSID)
                </label>
                <input
                  id="usb-wifi-ssid"
                  type="text"
                  value={bootConfig.wifiSsid}
                  onChange={(e) => updateField('wifiSsid', e.target.value)}
                  placeholder="Optional (e.g. Home-5G)"
                  className="os-control mt-1.5 min-h-[40px] w-full border px-3 py-2 font-mono text-xs focus:outline-none"
                  style={{
                    borderColor: 'var(--os-border-strong)',
                    backgroundColor: 'var(--os-bg)',
                    color: 'var(--os-fg)',
                  }}
                />
              </div>

              <div>
                <label
                  htmlFor="usb-wifi-psk"
                  className="block font-mono text-xs font-medium"
                  style={{ color: 'var(--os-fg)' }}
                >
                  Wi-Fi Password
                </label>
                <div className="relative mt-1.5">
                  <input
                    id="usb-wifi-psk"
                    type={showWifiPassword ? 'text' : 'password'}
                    autoComplete="off"
                    value={bootConfig.wifiPassword}
                    onChange={(e) => updateField('wifiPassword', e.target.value)}
                    placeholder="Leave blank for open network"
                    className="os-control min-h-[40px] w-full border py-2 pl-3 pr-10 font-mono text-xs focus:outline-none"
                    style={{
                      borderColor: 'var(--os-border-strong)',
                      backgroundColor: 'var(--os-bg)',
                      color: 'var(--os-fg)',
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowWifiPassword((prev) => !prev)}
                    aria-label={showWifiPassword ? 'Hide Wi-Fi password' : 'Show Wi-Fi password'}
                    className="absolute inset-y-0 right-0 flex w-10 items-center justify-center"
                    style={{ color: 'var(--os-muted)' }}
                  >
                    {showWifiPassword ? (
                      <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />
                    ) : (
                      <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                    )}
                  </button>
                </div>
              </div>

              <div>
                <label
                  htmlFor="usb-git-name"
                  className="block font-mono text-xs font-medium"
                  style={{ color: 'var(--os-fg)' }}
                >
                  Git User Name
                </label>
                <input
                  id="usb-git-name"
                  type="text"
                  value={bootConfig.gitName}
                  onChange={(e) => updateField('gitName', e.target.value)}
                  placeholder="Optional"
                  className="os-control mt-1.5 min-h-[40px] w-full border px-3 py-2 font-mono text-xs focus:outline-none"
                  style={{
                    borderColor: 'var(--os-border-strong)',
                    backgroundColor: 'var(--os-bg)',
                    color: 'var(--os-fg)',
                  }}
                />
              </div>

              <div>
                <label
                  htmlFor="usb-git-email"
                  className="block font-mono text-xs font-medium"
                  style={{ color: 'var(--os-fg)' }}
                >
                  Git User Email
                </label>
                <input
                  id="usb-git-email"
                  type="email"
                  value={bootConfig.gitEmail}
                  onChange={(e) => updateField('gitEmail', e.target.value)}
                  placeholder="Optional"
                  className="os-control mt-1.5 min-h-[40px] w-full border px-3 py-2 font-mono text-xs focus:outline-none"
                  style={{
                    borderColor: 'var(--os-border-strong)',
                    backgroundColor: 'var(--os-bg)',
                    color: 'var(--os-fg)',
                  }}
                />
              </div>
            </div>
          </section>

          {/* Card 3: Optional Global First-Boot Toolchains & Auto-Update */}
          <section
            aria-labelledby="usb-automation-heading"
            className="os-card border p-6"
            style={{
              borderColor: 'var(--os-border)',
              backgroundColor: 'var(--os-surface)',
            }}
          >
            <h2
              id="usb-automation-heading"
              className="font-display text-sm font-semibold"
              style={{ color: 'var(--os-fg)' }}
            >
              Optional Global Toolchains &amp; Auto-Update
            </h2>
            <p className="mt-1 text-xs" style={{ color: 'var(--os-muted)' }}>
              Pre-select global language toolchains (or leave unchecked to keep packages strictly
              local per project via <code className="font-mono">monolith-new-project</code>).
            </p>

            <div className="mt-5 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              {TOOLCHAIN_CATALOG.map((stack) => {
                const selected = bootConfig.preinstallStacks.includes(stack.id);
                const chosenVer = bootConfig.stackVersions[stack.id] ?? stack.defaultVersion;
                return (
                  <div
                    key={stack.id}
                    className="os-control flex flex-col justify-between gap-2 border p-3 transition-colors"
                    style={{
                      borderColor: selected ? 'var(--os-accent)' : 'var(--os-border)',
                      backgroundColor: 'var(--os-bg)',
                    }}
                  >
                    <label
                      htmlFor={`usb-stack-${stack.id}`}
                      className="flex flex-1 cursor-pointer items-start gap-2.5"
                    >
                      <input
                        id={`usb-stack-${stack.id}`}
                        type="checkbox"
                        checked={selected}
                        onChange={() => toggleStack(stack.id)}
                        className="mt-0.5 h-4 w-4 accent-sky-400"
                      />
                      <span>
                        <span className="block font-mono text-xs font-semibold" style={{ color: 'var(--os-fg)' }}>
                          {stack.name}
                        </span>
                        <span className="block font-mono text-[11px]" style={{ color: 'var(--os-muted)' }}>
                          LSP: {stack.nvimLsp} · ~{stack.estimatedMb} MB
                        </span>
                      </span>
                    </label>

                    {selected && stack.versions.length > 1 && (
                      <div
                        className="flex items-center justify-between gap-2 border-t pt-2"
                        style={{ borderColor: 'var(--os-border)' }}
                      >
                        <label
                          htmlFor={`usb-ver-${stack.id}`}
                          className="font-mono text-[11px]"
                          style={{ color: 'var(--os-muted)' }}
                        >
                          Version
                        </label>
                        <select
                          id={`usb-ver-${stack.id}`}
                          value={chosenVer}
                          onChange={(e) => updateStackVersion(stack.id, e.target.value)}
                          className="os-control border px-2 py-1 font-mono text-[11px] focus:outline-none"
                          style={{
                            borderColor: 'var(--os-border-strong)',
                            backgroundColor: 'var(--os-surface)',
                            color: 'var(--os-fg)',
                          }}
                        >
                          {stack.versions.map((ver) => (
                            <option key={ver} value={ver}>
                              {ver === stack.defaultVersion ? `${ver} (default)` : ver}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label
                  htmlFor="usb-extra-pkgs"
                  className="block font-mono text-xs font-medium"
                  style={{ color: 'var(--os-fg)' }}
                >
                  Extra Global Packages
                </label>
                <input
                  id="usb-extra-pkgs"
                  type="text"
                  value={bootConfig.extraPackages}
                  onChange={(e) => updateField('extraPackages', e.target.value)}
                  placeholder="e.g. zig sqlite fastfetch"
                  className="os-control mt-1.5 min-h-[40px] w-full border px-3 py-2 font-mono text-xs focus:outline-none"
                  style={{
                    borderColor: 'var(--os-border-strong)',
                    backgroundColor: 'var(--os-bg)',
                    color: 'var(--os-fg)',
                  }}
                />
              </div>

              <div>
                <label
                  htmlFor="usb-github-repo"
                  className="block font-mono text-xs font-medium"
                  style={{ color: 'var(--os-fg)' }}
                >
                  GitHub Releases Repo
                </label>
                <input
                  id="usb-github-repo"
                  type="text"
                  value={bootConfig.githubRepo}
                  onChange={(e) => updateField('githubRepo', e.target.value)}
                  placeholder="owner/monolith-os"
                  className="os-control mt-1.5 min-h-[40px] w-full border px-3 py-2 font-mono text-xs focus:outline-none"
                  style={{
                    borderColor: validation.errors.githubRepo ? '#ef4444' : 'var(--os-border-strong)',
                    backgroundColor: 'var(--os-bg)',
                    color: 'var(--os-fg)',
                  }}
                />
                {validation.errors.githubRepo && (
                  <p role="alert" className="mt-1 font-mono text-[11px] text-red-400">
                    {validation.errors.githubRepo}
                  </p>
                )}
              </div>
            </div>

            <div className="mt-5 space-y-3 border-t pt-4" style={{ borderColor: 'var(--os-border)' }}>
              <label htmlFor="usb-auto-update" className="flex cursor-pointer items-start gap-3">
                <input
                  id="usb-auto-update"
                  type="checkbox"
                  checked={bootConfig.autoUpdate}
                  onChange={(e) => updateField('autoUpdate', e.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-sky-400"
                />
                <span className="text-xs" style={{ color: 'var(--os-fg)' }}>
                  Enable background update check on login (<code className="font-mono">Super + Alt + U</code>)
                </span>
              </label>

              <label htmlFor="usb-skip-wizard" className="flex cursor-pointer items-start gap-3">
                <input
                  id="usb-skip-wizard"
                  type="checkbox"
                  checked={bootConfig.skipInteractiveWizard}
                  onChange={(e) => updateField('skipInteractiveWizard', e.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-sky-400"
                />
                <span className="text-xs" style={{ color: 'var(--os-fg)' }}>
                  Unattended first boot (skip interactive wizard and launch Plasma 6 directly)
                </span>
              </label>
            </div>
          </section>
        </div>

        {/* Right Column: Sticky Generated File Preview */}
        <aside className="space-y-6 lg:col-span-5">
          <div
            className="os-card border p-6 lg:sticky lg:top-20"
            style={{
              borderColor: 'var(--os-border)',
              backgroundColor: 'var(--os-surface)',
            }}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <FileCode2
                  className="h-4 w-4 shrink-0"
                  style={{ color: 'var(--os-accent)' }}
                  aria-hidden="true"
                />
                <h2 className="font-mono text-xs font-semibold" style={{ color: 'var(--os-fg)' }}>
                  monolith-boot.conf
                </h2>
              </div>
              <button
                type="button"
                onClick={handleCopyConf}
                className="os-control inline-flex min-h-[34px] items-center gap-1.5 border px-2.5 font-mono text-xs"
                style={{
                  borderColor: 'var(--os-border-strong)',
                  color: 'var(--os-fg)',
                }}
              >
                {copied ? (
                  <Check className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" />
                ) : (
                  <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                )}
                <span>{copied ? 'Copied' : 'Copy'}</span>
              </button>
            </div>

            <pre
              data-testid="usb-boot-conf-preview"
              className="os-control mt-4 max-h-[340px] overflow-auto border p-4 font-mono text-[11px] leading-relaxed os-scrollbar"
              style={{
                borderColor: 'var(--os-border)',
                backgroundColor: 'var(--os-bg)',
                color: 'var(--os-fg)',
              }}
            >
              <code>{generatedConf}</code>
            </pre>

            <div className="mt-4 flex flex-col gap-2.5">
              <button
                type="button"
                onClick={handleDownloadConf}
                disabled={!validation.isValid}
                className="os-control inline-flex min-h-[42px] w-full items-center justify-center gap-2 px-4 py-2 text-xs font-semibold transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                style={{
                  backgroundColor: 'var(--os-accent)',
                  color: 'var(--os-accent-fg)',
                }}
              >
                <Download className="h-4 w-4" aria-hidden="true" />
                <span>Download monolith-boot.conf</span>
              </button>

              <button
                type="button"
                onClick={handleDownloadBat}
                className="os-control inline-flex min-h-[40px] w-full items-center justify-center gap-2 border px-4 py-2 font-mono text-xs font-medium transition-colors hover:opacity-90"
                style={{
                  borderColor: 'var(--os-border-strong)',
                  backgroundColor: 'var(--os-bg)',
                  color: 'var(--os-fg)',
                }}
              >
                <Terminal className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Download Windows USB Helper (.bat)</span>
              </button>
            </div>

            <div className="mt-6 border-t pt-5" style={{ borderColor: 'var(--os-border)' }}>
              <div className="flex items-center gap-2">
                <HardDrive
                  className="h-4 w-4 shrink-0"
                  style={{ color: 'var(--os-accent)' }}
                  aria-hidden="true"
                />
                <h3 className="font-display text-xs font-semibold" style={{ color: 'var(--os-fg)' }}>
                  Where to Drop After Rufus
                </h3>
              </div>
              <ol className="mt-3 space-y-2 text-[11px] leading-relaxed" style={{ color: 'var(--os-muted)' }}>
                <li>1. Rufus ISO Mode: Paste into the USB root (e.g. E:\monolith-boot.conf).</li>
                <li>2. Rufus DD Mode: Double-click copy-to-monolith-usb.bat beside the file.</li>
                <li>3. Boot once: monolith-apply-bootconf imports it to /persist/monolith-boot.conf.</li>
              </ol>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

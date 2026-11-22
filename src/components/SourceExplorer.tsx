import { useMemo, useState } from 'react';
import { Check, Copy, Download, FileCode2, FolderGit2 } from 'lucide-react';
import { generateOsRepositoryFiles } from '../lib/osEngine';
import type { GeneratedFileEntry, OSConfigState } from '../lib/types';

interface SourceExplorerProps {
  config: OSConfigState;
  onDownloadZip: () => void;
  isExporting: boolean;
}

const GROUPS: GeneratedFileEntry['group'][] = [
  'GitHub Actions',
  'NixOS Flake',
  'Documentation',
];

export function SourceExplorer({
  config,
  onDownloadZip,
  isExporting,
}: SourceExplorerProps) {
  const files = useMemo(() => generateOsRepositoryFiles(config), [config]);
  const [selectedPath, setSelectedPath] = useState<string>('nixos/configuration.nix');
  const [fileFilter, setFileFilter] = useState<string>('');
  const [copiedPath, setCopiedPath] = useState<string | null>(null);

  const activeFile = useMemo(
    () => files.find((f) => f.path === selectedPath) ?? files[0],
    [files, selectedPath],
  );

  const visibleFiles = useMemo(() => {
    const q = fileFilter.trim().toLowerCase();
    if (!q) return files;
    return files.filter(
      (f) =>
        f.path.toLowerCase().includes(q) ||
        f.description.toLowerCase().includes(q) ||
        f.group.toLowerCase().includes(q),
    );
  }, [files, fileFilter]);

  const handleCopyFile = async () => {
    try {
      await navigator.clipboard.writeText(activeFile.content);
      setCopiedPath(activeFile.path);
      window.setTimeout(() => setCopiedPath(null), 1800);
    } catch {
      // Ignore clipboard failures in restricted contexts
    }
  };

  const handleDownloadSingleFile = () => {
    const blob = new Blob([activeFile.content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = activeFile.path.split('/').pop() ?? 'file.txt';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="mx-auto max-w-[1280px] px-6 pb-24 pt-10">
      <div
        className="flex flex-wrap items-end justify-between gap-4 border-b pb-6"
        style={{ borderColor: 'var(--os-border)' }}
      >
        <div className="max-w-2xl">
          <h1
            className="font-display text-xl font-bold tracking-[-0.015em] md:text-2xl"
            style={{ color: 'var(--os-fg)' }}
          >
            Niri-Only NixOS Flake &amp; GitHub Actions Pipeline
          </h1>
          <p className="mt-1.5 text-xs leading-relaxed" style={{ color: 'var(--os-muted)' }}>
            {files.length} self-contained declarative files pinned to{' '}
            <code className="font-mono" style={{ color: 'var(--os-fg)' }}>
              {config.nixSystem.channel}
            </code>{' '}
            with latest Nix, Niri Wayland, JetBrains Mono, minimal wallpaper, rounded transparent
            windows, auto-hiding Waybar, RAM sweeper, USB/HDMI/Wi-Fi/Bluetooth, and optional Wine
            .exe support — all synced live with your Settings.
          </p>
        </div>

        <button
          type="button"
          onClick={onDownloadZip}
          disabled={isExporting}
          className="os-control inline-flex min-h-[42px] items-center gap-2 whitespace-nowrap px-4 py-2 text-xs font-semibold transition-opacity hover:opacity-90 disabled:opacity-60"
          style={{
            backgroundColor: 'var(--os-accent)',
            color: 'var(--os-accent-fg)',
          }}
        >
          <Download className="h-4 w-4" aria-hidden="true" />
          <span>{isExporting ? 'Packaging Archive…' : 'Download NixOS Repo (.zip)'}</span>
        </button>
      </div>

      {/* Main Split Code Inspector */}
      <div
        className="os-card mt-8 grid grid-cols-1 overflow-hidden border lg:grid-cols-12"
        style={{
          borderColor: 'var(--os-border)',
          backgroundColor: 'var(--os-surface)',
        }}
      >
        {/* File Tree */}
        <aside
          aria-label="NixOS repository files"
          className="max-h-[640px] overflow-y-auto border-b p-4 lg:col-span-4 lg:border-b-0 lg:border-r os-scrollbar"
          style={{ borderColor: 'var(--os-border)' }}
        >
          <div className="mb-4">
            <input
              type="search"
              value={fileFilter}
              onChange={(e) => setFileFilter(e.target.value)}
              placeholder="Filter repository files..."
              aria-label="Filter repository files"
              className="os-control w-full border px-3 py-1.5 font-mono text-xs focus:outline-none"
              style={{
                borderColor: 'var(--os-border-strong)',
                backgroundColor: 'var(--os-bg)',
                color: 'var(--os-fg)',
              }}
            />
          </div>

          <div className="space-y-5">
            {GROUPS.map((group) => {
              const groupFiles = visibleFiles.filter((f) => f.group === group);
              if (groupFiles.length === 0) return null;
              return (
                <div key={group}>
                  <p className="px-2 font-mono text-[11px] font-semibold" style={{ color: 'var(--os-muted)' }}>
                    {group}
                  </p>
                  <div className="mt-1.5 flex flex-col gap-1">
                    {groupFiles.map((file) => {
                      const active = file.path === activeFile.path;
                      return (
                        <button
                          key={file.path}
                          type="button"
                          title={file.path}
                          aria-current={active ? 'true' : undefined}
                          onClick={() => setSelectedPath(file.path)}
                          className="os-control flex min-h-[36px] items-center gap-2 border px-2.5 py-1.5 text-left font-mono text-xs transition-colors"
                          style={{
                            borderColor: active ? 'var(--os-accent)' : 'transparent',
                            backgroundColor: active ? 'var(--os-surface-elevated)' : 'transparent',
                            color: active ? 'var(--os-accent)' : 'var(--os-fg)',
                          }}
                        >
                          <FileCode2 className="h-3.5 w-3.5 shrink-0 opacity-75" aria-hidden="true" />
                          <span className="truncate">{file.path}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </aside>

        {/* Active File Preview */}
        <div className="flex max-h-[640px] flex-col lg:col-span-8">
          <div
            className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-3.5"
            style={{ borderColor: 'var(--os-border)' }}
          >
            <div className="min-w-0">
              <p className="truncate font-mono text-xs font-semibold" style={{ color: 'var(--os-fg)' }}>
                {activeFile.path}
              </p>
              <p className="mt-0.5 text-[11px]" style={{ color: 'var(--os-muted)' }}>
                {activeFile.description}
              </p>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={handleCopyFile}
                className="os-control inline-flex min-h-[34px] items-center gap-1.5 border px-3 font-mono text-xs"
                style={{ borderColor: 'var(--os-border-strong)', color: 'var(--os-fg)' }}
              >
                {copiedPath === activeFile.path ? (
                  <Check className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" />
                ) : (
                  <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                )}
                <span>{copiedPath === activeFile.path ? 'Copied' : 'Copy'}</span>
              </button>

              <button
                type="button"
                onClick={handleDownloadSingleFile}
                className="os-control inline-flex min-h-[34px] items-center gap-1.5 border px-3 font-mono text-xs"
                style={{ borderColor: 'var(--os-border-strong)', color: 'var(--os-fg)' }}
              >
                <Download className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Save File</span>
              </button>
            </div>
          </div>

          <pre
            className="flex-1 overflow-auto p-5 font-mono text-xs leading-relaxed os-scrollbar"
            style={{
              backgroundColor: 'var(--os-bg)',
              color: 'var(--os-fg)',
            }}
          >
            <code>{activeFile.content}</code>
          </pre>
        </div>
      </div>

      {/* GitHub Push -> Automated Release Commands */}
      <div
        className="os-card mt-8 border p-6"
        style={{
          borderColor: 'var(--os-border)',
          backgroundColor: 'var(--os-surface)',
        }}
      >
        <div className="flex items-center gap-2.5">
          <FolderGit2 className="h-4 w-4" style={{ color: 'var(--os-accent)' }} aria-hidden="true" />
          <h2 className="font-display text-sm font-semibold" style={{ color: 'var(--os-fg)' }}>
            Publish to GitHub &amp; Trigger Automated NixOS ISO Release (Windows PowerShell)
          </h2>
        </div>
        <pre
          className="os-control mt-4 overflow-x-auto border p-4 font-mono text-xs leading-relaxed"
          style={{
            borderColor: 'var(--os-border)',
            backgroundColor: 'var(--os-bg)',
            color: 'var(--os-fg)',
          }}
        >
{`# 1. Unzip monolith-nixos-source.zip (or copy os-source/) into a new folder
cd monolith-nixos-source
git init -b main
git add .
git commit -m "Monolith NixOS Niri Wayland Flake ISO"

# 2. Push to GitHub — build-nixos.yml builds & publishes your ISO automatically
git remote add origin https://github.com/<your-username>/monolith-nixos.git
git push -u origin main

# 3. Download monolith-nixos-*.iso from Releases and flash with Rufus (DD mode)`}
        </pre>
      </div>
    </div>
  );
}

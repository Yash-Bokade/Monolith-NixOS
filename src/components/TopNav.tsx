import { useState } from 'react';
import { Download, Menu, X } from 'lucide-react';
import type { AppViewId } from '../lib/types';

interface TopNavProps {
  activeView: AppViewId;
  onNavigate: (view: AppViewId) => void;
  onDownloadZip: () => void;
  isExporting: boolean;
}

const NAV_ITEMS: { id: AppViewId; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'live-os', label: 'Live OS' },
  { id: 'usb-config', label: 'USB Config' },
  { id: 'settings', label: 'Settings' },
  { id: 'source', label: 'Source & CI' },
];

export function TopNav({
  activeView,
  onNavigate,
  onDownloadZip,
  isExporting,
}: TopNavProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const handleNav = (id: AppViewId) => {
    onNavigate(id);
    setMobileMenuOpen(false);
  };

  return (
    <header
      className="sticky top-0 z-40 border-b"
      style={{
        backgroundColor: 'color-mix(in srgb, var(--os-bg) 92%, transparent)',
        borderColor: 'var(--os-border)',
        backdropFilter: 'blur(10px)',
      }}
    >
      <div className="mx-auto flex max-w-[1280px] items-center justify-between gap-8 px-6 py-3.5">
        {/* Zone 1: Single-line Brand Wordmark */}
        <button
          type="button"
          onClick={() => handleNav('overview')}
          className="shrink-0 whitespace-nowrap font-display text-base font-bold tracking-tight transition-opacity hover:opacity-85 focus-visible:outline-2 focus-visible:outline-offset-4"
          style={{
            color: 'var(--os-fg)',
            outlineColor: 'var(--os-accent)',
          }}
        >
          Monolith NixOS
        </button>

        {/* Zone 2: Clean single-line text navigation links */}
        <nav aria-label="Primary navigation" className="hidden items-center gap-7 md:flex">
          {NAV_ITEMS.map((item) => {
            const isActive = activeView === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleNav(item.id)}
                aria-current={isActive ? 'page' : undefined}
                className="relative shrink-0 whitespace-nowrap py-1 text-xs font-medium transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-4"
                style={{
                  color: isActive ? 'var(--os-fg)' : 'var(--os-muted)',
                  outlineColor: 'var(--os-accent)',
                }}
              >
                {item.label}
                {isActive && (
                  <span
                    aria-hidden="true"
                    className="absolute inset-x-0 -bottom-[15px] h-[2px] rounded-full"
                    style={{ backgroundColor: 'var(--os-accent)' }}
                  />
                )}
              </button>
            );
          })}
        </nav>

        {/* Zone 3: Single primary action */}
        <div className="flex shrink-0 items-center gap-3">
          <button
            type="button"
            onClick={onDownloadZip}
            disabled={isExporting}
            className="os-control inline-flex min-h-[40px] shrink-0 items-center gap-2 whitespace-nowrap px-4 py-2 text-xs font-semibold transition-opacity duration-150 hover:opacity-90 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2"
            style={{
              backgroundColor: 'var(--os-accent)',
              color: 'var(--os-accent-fg)',
              outlineColor: 'var(--os-accent)',
            }}
          >
            <Download className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>{isExporting ? 'Building ZIP…' : 'Download Flake'}</span>
          </button>

          <button
            type="button"
            onClick={() => setMobileMenuOpen((prev) => !prev)}
            aria-label={mobileMenuOpen ? 'Close navigation menu' : 'Open navigation menu'}
            aria-expanded={mobileMenuOpen}
            className="os-control inline-flex min-h-[40px] min-w-[40px] items-center justify-center border md:hidden"
            style={{
              borderColor: 'var(--os-border)',
              color: 'var(--os-fg)',
              backgroundColor: 'var(--os-surface)',
            }}
          >
            {mobileMenuOpen ? (
              <X className="h-4 w-4" aria-hidden="true" />
            ) : (
              <Menu className="h-4 w-4" aria-hidden="true" />
            )}
          </button>
        </div>
      </div>

      {/* Mobile navigation drawer */}
      {mobileMenuOpen && (
        <nav
          aria-label="Mobile navigation"
          className="border-t px-6 py-3 md:hidden"
          style={{
            borderColor: 'var(--os-border)',
            backgroundColor: 'var(--os-surface)',
          }}
        >
          <div className="flex flex-col gap-1">
            {NAV_ITEMS.map((item) => {
              const isActive = activeView === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleNav(item.id)}
                  className="os-control flex min-h-[44px] items-center justify-between px-3 text-left text-xs font-medium transition-colors"
                  style={{
                    color: isActive ? 'var(--os-accent)' : 'var(--os-fg)',
                    backgroundColor: isActive ? 'var(--os-surface-elevated)' : 'transparent',
                  }}
                >
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>
        </nav>
      )}
    </header>
  );
}

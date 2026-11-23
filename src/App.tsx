import { useEffect, useState } from 'react';
import { LiveOSPreview } from './components/LiveOSPreview';
import { OverviewPage } from './components/OverviewPage';
import { SettingsStudio } from './components/SettingsStudio';
import { SourceExplorer } from './components/SourceExplorer';
import { TopNav } from './components/TopNav';
import { UsbBootConfigPage } from './components/UsbBootConfigPage';
import { buildOsSourceZip } from './lib/osEngine';
import { clearOSConfig, loadOSConfig, saveOSConfig } from './lib/storage';
import type { AppViewId, OSConfigState } from './lib/types';

function getInitialRouteState(): {
  view: AppViewId;
  liveMode: 'first-boot' | 'desktop-plasma';
} {
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get('autostart') === '1') {
      return { view: 'live-os', liveMode: 'desktop-plasma' };
    }
    const tab = params.get('view');
    if (tab === 'live-os' || tab === 'usb-config' || tab === 'settings' || tab === 'source') {
      return { view: tab, liveMode: 'desktop-plasma' };
    }
  } catch {
    // Ignore SSR or restricted location access
  }
  return { view: 'overview', liveMode: 'desktop-plasma' };
}

export default function App() {
  const initial = getInitialRouteState();
  const [activeView, setActiveView] = useState<AppViewId>(initial.view);
  const [liveMode, setLiveMode] = useState<'first-boot' | 'desktop-plasma'>(
    initial.liveMode,
  );
  const [config, setConfig] = useState<OSConfigState>(() => loadOSConfig());
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [exportToast, setExportToast] = useState<string | null>(null);

  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-os-theme', config.appearance.theme);
    root.style.setProperty('--os-radius', `${config.appearance.cornerRadiusPx}px`);
    root.style.setProperty(
      '--os-radius-sm',
      `${Math.max(3, config.appearance.cornerRadiusPx - 3)}px`,
    );
    root.style.setProperty(
      '--os-window-opacity',
      config.appearance.windowOpacity.toFixed(2),
    );
    saveOSConfig(config);
  }, [config]);

  const handleNavigate = (view: AppViewId) => {
    if (view === 'live-os') {
      setLiveMode('desktop-plasma');
    }
    setActiveView(view);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleLaunchLivePreset = (mode: 'first-boot' | 'desktop-plasma') => {
    setLiveMode(mode);
    setActiveView('live-os');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDownloadZip = async () => {
    if (isExporting) return;
    setIsExporting(true);
    try {
      const blob = await buildOsSourceZip(config);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'monolith-nixos-source.zip';
      link.click();
      URL.revokeObjectURL(url);
      setExportToast(
        'Exported Optimized Plasma 6 Wayland monolith-nixos-source.zip with NixOS Flake & GitHub Actions workflow.',
      );
      window.setTimeout(() => setExportToast(null), 4000);
    } catch {
      setExportToast('Export failed — please retry or copy individual files in Source & CI.');
      window.setTimeout(() => setExportToast(null), 4000);
    } finally {
      setIsExporting(false);
    }
  };

  const handleResetDefaults = () => {
    const fresh = clearOSConfig();
    setConfig(fresh);
    setExportToast('Restored Monolith NixOS factory default settings.');
    window.setTimeout(() => setExportToast(null), 3000);
  };

  return (
    <div
      className="min-h-screen transition-colors duration-200"
      style={{
        backgroundColor: 'var(--os-bg)',
        color: 'var(--os-fg)',
      }}
    >
      <TopNav
        activeView={activeView}
        onNavigate={handleNavigate}
        onDownloadZip={handleDownloadZip}
        isExporting={isExporting}
      />

      <main>
        {activeView === 'overview' && (
          <OverviewPage
            config={config}
            onNavigate={handleNavigate}
            onLaunchLivePreset={handleLaunchLivePreset}
            onDownloadZip={handleDownloadZip}
            onSelectDrivePreset={(nominalDriveGb, totalUsableGb) =>
              setConfig((prev) => ({
                ...prev,
                storage: {
                  ...prev.storage,
                  nominalDriveGb,
                  totalUsableGb,
                },
              }))
            }
          />
        )}

        {activeView === 'live-os' && (
          <LiveOSPreview
            config={config}
            initialMode={liveMode}
            onUpdateConfig={setConfig}
            onOpenSettings={() => handleNavigate('settings')}
          />
        )}

        {activeView === 'usb-config' && <UsbBootConfigPage config={config} />}

        {activeView === 'settings' && (
          <SettingsStudio
            config={config}
            onChange={setConfig}
            onResetDefaults={handleResetDefaults}
          />
        )}

        {activeView === 'source' && (
          <SourceExplorer
            config={config}
            onDownloadZip={handleDownloadZip}
            isExporting={isExporting}
          />
        )}
      </main>

      {exportToast && (
        <div
          role="status"
          aria-live="polite"
          className="os-card fixed bottom-5 right-5 z-50 max-w-md border px-4 py-3 font-mono text-xs shadow-lg"
          style={{
            backgroundColor: 'var(--os-surface-elevated)',
            borderColor: 'var(--os-accent)',
            color: 'var(--os-fg)',
          }}
        >
          {exportToast}
        </div>
      )}
    </div>
  );
}

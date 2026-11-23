# Monolith NixOS

An optimized, declarative portable **Graphical NixOS (nixos-unstable + latest Nix)** Live ISO built around **KDE Plasma 6 Wayland**, **native rounded menus & System Settings**, **JetBrains Mono**, **auto-hiding floating panel**, **unified working keyboard shortcuts**, and **USB flash/RAM optimizations** for any 32 GB+ USB drive.

## Minimal Repository Structure

```
.github/workflows/build-nixos.yml   # Automated GitHub Actions NixOS ISO release build
nixos/flake.nix                     # Latest NixOS Flake (nixos-unstable) exporting .#iso
nixos/configuration.nix             # Complete optimized Plasma 6 Wayland OS, scripts & persistence
docs/RUFUS_FLASHING_GUIDE.md        # Windows Rufus DD-mode flashing & boot instructions
```

## Core Architecture

- **Optimized Graphical Plasma 6 Wayland**: Auto-boots directly into Wayland with native rounded menus, floating auto-hiding taskbar, real graphical **System Settings** (`Super + ,`), minimal wallpaper, `92%` translucent windows, and clean zero-button titlebars (`ButtonsOnLeft=` / `ButtonsOnRight=`).
- **One Unified Shortcut System**: Every shortcut lives in `kglobalshortcutsrc` + standard `.desktop` launchers so 100% of keybinds work reliably and can be modified or extended directly in **System Settings → Keyboard → Shortcuts**.
- **Optimized RAM & USB Flash**: Baloo file indexing is disabled, bloated KDE apps are excluded, ZRAM (50% zstd) + `earlyoom` + `monolith-ram-clean` keep idle RAM ~`466 MB` (< 500 MB budget), and per-project local packages load into RAM only while active (`direnv` + `flake.nix`).
- **Full Hardware + Optional Windows `.exe`**: Native Plasma Wi-Fi, Bluetooth, HDMI multi-display, PipeWire audio, USB-A/C/Thunderbolt automount, LocalSend, OBS, Neovim, Minimal Firefox, and interactive first-boot prompt for Windows `.exe` support (`wineWowPackages.stable` + `winetricks`).
- **100% USB Persistence (No exFAT Needed)**: Since **LocalSend** handles cross-device file sharing over LAN, 100% of remaining USB capacity scales into `MONOLITH_PERSIST` (`ext4`) by default.

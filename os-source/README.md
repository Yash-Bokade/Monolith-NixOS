# Monolith NixOS

A minimal, declarative portable **NixOS (nixos-unstable + latest Nix)** Live ISO built strictly around **Niri Scrollable Wayland**, **JetBrains Mono**, **minimal wallpaper**, **keyboard-only window controls**, and **< 500 MB idle RAM** for any 32 GB+ USB drive.

## Minimal Repository Structure

```
.github/workflows/build-nixos.yml   # Automated GitHub Actions NixOS ISO release build
nixos/flake.nix                     # Latest NixOS Flake (nixos-unstable) exporting .#iso
nixos/configuration.nix             # Complete declarative Niri OS, TUIs, scripts & persistence
docs/RUFUS_FLASHING_GUIDE.md        # Windows Rufus DD-mode flashing & boot instructions
```

## Core Architecture

- **Niri Wayland Only**: Boots straight into Niri with Waybar already visible on start (modifiable auto-hide), minimal wallpaper (`swaybg`), `10px` rounded corners, `90%` window opacity, and **zero GUI minimize/expand/close buttons** (100% keyboard shortcuts).
- **JetBrains Mono + Unified Theme**: Every UI, terminal (`foot`), launcher (`fuzzel`), status bar (`waybar`), Neovim, TUI dialog, and TUI screensaver shares the exact same `Obsidian Matte` palette.
- **< 500 MB Idle RAM + RAM-Only Local Project Packages**: Estimated `~366 MB` idle. Global apps install via `monolith-pkg install <pkg>` (`nix profile install`). Per-project packages load into RAM only while working inside the project (`direnv` + `flake.nix`) and clear automatically on idle via `monolith-ram-clean`.
- **Full Hardware + Optional Windows `.exe`**: USB-A/C automount (`udisks2` + `udiskie`), HDMI/DP (`wlr-randr` + `kanshi`), Wi-Fi (`iwd`), Bluetooth (`bluez` + `bluetui`), PipeWire audio, and interactive first-boot prompt for Windows `.exe` support (`wineWowPackages.stable` + `winetricks`).
- **100% USB Persistence (No exFAT Needed)**: Since **LocalSend** handles cross-device file sharing over LAN, 100% of remaining USB capacity scales into `MONOLITH_PERSIST` (`ext4`) by default.

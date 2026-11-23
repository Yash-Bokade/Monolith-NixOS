# Rufus Flashing Guide — Monolith NixOS (Any 32 GB+ USB Drive)

Flash `monolith-nixos-*.iso` onto any **32 GB, 64 GB, 128 GB, 256 GB, 512 GB, or 1 TB+ USB drive / external SSD** from Windows using **Rufus**.

## 1. Exact Rufus Settings

| Rufus Setting | Required Value | Why |
| :--- | :--- | :--- |
| **Device** | Any **32 GB+** USB drive / SSD | Persistence scales automatically to 100% of remaining space |
| **Boot selection** | `monolith-nixos-*-x86_64.iso` | Built automatically in GitHub Releases |
| **Partition scheme** | **GPT** | Universal UEFI boot on modern x86_64 PCs |
| **Target system** | **UEFI (non CSM)** | Fast native UEFI boot (Legacy BIOS also supported) |
| **Write mode** | **Write in DD Image mode** | Preserves `MONOLITH_NIX` labels & leaves drive tail clean for auto-scaling |

## 2. Auto-Scaling Persistence (100% of Remaining Space)

> **Why exFAT is OFF by default**: Because **LocalSend** is pre-installed for wireless LAN file transfers to Windows, macOS, Android, and iOS, you don't need to sacrifice USB storage to a separate exFAT partition. All remaining drive space goes straight to `MONOLITH_PERSIST` (ext4).

| Drive Size (Usable) | EFI + NixOS | Auto-Scaled `MONOLITH_PERSIST` (ext4) | Optional exFAT |
| :--- | :--- | :--- | :--- |
| **32 GB** (~27.25 GB) | 2.5 GB | **24.8 GB** | 0.0 GB |
| **64 GB** (~57.6 GB) | 2.5 GB | **55.1 GB** | 0.0 GB |
| **128 GB** (~115.2 GB) | 2.5 GB | **112.7 GB** | 0.0 GB |
| **1 TB** (~931.3 GB) | 2.5 GB | **928.8 GB** | 0.0 GB |

## 3. Booting on Any x86_64 PC

1. Disable **Secure Boot** once in UEFI/BIOS settings.
2. Open your machine's Boot Menu (`F12` Dell/Lenovo/Acer, `F9` HP, `F8` ASUS, `F10` Samsung, `F11` MSI).
3. Select your **UEFI USB Drive** — Optimized KDE Plasma 6 Wayland launches automatically (default user: **`dev`**, password: **`monolith`**).

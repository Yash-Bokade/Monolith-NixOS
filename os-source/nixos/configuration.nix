{ config, pkgs, lib, modulesPath, ... }:

let
  monolithFirstboot = pkgs.writeShellScriptBin "monolith-firstboot" ''
#!/usr/bin/env bash
# Monolith NixOS — Pre-Desktop First-Boot Network, Windows .exe Prompt & Persistent Toolchain Wizard
set -uo pipefail

STAMP_FILE="$HOME/.config/monolith/.firstboot-complete"
STACKS_JSON="$HOME/.config/monolith/active-stacks.json"
VERSIONS_JSON="$HOME/.config/monolith/selected-versions.json"
LOG_FILE="$HOME/monolith-firstboot.log"

if [[ -f "$STAMP_FILE" && "''${1:-}" != "--force" ]]; then
  exit 0
fi

sudo dmesg -n 1 2>/dev/null || true
export DIALOGRC="$HOME/.dialogrc"
export MISE_YES=1
export MISE_PYTHON_COMPILE=0
export CARGO_HOME="$HOME/.cargo"
export RUSTUP_HOME="$HOME/.rustup"
export GOPATH="$HOME/go"
export PATH="$HOME/.local/share/mise/shims:$HOME/.local/bin:$HOME/.cargo/bin:$HOME/go/bin:$PATH"

clear
echo "================================================================="
echo "  MONOLITH NIXOS — FIRST-BOOT SETUP (OPTIMIZED PLASMA 6 WAYLAND)"
echo "================================================================="
echo ""

# Step 1: Ensure Auto-Scaling USB Persistence Partition (100% of remaining space)
if ! mountpoint -q /persist || ! mountpoint -q "$HOME"; then
  echo "[1/5] Initializing & mounting USB pendrive persistence (MONOLITH_PERSIST)..."
  sudo monolith-persist-usb || true
  cd "$HOME" 2>/dev/null || true
fi

if mountpoint -q /persist && mountpoint -q "$HOME"; then
  PERSIST_SRC=$(findmnt -n -o SOURCE /persist 2>/dev/null || echo "MONOLITH_PERSIST")
  PERSIST_FREE=$(df -h /persist 2>/dev/null | awk 'NR==2 {print $4}')
  echo "[1/5] [OK] USB Persistence ACTIVE -> $PERSIST_SRC ($PERSIST_FREE free)"
else
  echo "[1/5] [WARNING] USB persistence could NOT be mounted! Running in RAM-only mode."
  dialog --clear --backtitle "Monolith NixOS — Persistence Warning" \
    --title " WARNING: Pendrive Persistence Not Active " \
    --msgbox "Monolith NixOS could not create or mount MONOLITH_PERSIST on your USB drive.\n\nFix: Flash in Rufus using 'DD Image mode' on a 32 GB+ USB drive, or run 'sudo monolith-persist-usb --status'." 12 76 || true
fi

mkdir -p "$HOME/.config/monolith" "/home/dev/workspace" "/home/dev/exports/recordings" "/home/dev/exports/localsend" "$HOME/.local/bin"

# Step 2: Connect Internet FIRST (Wi-Fi / Ethernet)
check_online() {
  curl -fsS --max-time 4 https://nixos.org >/dev/null 2>&1 || ping -c 1 -W 2 1.1.1.1 >/dev/null 2>&1
}

echo "[2/5] Checking internet connectivity..."
ONLINE=0
if check_online; then
  ONLINE=1
else
  while true; do
    dialog --clear --backtitle "Monolith NixOS — First-Boot Setup" \
      --title " Step 1: Connect to the Internet " \
      --msgbox "Connect to Wi-Fi or Ethernet first before selecting optional global packages and Windows .exe support.\n\nPress Enter to open nmtui." 11 72 || true
    nmtui connect || true
    clear
    echo "  Verifying internet connection..."
    for _ in 1 2 3 4 5 6; do
      if check_online; then
        ONLINE=1
        break
      fi
      sleep 2
    done
    [[ "$ONLINE" == "1" ]] && break
    if ! dialog --clear --backtitle "Monolith NixOS — First-Boot Setup" \
      --title " Still Offline " \
      --yes-label "Retry Wi-Fi" --no-label "Continue to Plasma 6 Desktop" \
      --yesno "No internet connection detected yet.\n\nRetry Wi-Fi now, or continue to KDE Plasma 6 Wayland?\n(Run 'monolith-firstboot --force' anytime once online.)" 10 68; then
      break
    fi
  done
fi

if [[ "$ONLINE" == "1" ]]; then
  sudo timedatectl set-ntp true >/dev/null 2>&1 || true
fi

# Step 3: Load optional post-Rufus monolith-boot.conf overrides
BOOT_CONF_FILE="/etc/monolith/boot.conf"
[[ -f /persist/monolith-boot.conf ]] && BOOT_CONF_FILE="/persist/monolith-boot.conf"
read_bootconf_val() {
  local key="$1"
  [[ -f "$BOOT_CONF_FILE" ]] || return 0
  grep -E "^[[:space:]]*''${key}=" "$BOOT_CONF_FILE" 2>/dev/null | tail -n 1 | sed -E 's/^[^=]+=//; s/^"//; s/"$//' || true
}
CONF_STACKS=$(read_bootconf_val MONOLITH_PREINSTALL_STACKS)
CONF_EXTRA_PKGS=$(read_bootconf_val MONOLITH_EXTRA_PKGS)
CONF_SKIP_WIZARD=$(read_bootconf_val MONOLITH_SKIP_WIZARD)
CONF_WIN_EXE=$(read_bootconf_val MONOLITH_WINDOWS_EXE)

# Step 4: Ask if the user wants Windows (.exe) application support (Wine + Winetricks)
INSTALL_WINDOWS_EXE="0"
[[ "$CONF_WIN_EXE" == "true" ]] && INSTALL_WINDOWS_EXE="1"
[[ "$CONF_WIN_EXE" == "false" ]] && INSTALL_WINDOWS_EXE="0"

if [[ "$ONLINE" == "1" && "$CONF_SKIP_WIZARD" != "true" ]]; then
  if dialog --clear --backtitle "Monolith NixOS — Windows .exe Compatibility" \
    --title " Step 2: Run Windows (.exe) Applications? " \
    --yes-label "Yes — Install Wine + Winetricks" --no-label "No — Pure Linux Minimal" \
    --yesno "Do you want to run Windows (.exe) apps on Monolith NixOS?\n\nChoosing Yes installs 'wineWowPackages.stable' + 'winetricks' from Nixpkgs and enables 'monolith-exe <app.exe>' with persistent ~/.wine on MONOLITH_PERSIST.\n\n(Note: Idle RAM remains < 500 MB — Wine only loads into RAM when running an .exe.)" 14 76; then
    INSTALL_WINDOWS_EXE="1"
  else
    INSTALL_WINDOWS_EXE="0"
  fi
fi

CHOICES=""
JAVA_VER="21"
RUST_VER="stable"
GO_VER="latest"
PYTHON_VER="3.12"
NODE_VER="22"
CPP_VER="gcc+clang"
SELECTED_VERSIONS_PAIRS=()
NIX_DECL_PKGS=()
NIX_PROFILE_PKGS=()
LSPS=()
HAD_ERRORS=0
DID_INSTALL=0

if [[ -n "$CONF_STACKS" ]]; then
  IFS=',' read -ra STACK_ENTRIES <<< "$CONF_STACKS"
  for entry in "''${STACK_ENTRIES[@]}"; do
    s_id="''${entry%%:*}"
    s_ver="''${entry#*:}"
    [[ -z "$s_id" ]] && continue
    [[ "$s_ver" == "$s_id" || -z "$s_ver" ]] && s_ver="latest"
    CHOICES="''${CHOICES}''${CHOICES:+ }''${s_id}"
    case "$s_id" in
      java) JAVA_VER="$s_ver"; SELECTED_VERSIONS_PAIRS+=("\"java\":\"$JAVA_VER\"") ;;
      rust) RUST_VER="$s_ver"; SELECTED_VERSIONS_PAIRS+=("\"rust\":\"$RUST_VER\"") ;;
      go) GO_VER="$s_ver"; SELECTED_VERSIONS_PAIRS+=("\"go\":\"$GO_VER\"") ;;
      python) PYTHON_VER="$s_ver"; SELECTED_VERSIONS_PAIRS+=("\"python\":\"$PYTHON_VER\"") ;;
      nodejs) NODE_VER="$s_ver"; SELECTED_VERSIONS_PAIRS+=("\"nodejs\":\"$NODE_VER\"") ;;
      cpp) CPP_VER="$s_ver"; SELECTED_VERSIONS_PAIRS+=("\"cpp\":\"$CPP_VER\"") ;;
      containers) SELECTED_VERSIONS_PAIRS+=("\"containers\":\"latest\"") ;;
    esac
  done
fi

if [[ "$ONLINE" == "1" && "$CONF_SKIP_WIZARD" != "true" ]]; then
  CHOICES=$(dialog --clear --backtitle "Monolith NixOS — Optional Global Languages" \
    --title " Step 3: Select Global Stacks (Local Project Pkgs use monolith-new-project) " \
    --stdout --separate-output --checklist \
    "Pick global toolchains to pre-install (or leave empty and use per-project RAM-only packages):" 18 78 8 \
    java "Java (OpenJDK 25/21/17/11 + Maven/Gradle)" off \
    rust "Rust (Stable / Nightly + rust-analyzer)" off \
    go "Go (Latest / 1.24 / 1.23 + gopls + delve)" off \
    python "Python 3 (3.13 / 3.12 / 3.11 + uv + pyright)" off \
    nodejs "Node.js (22 LTS / 20 LTS + pnpm + TS LSP)" off \
    cpp "C / C++ (GCC + Clang + CMake + Ninja + clangd)" off \
    containers "Podman rootless containers" off) || CHOICES=""
fi

install_step() {
  local label="$1"
  shift
  echo "  -> $label"
  if "$@" 2>&1 | tee -a "$LOG_FILE"; then
    echo "     [OK] $label"
  else
    echo "     [WARN] $label failed (see $LOG_FILE)"
    HAD_ERRORS=1
  fi
}

if [[ "$ONLINE" == "1" ]]; then
  if [[ "$INSTALL_WINDOWS_EXE" == "1" ]]; then
    DID_INSTALL=1
    NIX_PROFILE_PKGS+=(nixpkgs#wineWowPackages.stable nixpkgs#winetricks)
    NIX_DECL_PKGS+=(wineWowPackages.stable winetricks)
  fi

  for choice in $CHOICES; do
    DID_INSTALL=1
    case "$choice" in
      java)
        install_step "Java ($JAVA_VER) + Maven + Gradle" mise use -g "java@$JAVA_VER" maven@latest gradle@latest
        NIX_DECL_PKGS+=(jdk21 maven gradle)
        LSPS+=("jdtls")
        ;;
      rust)
        install_step "Rust ($RUST_VER)" mise use -g "rust@$RUST_VER"
        NIX_DECL_PKGS+=(rustup rust-analyzer)
        LSPS+=("rust_analyzer")
        ;;
      go)
        install_step "Go ($GO_VER)" mise use -g "go@$GO_VER"
        NIX_DECL_PKGS+=(go gopls delve)
        LSPS+=("gopls")
        ;;
      python)
        install_step "Python ($PYTHON_VER) + uv + ruff" mise use -g "python@$PYTHON_VER" uv@latest ruff@latest
        NIX_DECL_PKGS+=(python312 uv ruff pyright)
        LSPS+=("pyright")
        ;;
      nodejs)
        install_step "Node.js ($NODE_VER) + pnpm" mise use -g "node@$NODE_VER" pnpm@latest
        NIX_DECL_PKGS+=(nodejs_22 pnpm)
        LSPS+=("ts_ls")
        ;;
      cpp)
        NIX_PROFILE_PKGS+=(nixpkgs#gcc nixpkgs#clang-tools nixpkgs#cmake nixpkgs#ninja nixpkgs#gdb)
        NIX_DECL_PKGS+=(gcc clang-tools cmake ninja gdb)
        LSPS+=("clangd")
        ;;
      containers)
        NIX_PROFILE_PKGS+=(nixpkgs#podman nixpkgs#podman-compose nixpkgs#slirp4netns)
        NIX_DECL_PKGS+=(podman podman-compose slirp4netns)
        LSPS+=("dockerls")
        ;;
    esac
  done

  if [[ -n "''${CONF_EXTRA_PKGS:-}" ]]; then
    DID_INSTALL=1
    read -ra EXTRA_ARR <<< "$CONF_EXTRA_PKGS"
    for ep in "''${EXTRA_ARR[@]}"; do
      CLEAN_EP="''${ep#nixpkgs#}"
      NIX_DECL_PKGS+=("$CLEAN_EP")
      [[ "$ep" == *#* ]] && NIX_PROFILE_PKGS+=("$ep") || NIX_PROFILE_PKGS+=("nixpkgs#$ep")
    done
  fi

  if [[ ''${#NIX_PROFILE_PKGS[@]} -gt 0 ]]; then
    install_step "Install global Nix packages (''${NIX_PROFILE_PKGS[*]})" nix --extra-experimental-features "nix-command flakes" profile install "''${NIX_PROFILE_PKGS[@]}"
    if mountpoint -q /persist; then
      sudo mkdir -p /persist/nix-cache /persist/nixos
      mapfile -t STORE_PATHS < <(nix --extra-experimental-features "nix-command flakes" profile list --json 2>/dev/null | jq -r '.. | .storePaths? // empty | .[]' | sort -u || true)
      if [[ ''${#STORE_PATHS[@]} -gt 0 ]]; then
        install_step "Persist Nix store paths to /persist/nix-cache" nix --extra-experimental-features "nix-command flakes" copy --to "file:///persist/nix-cache" "''${STORE_PATHS[@]}"
        printf '%s\n' "''${STORE_PATHS[@]}" | sudo tee /persist/nixos/profile-store-paths.txt >/dev/null
      fi
      printf '%s\n' "''${NIX_PROFILE_PKGS[@]}" | sudo tee /persist/nixos/profile-packages.txt >/dev/null
    fi
  fi

  sudo mkdir -p /etc/nixos
  {
    echo "# Monolith NixOS — Declarative Global User Packages (Persisted on MONOLITH_PERSIST)"
    echo "{ pkgs, ... }: {"
    echo "  environment.systemPackages = with pkgs; ["
    for npkg in "''${NIX_DECL_PKGS[@]}"; do
      echo "    $npkg"
    done
    echo "  ];"
    echo "}"
  } | sudo tee /etc/nixos/user-packages.nix >/dev/null
fi

if [[ ''${#SELECTED_VERSIONS_PAIRS[@]} -gt 0 ]]; then
  VERSIONS_BODY=$(IFS=,; echo "''${SELECTED_VERSIONS_PAIRS[*]}")
  echo "{''${VERSIONS_BODY}}" > "$VERSIONS_JSON"
else
  echo "{}" > "$VERSIONS_JSON"
fi

if [[ ''${#LSPS[@]} -gt 0 ]]; then
  LSP_JSON=$(printf '"%s",' "''${LSPS[@]}" | sed 's/,$//')
else
  LSP_JSON=""
fi
echo "{\"lsp_servers\": [$LSP_JSON], \"windows_exe\": ''${INSTALL_WINDOWS_EXE}}" > "$STACKS_JSON"

touch "$STAMP_FILE"
sync
echo "Setup complete! Optimized KDE Plasma 6 Wayland is ready."

  '';

  monolithPkg = pkgs.writeShellScriptBin "monolith-pkg" ''
#!/usr/bin/env bash
# Monolith NixOS — Global Nix Package Manager (monolith-pkg install|remove|list|search)
set -euo pipefail

CMD="''${1:-help}"
PKG="''${2:-}"

case "$CMD" in
  install|add)
    [[ -n "$PKG" ]] || { echo "Usage: monolith-pkg install <nixpkgs-name>"; exit 1; }
    CLEAN="''${PKG#nixpkgs#}"
    echo "Installing global Nix package: nixpkgs#$CLEAN ..."
    nix --extra-experimental-features "nix-command flakes" profile install "nixpkgs#$CLEAN"
    if mountpoint -q /persist 2>/dev/null; then
      sudo mkdir -p /persist/nix-cache /persist/nixos
      mapfile -t STORE_PATHS < <(nix --extra-experimental-features "nix-command flakes" profile list --json 2>/dev/null | jq -r '.. | .storePaths? // empty | .[]' | sort -u || true)
      if [[ ''${#STORE_PATHS[@]} -gt 0 ]]; then
        nix --extra-experimental-features "nix-command flakes" copy --to "file:///persist/nix-cache" "''${STORE_PATHS[@]}" || true
        printf '%s\n' "''${STORE_PATHS[@]}" | sudo tee /persist/nixos/profile-store-paths.txt >/dev/null
      fi
      grep -qxF "nixpkgs#$CLEAN" /persist/nixos/profile-packages.txt 2>/dev/null || echo "nixpkgs#$CLEAN" | sudo tee -a /persist/nixos/profile-packages.txt >/dev/null
    fi
    sync
    echo "[OK] Installed '$CLEAN' globally and cached on MONOLITH_PERSIST."
    ;;
  remove|rm)
    [[ -n "$PKG" ]] || { echo "Usage: monolith-pkg remove <nixpkgs-name>"; exit 1; }
    nix --extra-experimental-features "nix-command flakes" profile remove "$PKG"
    sync
    echo "[OK] Removed '$PKG' from global Nix profile."
    ;;
  list|ls)
    nix --extra-experimental-features "nix-command flakes" profile list
    ;;
  search)
    [[ -n "$PKG" ]] || { echo "Usage: monolith-pkg search <query>"; exit 1; }
    nix --extra-experimental-features "nix-command flakes" search nixpkgs "$PKG"
    ;;
  *)
    echo "Monolith NixOS Global Package Manager"
    echo "  monolith-pkg install <pkg>   Install global app via nix profile install nixpkgs#<pkg>"
    echo "  monolith-pkg remove <pkg>    Remove global app from Nix profile"
    echo "  monolith-pkg list            List globally installed Nix packages"
    echo "  monolith-pkg search <query>  Search latest nixos-unstable packages"
    ;;
esac

  '';

  monolithRamClean = pkgs.writeShellScriptBin "monolith-ram-clean" ''
#!/usr/bin/env bash
# Monolith NixOS — Idle RAM Sweeper & On-Demand Project Package Unloader (Target: < 500 MB Idle)
set -uo pipefail

QUIET=0
[[ "''${1:-}" == "--quiet" ]] && QUIET=1

USER_UID=$(id -u "dev" 2>/dev/null || echo "1000")
RAM_ROOT="/run/user/''${USER_UID}/monolith-projects"

# Unmount inactive RAM-only project package caches when no shell is inside the project directory
if [[ -d "$RAM_ROOT" ]]; then
  for proj_ram in "$RAM_ROOT"/*; do
    [[ -d "$proj_ram" ]] || continue
    proj_name=$(basename "$proj_ram")
    if ! lsof +D "$proj_ram" >/dev/null 2>&1; then
      rm -rf "$proj_ram" 2>/dev/null || true
      [[ "$QUIET" == "0" ]] && echo "[RAM] Unloaded idle local project packages: $proj_name"
    fi
  done
fi

# Flush filesystem buffers and reclaim Linux pagecache, dentries, and inodes
sync
if [[ -w /proc/sys/vm/drop_caches ]]; then
  echo 3 > /proc/sys/vm/drop_caches 2>/dev/null || true
else
  sudo sh -c 'sync && echo 3 > /proc/sys/vm/drop_caches' 2>/dev/null || true
fi

if [[ "$QUIET" == "0" ]]; then
  USED_MB=$(free -m | awk '/^Mem:/ {print $3}')
  echo "[OK] Idle RAM cleaned. Current memory used: ''${USED_MB} MB (target < 500 MB)."
fi

  '';

  monolithScreensaver = pkgs.writeShellScriptBin "monolith-screensaver" ''
#!/usr/bin/env bash
# Monolith NixOS — Theme-Synced Minimal TUI Screensaver (Obsidian Matte · Style: clock)
set -uo pipefail

if [[ "''${1:-}" == "--render" ]]; then
  STYLE="clock"
  trap 'tput cnorm; clear; exit 0' INT TERM EXIT
  tput civis
  clear
  while true; do
    ROWS=$(tput lines)
    COLS=$(tput cols)
    MID_R=$(( ROWS / 2 ))
    NOW=$(date +"%H:%M:%S")
    DAY=$(date +"%A, %B %d")
    MEM_MB=$(free -m | awk '/^Mem:/ {print $3}')
    clear
    tput cup $((MID_R - 3)) $(( (COLS - 28) / 2 ))
    printf "\033[1;36mMONOLITH NIXOS · PLASMA 6 WAYLAND\033[0m"
    tput cup $((MID_R - 1)) $(( (COLS - ''${#NOW}) / 2 ))
    printf "\033[1;37m%s\033[0m" "$NOW"
    tput cup $((MID_R + 1)) $(( (COLS - ''${#DAY}) / 2 ))
    printf "\033[0;37m%s\033[0m" "$DAY"
    INFO="RAM ''${MEM_MB} MB (IDLE CLEAN) · Press any key to resume"
    tput cup $((MID_R + 3)) $(( (COLS - ''${#INFO}) / 2 ))
    printf "\033[0;90m%s\033[0m" "$INFO"
    if read -rsn1 -t 1 _; then
      break
    fi
  done
  exit 0
fi

# Clean idle RAM before locking / screensaver
monolith-ram-clean --quiet || true
if [[ -n "''${WAYLAND_DISPLAY:-}" ]] && command -v loginctl >/dev/null 2>&1; then
  loginctl lock-session >/dev/null 2>&1 || exec konsole --fullscreen -e monolith-screensaver --render
else
  exec konsole --fullscreen -e monolith-screensaver --render
fi

  '';

  monolithHardware = pkgs.writeShellScriptBin "monolith-hardware" ''
#!/usr/bin/env bash
# Monolith NixOS — Theme-Synced TUI Hardware & Ports Manager (USB, HDMI, Wi-Fi, Bluetooth)
set -uo pipefail
export DIALOGRC="$HOME/.dialogrc"

if [[ "''${1:-}" == "--bar" ]]; then
  USB_CNT=$(lsblk -dnpo TRAN 2>/dev/null | grep -c '^usb$' || true)
  HDMI_OUT=$(kscreen-doctor -o 2>/dev/null | sed 's/\x1b\[[0-9;]*m//g' | grep -oE '(HDMI|DP)-[A-Za-z0-9-]+' | head -n 1 || true)
  [[ -n "$HDMI_OUT" ]] && HDMI_TXT="$HDMI_OUT" || HDMI_TXT="eDP"
  echo "USB:''${USB_CNT} ''${HDMI_TXT}"
  exit 0
fi

CHOICE=$(dialog --clear --backtitle "Monolith NixOS — Hardware & Ports TUI" \
  --title " USB · HDMI · Wi-Fi · Bluetooth · Idle RAM " \
  --stdout --menu "Select a hardware subsystem to inspect or configure:" 16 74 7 \
  "usb"    "USB Ports & Removable Drives (lsusb + lsblk + udisks2)" \
  "hdmi"   "HDMI / DisplayPort Monitors & Audio (kscreen-doctor + wpctl)" \
  "wifi"   "Wi-Fi & Ethernet Networks (nmtui)" \
  "bt"     "Bluetooth Devices & Audio (bluetui)" \
  "ram"    "Inspect & Clean Idle RAM (< 500 MB budget)" \
  "exe"    "Windows .exe Runtime Status (Wine + Winetricks)") || exit 0

case "$CHOICE" in
  usb)
    clear
    echo "=== USB DEVICES ==="
    lsusb || true
    echo ""
    echo "=== BLOCK & USB STORAGE ==="
    lsblk -o NAME,SIZE,TRAN,FSTYPE,MOUNTPOINT,LABEL || true
    read -rp "Press Enter to return..." _ || true
    ;;
  hdmi)
    clear
    echo "=== WAYLAND DISPLAYS (HDMI / DP / eDP) ==="
    kscreen-doctor -o 2>/dev/null || wlr-randr 2>/dev/null || true
    echo ""
    echo "=== PIPEWIRE AUDIO SINKS (HDMI / SPEAKERS / BT) ==="
    wpctl status || true
    read -rp "Press Enter to return..." _ || true
    ;;
  wifi) exec nmtui ;;
  bt) exec monolith-bluetooth ;;
  ram)
    clear
    monolith-ram-clean
    free -h
    read -rp "Press Enter to return..." _ || true
    ;;
  exe)
    clear
    if command -v wine >/dev/null 2>&1; then
      echo "[OK] Wine active: $(wine --version)"
      echo "Run any Windows app with: monolith-exe /path/to/app.exe"
    else
      echo "Wine is not installed. Run: monolith-pkg install wineWowPackages.stable"
    fi
    read -rp "Press Enter to return..." _ || true
    ;;
esac

  '';

  monolithSettings = pkgs.writeShellScriptBin "monolith-settings" ''
#!/usr/bin/env bash
# Monolith NixOS — Graphical System Settings Launcher (Super + ,)
set -uo pipefail
if [[ -n "''${WAYLAND_DISPLAY:-}" || -n "''${DISPLAY:-}" ]] && command -v systemsettings >/dev/null 2>&1; then
  exec systemsettings "$@"
fi
exec monolith-config

  '';

  monolithExe = pkgs.writeShellScriptBin "monolith-exe" ''
#!/usr/bin/env bash
# Monolith NixOS — Windows .exe Launcher (Wine + Persistent ~/.wine on MONOLITH_PERSIST)
set -euo pipefail
if ! command -v wine >/dev/null 2>&1; then
  echo "Windows .exe support (Wine) is not installed yet."
  echo "Install it anytime with: monolith-pkg install wineWowPackages.stable"
  exit 1
fi
export WINEPREFIX="$HOME/.wine"
exec wine "$@"

  '';

  monolithReset = pkgs.writeShellScriptBin "monolith-reset" ''
#!/usr/bin/env bash
# Monolith NixOS — Clean Project Reset
# Clears workspace files, local project caches, and dynamic toolchains.
# STRICTLY PRESERVES: Wi-Fi/Ethernet, Bluetooth, ~/.ssh, ~/.gitconfig, theme, wallpaper, shortcuts & OS settings.
set -euo pipefail

WORKSPACE="/home/dev/workspace"
PKG_TRACK="$HOME/.config/monolith/installed-project-pkgs.txt"

echo "================================================================="
echo "  MONOLITH NIXOS — PROJECT RESET"
echo "================================================================="
echo "WILL CLEAR:"
echo "  - Workspace directory: $WORKSPACE"
echo "  - Per-project RAM caches & toolchains (~/.local/share/mise, ~/.cargo, ~/go)"
echo "  - Dynamic build caches (~/.cache, ~/.m2, ~/.npm)"
echo ""
echo "WILL PRESERVE:"
echo "  - Wi-Fi & Ethernet profiles (/etc/NetworkManager/system-connections)"
echo "  - Bluetooth paired devices (/var/lib/bluetooth -> /persist/bluetooth)"
echo "  - SSH keys (/home/dev/.ssh) & Git identity (~/.gitconfig)"
echo "  - OS theme, wallpaper, rounded corners, shortcuts & ~/SHORTCUTS.txt"
echo ""

read -rp "Type RESET to wipe this project and return to First-Boot Wizard: " CONFIRM
[[ "$CONFIRM" == "RESET" ]] || { echo "Reset cancelled."; exit 0; }

rm -rf "$WORKSPACE"/* "$HOME/.cache"/* "$HOME/.local/share/mise" "$HOME/.config/mise" \
  "$HOME/.local/share/uv" "$HOME/.cargo" "$HOME/.rustup" "$HOME/.m2" "$HOME/.npm" "$HOME/go"

monolith-ram-clean --quiet || true

if [[ -f "$PKG_TRACK" ]]; then
  nix --extra-experimental-features "nix-command flakes" profile remove '.*' || true
  rm -f "$PKG_TRACK"
fi

rm -f "$HOME/.config/monolith/.firstboot-complete" "$HOME/.config/monolith/active-stacks.json" "$HOME/.config/monolith/selected-versions.json"
sync
echo "Project reset complete. Re-arming First-Boot Wizard..."
exec monolith-firstboot --force

  '';

  monolithPersistUsb = pkgs.writeShellScriptBin "monolith-persist-usb" ''
#!/usr/bin/env bash
# Monolith NixOS — Universal Auto-Scaling USB Persistence Partitioner & Mounter
# Allocates 100% of remaining space to MONOLITH_PERSIST (ext4)
# Supports Rufus DD mode (auto-appended ext4 partition) & Rufus ISO mode (loopback ext4 image fallback).
set -euo pipefail

PERSIST_LABEL="MONOLITH_PERSIST"
PERSIST_PERCENT=100
CREATE_EXFAT=0
USER_NAME="dev"
LOOP_IMG_NAME="monolith-persist.img"

show_status() {
  echo "================================================================="
  echo "  MONOLITH NIXOS — USB PENDRIVE PERSISTENCE STATUS"
  echo "================================================================="
  if mountpoint -q /persist; then
    SRC=$(findmnt -n -o SOURCE /persist 2>/dev/null || echo "unknown")
    FSTYPE=$(findmnt -n -o FSTYPE /persist 2>/dev/null || echo "unknown")
    SIZE_INFO=$(df -h /persist | awk 'NR==2 {printf "%s used / %s total (%s free)", $3, $2, $4}')
    echo "  Status     : ACTIVE (Storing directly on USB pendrive)"
    echo "  Device     : $SRC ($FSTYPE)"
    echo "  Capacity   : $SIZE_INFO"
    echo "  Home Bound : $(mountpoint -q "/home/''${USER_NAME}" && echo "YES -> /persist/home/''${USER_NAME}" || echo "NO")"
    echo "  Wi-Fi      : $(mountpoint -q /etc/NetworkManager/system-connections && echo "YES -> /persist/NetworkManager" || echo "NO")"
    echo "  Bluetooth  : $(mountpoint -q /var/lib/bluetooth && echo "YES -> /persist/bluetooth" || echo "NO")"
    echo "  NixOS Cfg  : $(mountpoint -q /etc/nixos && echo "YES -> /persist/nixos" || echo "NO")"
    if touch /persist/.write-check 2>/dev/null && sync && rm -f /persist/.write-check; then
      echo "  Write Test : PASS (flushed to USB flash)"
    else
      echo "  Write Test : FAIL (read-only mount)"
    fi
  else
    echo "  Status     : INACTIVE (RAM-ONLY tmpfs — data WILL NOT survive reboot!)"
    echo "  Hint       : Run 'sudo monolith-persist-usb' or flash ISO in Rufus DD mode."
  fi
  echo "================================================================="
}

if [[ "''${1:-}" == "--status" ]]; then
  show_status
  exit 0
fi

mount_and_bind_persist() {
  local target_src="$1"
  mkdir -p /persist "/home/''${USER_NAME}" /etc/NetworkManager/system-connections /var/lib/bluetooth /etc/nixos
  if ! mountpoint -q /persist; then
    if [[ -f "$target_src" ]]; then
      mount -o loop,rw "$target_src" /persist
    else
      mount -o rw "$target_src" /persist
    fi
  fi

  mkdir -p "/persist/home/''${USER_NAME}" "/persist/home/''${USER_NAME}/workspace" /persist/projects /persist/NetworkManager /persist/bluetooth /persist/nixos /persist/nix-cache

  local user_group
  user_group=$(id -gn "''${USER_NAME}" 2>/dev/null || echo "users")

  if ! mountpoint -q "/home/''${USER_NAME}"; then
    cp -rn "/home/''${USER_NAME}/." "/persist/home/''${USER_NAME}/" 2>/dev/null || true
    chown -R "''${USER_NAME}:''${user_group}" "/persist/home/''${USER_NAME}"
    mount --bind "/persist/home/''${USER_NAME}" "/home/''${USER_NAME}"
  fi
  chown -R "''${USER_NAME}:''${user_group}" /persist/projects 2>/dev/null || true

  local need_net_restart=0
  if ! mountpoint -q /etc/NetworkManager/system-connections; then
    cp -rn /etc/NetworkManager/system-connections/. /persist/NetworkManager/ 2>/dev/null || true
    mount --bind /persist/NetworkManager /etc/NetworkManager/system-connections
    chmod 700 /etc/NetworkManager/system-connections
    need_net_restart=1
  fi

  local need_bt_restart=0
  if ! mountpoint -q /var/lib/bluetooth; then
    cp -rn /var/lib/bluetooth/. /persist/bluetooth/ 2>/dev/null || true
    mount --bind /persist/bluetooth /var/lib/bluetooth
    need_bt_restart=1
  fi

  if ! mountpoint -q /etc/nixos; then
    cp -rn /etc/nixos/. /persist/nixos/ 2>/dev/null || true
    mount --bind /persist/nixos /etc/nixos
  fi
  chown -R "''${USER_NAME}:''${user_group}" /persist/nixos 2>/dev/null || true

  touch /persist/.monolith-persist-ok
  sync

  if [[ "$need_net_restart" == "1" ]] && systemctl is-active --quiet NetworkManager 2>/dev/null; then
    nmcli connection reload >/dev/null 2>&1 || true
  fi
  if [[ "$need_bt_restart" == "1" ]] && systemctl is-active --quiet bluetooth 2>/dev/null; then
    systemctl try-restart bluetooth >/dev/null 2>&1 || true
  fi
}

udevadm settle --timeout=10 >/dev/null 2>&1 || true

EXISTING_PERSIST=""
for _ in 1 2 3 4 5; do
  EXISTING_PERSIST=$(blkid -c /dev/null -L "$PERSIST_LABEL" 2>/dev/null || true)
  [[ -n "$EXISTING_PERSIST" ]] && break
  sleep 0.5
done

BOOT_PART=""
BOOT_MNT=""
CANDIDATE=$(findmnt -n -o SOURCE /iso 2>/dev/null || true)
if [[ -n "$CANDIDATE" && "$CANDIDATE" != /dev/loop* ]]; then
  BOOT_PART="$CANDIDATE"
  BOOT_MNT="/iso"
fi
if [[ -z "$BOOT_PART" ]]; then
  CANDIDATE=$(blkid -c /dev/null -L "MONOLITH_NIX" 2>/dev/null || true)
  if [[ -n "$CANDIDATE" ]]; then
    BOOT_PART="$CANDIDATE"
    BOOT_MNT=$(findmnt -n -o TARGET "$CANDIDATE" 2>/dev/null | head -n 1 || true)
  fi
fi
if [[ -z "$BOOT_PART" ]]; then
  USB_DISK=$(lsblk -dnpo NAME,TRAN 2>/dev/null | awk '$2=="usb" {print $1; exit}')
  [[ -n "$USB_DISK" ]] && BOOT_PART="$USB_DISK"
fi

BOOT_NAME=$(lsblk -no pkname "$BOOT_PART" 2>/dev/null | head -n 1 || true)
if [[ -z "$BOOT_NAME" && -b "$BOOT_PART" ]]; then
  BOOT_NAME=$(basename "$BOOT_PART")
fi
BOOT_DEV="/dev/''${BOOT_NAME}"

if [[ -n "$EXISTING_PERSIST" ]]; then
  mount_and_bind_persist "$EXISTING_PERSIST"
  echo "Persistence active at /persist ($EXISTING_PERSIST — $(df -h /persist | awk 'NR==2 {print $2}') total)."
  exit 0
fi

if [[ -n "$BOOT_MNT" && -f "$BOOT_MNT/$LOOP_IMG_NAME" ]]; then
  mount -o remount,rw "$BOOT_MNT" 2>/dev/null || true
  mount_and_bind_persist "$BOOT_MNT/$LOOP_IMG_NAME"
  echo "Loopback USB persistence active at /persist ($BOOT_MNT/$LOOP_IMG_NAME)."
  exit 0
fi

if [[ -z "$BOOT_NAME" || ! -b "$BOOT_DEV" ]]; then
  echo "Unable to determine USB block device (BOOT_PART=$BOOT_PART)." >&2
  exit 1
fi

sgdisk -e "$BOOT_DEV" >/dev/null 2>&1 || true
partx -a "$BOOT_DEV" >/dev/null 2>&1 || true
udevadm settle --timeout=5 >/dev/null 2>&1 || sleep 1

TOTAL_SECTORS=$(blockdev --getsz "$BOOT_DEV")
LAST_END=$(sfdisk -d "$BOOT_DEV" 2>/dev/null | awk -F'[,= ]+' '/start=/ {
  s=0; z=0;
  for (i=1; i<=NF; i++) {
    if ($i == "start") s=$(i+1);
    if ($i == "size") z=$(i+1);
  }
  if (s + z > max) max = s + z;
} END { print max + 0 }')

START_SECTOR=$(( ((LAST_END + 2047) / 2048) * 2048 ))
FREE_SECTORS=$(( TOTAL_SECTORS - START_SECTOR - 2048 ))
FREE_MIB=$(( FREE_SECTORS / 2048 ))

if [[ "$FREE_MIB" -lt 2048 ]]; then
  if [[ -n "$BOOT_MNT" ]]; then
    FSTYPE=$(findmnt -n -o FSTYPE "$BOOT_MNT" 2>/dev/null || echo "")
    if [[ "$FSTYPE" != "iso9660" && "$FSTYPE" != "udf" ]]; then
      mount -o remount,rw "$BOOT_MNT" 2>/dev/null || true
      AVAIL_MIB=$(df -m "$BOOT_MNT" 2>/dev/null | awk 'NR==2 {print $4}')
      if [[ "''${AVAIL_MIB:-0}" -ge 2048 ]]; then
        IMG_MIB=$(( AVAIL_MIB * PERSIST_PERCENT / 100 ))
        if [[ "$FSTYPE" == "vfat" && "$IMG_MIB" -gt 3900 ]]; then
          IMG_MIB=3900
        fi
        fallocate -l "''${IMG_MIB}M" "$BOOT_MNT/$LOOP_IMG_NAME" 2>/dev/null || dd if=/dev/zero of="$BOOT_MNT/$LOOP_IMG_NAME" bs=1M count=0 seek="$IMG_MIB"
        mkfs.ext4 -q -F -L "$PERSIST_LABEL" "$BOOT_MNT/$LOOP_IMG_NAME"
        mount_and_bind_persist "$BOOT_MNT/$LOOP_IMG_NAME"
        exit 0
      fi
    fi
  fi
  echo "Insufficient unallocated space (''${FREE_MIB} MiB) on $BOOT_DEV." >&2
  exit 1
fi

BEFORE_PARTS=$(lsblk -lnpo NAME "$BOOT_DEV" | tail -n +2 | sort)

if [[ "$CREATE_EXFAT" == "1" ]]; then
  PERSIST_MIB=$(( FREE_MIB * PERSIST_PERCENT / 100 ))
  PERSIST_SECTORS=$(( PERSIST_MIB * 2048 ))
  REMAINING_MIB=$(( FREE_MIB - PERSIST_MIB ))
  if [[ "$REMAINING_MIB" -lt 512 ]]; then
    CREATE_EXFAT="0"
    printf '%s,%s,L\n' "$START_SECTOR" "$FREE_SECTORS" | sfdisk --append --force --no-reread "$BOOT_DEV" >/dev/null
  else
    printf '%s,%s,L\n' "$START_SECTOR" "$PERSIST_SECTORS" | sfdisk --append --force --no-reread "$BOOT_DEV" >/dev/null
  fi
else
  printf '%s,%s,L\n' "$START_SECTOR" "$FREE_SECTORS" | sfdisk --append --force --no-reread "$BOOT_DEV" >/dev/null
fi

partx -a "$BOOT_DEV" >/dev/null 2>&1 || partprobe "$BOOT_DEV" >/dev/null 2>&1 || true
udevadm settle --timeout=10 >/dev/null 2>&1 || sleep 2

AFTER_PARTS=$(lsblk -lnpo NAME "$BOOT_DEV" | tail -n +2 | sort)
PERSIST_DEV=$(comm -13 <(printf '%s\n' "$BEFORE_PARTS") <(printf '%s\n' "$AFTER_PARTS") | head -n 1)

if [[ -z "$PERSIST_DEV" || ! -b "$PERSIST_DEV" ]]; then
  echo "Failed to detect newly created persistence partition on $BOOT_DEV." >&2
  exit 1
fi

mkfs.ext4 -q -F -L "$PERSIST_LABEL" "$PERSIST_DEV"

if [[ "$CREATE_EXFAT" == "1" ]]; then
  BEFORE_XFER=$(lsblk -lnpo NAME "$BOOT_DEV" | tail -n +2 | sort)
  XFER_START=$(( START_SECTOR + PERSIST_SECTORS ))
  XFER_SECTORS=$(( TOTAL_SECTORS - XFER_START - 2048 ))
  XFER_TYPE="EBD0A0A2-B9E5-4433-87C0-68B6B72699C7"
  printf '%s,%s,%s\n' "$XFER_START" "$XFER_SECTORS" "$XFER_TYPE" | sfdisk --append --force --no-reread "$BOOT_DEV" >/dev/null || true
  partx -a "$BOOT_DEV" >/dev/null 2>&1 || partprobe "$BOOT_DEV" >/dev/null 2>&1 || true
  udevadm settle --timeout=10 >/dev/null 2>&1 || sleep 2
  AFTER_XFER=$(lsblk -lnpo NAME "$BOOT_DEV" | tail -n +2 | sort)
  XFER_DEV=$(comm -13 <(printf '%s\n' "$BEFORE_XFER") <(printf '%s\n' "$AFTER_XFER") | head -n 1)
  if [[ -n "$XFER_DEV" && -b "$XFER_DEV" && "$XFER_DEV" != "$PERSIST_DEV" ]]; then
    mkfs.exfat -n "MONOLITH_XFER" "$XFER_DEV" >/dev/null || true
  fi
fi

mount_and_bind_persist "$PERSIST_DEV"
echo "Persistence ready at /persist ($PERSIST_DEV — $(df -h /persist | awk 'NR==2 {print $2}') total)."

  '';

  monolithShortcutMenu = pkgs.writeShellScriptBin "monolith-shortcut-menu" ''
#!/usr/bin/env bash
# Monolith NixOS — Single Unified Shortcut Reference (Super + /)
set -euo pipefail
SHORTCUT_FILE="$HOME/SHORTCUTS.txt"
[[ -f "$SHORTCUT_FILE" ]] || { echo "SHORTCUTS.txt missing"; exit 1; }
if [[ -t 1 ]]; then
  cat "$SHORTCUT_FILE"
  echo ""
  read -rp "Press Enter to close (or run systemsettings -> Shortcuts to edit visually)..." _ || true
else
  exec konsole --hold -e bash -lc 'cat "$HOME/SHORTCUTS.txt"; echo ""; echo "Tip: Press Super + , (System Settings -> Keyboard -> Shortcuts) to edit or add any shortcut."'
fi

  '';

  monolithPlasmaInit = pkgs.writeShellScriptBin "monolith-plasma-init" ''
#!/usr/bin/env bash
# Monolith NixOS — Apply Rounded Floating Auto-Hide Panel, Minimal Wallpaper & First-Boot Hook
set -uo pipefail

STATE_FLAG="$HOME/.config/monolith/.plasma-layout-applied"
QDBUS_BIN="$(command -v qdbus || command -v qdbus6 || true)"

for _ in $(seq 1 25); do
  if [[ -n "$QDBUS_BIN" ]] && "$QDBUS_BIN" org.kde.plasmashell /PlasmaShell >/dev/null 2>&1; then
    break
  fi
  sleep 0.4
done

if [[ ! -f "$STATE_FLAG" ]]; then
  if [[ "obsidian-horizon" != "solid-matte" && -f "/home/dev/.config/monolith/wallpaper.svg" ]] && command -v plasma-apply-wallpaperimage >/dev/null 2>&1; then
    plasma-apply-wallpaperimage "/home/dev/.config/monolith/wallpaper.svg" >/dev/null 2>&1 || true
  fi

  if [[ -n "$QDBUS_BIN" ]]; then
    "$QDBUS_BIN" org.kde.plasmashell /PlasmaShell org.kde.PlasmaShell.evaluateScript '
      var allPanels = panels();
      for (var i = 0; i < allPanels.length; i++) {
        var p = allPanels[i];
        p.floating = true;
        p.location = "bottom";
        p.height = 42;
        p.hiding = "autohide";
      }
    ' >/dev/null 2>&1 || true
  fi

  mkdir -p "$HOME/.config/monolith"
  touch "$STATE_FLAG"
fi

if [[ ! -f "$HOME/.config/monolith/.firstboot-complete" ]]; then
  if ! grep -qE '^[[:space:]]*MONOLITH_SKIP_WIZARD="?true"?' /persist/monolith-boot.conf /etc/monolith/boot.conf 2>/dev/null; then
    konsole -e monolith-firstboot &
  fi
fi

  '';

  monolithBluetooth = pkgs.writeShellScriptBin "monolith-bluetooth" ''
#!/usr/bin/env bash
# Monolith NixOS — Keyboard-Driven Bluetooth Manager (Super + Alt + B)
set -uo pipefail

if command -v rfkill >/dev/null 2>&1; then
  sudo rfkill unblock bluetooth >/dev/null 2>&1 || true
fi
if command -v bluetoothctl >/dev/null 2>&1; then
  bluetoothctl power on >/dev/null 2>&1 || true
fi

if command -v bluetui >/dev/null 2>&1; then
  exec bluetui
elif command -v bluetoothctl >/dev/null 2>&1; then
  exec bluetoothctl
fi

  '';

  monolithConfig = pkgs.writeShellScriptBin "monolith-config" ''
#!/usr/bin/env bash
# Monolith NixOS — Direct Pendrive Configuration Editor (Super + Alt + C)
set -uo pipefail

export DIALOGRC="$HOME/.dialogrc"
EDITOR_BIN="''${EDITOR:-nvim}"
command -v "$EDITOR_BIN" >/dev/null 2>&1 || EDITOR_BIN="vi"

if ! mountpoint -q /persist; then
  sudo monolith-persist-usb || true
fi

TARGET="''${1:-}"
if [[ -z "$TARGET" ]]; then
  TARGET=$(dialog --clear --backtitle "Monolith NixOS — Pendrive Config Editor" \
    --title " Edit Persistent Configs on MONOLITH_PERSIST " \
    --stdout --menu "Select a configuration file stored on your USB pendrive:" 17 76 8 \
    "packages"  "NixOS Global Packages (/etc/nixos/user-packages.nix)" \
    "nix"       "NixOS System Config (/etc/nixos/configuration.nix)" \
    "flake"     "NixOS Flake Definition (/etc/nixos/flake.nix)" \
    "shortcuts" "Plasma 6 Global Shortcuts (~/.config/kglobalshortcutsrc)" \
    "kwin"      "KWin Window Rules & Buttons (~/.config/kwinrc)" \
    "theme"     "Plasma 6 Unified Theme & Fonts (~/.config/kdeglobals)" \
    "nvim"      "Neovim IDE Config (~/.config/nvim/init.lua)" \
    "status"    "Check USB Pendrive Persistence & Free Space") || exit 0
fi

open_and_sync() {
  local file_path="$1"
  mkdir -p "$(dirname "$file_path")" 2>/dev/null || sudo mkdir -p "$(dirname "$file_path")"
  if [[ -w "$file_path" ]] || [[ -w "$(dirname "$file_path")" ]]; then
    "$EDITOR_BIN" "$file_path"
  else
    sudo "$EDITOR_BIN" "$file_path"
  fi
  sync
  echo "[OK] Saved & flushed '$file_path' directly to USB pendrive (MONOLITH_PERSIST)."
}

case "$TARGET" in
  packages|user-packages) open_and_sync "/etc/nixos/user-packages.nix" ;;
  nix|nixos|config)       open_and_sync "/etc/nixos/configuration.nix" ;;
  flake)                  open_and_sync "/etc/nixos/flake.nix" ;;
  shortcuts)              open_and_sync "$HOME/.config/kglobalshortcutsrc" ;;
  kwin)                   open_and_sync "$HOME/.config/kwinrc" ;;
  theme)                  open_and_sync "$HOME/.config/kdeglobals" ;;
  nvim|neovim)            open_and_sync "$HOME/.config/nvim/init.lua" ;;
  status)
    monolith-persist-usb --status
    read -rp "Press Enter to close..." _ || true
    ;;
  *)
    echo "Usage: monolith-config [packages|nix|flake|shortcuts|kwin|theme|nvim|status]"
    exit 1
    ;;
esac

  '';

  monolithNewProject = pkgs.writeShellScriptBin "monolith-new-project" ''
#!/usr/bin/env bash
# Monolith NixOS — Project Generator with On-Demand RAM-Only Local Nix Packages (Super + Alt + N)
set -uo pipefail

export DIALOGRC="$HOME/.dialogrc"
WORKSPACE="/home/dev/workspace"

if ! mountpoint -q /persist || ! mountpoint -q "$HOME"; then
  sudo monolith-persist-usb || true
fi

PROJ_NAME="''${1:-}"
STACK="''${2:-}"
LOCAL_PKGS="''${3:-}"

if [[ -z "$PROJ_NAME" ]]; then
  PROJ_NAME=$(dialog --clear --backtitle "Monolith NixOS — New Project (RAM-Only Local Packages)" \
    --title " Step 1: Project Directory Name " \
    --stdout --inputbox "Folder name under $WORKSPACE/<name>:" 10 74 "my-project") || exit 0
fi

PROJ_NAME=$(echo "$PROJ_NAME" | tr ' ' '-' | tr -cd 'a-zA-Z0-9._-')
[[ -n "$PROJ_NAME" ]] || { echo "Invalid project name." >&2; exit 1; }

if [[ -z "$STACK" ]]; then
  STACK=$(dialog --clear --backtitle "Monolith NixOS — Select Local Project Stack" \
    --title " Step 2: Select Base Stack (Loaded in RAM ONLY inside this project) " \
    --stdout --menu "Choose local devShell packages for '$PROJ_NAME':" 16 76 8 \
    "rust"   "Rust (rustc + cargo + rust-analyzer + clippy)" \
    "nodejs" "Node.js 22 & TypeScript (nodejs_22 + pnpm + ts-ls)" \
    "python" "Python 3.12 (python312 + uv + ruff + pyright)" \
    "java"   "Java 21 LTS (jdk21 + maven + gradle + jdtls)" \
    "go"     "Go (go + gopls + delve)" \
    "cpp"    "C / C++ (gcc + clang-tools + cmake + ninja + gdb)" \
    "custom" "Custom local nixpkgs only") || exit 0
fi

if [[ -z "$LOCAL_PKGS" ]]; then
  LOCAL_PKGS=$(dialog --clear --backtitle "Monolith NixOS — Extra Local Project Packages" \
    --title " Step 3: Additional Local Packages (RAM-Only When Project Active) " \
    --stdout --inputbox "Optional space-separated nixpkgs only for '$PROJ_NAME' (e.g. sqlite redis jq):" 10 74 "") || LOCAL_PKGS=""
fi

NIX_PKGS=()
case "$STACK" in
  java)   NIX_PKGS+=(jdk21 maven gradle jdt-language-server) ;;
  rust)   NIX_PKGS+=(rustc cargo rustfmt clippy rust-analyzer) ;;
  go)     NIX_PKGS+=(go gopls delve) ;;
  python) NIX_PKGS+=(python312 uv ruff pyright) ;;
  nodejs) NIX_PKGS+=(nodejs_22 pnpm nodePackages.typescript nodePackages.typescript-language-server) ;;
  cpp)    NIX_PKGS+=(gcc clang-tools cmake ninja gdb) ;;
  custom) ;;
esac

if [[ -n "$LOCAL_PKGS" ]]; then
  read -ra EXTRA_LIST <<< "$LOCAL_PKGS"
  NIX_PKGS+=("''${EXTRA_LIST[@]}")
fi

PROJ_DIR="$WORKSPACE/$PROJ_NAME"
mkdir -p "$PROJ_DIR"
[[ -d /persist/projects ]] && ln -sfn "$PROJ_DIR" "/persist/projects/$PROJ_NAME" 2>/dev/null || true

PKGS_BLOCK=""
for p in "''${NIX_PKGS[@]}"; do
  PKGS_BLOCK="''${PKGS_BLOCK}          ''${p}
"
done

cat > "$PROJ_DIR/flake.nix" <<FLAKE_EOF
{
  description = "$PROJ_NAME — Monolith NixOS RAM-Only Local Project ($STACK)";
  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  outputs = { self, nixpkgs }:
    let
      system = "x86_64-linux";
      pkgs = import nixpkgs { inherit system; config.allowUnfree = true; };
    in {
      devShells.''${system}.default = pkgs.mkShell {
        name = "$PROJ_NAME-ram-dev";
        packages = with pkgs; [
$(printf "%b" "$PKGS_BLOCK")        ];
        shellHook = '''
          export MONOLITH_ACTIVE_PROJECT="$PROJ_NAME"
          export MONOLITH_RAM_DIR="/run/user/$(id -u)/monolith-projects/$PROJ_NAME"
          mkdir -p "$MONOLITH_RAM_DIR"
          export XDG_CACHE_HOME="$MONOLITH_RAM_DIR/cache"
          export TMPDIR="$MONOLITH_RAM_DIR/tmp"
          mkdir -p "$XDG_CACHE_HOME" "$TMPDIR"
          echo "[MONOLITH] Local project packages loaded in RAM for $PROJ_NAME (auto-cleared when idle)."
        ''';
      };
    };
}
FLAKE_EOF

cat > "$PROJ_DIR/.envrc" <<'ENVRC_EOF'
use flake
ENVRC_EOF

git -C "$PROJ_DIR" init -q >/dev/null 2>&1 || true
command -v direnv >/dev/null 2>&1 && direnv allow "$PROJ_DIR" >/dev/null 2>&1 || true
sync
echo "[OK] Created RAM-only local project at $PROJ_DIR (local pkgs load on cd & clear on idle)."

  '';

  monolithScreenshot = pkgs.writeShellScriptBin "monolith-screenshot" ''
#!/usr/bin/env bash
# Monolith NixOS — Native Plasma 6 Wayland Screenshot Utility (spectacle + fallback)
set -euo pipefail

MODE="''${1:-region}"
SHOT_DIR="$HOME/Pictures/Screenshots"
mkdir -p "$SHOT_DIR"
OUT_FILE="''${SHOT_DIR}/monolith-$(date +%Y%m%d-%H%M%S).png"

if command -v spectacle >/dev/null 2>&1; then
  case "$MODE" in
    region)    spectacle -b -r -n -o "$OUT_FILE" -c ;;
    full)      spectacle -b -f -n -o "$OUT_FILE" -c ;;
    clipboard) spectacle -b -r -n -c; exit 0 ;;
    *)
      echo "Usage: monolith-screenshot [region|full|clipboard]"
      exit 1
      ;;
  esac
  sync
  echo "Screenshot saved to $OUT_FILE and copied to clipboard."
  exit 0
fi

case "$MODE" in
  region)
    GEOM="$(slurp)" || exit 0
    [[ -n "$GEOM" ]] || exit 0
    grim -g "$GEOM" "$OUT_FILE"
    ;;
  full)
    grim "$OUT_FILE"
    ;;
  clipboard)
    GEOM="$(slurp)" || exit 0
    [[ -n "$GEOM" ]] || exit 0
    grim -g "$GEOM" - | wl-copy --type image/png
    exit 0
    ;;
  *)
    echo "Usage: monolith-screenshot [region|full|clipboard]"
    exit 1
    ;;
esac

wl-copy --type image/png < "$OUT_FILE" || true
sync
echo "Screenshot saved to $OUT_FILE and copied to clipboard."

  '';

  monolithUpdate = pkgs.writeShellScriptBin "monolith-update" ''
#!/usr/bin/env bash
# Monolith NixOS — Persistent Auto-Updater (Latest Nix Flake + Global Profile + GitHub ISO)
set -uo pipefail

MODE="''${1:-interactive}"
export PATH="$HOME/.local/share/mise/shims:$HOME/.local/bin:$HOME/.cargo/bin:$HOME/go/bin:$PATH"

BOOT_CONF="/etc/monolith/boot.conf"
[[ -f /persist/monolith-boot.conf ]] && BOOT_CONF="/persist/monolith-boot.conf"
GITHUB_REPO=""
if [[ -f "$BOOT_CONF" ]]; then
  GITHUB_REPO=$(grep -E '^[[:space:]]*MONOLITH_GITHUB_REPO=' "$BOOT_CONF" 2>/dev/null | tail -n 1 | sed -E 's/^[^=]+=//; s/^"//; s/"$//' || true)
fi

if ! (curl -fsS --max-time 4 https://api.github.com >/dev/null 2>&1 || ping -c 1 -W 2 1.1.1.1 >/dev/null 2>&1); then
  echo "[OFFLINE] Connect to Wi-Fi/Ethernet first (nmtui) and re-run monolith-update."
  exit 0
fi

if [[ -n "$GITHUB_REPO" ]]; then
  LATEST_JSON=$(curl -fsSL --max-time 8 "https://api.github.com/repos/''${GITHUB_REPO}/releases/latest" 2>/dev/null || true)
  LATEST_TAG=$(printf '%s' "$LATEST_JSON" | jq -r '.tag_name // empty' 2>/dev/null || true)
  if [[ -n "$LATEST_TAG" ]]; then
    echo "Latest GitHub Release: $LATEST_TAG"
    mkdir -p "$HOME/.config/monolith"
    printf '%s\n' "$LATEST_TAG" > "$HOME/.config/monolith/latest-release.txt"
  fi
fi

if [[ "$MODE" == "--check" ]]; then
  command -v mise >/dev/null 2>&1 && mise outdated || true
  exit 0
fi

command -v mise >/dev/null 2>&1 && mise upgrade || true

if [[ -f /etc/nixos/flake.nix ]]; then
  (cd /etc/nixos && nix --extra-experimental-features 'nix-command flakes' flake update) || true
fi
nix --extra-experimental-features 'nix-command flakes' profile upgrade --all || true
if [[ -d /persist/nix-cache ]]; then
  mapfile -t UPDATED_PATHS < <(nix --extra-experimental-features 'nix-command flakes' profile list --json 2>/dev/null | jq -r '.. | .storePaths? // empty | .[]' | sort -u || true)
  if [[ "''${#UPDATED_PATHS[@]}" -gt 0 ]]; then
    nix --extra-experimental-features 'nix-command flakes' copy --to 'file:///persist/nix-cache' "''${UPDATED_PATHS[@]}" || true
    printf '%s\n' "''${UPDATED_PATHS[@]}" | sudo tee /persist/nixos/profile-store-paths.txt >/dev/null
  fi
fi

sync
echo "[OK] Monolith NixOS update complete & synced to USB pendrive!"
if [[ "$MODE" == "interactive" && -t 0 ]]; then
  read -rp "Press Enter to close..." _ || true
fi

  '';

  monolithApplyBootconf = pkgs.writeShellScriptBin "monolith-apply-bootconf" ''
#!/usr/bin/env bash
# Monolith NixOS — Post-Rufus First-Boot Customizer (monolith-boot.conf)
set -uo pipefail

SKEL_DIR="''${1:-/etc/skel}"
DEFAULT_USER="dev"
PERSIST_CONF="/persist/monolith-boot.conf"
ACTIVE_CONF="/etc/monolith/boot.conf"
mkdir -p /etc/monolith

FOUND_CONF=""
for candidate in "/iso/monolith-boot.conf" "$PERSIST_CONF"; do
  if [[ -f "$candidate" ]]; then
    FOUND_CONF="$candidate"
    break
  fi
done

if [[ -z "$FOUND_CONF" ]]; then
  BOOT_PART=$(findmnt -n -o SOURCE /iso 2>/dev/null || true)
  BOOT_NAME=$(lsblk -no pkname "$BOOT_PART" 2>/dev/null | head -n 1 || true)
  if [[ -n "$BOOT_NAME" && -b "/dev/''${BOOT_NAME}" ]]; then
    SCAN_MNT="/tmp/monolith-bootconf-scan"
    mkdir -p "$SCAN_MNT"
    for part in $(lsblk -lnpo NAME "/dev/''${BOOT_NAME}" | tail -n +2); do
      EXISTING_MNT=$(findmnt -n -o TARGET "$part" 2>/dev/null | head -n 1 || true)
      if [[ -n "$EXISTING_MNT" ]]; then
        for sub in "monolith-boot.conf" "EFI/monolith-boot.conf"; do
          [[ -f "''${EXISTING_MNT}/''${sub}" ]] && FOUND_CONF="''${EXISTING_MNT}/''${sub}" && break 2
        done
      elif mount -o ro "$part" "$SCAN_MNT" 2>/dev/null; then
        for sub in "monolith-boot.conf" "EFI/monolith-boot.conf"; do
          if [[ -f "''${SCAN_MNT}/''${sub}" ]]; then
            cp "''${SCAN_MNT}/''${sub}" "$ACTIVE_CONF"
            FOUND_CONF="$ACTIVE_CONF"
            break
          fi
        done
        umount "$SCAN_MNT" 2>/dev/null || true
        [[ -n "$FOUND_CONF" ]] && break
      fi
    done
    rmdir "$SCAN_MNT" 2>/dev/null || true
  fi
fi

[[ -z "$FOUND_CONF" || ! -f "$FOUND_CONF" ]] && exit 0

tr -d '\r' < "$FOUND_CONF" > "$ACTIVE_CONF"
chmod 600 "$ACTIVE_CONF"
if mountpoint -q /persist 2>/dev/null; then
  cp "$ACTIVE_CONF" "$PERSIST_CONF"
  chmod 600 "$PERSIST_CONF"
fi

get_val() {
  local key="$1"
  grep -E "^[[:space:]]*''${key}=" "$ACTIVE_CONF" 2>/dev/null | tail -n 1 | sed -E 's/^[^=]+=//; s/^"//; s/"$//' || true
}

CFG_USER=$(get_val MONOLITH_USER)
CFG_PASS=$(get_val MONOLITH_PASSWORD)
CFG_HOST=$(get_val MONOLITH_HOSTNAME)
CFG_TZ=$(get_val MONOLITH_TIMEZONE)
CFG_KEYMAP=$(get_val MONOLITH_KEYMAP)
CFG_WIFI_SSID=$(get_val MONOLITH_WIFI_SSID)
CFG_WIFI_PSK=$(get_val MONOLITH_WIFI_PSK)
CFG_GIT_NAME=$(get_val MONOLITH_GIT_NAME)
CFG_GIT_EMAIL=$(get_val MONOLITH_GIT_EMAIL)

TARGET_USER="$DEFAULT_USER"
if [[ -n "$CFG_USER" && "$CFG_USER" =~ ^[a-z_][a-z0-9_-]{0,31}$ ]]; then
  TARGET_USER="$CFG_USER"
  if ! id "$TARGET_USER" >/dev/null 2>&1; then
    useradd -m -G wheel,networkmanager,video,audio,input,render -s /bin/bash "$TARGET_USER" 2>/dev/null || true
  fi
  if mountpoint -q /persist 2>/dev/null; then
    mkdir -p "/persist/home/''${TARGET_USER}" "/home/''${TARGET_USER}"
    mountpoint -q "/home/''${TARGET_USER}" || mount --bind "/persist/home/''${TARGET_USER}" "/home/''${TARGET_USER}" || true
  fi
  cp -rn "''${SKEL_DIR}/." "/home/''${TARGET_USER}/" 2>/dev/null || true
  TARGET_GROUP=$(id -gn "$TARGET_USER" 2>/dev/null || echo "users")
  chown -R "''${TARGET_USER}:''${TARGET_GROUP}" "/home/''${TARGET_USER}" 2>/dev/null || true
fi
printf '%s\n' "$TARGET_USER" > /etc/monolith/active-user

if [[ -n "$CFG_PASS" ]] && id "$TARGET_USER" >/dev/null 2>&1; then
  printf '%s:%s\n' "$TARGET_USER" "$CFG_PASS" | chpasswd 2>/dev/null || true
fi

if [[ -n "$CFG_HOST" && "$CFG_HOST" =~ ^[a-zA-Z0-9][a-zA-Z0-9-]{0,62}$ ]]; then
  hostname "$CFG_HOST" 2>/dev/null || true
fi

if [[ -n "$CFG_TZ" && -f "/usr/share/zoneinfo/''${CFG_TZ}" ]]; then
  ln -sf "/usr/share/zoneinfo/''${CFG_TZ}" /etc/localtime 2>/dev/null || true
fi

if [[ -n "$CFG_KEYMAP" && "$CFG_KEYMAP" =~ ^[a-z]{2,8}$ ]]; then
  loadkeys "$CFG_KEYMAP" 2>/dev/null || true
  mkdir -p "/home/''${TARGET_USER}/.config"
  printf '[Layout]\nLayoutList=%s\nUse=true\n' "$CFG_KEYMAP" > "/home/''${TARGET_USER}/.config/kxkbrc"
  TARGET_GROUP=$(id -gn "$TARGET_USER" 2>/dev/null || echo "users")
  chown "''${TARGET_USER}:''${TARGET_GROUP}" "/home/''${TARGET_USER}/.config/kxkbrc" 2>/dev/null || true
fi

if [[ -n "$CFG_WIFI_SSID" ]]; then
  mkdir -p /etc/NetworkManager/system-connections
  SAFE_NM=$(printf '%s' "$CFG_WIFI_SSID" | tr -cd 'a-zA-Z0-9_-')
  [[ -z "$SAFE_NM" ]] && SAFE_NM="monolith-wifi"
  NM_FILE="/etc/NetworkManager/system-connections/''${SAFE_NM}.nmconnection"
  {
    echo "[connection]"
    echo "id=''${CFG_WIFI_SSID}"
    echo "type=wifi"
    echo "autoconnect=true"
    echo ""
    echo "[wifi]"
    echo "mode=infrastructure"
    echo "ssid=''${CFG_WIFI_SSID}"
    if [[ -n "$CFG_WIFI_PSK" ]]; then
      echo ""
      echo "[wifi-security]"
      echo "key-mgmt=wpa-psk"
      echo "psk=''${CFG_WIFI_PSK}"
    fi
    echo ""
    echo "[ipv4]"
    echo "method=auto"
    echo ""
    echo "[ipv6]"
    echo "method=auto"
  } > "$NM_FILE"
  chmod 600 "$NM_FILE"
fi

if [[ -n "$CFG_GIT_NAME" || -n "$CFG_GIT_EMAIL" ]]; then
  GIT_CFG="/home/''${TARGET_USER}/.gitconfig"
  {
    echo "[user]"
    [[ -n "$CFG_GIT_NAME" ]] && echo "  name = ''${CFG_GIT_NAME}"
    [[ -n "$CFG_GIT_EMAIL" ]] && echo "  email = ''${CFG_GIT_EMAIL}"
    echo "[init]"
    echo "  defaultBranch = main"
  } > "$GIT_CFG"
  TARGET_GROUP=$(id -gn "$TARGET_USER" 2>/dev/null || echo "users")
  chown "''${TARGET_USER}:''${TARGET_GROUP}" "$GIT_CFG" 2>/dev/null || true
fi

sync

  '';

  localSendCompat = pkgs.writeShellScriptBin "localsend_app" ''
    exec ${pkgs.localsend}/bin/localsend "$@"
  '';

  monolithNixSeed = pkgs.runCommand "monolith-nix-seed" {} ''
    mkdir -p $out
    cp ${./flake.nix} $out/flake.nix
    cp ${./configuration.nix} $out/configuration.nix
    cat > $out/user-packages.nix <<'USER_PKGS_EOF'
# Monolith NixOS — Declarative Global User Packages (Persisted on MONOLITH_PERSIST)
# Install anytime via: monolith-pkg install <pkg>  or  nix profile install nixpkgs#<pkg>
{ pkgs, ... }: {
  environment.systemPackages = with pkgs; [
  ];
}
USER_PKGS_EOF
  '';

  monolithSkel = pkgs.runCommand "monolith-skel" {} ''
    mkdir -p $out/.config/autostart $out/.config/nvim $out/.config/gtk-3.0 $out/.config/gtk-4.0 $out/.config/monolith $out/.local/share/konsole $out/.local/share/applications $out/.mozilla/firefox/monolith.default

    cat > $out/.config/kdeglobals <<'MONOLITH_EOF'
[General]
ColorScheme=MonolithUnified
Name=MonolithUnified
TerminalApplication=konsole
TerminalService=org.kde.konsole.desktop
font=JetBrains Mono,10,-1,5,400,0,0,0,0,0,0,0,0,0,0,1
fixed=JetBrains Mono,10,-1,5,400,0,0,0,0,0,0,0,0,0,0,1
menuFont=JetBrains Mono,10,-1,5,400,0,0,0,0,0,0,0,0,0,0,1
toolBarFont=JetBrains Mono,9,-1,5,400,0,0,0,0,0,0,0,0,0,0,1
smallestReadableFont=JetBrains Mono,8,-1,5,400,0,0,0,0,0,0,0,0,0,0,1

[KDE]
AnimationDurationFactor=0.5
LookAndFeelPackage=org.kde.breezedark.desktop
SingleClick=false
widgetStyle=breeze

[WM]
activeBackground=23,23,28
activeBlend=56,189,248
activeForeground=244,244,245
inactiveBackground=17,17,20
inactiveBlend=161,161,170
inactiveForeground=161,161,170

[Colors:Window]
BackgroundAlternate=23,23,28
BackgroundNormal=17,17,20
DecorationFocus=56,189,248
DecorationHover=56,189,248
ForegroundActive=56,189,248
ForegroundInactive=161,161,170
ForegroundLink=56,189,248
ForegroundNormal=244,244,245

[Colors:View]
BackgroundAlternate=17,17,20
BackgroundNormal=9,9,11
DecorationFocus=56,189,248
DecorationHover=56,189,248
ForegroundActive=56,189,248
ForegroundInactive=161,161,170
ForegroundLink=56,189,248
ForegroundNormal=244,244,245

[Colors:Button]
BackgroundAlternate=17,17,20
BackgroundNormal=23,23,28
DecorationFocus=56,189,248
DecorationHover=56,189,248
ForegroundActive=56,189,248
ForegroundInactive=161,161,170
ForegroundNormal=244,244,245

[Colors:Selection]
BackgroundAlternate=56,189,248
BackgroundNormal=56,189,248
DecorationFocus=56,189,248
DecorationHover=56,189,248
ForegroundActive=4,19,28
ForegroundInactive=4,19,28
ForegroundNormal=4,19,28

MONOLITH_EOF

    cat > $out/.config/kwinrc <<'MONOLITH_EOF'
[org.kde.kdecoration2]
BorderSize=Tiny
BorderSizeAuto=false
ButtonsOnLeft=
ButtonsOnRight=
ShowToolTips=false
library=org.kde.breeze
theme=Breeze

[Compositing]
LatencyPolicy=Low
WindowsBlockCompositing=true

[Plugins]
blurEnabled=true
kwin4_effect_translucencyEnabled=true

[Windows]
Placement=Centered

MONOLITH_EOF

    cat > $out/.config/breezerc <<'MONOLITH_EOF'
[Common]
OutlineIntensity=OutlineLow
ShadowSize=ShadowSmall

[Windeco]
ButtonSize=ButtonSmall
DrawBackgroundGradient=false
DrawBorderOnMaximizedWindows=false

MONOLITH_EOF

    cat > $out/.config/kwinrulesrc <<'MONOLITH_EOF'
[1]
Description=Monolith Translucent Rounded Windows
opacityactive=92
opacityactiverule=2
opacityinactive=87
opacityinactiverule=2
types=1
wmclassmatch=0

[General]
count=1
rules=1

MONOLITH_EOF

    cat > $out/.config/baloofilerc <<'MONOLITH_EOF'
[Basic Settings]
Indexing-Enabled=false

MONOLITH_EOF

    cat > $out/.config/kscreenlockerrc <<'MONOLITH_EOF'
[Daemon]
Autolock=true
LockOnResume=true
Timeout=5

MONOLITH_EOF

    cat > $out/.config/konsolerc <<'MONOLITH_EOF'
[Desktop Entry]
DefaultProfile=Monolith.profile

[MainWindow]
MenuBar=Disabled
ToolBarsMovable=Disabled

[TabBar]
TabBarVisibility=ShowTabBarWhenNeeded

MONOLITH_EOF

    cat > $out/.local/share/konsole/Monolith.profile <<'MONOLITH_EOF'
[Appearance]
ColorScheme=Monolith
Font=JetBrains Mono,12,-1,5,400,0,0,0,0,0,0,0,0,0,0,1

[General]
Directory=/home/dev/workspace
Name=Monolith
Parent=FALLBACK/

[Scrolling]
HistorySize=5000

MONOLITH_EOF

    cat > $out/.local/share/konsole/Monolith.colorscheme <<'MONOLITH_EOF'
[Background]
Color=17,17,20

[BackgroundIntense]
Color=23,23,28

[Foreground]
Color=244,244,245

[ForegroundIntense]
Color=56,189,248

[Color4]
Color=56,189,248

[Color6]
Color=56,189,248

[General]
Blur=true
Description=Monolith Unified Theme
Opacity=0.92

MONOLITH_EOF

    cat > $out/.config/kglobalshortcutsrc <<'MONOLITH_EOF'
[kwin]
Window Close=Meta+Q,Alt+F4,Close Window
Window Maximize=Meta+F,Meta+PgUp,Maximize Window
Window Minimize=Meta+M,Meta+PgDown,Minimize Window
Show Desktop=Meta+D,Meta+D,Peek at Desktop
Overview=Meta+Tab,Meta+W,Toggle Overview

[ksmserver]
Lock Session=Meta+Shift+L,Meta+Shift+L\tScreensaver,Lock Session

[services][org.kde.krunner.desktop]
_launch=Meta+Space\tAlt+Space

[services][systemsettings.desktop]
_launch=Meta+,

[services][monolith-terminal.desktop]
_launch=Meta+Return

[services][monolith-neovim.desktop]
_launch=Meta+N

[services][monolith-firefox.desktop]
_launch=Meta+B

[services][monolith-obs.desktop]
_launch=Meta+O

[services][monolith-localsend.desktop]
_launch=Meta+L

[services][monolith-shortcuts.desktop]
_launch=Meta+/

[services][monolith-new-project.desktop]
_launch=Meta+Alt+N

[services][monolith-reset.desktop]
_launch=Meta+Shift+Backspace

[services][monolith-custom-1.desktop]
_launch=Meta+E

[services][monolith-custom-2.desktop]
_launch=Meta+T

MONOLITH_EOF

    cat > $out/.config/autostart/monolith-plasma-init.desktop <<'MONOLITH_EOF'
[Desktop Entry]
Type=Application
Name=Monolith Plasma 6 Initializer
Exec=monolith-plasma-init
OnlyShowIn=KDE;
X-KDE-AutostartPhase=2

MONOLITH_EOF

    cat > $out/.config/autostart/org.kde.discover.notifier.desktop <<'MONOLITH_EOF'
[Desktop Entry]
Type=Application
Name=Discover Notifier
Hidden=true

MONOLITH_EOF

    cat > $out/.local/share/applications/monolith-terminal.desktop <<'MONOLITH_EOF'
[Desktop Entry]
Type=Application
Name=Monolith Terminal
Exec=konsole --workdir /home/dev/workspace
Icon=utilities-terminal

MONOLITH_EOF

    cat > $out/.local/share/applications/monolith-neovim.desktop <<'MONOLITH_EOF'
[Desktop Entry]
Type=Application
Name=Monolith Neovim IDE
Exec=konsole --workdir /home/dev/workspace -e nvim
Icon=nvim

MONOLITH_EOF

    cat > $out/.local/share/applications/monolith-firefox.desktop <<'MONOLITH_EOF'
[Desktop Entry]
Type=Application
Name=Minimal Firefox
Exec=firefox
Icon=firefox

MONOLITH_EOF

    cat > $out/.local/share/applications/monolith-obs.desktop <<'MONOLITH_EOF'
[Desktop Entry]
Type=Application
Name=OBS Studio
Exec=obs
Icon=com.obsproject.Studio

MONOLITH_EOF

    cat > $out/.local/share/applications/monolith-localsend.desktop <<'MONOLITH_EOF'
[Desktop Entry]
Type=Application
Name=LocalSend File Sharing
Exec=localsend_app
Icon=folder-remote

MONOLITH_EOF

    cat > $out/.local/share/applications/monolith-shortcuts.desktop <<'MONOLITH_EOF'
[Desktop Entry]
Type=Application
Name=Monolith Unified Shortcuts
Exec=monolith-shortcut-menu
Icon=preferences-desktop-keyboard-shortcuts

MONOLITH_EOF

    cat > $out/.local/share/applications/monolith-new-project.desktop <<'MONOLITH_EOF'
[Desktop Entry]
Type=Application
Name=New Local RAM Project
Exec=konsole -e monolith-new-project
Icon=folder-new

MONOLITH_EOF

    cat > $out/.local/share/applications/monolith-reset.desktop <<'MONOLITH_EOF'
[Desktop Entry]
Type=Application
Name=Monolith Project Reset
Exec=konsole -e monolith-reset
Icon=edit-clear-history

MONOLITH_EOF

    cat > $out/.local/share/applications/monolith-custom-1.desktop <<'MONOLITH_EOF'
[Desktop Entry]
Type=Application
Name=Open Dolphin Graphical File Manager
Exec=sh -lc 'dolphin'
Icon=utilities-terminal
NoDisplay=false

MONOLITH_EOF

    cat > $out/.local/share/applications/monolith-custom-2.desktop <<'MONOLITH_EOF'
[Desktop Entry]
Type=Application
Name=Open btop RAM & CPU Monitor
Exec=sh -lc 'konsole -e btop'
Icon=utilities-terminal
NoDisplay=false

MONOLITH_EOF

    cat > $out/.config/gtk-3.0/settings.ini <<'MONOLITH_EOF'
[Settings]
gtk-font-name=JetBrains Mono 12
gtk-application-prefer-dark-theme=1
gtk-decoration-layout=

MONOLITH_EOF

    cat > $out/.config/gtk-4.0/settings.ini <<'MONOLITH_EOF'
[Settings]
gtk-font-name=JetBrains Mono 12
gtk-application-prefer-dark-theme=1
gtk-decoration-layout=

MONOLITH_EOF

    cat > $out/.config/gtk-3.0/gtk.css <<'MONOLITH_EOF'
/* Monolith NixOS — Zero GUI [minimize, expand, close] buttons + Unified Theme & Rounding */
headerbar button.minimize,
headerbar button.maximize,
headerbar button.close,
.titlebar button.minimize,
.titlebar button.maximize,
.titlebar button.close {
  display: none;
  opacity: 0;
  min-width: 0;
  min-height: 0;
  padding: 0;
  margin: 0;
}

window, .background {
  border-radius: 12px;
  background-color: #111114;
  color: #F4F4F5;
}

MONOLITH_EOF

    cat > $out/.config/gtk-4.0/gtk.css <<'MONOLITH_EOF'
/* Monolith NixOS — Zero GUI [minimize, expand, close] buttons + Unified Theme & Rounding */
headerbar button.minimize,
headerbar button.maximize,
headerbar button.close,
.titlebar button.minimize,
.titlebar button.maximize,
.titlebar button.close {
  display: none;
  opacity: 0;
  min-width: 0;
  min-height: 0;
  padding: 0;
  margin: 0;
}

window, .background {
  border-radius: 12px;
  background-color: #111114;
  color: #F4F4F5;
}

MONOLITH_EOF

    cat > $out/.config/monolith/wallpaper.svg <<'MONOLITH_EOF'
<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#09090B" />
      <stop offset="68%" stop-color="#111114" />
      <stop offset="100%" stop-color="#09090B" />
    </linearGradient>
    <radialGradient id="glow" cx="50%" cy="56%" r="55%">
      <stop offset="0%" stop-color="#38BDF8" stop-opacity="0.14" />
      <stop offset="100%" stop-color="#09090B" stop-opacity="0" />
    </radialGradient>
  </defs>
  <rect width="1920" height="1080" fill="url(#bg)" />
  <rect width="1920" height="1080" fill="url(#glow)" />
  <path d="M0 740 C 320 690, 560 760, 880 715 C 1220 668, 1520 735, 1920 690 L 1920 1080 L 0 1080 Z" fill="#17171C" fill-opacity="0.72" />
  <path d="M0 820 C 420 790, 740 845, 1140 805 C 1480 770, 1720 825, 1920 795 L 1920 1080 L 0 1080 Z" fill="#09090B" fill-opacity="0.86" />
  <line x1="0" y1="740" x2="1920" y2="690" stroke="#38BDF8" stroke-opacity="0.18" stroke-width="1" />
</svg>

MONOLITH_EOF

    cat > $out/.config/nvim/init.lua <<'MONOLITH_EOF'
-- Monolith NixOS — Minimal High-Performance Neovim Configuration (Unified Theme + Auto-LSP)
vim.g.mapleader = " "
vim.opt.number = true
vim.opt.relativenumber = true
vim.opt.termguicolors = true
vim.opt.expandtab = true
vim.opt.shiftwidth = 2
vim.opt.tabstop = 2
vim.opt.clipboard = "unnamedplus"
vim.opt.signcolumn = "yes"
vim.opt.updatetime = 200

-- Sync Neovim highlights with active Obsidian Matte OS theme
vim.api.nvim_set_hl(0, "Normal", { fg = "#F4F4F5", bg = "NONE" })
vim.api.nvim_set_hl(0, "NormalFloat", { fg = "#F4F4F5", bg = "#111114" })
vim.api.nvim_set_hl(0, "FloatBorder", { fg = "#38BDF8", bg = "#111114" })
vim.api.nvim_set_hl(0, "LineNr", { fg = "#A1A1AA" })
vim.api.nvim_set_hl(0, "CursorLineNr", { fg = "#38BDF8", bold = true })
vim.api.nvim_set_hl(0, "StatusLine", { fg = "#F4F4F5", bg = "#17171C" })

local map = vim.keymap.set
map("n", "<leader>e", vim.cmd.Ex, { desc = "Toggle file explorer" })
map("n", "<C-s>", "<cmd>w<cr>", { desc = "Save buffer" })
map("i", "<C-s>", "<esc><cmd>w<cr>a", { desc = "Save buffer" })
map("n", "[d", vim.diagnostic.goto_prev, { desc = "Previous diagnostic" })
map("n", "]d", vim.diagnostic.goto_next, { desc = "Next diagnostic" })

local stacks_file = vim.fn.expand("~/.config/monolith/active-stacks.json")
local active_lsps = {}
if vim.fn.filereadable(stacks_file) == 1 then
  local ok, parsed = pcall(vim.fn.json_decode, table.concat(vim.fn.readfile(stacks_file), "\n"))
  if ok and parsed and parsed.lsp_servers then
    active_lsps = parsed.lsp_servers
  end
end

vim.api.nvim_create_autocmd("LspAttach", {
  callback = function(args)
    local opts = { buffer = args.buf }
    map("n", "gd", vim.lsp.buf.definition, opts)
    map("n", "K", vim.lsp.buf.hover, opts)
    map("n", "<leader>ca", vim.lsp.buf.code_action, opts)
    map("n", "<leader>rn", vim.lsp.buf.rename, opts)
    map("n", "<leader>f", function() vim.lsp.buf.format({ async = true }) end, opts)
  end,
})

local native_lsps = {
  rust_analyzer = { cmd = { "rust-analyzer" }, filetypes = { "rust" }, root_markers = { "Cargo.toml", ".git" } },
  gopls = { cmd = { "gopls" }, filetypes = { "go", "gomod" }, root_markers = { "go.mod", ".git" } },
  pyright = { cmd = { "pyright-langserver", "--stdio" }, filetypes = { "python" }, root_markers = { "pyproject.toml", "requirements.txt", ".git" } },
  ts_ls = { cmd = { "typescript-language-server", "--stdio" }, filetypes = { "javascript", "javascriptreact", "typescript", "typescriptreact" }, root_markers = { "package.json", "tsconfig.json", ".git" } },
  clangd = { cmd = { "clangd" }, filetypes = { "c", "cpp", "objc", "objcpp" }, root_markers = { "compile_commands.json", "CMakeLists.txt", ".git" } },
  jdtls = { cmd = { "jdtls" }, filetypes = { "java" }, root_markers = { "pom.xml", "build.gradle", "build.gradle.kts", ".git" } },
}

if vim.lsp and vim.lsp.config and vim.lsp.enable then
  for _, server in ipairs(active_lsps) do
    local cfg = native_lsps[server]
    if cfg and vim.fn.executable(cfg.cmd[1]) == 1 then
      vim.lsp.config(server, cfg)
      vim.lsp.enable(server)
    end
  end
end

MONOLITH_EOF

    cat > $out/.mozilla/firefox/monolith.default/user.js <<'MONOLITH_EOF'
// Monolith NixOS — Minimal Firefox Low-Memory & Hardware Acceleration Profile
user_pref("dom.ipc.processCount", 2);
user_pref("browser.cache.disk.enable", false);
user_pref("browser.cache.memory.capacity", 65536);
user_pref("media.ffmpeg.vaapi.enabled", true);
user_pref("gfx.webrender.all", true);
user_pref("toolkit.legacyUserProfileCustomizations.stylesheets", true);
user_pref("browser.tabs.inTitlebar", 0);
user_pref("browser.startup.homepage", "about:blank");
user_pref("browser.newtabpage.enabled", false);
user_pref("extensions.pocket.enabled", false);
user_pref("toolkit.telemetry.enabled", false);
user_pref("datareporting.healthreport.uploadEnabled", false);
user_pref("font.name.sans-serif.x-western", "JetBrains Mono");
user_pref("font.name.monospace.x-western", "JetBrains Mono");
user_pref("browser.download.dir", "/home/dev/workspace/downloads");

MONOLITH_EOF

    cat > $out/SHORTCUTS.txt <<'MONOLITH_EOF'
===============================================================================
MONOLITH NIXOS — UNIFIED KEYBOARD SHORTCUT REFERENCE
Desktop: Optimized KDE Plasma 6 Wayland (Rounded Menus + Native System Settings)
Font: JetBrains Mono  |  Theme: Obsidian Matte
Location on OS: ~/SHORTCUTS.txt  |  Edit Visually: System Settings -> Shortcuts
===============================================================================

[1. OS, KWIN WINDOW CONTROLS (ZERO GUI BUTTONS) & CORE APPS]
Super + Space                | App Launcher / KRunner — Open rounded graphical KRunner search & app launcher (panel auto-hides on edge hover)
Super + Q                    | Close Focused Window — Native KWin keyboard close (no GUI close button)
Super + F                    | Expand / Maximize Window — Native KWin maximize toggle (no GUI expand button)
Super + M                    | Minimize Focused Window — Native KWin minimize to auto-hiding panel (no GUI minimize button)
Super + D                    | Show / Restore Desktop — Native KWin peek-at-desktop toggle for clean wallpaper view
Super + /                    | Unified Shortcut Menu — Single verified shortcut cheat sheet synced with System Settings -> Shortcuts
Super + ,                    | Open Graphical System Settings — Launch native KDE Plasma 6 System Settings GUI (wallpaper, theme, shortcuts, Wi-Fi, HDMI)
Super + Return               | Open Terminal (Konsole) — Launch JetBrains Mono Wayland terminal in ~/workspace
Super + N                    | Launch Neovim IDE — Open pre-configured Neovim inside Konsole with active project LSP servers
Super + B                    | Launch Minimal Firefox — Open low-memory tuned Firefox with hardware VA-API acceleration
Super + O                    | Launch OBS Studio — Open Wayland PipeWire screen recorder pointed at your export folder
Super + L                    | Launch LocalSend — Open local-network peer-to-peer file sharing (replaces exFAT transfer)
Super + Alt + N              | New Project (Local RAM Pkgs) — Create a project folder with isolated on-demand RAM-only local nixpkgs
Super + Shift + L            | Lock Screen & Clean Idle RAM — Start themed Plasma lock/screensaver and clear idle project caches from RAM
Super + Shift + Backspace    | Trigger Project Reset — Wipe workspace & toolchains while preserving Wi-Fi, Bluetooth, SSH & settings

[2. CUSTOM APPLICATION SHORTCUTS]
Super + E                    | Open Dolphin Graphical File Manager — exec: dolphin
Super + T                    | Open btop RAM & CPU Monitor — exec: konsole -e btop

[3. PLASMA 6 WAYLAND WORKSPACE & PANEL CONTROLS]
Super + Tab                  | Overview of all open windows & virtual desktops
Super + Left / Right         | Snap focused window to left / right half of screen
Right-Click Taskbar          | Show Panel Configuration (auto-hide, height, floating)
Super + ,                    | Open Graphical System Settings (all visual options)

[4. NEOVIM IDE (PRE-INSTALLED WITH AUTO-LSP)]
Space + ff                   | Find files in workspace (Telescope)
Space + fg                   | Live grep across project (ripgrep)
Space + e                    | Toggle minimal file explorer (netrw/oil)
gd                           | Go to definition (active LSP)
K                            | Show symbol documentation hover (LSP)
Space + ca                   | Code actions & quick fixes (LSP)
Space + rn                   | Rename symbol across project (LSP)
Space + f                    | Format current buffer
[d / ]d                      | Jump to previous / next diagnostic
Ctrl + s                     | Save buffer

[5. PACKAGES, RAM-ONLY PROJECTS, HARDWARE & UTILITIES]
monolith-settings            | Open Graphical System Settings (Super + ,)
monolith-pkg install <pkg>   | Install global app via nix profile install nixpkgs#<pkg>
monolith-new-project         | Create project with on-demand RAM-only local packages (Super + Alt + N)
monolith-ram-clean           | Unload idle project RAM mounts & drop pagecache (<500 MB idle)
monolith-hardware            | Inspect USB, HDMI, Wi-Fi, Bluetooth & idle RAM
monolith-exe <app.exe>       | Run Windows .exe apps via Wine (when enabled in setup/settings)
monolith-update [--check]    | Update Nix flake, global profile & check latest GitHub ISO
monolith-firstboot --force   | Re-open setup wizard (includes Windows .exe option)
monolith-reset               | Clean Project Reset (keeps Wi-Fi, Bluetooth, SSH, OS settings)

MONOLITH_EOF

    cat > $out/.config/monolith/settings.json <<'MONOLITH_EOF'
{
  "osName": "Monolith NixOS",
  "hostname": "monolith-usb",
  "defaultCompositor": "plasma6",
  "nixSystem": {
    "channel": "nixos-unstable",
    "useLatestNixPackage": true,
    "globalPackages": [
      "git",
      "gh",
      "neovim",
      "ripgrep",
      "fd",
      "yazi",
      "btop",
      "jq",
      "localsend",
      "obs-studio"
    ],
    "projects": [
      {
        "id": "proj-api",
        "name": "monolith-api",
        "stack": "rust",
        "version": "stable",
        "localPackages": [
          "rustc",
          "cargo",
          "rust-analyzer",
          "clippy",
          "pkg-config"
        ],
        "ramOnly": true
      },
      {
        "id": "proj-web",
        "name": "web-studio",
        "stack": "nodejs",
        "version": "22",
        "localPackages": [
          "nodejs_22",
          "pnpm",
          "nodePackages.typescript-language-server"
        ],
        "ramOnly": true
      }
    ],
    "windowsExeSupport": false,
    "ramIdleLimitMb": 500,
    "autoClearIdleRam": true
  },
  "appearance": {
    "theme": "obsidian-matte",
    "wallpaper": "obsidian-horizon",
    "customWallpaperPath": "",
    "fontSizePx": 12,
    "cornerRadiusPx": 12,
    "windowOpacity": 0.92,
    "borderWidthPx": 1,
    "windowGapPx": 8,
    "barPosition": "bottom",
    "taskbarAutoHide": true,
    "taskbarShowOnStart": true,
    "taskbarHeightPx": 42,
    "taskbarHideDelayMs": 1800,
    "screensaverEnabled": true,
    "screensaverTimeoutMin": 5,
    "screensaverStyle": "clock"
  },
  "storage": {
    "nominalDriveGb": 64,
    "totalUsableGb": 57.6,
    "efiGb": 0.5,
    "squashfsGb": 2,
    "persistenceGb": 55.1,
    "persistencePercent": 100,
    "exfatTransferGb": 0,
    "isValid": true,
    "warning": null
  },
  "idleRamBudgetMb": {
    "kernelAndSystemdMb": 138,
    "kwinWaylandMb": 112,
    "plasmaShellMb": 114,
    "hardwareServicesMb": 102,
    "totalIdleMb": 466,
    "withinBudget": true
  },
  "exportPaths": {
    "workspaceDir": "/home/dev/workspace",
    "obsRecordingsDir": "/home/dev/exports/recordings",
    "localSendDir": "/home/dev/exports/localsend",
    "backupExportDir": "/home/dev/exports/backups",
    "sshDir": "/home/dev/.ssh",
    "dotfilesSyncRemote": "git@github.com:your-username/monolith-dotfiles.git"
  },
  "browser": {
    "maxContentProcesses": 2,
    "enableVaapi": true,
    "blockTelemetry": true,
    "minimalChromeCss": true
  },
  "hardware": {
    "intelGraphicsVaapi": true,
    "amdRadeonVulkan": true,
    "nvidiaOpenNvk": true,
    "universalWifiEthernet": true,
    "bluetoothStack": true,
    "usbAutomount": true,
    "hdmiDisplayAudio": true,
    "sofAudioFirmware": true,
    "laptopAcpiSupport": true
  },
  "hotkeys": {
    "toggleStatusBar": "Super + Space",
    "closeWindow": "Super + Q",
    "expandWindow": "Super + F",
    "minimizeWindow": "Super + M",
    "toggleHideWindows": "Super + D",
    "shortcutSearch": "Super + /",
    "openSettingsTui": "Super + ,",
    "openTerminal": "Super + Return",
    "openNeovim": "Super + N",
    "openBrowser": "Super + B",
    "openObs": "Super + O",
    "openLocalSend": "Super + L",
    "newProject": "Super + Alt + N",
    "triggerScreensaver": "Super + Shift + L",
    "projectReset": "Super + Shift + Backspace"
  },
  "customShortcuts": [
    {
      "id": "custom-dolphin",
      "label": "Open Dolphin Graphical File Manager",
      "command": "dolphin",
      "modifier": "Super",
      "key": "E"
    },
    {
      "id": "custom-btop",
      "label": "Open btop RAM & CPU Monitor",
      "command": "konsole -e btop",
      "modifier": "Super",
      "key": "T"
    }
  ]
}
MONOLITH_EOF

    cat > $out/.dialogrc <<'MONOLITH_EOF'
# Monolith NixOS — Theme-Synced TUI Dialog Palette (Obsidian Matte)
use_shadow = OFF
use_colors = ON
screen_color = (WHITE,BLACK,OFF)
dialog_color = (WHITE,BLACK,OFF)
title_color = (CYAN,BLACK,ON)
border_color = (CYAN,BLACK,OFF)
border2_color = (CYAN,BLACK,OFF)
button_active_color = (BLACK,CYAN,ON)
button_inactive_color = (WHITE,BLACK,OFF)
button_key_active_color = (BLACK,CYAN,ON)
button_key_inactive_color = (CYAN,BLACK,ON)
button_label_active_color = (BLACK,CYAN,ON)
button_label_inactive_color = (WHITE,BLACK,OFF)
item_color = (WHITE,BLACK,OFF)
item_selected_color = (BLACK,CYAN,ON)
tag_color = (CYAN,BLACK,ON)
tag_selected_color = (BLACK,CYAN,ON)
tag_key_color = (CYAN,BLACK,ON)
tag_key_selected_color = (BLACK,CYAN,ON)
check_color = (WHITE,BLACK,OFF)
check_selected_color = (BLACK,CYAN,ON)

MONOLITH_EOF

    cat > $out/.bashrc <<'MONOLITH_EOF'
# Monolith NixOS — Shell Profile (JetBrains Mono + direnv RAM-Only Project Envs + mise)
export PATH="$HOME/.local/share/mise/shims:$HOME/.local/bin:$HOME/.cargo/bin:$HOME/go/bin:$PATH"
export DIALOGRC="$HOME/.dialogrc"
export MONOLITH_THEME="obsidian-matte"
if command -v mise >/dev/null 2>&1; then
  eval "$(mise activate bash)"
fi
if command -v direnv >/dev/null 2>&1; then
  eval "$(direnv hook bash)"
fi
PS1='\[\e[36m\]\u@\h\[\e[0m\] \w \$ '

MONOLITH_EOF
  '';
in
{
  imports = [
    "${modulesPath}/installer/cd-dvd/installation-cd-minimal.nix"
  ];

  # Portable ISO identity & fast multi-threaded zstd compression
  isoImage.isoBaseName = lib.mkForce "monolith-nixos";
  isoImage.volumeID = lib.mkForce "MONOLITH_NIX";
  isoImage.squashfsCompression = lib.mkForce "zstd -Xcompression-level 15";
  isoImage.makeEfiBootable = true;
  isoImage.makeUsbBootable = true;

  # Latest Nix package manager & flakes
  nix.package = pkgs.nixVersions.latest;
  nix.settings = {
    experimental-features = [ "nix-command" "flakes" ];
    auto-optimise-store = false;
  };
  nixpkgs.config.allowUnfree = true;
  hardware.enableRedistributableFirmware = true;

  # Strict < 500 MB Idle RAM Tuning (ZRAM + earlyoom + aggressive cache reclaim)
  zramSwap = {
    enable = true;
    algorithm = "zstd";
    memoryPercent = 50;
  };
  services.earlyoom.enable = true;
  boot.kernelParams = [ "quiet" "loglevel=3" ];
  boot.kernel.sysctl = {
    "kernel.printk" = "3 3 3 3";
    "vm.swappiness" = 10;
    "vm.vfs_cache_pressure" = 150;
    "vm.dirty_ratio" = 10;
  };

  console = {
    earlySetup = true;
    keyMap = "us";
    font = "${pkgs.terminus_font}/share/consolefonts/ter-v24n.psf.gz";
    packages = [ pkgs.terminus_font ];
  };

  # Universal Hardware: CPUs, GPUs, HDMI/DP, USB-A/C/Thunderbolt, Wi-Fi, Bluetooth, Audio
  hardware.cpu.intel.updateMicrocode = true;
  hardware.cpu.amd.updateMicrocode = true;
  hardware.graphics.enable = true;
  services.udisks2.enable = true;
  services.hardware.bolt.enable = true;
  hardware.bluetooth = {
    enable = true;
    powerOnBoot = true;
    settings = {
      General = {
        Experimental = true;
        FastConnectable = true;
      };
      Policy = {
        AutoEnable = true;
      };
    };
  };

  networking.hostName = lib.mkForce "monolith-usb";
  networking.wireless.enable = lib.mkForce false;
  networking.networkmanager = {
    enable = true;
    wifi.backend = "iwd";
  };
  # Open LocalSend port (53317) for zero-cable LAN file sharing
  networking.firewall.allowedTCPPorts = [ 53317 ];
  networking.firewall.allowedUDPPorts = [ 53317 ];
  services.timesyncd.enable = true;

  security.rtkit.enable = true;
  services.pulseaudio.enable = lib.mkForce false;
  services.pipewire = {
    enable = true;
    alsa.enable = true;
    pulse.enable = true;
    jack.enable = true;
  };

  # Optimized Graphical NixOS — KDE Plasma 6 Wayland (Rounded Menus, Native System Settings, Low RAM)
  services.desktopManager.plasma6.enable = true;
  services.displayManager.sddm = {
    enable = true;
    wayland.enable = true;
  };
  services.displayManager.defaultSession = "plasma";
  services.displayManager.autoLogin = {
    enable = true;
    user = "dev";
  };

  # Strip bloated KDE apps for faster USB boot & smaller ISO
  environment.plasma6.excludePackages = with pkgs.kdePackages; [
    elisa
    gwenview
    okular
    kate
    khelpcenter
  ];

  programs.direnv = {
    enable = true;
    nix-direnv.enable = true;
  };

  programs.nix-ld = {
    enable = true;
    libraries = with pkgs; [
      stdenv.cc.cc
      zlib
      openssl
      curl
      expat
      libxcrypt
      nss
      nspr
    ];
  };

  services.getty.autologinUser = lib.mkForce null;

  # Periodic Idle RAM Sweeper Timer (keeps idle memory strictly < 500 MB)
  systemd.services.monolith-ram-clean = {
    description = "Monolith NixOS Idle RAM & Project Cache Cleaner";
    serviceConfig = {
      Type = "oneshot";
      ExecStart = "${monolithRamClean}/bin/monolith-ram-clean --quiet";
    };
  };
  systemd.timers.monolith-ram-clean = {
    wantedBy = [ "timers.target" ];
    enable = true;
    timerConfig = {
      OnBootSec = "3m";
      OnUnitActiveSec = "5m";
    };
  };

  users.users.dev = {
    isNormalUser = true;
    description = "Monolith NixOS Developer";
    initialPassword = "monolith";
    extraGroups = [ "wheel" "networkmanager" "video" "audio" "input" "render" ];
  };
  security.sudo.wheelNeedsPassword = false;

  systemd.services.monolith-init-user = {
    description = "Monolith NixOS User Initialization, Hardware & Pendrive Persistence";
    after = [ "local-fs.target" "systemd-udev-settle.service" ];
    before = [ "NetworkManager.service" "bluetooth.service" "display-manager.service" ];
    wantedBy = [ "multi-user.target" ];
    path = with pkgs; [
      util-linux
      coreutils
      gnugrep
      gnused
      gawk
      shadow
      parted
      gptfdisk
      e2fsprogs
      exfatprogs
      systemd
      networkmanager
      nix
      monolithPersistUsb
      monolithApplyBootconf
    ];
    serviceConfig = {
      Type = "oneshot";
      RemainAfterExit = true;
    };
    script = ''
      dmesg -n 1 2>/dev/null || true
      mkdir -p /home/dev /etc/NetworkManager/system-connections /var/lib/bluetooth /etc/nixos /etc/monolith

      udevadm settle --timeout=10 2>/dev/null || true
      ${monolithPersistUsb}/bin/monolith-persist-usb || true

      cp -rn ${monolithNixSeed}/. /etc/nixos/ 2>/dev/null || true
      chmod -R u+w /etc/nixos 2>/dev/null || true
      chown -R dev:users /etc/nixos 2>/dev/null || true

      cp -rn ${monolithSkel}/. /home/dev/ 2>/dev/null || true
      chmod -R u+w /home/dev 2>/dev/null || true
      chown -R dev:users /home/dev

      ${monolithApplyBootconf}/bin/monolith-apply-bootconf ${monolithSkel} || true
      sync

      ACTIVE_USER="dev"
      if [ -f /etc/monolith/active-user ]; then
        ACTIVE_USER=$(cat /etc/monolith/active-user 2>/dev/null || echo "dev")
      fi
      if [ -s /persist/nixos/profile-store-paths.txt ] && [ -d /persist/nix-cache ]; then
        mapfile -t SAVED_PATHS < <(grep -v '^$' /persist/nixos/profile-store-paths.txt || true)
        if [ "''${#SAVED_PATHS[@]}" -gt 0 ]; then
          nix --extra-experimental-features 'nix-command flakes' copy --from 'file:///persist/nix-cache' --no-check-sigs "''${SAVED_PATHS[@]}" >/dev/null 2>&1 || true
          /run/wrappers/bin/su - "$ACTIVE_USER" -c "nix --extra-experimental-features 'nix-command flakes' --offline profile install ''${SAVED_PATHS[*]}" >/dev/null 2>&1 || true
        fi
      fi
    '';
  };

  # JetBrains Mono enforced across every UI, TUI, terminal, and browser
  fonts = {
    packages = with pkgs; [
      jetbrains-mono
      nerd-fonts.jetbrains-mono
      noto-fonts
      terminus_font
    ];
    fontconfig.defaultFonts = {
      monospace = [ "JetBrains Mono" ];
      sansSerif = [ "JetBrains Mono" ];
      serif = [ "JetBrains Mono" ];
    };
  };

  environment.systemPackages = with pkgs; [
    firefox
    neovim
    git
    gh
    openssh
    localsend
    obs-studio
    mise
    direnv
    nix-direnv
    kdePackages.qttools
    bluez
    bluetui
    usbutils
    wlr-randr
    yazi
    btop
    wl-clipboard
    grim
    slurp
    brightnessctl
    ripgrep
    fd
    jq
    lsof
    curl
    rsync
    unzip
    gnutar
    dialog
    parted
    gptfdisk
    dosfstools
    e2fsprogs
    exfatprogs
    util-linux
    monolithFirstboot
    monolithPkg
    monolithRamClean
    monolithScreensaver
    monolithHardware
    monolithSettings
    monolithExe
    monolithReset
    monolithPersistUsb
    monolithShortcutMenu
    monolithPlasmaInit
    monolithBluetooth
    monolithConfig
    monolithNewProject
    monolithScreenshot
    monolithUpdate
    monolithApplyBootconf
    localSendCompat
  ];

  system.stateVersion = "25.11";
}

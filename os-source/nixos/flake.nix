{
  description = "Monolith NixOS — Minimal Declarative Portable NixOS Live ISO (Niri Wayland Only)";

  inputs = {
    # Latest NixOS channel selected in Monolith Settings (nixos-unstable)
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs = { self, nixpkgs, ... }:
    let
      system = "x86_64-linux";
      monolithSystem = nixpkgs.lib.nixosSystem {
        inherit system;
        modules = [
          ./configuration.nix
        ];
      };
    in {
      nixosConfigurations.monolith = monolithSystem;
      packages.${system} = {
        iso = monolithSystem.config.system.build.isoImage;
        default = monolithSystem.config.system.build.isoImage;
      };
    };
}

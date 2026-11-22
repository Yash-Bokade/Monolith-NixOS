import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_OS_CONFIG } from '../src/lib/osDefaults';
import { generateOsRepositoryFiles } from '../src/lib/osEngine';

const outRoot = path.resolve(process.cwd(), 'os-source');
fs.rmSync(outRoot, { recursive: true, force: true });
fs.mkdirSync(outRoot, { recursive: true });

const files = generateOsRepositoryFiles(DEFAULT_OS_CONFIG);
for (const file of files) {
  const fullPath = path.join(outRoot, file.path);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, file.content, 'utf8');
  if (file.executable) {
    fs.chmodSync(fullPath, 0o755);
  }
}

// Mirror ONLY build-nixos.yml at repository root pointing to os-source/nixos
const rootWorkflowsDir = path.resolve(process.cwd(), '.github/workflows');
fs.mkdirSync(rootWorkflowsDir, { recursive: true });
for (const stale of ['build-iso.yml', 'build-arch.yml', 'build-fedora.yml']) {
  fs.rmSync(path.join(rootWorkflowsDir, stale), { force: true });
}

const nixWorkflow = files.find((f) => f.path === '.github/workflows/build-nixos.yml');
if (nixWorkflow) {
  const rootWorkflowPath = path.join(rootWorkflowsDir, 'build-nixos.yml');
  const rootWorkflowContent = nixWorkflow.content
    .replaceAll("'nixos/**'", "'os-source/nixos/**'")
    .replaceAll(
      'nix build ./nixos#packages.x86_64-linux.iso',
      'nix build ./os-source/nixos#packages.x86_64-linux.iso',
    );
  fs.writeFileSync(rootWorkflowPath, rootWorkflowContent, 'utf8');
}

console.log(
  `Synced ${files.length} minimal Monolith NixOS files into os-source/ and build-nixos.yml into .github/workflows/`,
);

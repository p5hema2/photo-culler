/**
 * electron-builder `afterPack` hook — assertion only, it never modifies output.
 *
 * If the vendoring in `vendor-native-deps.mjs` ever misfires, the app still
 * builds and installs perfectly and only dies at runtime on the first
 * thumbnail with `Could not load the "sharp" module`. That is a release-grade
 * failure with no build-time signal, so this check is mandatory rather than
 * nice-to-have: it turns a silent miss into a failed build.
 *
 * Resolved via electron-builder's `resolveFunction`, which resolves a leading
 * "./" against process.cwd() — NOT against the config file. `pnpm package:*`
 * runs with cwd = apps/desktop, so `./scripts/verify-pack.mjs` is correct.
 */

import { existsSync, readdirSync } from 'fs';
import { join } from 'path';

/** Arch ordinals from builder-util: ia32=0, x64=1, armv7l=2, arm64=3, universal=4. */
const ARCH_NAMES = ['ia32', 'x64', 'armv7l', 'arm64', 'universal'];

export default async function verifyPack(context) {
  const { appOutDir, electronPlatformName, arch } = context;
  const archName = ARCH_NAMES[arch] ?? String(arch);

  // asar is disabled, so the app tree sits unpacked under resources/app.
  const candidates = [
    join(appOutDir, 'resources', 'app', 'node_modules'),
    join(appOutDir, 'Photo Culler.app', 'Contents', 'Resources', 'app', 'node_modules'),
  ];
  const nodeModules = candidates.find((p) => existsSync(p));
  if (!nodeModules) {
    throw new Error(
      `verify-pack: no packaged node_modules found. Looked in:\n  ${candidates.join('\n  ')}`,
    );
  }

  const problems = [];

  // ── sharp: exactly the target's addon, and nothing from another platform
  const imgDir = join(nodeModules, '@img');
  const imgEntries = existsSync(imgDir) ? readdirSync(imgDir) : [];
  const addons = imgEntries.filter(
    (n) => n.startsWith('sharp-') && !n.startsWith('sharp-libvips-'),
  );

  const expectedAddon = `sharp-${electronPlatformName === 'darwin' ? 'darwin' : electronPlatformName === 'win32' ? 'win32' : 'linux'}-${archName}`;

  if (addons.length !== 1) {
    problems.push(`expected exactly one @img/sharp-* addon, found: ${addons.join(', ') || 'none'}`);
  } else if (addons[0] !== expectedAddon) {
    problems.push(`expected @img/${expectedAddon}, found @img/${addons[0]}`);
  }

  // This is the regression test for the whole size change: no foreign binaries.
  const foreign = imgEntries.filter(
    (n) => n.startsWith('sharp-') && !n.includes(`-${archName}`) && n !== 'colour',
  );
  if (foreign.length > 0) {
    problems.push(`foreign-platform binaries shipped: ${foreign.join(', ')}`);
  }

  if (!existsSync(join(nodeModules, 'sharp', 'lib', 'sharp.js'))) {
    problems.push('sharp/lib/sharp.js is missing');
  }

  // ── exiftool: exactly one platform package, and it matches the target
  const expectedExif =
    electronPlatformName === 'win32' ? 'exiftool-vendored.exe' : 'exiftool-vendored.pl';
  const exifPkgs = ['exiftool-vendored.exe', 'exiftool-vendored.pl'].filter((n) =>
    existsSync(join(nodeModules, n)),
  );

  if (exifPkgs.length !== 1) {
    problems.push(
      `expected exactly one exiftool platform package, found: ${exifPkgs.join(', ') || 'none'}`,
    );
  } else if (exifPkgs[0] !== expectedExif) {
    problems.push(`expected ${expectedExif}, found ${exifPkgs[0]}`);
  }

  if (problems.length > 0) {
    throw new Error(
      `verify-pack failed for ${electronPlatformName}-${archName} in ${nodeModules}:\n` +
        problems.map((p) => `  - ${p}`).join('\n'),
    );
  }

  console.log(`  • verify-pack: ${electronPlatformName}-${archName} native deps look correct`);
}

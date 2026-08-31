/**
 * electron-builder `afterPack` hook — assertion only, it never modifies output.
 *
 * If the vendoring in `vendor-native-deps.mjs` ever misfires, the app still
 * builds and installs perfectly and only dies at runtime — every metadata read,
 * rating write and rotation failing, because the exiftool child cannot spawn and
 * `exiftool.ts` makes that failure sticky for the session. That is a
 * release-grade failure with no build-time signal, so this check is mandatory
 * rather than nice-to-have: it turns a silent miss into a failed build.
 *
 * It checks two opposite things, and the second is newer:
 *
 * - exiftool-vendored MUST be present, and must be the target's platform package.
 * - sharp must NOT be present. It became a devDependency once rotation stopped
 *   re-encoding pixels, and this assertion is what keeps ~19-21 MB of libvips per
 *   artifact from creeping back in. Up to that change this file REQUIRED sharp,
 *   so if you are here because the build fails asking for it, the fix is to stop
 *   staging it in `vendor-native-deps.mjs`, not to restore the old assertion.
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

  // ── sharp: must be ABSENT. No runtime code imports it; it is a devDependency
  // for make-icons.mjs and the fixture-generating tests only. Both the wrapper
  // and its platform binaries are checked, because staging either one is the
  // mistake this catches — and `@img` is where the ~19-21 MB actually lives.
  const imgDir = join(nodeModules, '@img');
  const imgEntries = existsSync(imgDir) ? readdirSync(imgDir) : [];
  const sharpBinaries = imgEntries.filter((n) => n.startsWith('sharp-'));

  if (sharpBinaries.length > 0) {
    problems.push(
      `sharp platform binaries shipped, expected none: ${sharpBinaries.join(', ')}. ` +
        'sharp is a devDependency — stop staging it in vendor-native-deps.mjs.',
    );
  }
  if (existsSync(join(nodeModules, 'sharp'))) {
    problems.push('the sharp package shipped, expected none — see vendor-native-deps.mjs');
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

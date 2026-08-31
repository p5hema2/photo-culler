/**
 * Stages the platform-specific native dependencies electron-builder must ship,
 * into `apps/desktop/vendor/<os>-<arch>/node_modules/`.
 *
 * That is `exiftool-vendored` and nothing else. `sharp` used to be staged here
 * too and is deliberately gone: no main-, preload- or renderer-side code imports
 * it any more (rotation was its last runtime caller, and it became an EXIF
 * Orientation tag write), so every artifact was carrying ~19-21 MB of libvips for
 * nothing. It is still a devDependency, for `make-icons.mjs` and for the
 * main-process tests that generate real JPEG/PNG fixtures — it just is not
 * shipped. `verify-pack.mjs` asserts it stays out.
 *
 * Two problems are being solved here:
 *
 * 1. pnpm keeps a package's dependencies as siblings in its virtual store
 *    (`node_modules/.pnpm/<pkg>@<ver>/node_modules/`) and links them by symlink.
 *    electron-builder cannot follow those, so the tree has to be flattened.
 *
 * 2. Optional platform packages are installed for every platform (see
 *    `pnpm.supportedArchitectures` in the root package.json), so each target has
 *    to be given only its own. `exiftool-vendored.exe` and `exiftool-vendored.pl`
 *    are the pair that matters; shipping both would put a Perl distribution in
 *    the Windows installer and a Windows exe in the mac bundle.
 *
 * Pruning is a DENY-list, not an allow-list: only names positively identified
 * as platform-specific are dropped, so a future platform-neutral dependency of
 * exiftool-vendored is carried along automatically. The `@img/sharp-*` patterns
 * stay in that list even though nothing reaches them now — they cost nothing and
 * they mean re-adding a root cannot quietly ship foreign binaries again.
 *
 * Usage:
 *   node scripts/vendor-native-deps.mjs [--target <os>-<arch>]... [--verbose]
 *
 *   --target   Repeatable. win-x64 | win-arm64 | mac-x64 | mac-arm64
 *              | linux-x64 | linux-arm64. Defaults to the host's target.
 *   --verbose  Print every copied package.
 *
 * `<os>` is electron-builder's build configuration key (mac/win/linux), NOT the
 * Node platform name, because the directory has to match the `${os}-${arch}`
 * macro used in electron-builder.yml.
 */

import { cpSync, mkdirSync, rmSync, realpathSync, readdirSync, existsSync, statSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const appDir = resolve(import.meta.dirname, '..');

/** Names we know are platform-specific. Everything else is copied. */
const PLATFORM_SPECIFIC = [
  /^@img\/sharp-/,
  /^@img\/sharp-libvips-/,
  /^exiftool-vendored\.(exe|pl)$/,
];

/**
 * What each target keeps. Only the exiftool binary differs by platform now, and
 * only by OS — `exiftool-vendored.pl` declares `"os": ["!win32"]` and there is no
 * per-arch split — so every mac and linux target names the same package. The
 * table stays keyed by `<os>-<arch>` because the directory name has to match
 * electron-builder.yml's `${os}-${arch}` macro.
 */
const TARGETS = {
  'win-x64': { exiftool: 'exiftool-vendored.exe' },
  'win-arm64': { exiftool: 'exiftool-vendored.exe' },
  'mac-x64': { exiftool: 'exiftool-vendored.pl' },
  'mac-arm64': { exiftool: 'exiftool-vendored.pl' },
  'linux-x64': { exiftool: 'exiftool-vendored.pl' },
  'linux-arm64': { exiftool: 'exiftool-vendored.pl' },
};

const OS_KEY = { win32: 'win', darwin: 'mac', linux: 'linux' };

// ─── args ────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const verbose = args.includes('--verbose');
const requested = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--target') {
    const t = args[++i];
    if (!t || !(t in TARGETS)) {
      console.error(`Unknown target "${t}". Known: ${Object.keys(TARGETS).join(', ')}`);
      process.exit(1);
    }
    requested.push(t);
  }
}
if (requested.length === 0) {
  const hostTarget = `${OS_KEY[process.platform] ?? process.platform}-${process.arch}`;
  if (!(hostTarget in TARGETS)) {
    console.error(`No target given and the host (${hostTarget}) is not a supported target.`);
    process.exit(1);
  }
  requested.push(hostTarget);
}

// ─── source roots in the pnpm virtual store ──────────────────────────

/** The virtual-store node_modules dir holding `pkg` and all of its siblings. */
function virtualStoreDir(pkg) {
  const pkgJson = realpathSync(require.resolve(`${pkg}/package.json`));
  return dirname(dirname(pkgJson));
}

// One root now. `sharp` used to be a second one; see the header for why it is not.
const roots = [virtualStoreDir('exiftool-vendored')];

// ─── copy ────────────────────────────────────────────────────────────

function copyPackage(srcRoot, name, destRoot) {
  const src = join(srcRoot, name);
  const dest = join(destRoot, name);
  mkdirSync(dirname(dest), { recursive: true });
  // dereference resolves pnpm's symlinks; file modes are preserved, which is
  // what keeps exiftool-vendored.pl/bin/exiftool executable.
  cpSync(src, dest, { recursive: true, dereference: true });
  if (verbose) console.log(`    ${name}`);
}

function isPlatformSpecific(name) {
  return PLATFORM_SPECIFIC.some((re) => re.test(name));
}

/** List package names in a virtual-store node_modules, expanding @scopes. */
function listPackages(root) {
  const names = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    if (entry.name.startsWith('@')) {
      for (const sub of readdirSync(join(root, entry.name), { withFileTypes: true })) {
        names.push(`${entry.name}/${sub.name}`);
      }
    } else {
      names.push(entry.name);
    }
  }
  return names;
}

let failed = false;

for (const target of requested) {
  const spec = TARGETS[target];
  const destRoot = resolve(appDir, 'vendor', target, 'node_modules');
  console.log(`\n${target}`);

  rmSync(resolve(appDir, 'vendor', target), { recursive: true, force: true });
  mkdirSync(destRoot, { recursive: true });

  const keep = new Set([spec.exiftool]);
  const copied = new Set();

  for (const root of roots) {
    for (const name of listPackages(root)) {
      if (copied.has(name)) continue;
      if (isPlatformSpecific(name) && !keep.has(name)) continue;
      copyPackage(root, name, destRoot);
      copied.add(name);
    }
  }

  // ── assertions: a silent miss here ships an app that installs fine and then
  // loses every metadata read, rating write and rotation, because the exiftool
  // child cannot spawn. `exiftool.ts` makes that failure sticky for the session.
  const problems = [];

  for (const name of keep) {
    if (!copied.has(name)) {
      problems.push(
        `missing ${name} — run \`pnpm install\`. If it stays missing, check that ` +
          `pnpm.supportedArchitectures in the root package.json declares ONLY "cpu". ` +
          `Listing "os" makes pnpm match optional deps against that literal list, which ` +
          `never matches a negated "os" field such as exiftool-vendored.pl's ["!win32"].`,
      );
    }
  }

  // sharp is a devDependency and must not be staged. Copying it back would be
  // ~19-21 MB of libvips per artifact for code that no longer exists, and
  // `verify-pack.mjs` would fail the build — assert it here too, where the
  // diagnostic can name the cause.
  if (existsSync(join(destRoot, '@img')) || copied.has('sharp')) {
    problems.push(
      'sharp was staged. It is a devDependency with no runtime caller — remove it ' +
        'from `roots`/`TARGETS` rather than relaxing verify-pack.mjs.',
    );
  }

  const binName = spec.exiftool.endsWith('.exe') ? 'exiftool.exe' : 'exiftool';
  const bin = join(destRoot, spec.exiftool, 'bin', binName);
  if (copied.has(spec.exiftool)) {
    if (!existsSync(bin)) {
      problems.push(`missing ${spec.exiftool}/bin/${binName}`);
    } else if (process.platform !== 'win32' && !(statSync(bin).mode & 0o100)) {
      problems.push(`${spec.exiftool}/bin/${binName} is not executable`);
    }
  }

  if (problems.length > 0) {
    failed = true;
    for (const p of problems) console.error(`  ERROR: ${p}`);
  } else {
    console.log(`  ok — ${copied.size} packages`);
  }
}

if (failed) process.exit(1);

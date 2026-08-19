/**
 * Stages the platform-specific native dependencies electron-builder must ship,
 * into `apps/desktop/vendor/<os>-<arch>/node_modules/`.
 *
 * Two problems are being solved at once:
 *
 * 1. pnpm keeps a package's dependencies as siblings in its virtual store
 *    (`node_modules/.pnpm/<pkg>@<ver>/node_modules/`) and links them by symlink.
 *    electron-builder cannot follow those, so the tree has to be flattened.
 *
 * 2. The root `.npmrc` declares every supported architecture, so `pnpm install`
 *    fetches ALL of sharp's platform binaries. Copying them wholesale shipped
 *    ~115 MB of macOS and Linux libvips inside the Windows installer. Each
 *    target now gets only its own binaries.
 *
 * Pruning is a DENY-list, not an allow-list: only names positively identified
 * as platform-specific are dropped, so a future platform-neutral dependency of
 * sharp or exiftool-vendored is carried along automatically.
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
 * What each target keeps.
 *
 * Note the asymmetry, verified on disk: win32 has NO separate
 * `@img/sharp-libvips-win32-*` — the libvips DLLs live inside
 * `@img/sharp-win32-<arch>/lib/`. darwin and linux need the extra package.
 */
const TARGETS = {
  'win-x64': { img: ['sharp-win32-x64'], exiftool: 'exiftool-vendored.exe' },
  'win-arm64': { img: ['sharp-win32-arm64'], exiftool: 'exiftool-vendored.exe' },
  'mac-x64': {
    img: ['sharp-darwin-x64', 'sharp-libvips-darwin-x64'],
    exiftool: 'exiftool-vendored.pl',
  },
  'mac-arm64': {
    img: ['sharp-darwin-arm64', 'sharp-libvips-darwin-arm64'],
    exiftool: 'exiftool-vendored.pl',
  },
  'linux-x64': {
    img: [
      'sharp-linux-x64',
      'sharp-libvips-linux-x64',
      'sharp-linuxmusl-x64',
      'sharp-libvips-linuxmusl-x64',
    ],
    exiftool: 'exiftool-vendored.pl',
  },
  'linux-arm64': {
    img: [
      'sharp-linux-arm64',
      'sharp-libvips-linux-arm64',
      'sharp-linuxmusl-arm64',
      'sharp-libvips-linuxmusl-arm64',
    ],
    exiftool: 'exiftool-vendored.pl',
  },
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

const roots = [virtualStoreDir('sharp'), virtualStoreDir('exiftool-vendored')];

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

  const keep = new Set([...spec.img.map((n) => `@img/${n}`), spec.exiftool]);
  const copied = new Set();

  for (const root of roots) {
    for (const name of listPackages(root)) {
      if (copied.has(name)) continue;
      if (isPlatformSpecific(name) && !keep.has(name)) continue;
      copyPackage(root, name, destRoot);
      copied.add(name);
    }
  }

  // ── assertions: a silent miss here ships an app that installs fine and
  // then dies on the first thumbnail with `Could not load the "sharp" module`.
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

  for (const n of spec.img) {
    const dir = join(destRoot, '@img', n);
    if (!existsSync(dir)) continue;
    if (n.startsWith('sharp-libvips-')) {
      const lib = join(dir, 'lib');
      if (!existsSync(lib) || readdirSync(lib).length === 0) {
        problems.push(`${n}/lib is empty`);
      }
    } else {
      const addon = join(dir, 'lib', `${n}.node`);
      if (!existsSync(addon)) problems.push(`missing native addon ${n}/lib/${n}.node`);
    }
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

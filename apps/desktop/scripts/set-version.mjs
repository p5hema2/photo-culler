/**
 * Stamps the release version into apps/desktop/package.json at build time.
 *
 * The git tag is the single source of truth for the release version. The
 * version committed in package.json is a placeholder for local builds and is
 * never released as-is.
 *
 * electron-builder reads the version from package.json to interpolate
 * ${version} into artifact names (see electron-builder.yml), and the file is
 * copied into the app bundle, so this must run before `pnpm package`.
 *
 * Version source, in order of precedence:
 *   1. argv[2]              — explicit, for local testing
 *   2. GITHUB_REF_NAME      — set automatically by Actions on a tag push
 *
 * A leading "v" is stripped, so both "v1.2.0" and "1.2.0" are accepted.
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

// Matches semver core with optional prerelease/build metadata (e.g. 1.2.0-rc.1)
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[\w.-]+)?(?:\+[\w.-]+)?$/;

const appDir = resolve(import.meta.dirname, '..');
const pkgPath = resolve(appDir, 'package.json');

const rawVersion = process.argv[2] ?? process.env.GITHUB_REF_NAME;

if (!rawVersion) {
  console.error(
    'No version given. Pass one as an argument or set GITHUB_REF_NAME (e.g. "v1.2.0").',
  );
  process.exit(1);
}

const version = rawVersion.replace(/^v/, '');

if (!SEMVER.test(version)) {
  console.error(`Not a valid semver version: "${rawVersion}" (parsed as "${version}")`);
  process.exit(1);
}

const raw = readFileSync(pkgPath, 'utf8');
const pkg = JSON.parse(raw);
const previous = pkg.version;
pkg.version = version;

// Preserve the 2-space indent + trailing newline that prettier enforces
writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);

console.log(`Stamped version: ${previous} -> ${version} (${pkgPath})`);

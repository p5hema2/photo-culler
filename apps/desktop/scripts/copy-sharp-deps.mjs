/**
 * Copies sharp and all its dependencies from the pnpm virtual store
 * into a flat node_modules structure that electron-builder can package.
 *
 * pnpm stores sharp's deps as siblings under:
 *   node_modules/.pnpm/sharp@<version>/node_modules/
 * This script finds that path dynamically and copies everything into
 *   apps/desktop/sharp-vendor/node_modules/
 */

import { cpSync, mkdirSync, rmSync, realpathSync, readdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const appDir = resolve(import.meta.dirname, '..');
const vendorDir = resolve(appDir, 'sharp-vendor', 'node_modules');

// Clean previous vendor dir
rmSync(resolve(appDir, 'sharp-vendor'), { recursive: true, force: true });
mkdirSync(vendorDir, { recursive: true });

// Resolve the real path of sharp (follows pnpm symlink into virtual store)
const sharpEntry = require.resolve('sharp');
const sharpPkg = resolve(realpathSync(resolve(dirname(sharpEntry), '..')));
// The virtual store's node_modules dir contains sharp + all its deps
const virtualNodeModules = dirname(sharpPkg);

console.log(`Copying sharp deps from: ${virtualNodeModules}`);

for (const entry of readdirSync(virtualNodeModules, { withFileTypes: true })) {
  const src = resolve(virtualNodeModules, entry.name);
  const dest = resolve(vendorDir, entry.name);

  if (entry.name.startsWith('.')) continue;

  // Handle scoped packages (@img, etc.)
  if (entry.name.startsWith('@')) {
    mkdirSync(dest, { recursive: true });
    for (const sub of readdirSync(src, { withFileTypes: true })) {
      const subSrc = resolve(src, sub.name);
      const subDest = resolve(dest, sub.name);
      console.log(`  @${entry.name}/${sub.name}`);
      cpSync(subSrc, subDest, { recursive: true, dereference: true });
    }
  } else {
    console.log(`  ${entry.name}`);
    cpSync(src, dest, { recursive: true, dereference: true });
  }
}

console.log(`Sharp vendor deps copied to: ${vendorDir}`);

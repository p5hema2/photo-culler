/**
 * Asserts that the portable-mode userData redirect is emitted BEFORE
 * electron-store is constructed, in the BUILT main bundle.
 *
 * Source-level import order is not what decides this, which is why a unit test
 * would guard the wrong thing: a path override is a dependency EDGE, and what
 * matters is where the bundler ended up placing each side. `store.ts` builds its
 * Store at module scope and electron-store reads `app.getPath('userData')` in the
 * constructor, so an override emitted one line later is an override that never
 * happened — and the failure is silent, a `session.json` in %APPDATA% that nobody
 * looks for.
 *
 * Run after `pnpm build`, from apps/desktop. Baseline when this was written:
 * `new ElectronStore(` at out/main/index.js:13147, the redirect above it.
 */

import { readFileSync } from 'node:fs';

const BUNDLE = 'out/main/index.js';

let src;
try {
  src = readFileSync(BUNDLE, 'utf8');
} catch {
  throw new Error(`verify-path-order: ${BUNDLE} not found — run \`pnpm build\` first.`);
}

const redirect = src.search(/setPath\(\s*["']userData["']/);
const store = src.indexOf('new ElectronStore(');

// Both probes match on the bundled output rather than on our own source, so
// either can be invalidated by a dependency upgrade. Fail loudly instead of
// passing vacuously — a check that silently stops checking is worse than none.
if (redirect === -1) {
  throw new Error(
    `verify-path-order: no setPath("userData") in ${BUNDLE}. ` +
      'Either src/main/portable.ts is no longer reached, or it was rewritten — ' +
      'fix the app, or update this probe deliberately.',
  );
}
if (store === -1) {
  throw new Error(
    `verify-path-order: no \`new ElectronStore(\` in ${BUNDLE}. ` +
      'electron-store probably changed its bundled class name; update this probe.',
  );
}

if (redirect > store) {
  throw new Error(
    `verify-path-order: the userData redirect (offset ${redirect}) is emitted AFTER ` +
      `electron-store is constructed (offset ${store}), so portable mode is inert and ` +
      'session.json lands in the OS profile. src/main/portable.ts must be imported above ' +
      "'./ipc-handlers' in src/main/index.ts — see that file's header.",
  );
}

console.log(
  `verify-path-order: userData redirect at ${redirect} precedes electron-store at ${store}`,
);

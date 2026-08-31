import { app } from 'electron';
import path from 'node:path';
import { existsSync, mkdirSync, writeFileSync, unlinkSync } from 'node:fs';

/**
 * Portable mode: keep every byte this app writes inside its own folder.
 *
 * Nothing photo-related is at stake. Quality scores live in
 * `.photo-culler-results.json`, thumbnails in `.photo-culler-thumbs/` — both
 * beside the photos — and ratings inside the image files themselves. What is at
 * stake is the Chromium profile plus electron-store's `session.json`, which
 * otherwise land in `%APPDATA%\@photo-culler\desktop` (the SCOPED package name,
 * because the packaged package.json carries `name: "@photo-culler/desktop"` and
 * no `productName`) or `~/Library/Application Support/Photo Culler`. Measured on
 * a clean packaged run: 2.6 MB of caches and one 218-byte settings file, created
 * on every host machine a portable copy is plugged into.
 *
 * IMPORT ORDER IS LOAD-BEARING — and not for the reason it looks like.
 * `store.ts` constructs electron-store at MODULE scope, and electron-store reads
 * `app.getPath('userData')` in its constructor. The reflex is to put this above
 * index.ts's `import './store'`, whose comment even claims it exists to
 * initialize the store early. That import is DEAD: the store is already pulled
 * in five lines above it, via `./ipc-handlers`. ES module imports are hoisted
 * and evaluated depth-first before any statement in the importing module runs,
 * so this file has to be imported ABOVE `'./ipc-handlers'` — and a function
 * exported from here and called from index.ts's body would be too late by
 * construction. `store.ts` imports this module too, so the ordering survives as
 * a DEPENDENCY EDGE rather than as a source position an import sorter can move.
 * `scripts/verify-path-order.mjs` asserts the property on the built bundle,
 * which is the only place it is actually decided.
 *
 * ONE setPath call is enough: `sessionData`, `crashDumps` and `logs` all derive
 * from `userData` unless separately overridden. Do not add a second call.
 */

/** The folder to treat as "the app's own folder", or null if not portable. */
function portableRoot(): string | null {
  // Set only by electron-builder's NSIS `portable` target, where it names the
  // folder holding the exe rather than the %TEMP% tree the stub extracted into.
  // We deliberately do not ship that target — it re-extracts the whole app on
  // every launch — but honour the variable so it cannot silently misbehave.
  const fromStub = process.env.PORTABLE_EXECUTABLE_DIR;
  if (fromStub) return fromStub;

  const exeDir = path.dirname(app.getPath('exe'));

  // …/Photo Culler.app/Contents/MacOS/Photo Culler -> the folder HOLDING the
  // bundle. Never inside it: the bundle is read-only on a DMG, under Gatekeeper
  // App Translocation and on a write-protected volume, and writing into it would
  // break the ad-hoc signature electron-builder applies to arm64 builds.
  const base =
    process.platform === 'darwin' && exeDir.endsWith(path.join('Contents', 'MacOS'))
      ? path.resolve(exeDir, '..', '..', '..')
      : exeDir;

  // Opt in by marker file, so someone who unzipped into Program Files keeps the
  // roaming profile they already have. On macOS the marker doubles as the
  // fail-safe for App Translocation: that copies only the .app, so a translocated
  // launch cannot see a sibling marker and falls back without any path sniffing.
  // Explorer appends .txt to a file created without an extension — take both.
  const marked = ['portable', 'portable.txt'].some((name) => existsSync(path.join(base, name)));
  return marked ? base : null;
}

/**
 * Windows' `access(W_OK)` reports only the read-only ATTRIBUTE, not whether the
 * ACL permits a write, so probe for real. `mkdir` first because `app.setPath`
 * throws for a path that does not exist.
 */
function writable(dir: string): boolean {
  const probe = path.join(dir, `.write-probe-${process.pid}`);
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(probe, '');
    unlinkSync(probe);
    return true;
  } catch {
    return false;
  }
}

/** Where portable data actually went, or null. Surfaced in the About dialog. */
export const portableDataDir: string | null = (() => {
  if (!app.isPackaged) return null;

  const root = portableRoot();
  if (root === null) return null;

  const dir = path.join(root, 'photo-culler-data');
  if (!writable(dir)) {
    // A read-only medium, or an ACL that says no. Keep the OS default: userData
    // holds seven UI preferences and disposable Chromium caches, so degrading
    // quietly beats failing to start — and this runs at module scope, before any
    // window exists to show an error in.
    return null;
  }

  app.setPath('userData', dir);
  return dir;
})();

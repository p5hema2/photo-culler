/**
 * Validates electron-builder.yml against electron-builder's OWN JSON schema.
 *
 * Why this exists: `ci.yml` stops at `pnpm build` and never packages, so a
 * malformed builder config first surfaces on a `v*` tag push — after the tag is
 * public. And the config is easy to get wrong in one specific way:
 * `scheme.json` sets `additionalProperties: false` and has properties for
 * `nsis`, `dmg`, `portable` and friends but NONE for `zip`, so a root `zip:`
 * block is a hard ValidationError. It reads as though it should work because
 * `ArchiveTarget` does look up `config["zip"]` at runtime. The archive targets
 * are named through `win.artifactName` / `mac.artifactName` instead.
 *
 * No new dependency: the schema, js-yaml and the validator all already sit in the
 * store as electron-builder's own transitive deps. They are reached through a
 * chained createRequire so pnpm's virtual store resolves them the same way
 * electron-builder itself does.
 */

import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const configPath = path.join(here, '..', 'electron-builder.yml');

const requireHere = createRequire(import.meta.url);
const requireFromBuilder = createRequire(requireHere.resolve('electron-builder/package.json'));
const requireFromLib = createRequire(requireFromBuilder.resolve('app-builder-lib/package.json'));

const schema = requireFromLib('./scheme.json');
const yaml = requireFromLib('js-yaml');
// The module export IS the validator — not a `{ validate }` namespace. This is
// the same call app-builder-lib makes in out/util/config/config.js:207.
const validateSchema = requireFromLib('@develar/schema-utils');

const config = yaml.load(readFileSync(configPath, 'utf8'));

// `afterPack` is a function at runtime and a string here; the schema accepts
// both, so the file validates as written. Nothing is normalised before the check
// on purpose — we want to validate exactly what electron-builder will read.
try {
  validateSchema(schema, config, {
    name: 'electron-builder.yml',
    postFormatter: (formattedError) => formattedError,
  });
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}

console.log('validate-builder-config: electron-builder.yml is valid');

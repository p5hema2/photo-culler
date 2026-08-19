#!/usr/bin/env node
// Build the packaged app's icons from one master PNG.
//
//   node scripts/make-icons.mjs [source.png]
//
// Source defaults to build/icon-source.png and must be square and at least
// 1024px, because that is the largest size macOS asks for. Everything else is
// derived, so the master is the only artwork under version control that anyone
// has to redraw.
//
// Both container formats are written by hand rather than shelled out to
// iconutil or ImageMagick: neither exists on a Windows dev machine, and both
// formats are just a header plus embedded PNGs. sharp does the resampling and
// is already a dependency.

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(root, process.argv[2] ?? 'build/icon-source.png');

/** Windows reads PNG-compressed entries from Vista onwards. */
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

/**
 * macOS icon types, each a size and the slot it fills. 256 and 512 appear
 * twice on purpose: the second of each pair is the @2x slot for the size below
 * it, and macOS picks between them by display scale.
 */
const ICNS_TYPES = [
  ['ic11', 32],
  ['ic12', 64],
  ['ic07', 128],
  ['ic13', 256],
  ['ic08', 256],
  ['ic14', 512],
  ['ic09', 512],
  ['ic10', 1024],
];

/** Resize the master to one square PNG. */
async function render(image, size) {
  return image
    .clone()
    .resize(size, size, { fit: 'cover', kernel: 'lanczos3' })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

function buildIco(images) {
  const HEADER = 6;
  const ENTRY = 16;
  const header = Buffer.alloc(HEADER);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // 1 = icon
  header.writeUInt16LE(images.length, 4);

  let offset = HEADER + ENTRY * images.length;
  const entries = images.map(({ size, data }) => {
    const entry = Buffer.alloc(ENTRY);
    // 256 does not fit in a byte and is encoded as 0.
    entry.writeUInt8(size === 256 ? 0 : size, 0);
    entry.writeUInt8(size === 256 ? 0 : size, 1);
    entry.writeUInt8(0, 2); // palette size, 0 for true colour
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // colour planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += data.length;
    return entry;
  });

  return Buffer.concat([header, ...entries, ...images.map((i) => i.data)]);
}

function buildIcns(chunks) {
  const body = chunks.map(({ type, data }) => {
    const head = Buffer.alloc(8);
    head.write(type, 0, 4, 'ascii');
    head.writeUInt32BE(data.length + 8, 4); // length counts the header itself
    return Buffer.concat([head, data]);
  });

  const total = 8 + body.reduce((sum, b) => sum + b.length, 0);
  const head = Buffer.alloc(8);
  head.write('icns', 0, 4, 'ascii');
  head.writeUInt32BE(total, 4);
  return Buffer.concat([head, ...body]);
}

async function main() {
  const master = sharp(await readFile(source));
  const { width, height } = await master.metadata();

  if (width !== height) {
    throw new Error(`icon source must be square, got ${width}x${height}`);
  }
  if (width < 1024) {
    throw new Error(`icon source must be at least 1024px, got ${width}px`);
  }

  // Distinct sizes only — the two 256s and two 512s share one render.
  const sizes = [...new Set([...ICO_SIZES, ...ICNS_TYPES.map(([, s]) => s), 512])];
  const rendered = new Map(
    await Promise.all(sizes.map(async (size) => [size, await render(master, size)])),
  );

  const ico = buildIco(ICO_SIZES.map((size) => ({ size, data: rendered.get(size) })));
  const icns = buildIcns(ICNS_TYPES.map(([type, size]) => ({ type, data: rendered.get(size) })));

  await writeFile(resolve(root, 'build/icon.png'), rendered.get(512));
  await writeFile(resolve(root, 'build/icon.ico'), ico);
  await writeFile(resolve(root, 'build/icon.icns'), icns);

  const kb = (b) => `${(b.length / 1024).toFixed(1)} KB`;
  console.log(`icons written from ${source}`);
  console.log(`  build/icon.png   512x512            ${kb(rendered.get(512))}`);
  console.log(`  build/icon.ico   ${ICO_SIZES.join('/')}  ${kb(ico)}`);
  console.log(`  build/icon.icns  32..1024           ${kb(icns)}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});

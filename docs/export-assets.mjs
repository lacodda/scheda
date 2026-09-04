// One-off: rasterize scheda brand SVGs into PNGs + a multi-size .ico.
// Run from the docs package so it resolves the local sharp install:
//   node export-assets.mjs
import sharp from "sharp";
import fs from "node:fs";
import path from "node:path";

const ASSETS = "C:/Projects/scheda/assets";
// The icons the built application ships with. Generated from the same masters
// as everything else: keeping them by hand is how they fell two weeks behind
// the approved mark and shipped the pre-identity orange tile in kilna v0.28-v0.32.
const APP_ICONS = "C:/Projects/scheda/src-tauri/icons";

// The three levels of the mark. Which one a raster takes is decided by
// `levelFor` below, never by habit.
const S = path.join(ASSETS, "logo-s.svg");
const M = path.join(ASSETS, "logo-m.svg");
const L = path.join(ASSETS, "logo.svg");
const BANNER = path.join(ASSETS, "banner.svg");

// Which level of the mark survives at which size — the line rule, not a
// preference: S ≤27px, M 28-63px, L ≥64px. Below 28px the outline and the
// card's ruled lines collapse into noise, so the filled tile is all that
// reads; above 64px the filled tile is a coloured blob and the full mark has
// room for its card (header bar + two ruled lines) inside the hex tile.
function levelFor(size) {
  if (size <= 27) return S;
  if (size <= 63) return M;
  return L;
}

// Largest first. Windows picks by *closest size* and ignores order (see
// "About Icons", Icon Display), but tauri-codegen takes `entries()[0]`
// verbatim as the window icon — so the first entry is the one the titlebar
// stretches from, and a 16px first entry is why it looked smeared.
const ICO_SIZES = [256, 128, 64, 48, 32, 24, 16];

async function png(src, size, out) {
  await sharp(src, { density: 384 }).resize(size, size).png().toFile(out);
}

// Minimal ICO container: header + directory entries + embedded PNG payloads.
function buildIco(pngBuffers, sizes) {
  const count = pngBuffers.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(count, 4);

  const entries = Buffer.alloc(16 * count);
  let offset = 6 + 16 * count;
  pngBuffers.forEach((buf, i) => {
    const size = sizes[i];
    const e = 16 * i;
    entries.writeUInt8(size >= 256 ? 0 : size, e + 0); // width (0 means 256)
    entries.writeUInt8(size >= 256 ? 0 : size, e + 1); // height
    entries.writeUInt8(0, e + 2); // palette
    entries.writeUInt8(0, e + 3); // reserved
    entries.writeUInt16LE(1, e + 4); // color planes
    entries.writeUInt16LE(32, e + 6); // bits per pixel
    entries.writeUInt32LE(buf.length, e + 8);
    entries.writeUInt32LE(offset, e + 12);
    offset += buf.length;
  });

  return Buffer.concat([header, entries, ...pngBuffers]);
}

const icoParts = [];
for (const size of ICO_SIZES) {
  icoParts.push(
    await sharp(levelFor(size), { density: 384 }).resize(size, size).png().toBuffer(),
  );
}
fs.writeFileSync(path.join(ASSETS, "icon.ico"), buildIco(icoParts, ICO_SIZES));
console.log("wrote icon.ico");

// Favicon + docs logo.
await png(S, 32, path.join(ASSETS, "favicon-32.png"));
// 180px is a home-screen tile, well past the 64px line where the full mark
// has room for its card. It was S until v0.32.2 for no reason but habit (kilna).
await png(levelFor(180), 180, path.join(ASSETS, "apple-touch-icon.png"));
await png(L, 512, path.join(ASSETS, "logo-512.png"));
console.log("wrote pngs");

// The application's own icons — the same file the brand ships, so the two
// cannot drift. Every size carries the level that reads at it.
fs.writeFileSync(path.join(APP_ICONS, "icon.ico"), buildIco(icoParts, ICO_SIZES));
await png(L, 512, path.join(APP_ICONS, "icon.png"));
// Sizes the Tauri template ships with. Nothing in tauri.conf.json names them,
// but they are in the repo, and a stale copy of the mark is worse than none.
await png(levelFor(32), 32, path.join(APP_ICONS, "32x32.png"));
await png(levelFor(128), 128, path.join(APP_ICONS, "128x128.png"));
await png(levelFor(256), 256, path.join(APP_ICONS, "256x256.png"));
console.log("wrote application icons");

// GitHub social preview: 1280x640. Two adjustments to the banner: its plate
// spans the full 720px while the artwork only fills part of it (trim the
// tail, or it lands off-centre), and the rounded plate over an identical
// background leaves a visible seam (drop it and keep the inner rows only).
//
// scheda's banner carries a longer subtitle ("a markdown notepad that grows
// into a vault", 42 chars) than kilna's ("from raw idea to shipped work", 29
// chars) at the same font-size, so the artwork's right edge sits further out:
// measured ink (rendering the banner without its background plate and
// scanning for the right-most non-transparent pixel) reaches ~575 of the
// 720-wide viewBox, versus kilna's ~461. Trimming flush to the ink would cut
// closer to the text than kilna's own trim did (kilna's 1290/1600 trim left
// ~119 viewBox units of margin past its own ink), so this keeps the same
// absolute margin rather than the same trim width: 575 + 119 ≈ 694 viewBox
// units, i.e. 1543 in the 1600-wide resize space used below (kilna used
// 1290 for its narrower subtitle).
const bannerWidth = 1600;
const bannerHeight = Math.round((bannerWidth * 170) / 720);
const inset = Math.round((bannerWidth * 6) / 720); // clears the plate's rounded edge
const trimWidth = 1543; // see comment above — scheda's longer subtitle needs more room than kilna's 1290
const banner = await sharp(BANNER, { density: 384 })
  .resize({ width: bannerWidth })
  .extract({ left: inset, top: inset, width: trimWidth - inset, height: bannerHeight - 2 * inset })
  .png()
  .toBuffer();

// Background colour is scheda's own banner plate fill (#1B2126), read from
// banner.svg's `<rect ... fill="#1B2126"/>` — not assumed from another
// project. It happens to match kilna's plate colour, but that is because
// both banners were built from the same base template, not because this
// script copies kilna's value.
await sharp({
  create: { width: 1280, height: 640, channels: 4, background: "#1B2126" },
})
  .composite([{ input: await sharp(banner).resize({ width: 880 }).png().toBuffer(), gravity: "centre" }])
  .png()
  .toFile(path.join(ASSETS, "social-preview.png"));
console.log("wrote social-preview.png");

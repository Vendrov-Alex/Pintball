/**
 * Store + PWA image generator.
 *
 * Writes every icon and splash the two stores need, straight from code — no
 * binary art in the repo, no design tool in the loop, and re-running it after a
 * palette change regenerates the whole set. PNG is encoded by hand (zlib is in
 * Node's standard library) so the script has zero dependencies.
 *
 *   npm run assets:icon
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

// ------------------------------------------------------------------ png codec

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

/** rgba: Uint8Array of width*height*4. */
function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter type 0 (none)
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ----------------------------------------------------------------- artwork

const BG_INNER = [26, 35, 56];
const BG_OUTER = [7, 9, 15];
const RING = [120, 224, 255];
const SQUARE = [234, 246, 255];

const mix = (a, b, t) => a + (b - a) * t;
const smooth = (edge0, edge1, x) => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

/**
 * @param size    output resolution
 * @param logo    logo scale relative to the canvas (0.55 keeps a maskable safe zone)
 * @param opaque  false renders the logo on transparency (adaptive-icon foreground)
 */
function draw(size, logo, opaque = true) {
  const px = new Uint8Array(size * size * 4);
  const c = size / 2;
  const ringR = size * logo * 0.5;
  const ringW = size * logo * 0.055;
  const sq = size * logo * 0.16;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const dx = x - c + 0.5;
      const dy = y - c + 0.5;
      const d = Math.hypot(dx, dy);

      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;

      if (opaque) {
        const t = Math.min(1, d / (size * 0.62));
        r = mix(BG_INNER[0], BG_OUTER[0], t);
        g = mix(BG_INNER[1], BG_OUTER[1], t);
        b = mix(BG_INNER[2], BG_OUTER[2], t);
        a = 255;
      }

      // Dashed firing circle: 16 dashes with soft antialiased edges.
      const angle = Math.atan2(dy, dx);
      const dash = (Math.sin(angle * 16) + 1) / 2 > 0.35 ? 1 : 0;
      const ringA = dash * (1 - smooth(ringW * 0.35, ringW * 0.75, Math.abs(d - ringR)));
      if (ringA > 0) {
        r = mix(r, RING[0], ringA);
        g = mix(g, RING[1], ringA);
        b = mix(b, RING[2], ringA);
        a = Math.max(a, ringA * 255);
      }

      // Soft inner glow so the mark reads at 48px.
      const glow = Math.max(0, 1 - d / (ringR * 0.95)) ** 3 * 0.5;
      if (glow > 0) {
        r = mix(r, RING[0], glow * 0.45);
        g = mix(g, RING[1], glow * 0.45);
        b = mix(b, RING[2], glow * 0.45);
        a = Math.max(a, glow * 255);
      }

      // The square itself.
      const inSquare = 1 - Math.max(smooth(sq - 1.5, sq + 1.5, Math.abs(dx)), smooth(sq - 1.5, sq + 1.5, Math.abs(dy)));
      if (inSquare > 0) {
        r = mix(r, SQUARE[0], inSquare);
        g = mix(g, SQUARE[1], inSquare);
        b = mix(b, SQUARE[2], inSquare);
        a = Math.max(a, inSquare * 255);
      }

      px[i] = Math.round(r);
      px[i + 1] = Math.round(g);
      px[i + 2] = Math.round(b);
      px[i + 3] = Math.round(a);
    }
  }
  return px;
}

function solid(size, [r, g, b]) {
  const px = new Uint8Array(size * size * 4);
  for (let i = 0; i < px.length; i += 4) {
    px[i] = r;
    px[i + 1] = g;
    px[i + 2] = b;
    px[i + 3] = 255;
  }
  return px;
}

function write(path, size, pixels) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, encodePng(size, size, pixels));
  console.log(`  ${path}  ${size}x${size}`);
}

console.log('Generating store + PWA assets…');

// Capacitor asset pipeline sources (npx @capacitor/assets generate).
write('resources/icon.png', 1024, draw(1024, 0.72));
write('resources/icon-foreground.png', 1024, draw(1024, 0.52, false));
write('resources/icon-background.png', 1024, solid(1024, BG_OUTER));
write('resources/splash.png', 2732, draw(2732, 0.26));
write('resources/splash-dark.png', 2732, draw(2732, 0.26));

// PWA / browser icons referenced by manifest.webmanifest.
write('public/icons/icon-192.png', 192, draw(192, 0.74));
write('public/icons/icon-512.png', 512, draw(512, 0.74));
write('public/icons/icon-512-maskable.png', 512, draw(512, 0.55));
write('public/favicon.png', 64, draw(64, 0.8));

console.log('Done. Next: npx @capacitor/assets generate --iconBackgroundColor "#07090f" --splashBackgroundColor "#07090f"');

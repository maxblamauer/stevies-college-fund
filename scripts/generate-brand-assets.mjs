/**
 * From src/assets/stevie-mood-happy.png (source of truth for the happy mark):
 * - public/favicon.png — 64px tab icon
 * - stevie-logo-mark-sm.png — header / account menu (~36px CSS → enough for 2–3x DPR)
 *
 * Large in-app marks use stevie-mood-happy.png / stevie-mood-skeptical.png directly (no resize here).
 */
import sharp from 'sharp';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const src = path.join(root, 'src/assets/stevie-mood-happy.png');

function circleMask(size) {
  return Buffer.from(
    `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
      <circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="#ffffff"/>
    </svg>`,
  );
}

async function writeCircularPng(size, outRel) {
  const out = path.join(root, outRel);
  await sharp(src)
    .resize(size, size, { fit: 'cover', position: 'centre' })
    .ensureAlpha()
    .composite([{ input: circleMask(size), blend: 'dest-in' }])
    .png()
    .toFile(out);
  console.log('Wrote', outRel);
}

await writeCircularPng(64, 'public/favicon.png');
await writeCircularPng(192, 'src/assets/stevie-logo-mark-sm.png');

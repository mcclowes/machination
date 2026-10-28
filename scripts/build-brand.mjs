/** Export original vector artwork and verify native image constraints. */
import sharp from 'sharp';
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
const directory = new URL('../assets/brand/', import.meta.url);
const source = await readFile(new URL('mark.svg', directory), 'utf8');
const drawing = source.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
const background = '#080f0d';
function svg(scale, opaque = false, monochrome = '') {
  const mark = monochrome ? drawing.replace(/#(?:6b8a62|b8e986|e9a775)/g, monochrome) : drawing;
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">${opaque ? `<rect width="1024" height="1024" fill="${background}"/>` : ''}<g transform="translate(512 512) scale(${scale}) translate(-512 -512)">${mark}</g></svg>`);
}
await mkdir(directory, { recursive: true });
const assets = [
  ['icon.png', svg(1.1, true), true],
  ['adaptive-foreground.png', svg(0.9), false],
  ['adaptive-monochrome.png', svg(0.9, false, '#ffffff'), false],
  ['splash.png', svg(1.1), false],
];
for (const [name, vector, opaque] of assets) {
  const image = sharp(vector);
  await (opaque ? image.flatten({ background }).removeAlpha() : image).png().toFile(new URL(name, directory).pathname);
  const { data, info } = await sharp(new URL(name, directory).pathname).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.equal(info.width, 1024); assert.equal(info.height, 1024);
  for (let offset = 0; offset < data.length; offset += 4) {
    const alpha = data[offset + 3];
    if (opaque) assert.equal(alpha, 255, `${name} must be opaque`);
    if (name.startsWith('adaptive-') && alpha) {
      const pixel = offset / 4, x = pixel % info.width, y = Math.floor(pixel / info.width);
      assert.ok(Math.hypot(x + 0.5 - 512, y + 0.5 - 512) <= 1024 * 33 / 108, `${name} exceeds Android's safe zone`);
      if (name.includes('monochrome')) assert.deepEqual([...data.subarray(offset, offset + 3)], [255, 255, 255]);
    }
  }
  console.log(`Exported ${name}: 1024×1024${opaque ? ', opaque' : ', transparent'}.`);
}
// Review masks and small sizes without baking launcher masks into the actual assets.
const mask = shape => Buffer.from(`<svg width="192" height="192" xmlns="http://www.w3.org/2000/svg">${shape}</svg>`);
const base = await sharp(new URL('icon.png', directory).pathname).resize(192).toBuffer();
const adaptive = await sharp(new URL('adaptive-foreground.png', directory).pathname).resize(288).extract({ left: 48, top: 48, width: 192, height: 192 }).flatten({ background }).png().toBuffer();
const monochrome = await sharp(svg(0.9, false, '#182312')).resize(288).extract({ left: 48, top: 48, width: 192, height: 192 }).flatten({ background: '#c3cfaf' }).png().toBuffer();
const shapes = [
  '<rect width="192" height="192" rx="43" fill="white"/>',
  '<circle cx="96" cy="96" r="96" fill="white"/>',
  '<rect width="192" height="192" rx="48" fill="white"/>',
  '<circle cx="96" cy="96" r="96" fill="white"/>',
];
const composites = [];
for (const [index, buffer] of [base, adaptive, adaptive, monochrome].entries()) {
  const rounded = await sharp(buffer).composite([{ input: mask(shapes[index]), blend: 'dest-in' }]).png().toBuffer();
  composites.push({ input: rounded, left: 32 + index * 232, top: 70 });
  for (const [i, size] of [60, 40, 24].entries()) composites.push({ input: await sharp(rounded).resize(size).png().toBuffer(), left: 32 + index * 232 + i * 76, top: 300 });
}
const labels = Buffer.from('<svg width="960" height="400" xmlns="http://www.w3.org/2000/svg"><g fill="#d6e2cd" font-family="sans-serif" font-size="16"><text x="32" y="38">iOS / legacy</text><text x="264" y="38">Android / circle</text><text x="496" y="38">Android / rounded</text><text x="728" y="38">Android / themed</text><text x="32" y="390">Small previews: 60, 40, and 24 px. Launcher masks are applied only in this preview.</text></g></svg>');
await mkdir(new URL('../.data/', import.meta.url), { recursive: true });
await sharp({ create: { width: 960, height: 420, channels: 4, background: '#142018' } }).composite([...composites, { input: labels, left: 0, top: 0 }]).png().toFile(new URL('../.data/brand-preview.png', import.meta.url).pathname);
console.log('Mask and small-size preview: .data/brand-preview.png');

/** Center the visible emblems without changing their scale or silhouettes. */
import sharp from 'sharp';

const source = new URL('../assets/bases/transparent-sheet.png', import.meta.url).pathname;
const cellSize = 724;
const crop = { width: 600, height: 560 };
const visibleAlpha = 128;

for (const [index, name] of ['factory', 'generator', 'mine'].entries()) {
  const { data } = await sharp(source)
    .extract({ left: index * cellSize, top: 0, width: cellSize, height: cellSize })
    .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let left = cellSize, right = -1, top = cellSize, bottom = -1;
  for (let y = 0; y < cellSize; y++) for (let x = 0; x < cellSize; x++) {
    if (data[(y * cellSize + x) * 4 + 3] < visibleAlpha) continue;
    left = Math.min(left, x); right = Math.max(right, x);
    top = Math.min(top, y); bottom = Math.max(bottom, y);
  }
  if (right <= left || bottom <= top || right - left >= crop.width || bottom - top >= crop.height) {
    throw new Error(`${name}: artwork must fit inside the crop`);
  }
  const x = Math.round((left + right - crop.width + 1) / 2);
  const y = Math.round((top + bottom - crop.height + 1) / 2);
  if (x < 0 || y < 0 || x + crop.width > cellSize || y + crop.height > cellSize) {
    throw new Error(`${name}: centered crop must fit inside its sheet cell`);
  }
  await sharp(source).extract({ left: index * cellSize + x, top: y, ...crop })
    .resize(248, 248, { fit: 'contain', background: '#00000000' })
    .extend({ top: 4, bottom: 4, left: 4, right: 4, background: '#00000000' })
    .png().toFile(new URL(`../assets/bases/${name}.png`, import.meta.url).pathname);
}

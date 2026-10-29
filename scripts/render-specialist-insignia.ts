/** Regenerate the vector contact sheet and its ignored review PNG from the role geometry. */
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath, URL } from 'node:url';
import sharp from 'sharp';
import { SPECIALISTS, type SpecialistKind } from '../src/game/specialist-catalog';
import { playerAppearance } from '../src/game/players';
import { captiveLockSvg, insigniaSvg, INSIGNIA_BACKGROUND, INSIGNIA_CAPTIVE_OPACITY, INSIGNIA_COLOR } from '../src/components/specialist-insignia';

const escape = (text: string) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
const placed = (kind: SpecialistKind, size: number, x: number, y: number) => insigniaSvg(kind, size).replace('<svg ', `<svg x="${x}" y="${y}" `);
function badge(kind: SpecialistKind, x: number, y: number, captive = false) {
  const ownerColor = playerAppearance(captive ? 'vesper' : 'you').color;
  const lock = captive ? captiveLockSvg().replace('<svg ', '<svg x="16" y="0" ') : '';
  return `<g transform="translate(${x} ${y})"><circle cx="12" cy="12" r="11.5" fill="${INSIGNIA_BACKGROUND}" stroke="${ownerColor}"${captive ? ' stroke-dasharray="2 2"' : ''}/><g opacity="${captive ? INSIGNIA_CAPTIVE_OPACITY : 1}">${placed(kind, 20, 2, 2)}</g>${lock}<rect x="16" y="15" width="9" height="11" rx="2" fill="${INSIGNIA_BACKGROUND}"/><text x="24" y="24" text-anchor="end" font-size="9">2</text></g>`;
}
const cells = (Object.keys(SPECIALISTS) as SpecialistKind[]).map((kind, i) => {
  const x = 12 + i % 6 * 196, y = 88 + Math.floor(i / 6) * 164;
  const entry = SPECIALISTS[kind];
  return `<g transform="translate(${x} ${y})"><rect width="184" height="152" rx="5" fill="#14232b" stroke="#30434b"/><text x="10" y="22" font-size="13">${escape(entry.reference)}</text><text x="10" y="40" font-size="10" fill="#a6b1a0">${escape(entry.name)}</text>${placed(kind, 36, 12, 61)}${placed(kind, 20, 70, 69)}${badge(kind, 111, 67)}${badge(kind, 150, 67, true)}<g font-size="10" fill="#a6b1a0"><text x="19" y="120">36px</text><text x="69" y="120">20px</text><text x="105" y="120">Count</text><text x="142" y="120">Captive</text></g></g>`;
}).join('');
const sheet = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="940" viewBox="0 0 1200 940"><rect width="1200" height="940" fill="${INSIGNIA_BACKGROUND}"/><g fill="${INSIGNIA_COLOR}" font-family="sans-serif"><text x="22" y="32" font-size="22">Specialist insignia</text><text x="22" y="57" font-size="12" fill="#a6b1a0">29 original role silhouettes · actual display sizes and grouped/captive examples</text>${cells}<text x="22" y="930" font-size="11" fill="#a6b1a0">Static geometry review. Native interaction and small-screen reading require separate acceptance.</text></g></svg>`;
async function main() {
  const vector = new URL('../assets/specialists/insignia-contact-sheet.svg', import.meta.url);
  const preview = new URL('../.fettle/shots/specialist-insignia-contact-sheet.png', import.meta.url);
  await mkdir(new URL('.', vector), { recursive: true });
  await mkdir(new URL('.', preview), { recursive: true });
  await writeFile(vector, `${sheet}\n`);
  await sharp(Buffer.from(sheet)).png().toFile(fileURLToPath(preview));
  console.log(`Contact sheet: ${fileURLToPath(vector)}`);
  console.log(`Review PNG: ${fileURLToPath(preview)}`);
}
void main();

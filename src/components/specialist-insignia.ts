/** Original role silhouettes shared by native icons and the review contact sheet. */
import type { SpecialistKind } from '../game/specialist-catalog';

export type Insignia = {
  outline: readonly string[];
  solid?: readonly string[];
  circles?: readonly { x: number; y: number; radius: number; solid?: true }[];
};
export const INSIGNIA_COLOR = '#e5eadc';
export const INSIGNIA_BACKGROUND = '#101d24';
export const INSIGNIA_CAPTIVE_OPACITY = 0.45;
export const INSIGNIA_STROKE = 1.8;
export const INSIGNIA_VIEWBOX = 24;

export const SPECIALIST_INSIGNIA = {
  queen: {
    outline: ['M8 6H16V18H8Z', 'M3 8H8M3 12H8M3 16H8M16 8H21M16 12H21M16 16H21M10 3V6M14 3V6M10 18V21M14 18V21'],
    solid: ['M12 9L15 12L12 15L9 12Z'],
  },
  diplomat: { outline: ['M3 5H11V12H7L4 15V12H3Z', 'M13 10H21V17H20V20L17 17H13Z'] },
  elder: {
    outline: ['M6 3H18C18 8 15 9 12 12C15 15 18 16 18 21H6C6 16 9 15 12 12C9 9 6 8 6 3Z'],
    solid: ['M9 6H15L12 10Z', 'M12 15L15 18H9Z'],
  },
  foreman: { outline: ['M3 21H12M5 17L12 10H18M18 6V14M18 6L22 4M18 14L22 16'], circles: [{ x: 5, y: 17, radius: 2 }, { x: 12, y: 10, radius: 2 }] },
  engineer: { outline: ['M14 3L13 7L17 11L21 10C21 14 17 16 14 14L7 21C5 23 2 20 4 18L11 11C9 8 11 4 14 3Z'] },
  pirate: { outline: ['M12 6V14C12 23 3 23 3 15L7 17'], circles: [{ x: 12, y: 4, radius: 2 }] },
  lieutenant: { outline: [], solid: ['M4 7L12 13L20 7V12L12 18L4 12Z'], circles: [{ x: 12, y: 3.5, radius: 1.8, solid: true }] },
  general: { outline: ['M5 4L12 9L19 4M5 9L12 14L19 9M5 14L12 19L19 14'] },
  princess: { outline: ['M12 5L19 12L12 19L5 12Z', 'M12 2V5M19 12H22M12 19V22M2 12H5'] },
  infiltrator: {
    outline: ['M9 3L3 6V12Q3 18 9 21M15 3L21 6V12Q21 18 15 21'],
    solid: ['M13 3L8 12H12L10 21L17 10H13L15 3Z'],
  },
  warHero: {
    outline: ['M6 15H18Q22 15 22 18Q22 21 18 21H6Q2 21 2 18Q2 15 6 15Z', 'M7 15V9H15V15M15 10H22'],
    circles: [{ x: 6, y: 18, radius: 1, solid: true }, { x: 12, y: 18, radius: 1, solid: true }, { x: 18, y: 18, radius: 1, solid: true }],
  },
  sentry: { outline: ['M8 16V20M3 21H14'], solid: ['M8 9L18 3L21 7L11 14Z'], circles: [{ x: 8, y: 13, radius: 3 }] },
  intelligence: { outline: ['M4 4A16 16 0 0 1 20 20M4 10A10 10 0 0 1 14 20M4 16A4 4 0 0 1 8 20'], circles: [{ x: 4, y: 20, radius: 1.5, solid: true }] },
  tinkerer: { outline: ['M3 12H9M15 12H21M9 5V19M15 5V19'] },
  energy: {
    outline: [], solid: ['M10 9L6 3Q12 0 18 3L14 9Z', 'M15 11H22Q23 17 18 21L14 14Z', 'M10 14L6 21Q1 17 2 11H9Z'],
    circles: [{ x: 12, y: 12, radius: 1.6, solid: true }],
  },
  saboteur: { outline: ['M12 21V12L5 5M12 12L19 5M3 9V3H9M15 3H21V9'] },
  assassin: { outline: ['M20 3L16 12L12 14L10 12L12 8Z', 'M7 10L14 17M4 20L9 15M3 21L5 19'] },
  inspector: { outline: ['M12 3L20 6V12Q20 18 12 22Q4 18 4 12V6Z', 'M8 12L11 15L16 9'] },
  security: { outline: ['M3 21V6H6V3H10V6H14V3H18V6H21V21Z', 'M10 21V14H14V21'], solid: ['M6 9H8V11H6ZM16 9H18V11H16Z'] },
  doubleAgent: { outline: ['M3 8H20M16 4L20 8L16 12M20 16H3M7 12L3 16L7 20'] },
  thief: { outline: ['M5 4H9V14Q12 19 15 14V4H19V14Q12 27 5 14Z', 'M5 8H9M15 8H19'] },
  smuggler: { outline: ['M6 7H21V19H6Z', 'M6 8L13 14L21 8M2 7H4M1 12H4M2 17H4'] },
  tycoon: { outline: ['M3 21V10L9 6V11L15 7V12L21 8V21Z', 'M3 10V3H7V7'], solid: ['M6 16H8V18H6ZM12 16H14V18H12ZM18 16H20V18H18Z'] },
  navigator: { outline: [], solid: ['M15 5L14 14L5 18L10 10Z'], circles: [{ x: 12, y: 12, radius: 9 }] },
  admiral: { outline: [], solid: ['M12 2L16 10L12 8L8 10Z', 'M5 13L9 21L5 19L1 21Z', 'M19 13L23 21L19 19L15 21Z'] },
  martyr: { outline: ['M13 9L15 6H18L20 4M18 3V1M21 6H23'], circles: [{ x: 10, y: 14, radius: 6 }] },
  helmsman: { outline: ['M12 2V22M2 12H22M5 5L19 19M5 19L19 5'], circles: [{ x: 12, y: 12, radius: 6 }, { x: 12, y: 12, radius: 2, solid: true }] },
  hypnotist: { outline: ['M2 12Q12 0 22 12Q12 24 2 12Z'], circles: [{ x: 12, y: 12, radius: 4 }, { x: 12, y: 12, radius: 1, solid: true }] },
  king: { outline: ['M3 7L7 11L12 3L17 11L21 7L18 19H6Z', 'M6 22H18'] },
} as const satisfies Record<SpecialistKind, Insignia>;

export const CAPTIVE_LOCK: Insignia = { outline: ['M2 4V2.5C2 0.5 6 0.5 6 2.5V4'], solid: ['M1 4H7V9H1Z'] };
export const CAPTIVE_LOCK_WIDTH = 8, CAPTIVE_LOCK_HEIGHT = 10, CAPTIVE_LOCK_STROKE = 1;

function drawingSvg(icon: Insignia, width: number, height: number, viewBox: string, stroke: number, color: string, background?: string): string {
  const outline = icon.outline.map(d => `<path d="${d}"/>`).join('');
  const solid = (icon.solid ?? []).map(d => `<path d="${d}" fill="${color}" stroke="none"/>`).join('');
  const circles = (icon.circles ?? []).map(c => `<circle cx="${c.x}" cy="${c.y}" r="${c.radius}"${c.solid ? ` fill="${color}" stroke="none"` : ''}/>`).join('');
  const backing = background ? `<path d="M0 0H${width}V${height}H0Z" fill="${background}" stroke="none"/>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${viewBox}" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round">${backing}${outline}${solid}${circles}</svg>`;
}
export function insigniaSvg(kind: SpecialistKind, size: number, color = INSIGNIA_COLOR): string {
  return drawingSvg(SPECIALIST_INSIGNIA[kind], size, size, `0 0 ${INSIGNIA_VIEWBOX} ${INSIGNIA_VIEWBOX}`, INSIGNIA_STROKE, color);
}
export function captiveLockSvg(): string {
  return drawingSvg(CAPTIVE_LOCK, CAPTIVE_LOCK_WIDTH, CAPTIVE_LOCK_HEIGHT, `0 0 ${CAPTIVE_LOCK_WIDTH} ${CAPTIVE_LOCK_HEIGHT}`, CAPTIVE_LOCK_STROKE, INSIGNIA_COLOR, INSIGNIA_BACKGROUND);
}

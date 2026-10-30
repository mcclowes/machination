/**
 * ---
 * purpose: Geometry for the animated title artwork, with effect anchors in artwork-relative percentages.
 * ---
 */
export const ART_ASPECT = 1536 / 1024;

export type Frame = { left: number; top: number; width: number; height: number };
export type Anchor = { x: number; y: number };

/** Sizes the artwork to cover a viewport, cropping around a focus point so the logo survives tall or wide crops. */
export function coverFrame(width: number, height: number, focus: Anchor = { x: 0.5, y: 0.35 }): Frame {
  const scaled = width / height > ART_ASPECT
    ? { width, height: width / ART_ASPECT }
    : { width: height * ART_ASPECT, height };
  return { ...scaled, left: (width - scaled.width) * focus.x, top: (height - scaled.height) * focus.y };
}

export function heroHeight(width: number): number {
  return Math.round(Math.min(width * 0.85, 520));
}

// Percent positions measured against assets/brand/asteroid-frontier.png.
export const ENGINES = [
  { x: 50.4, y: 68.7, size: 4.2, period: 1300 },
  { x: 64.7, y: 78.8, size: 2.8, period: 1100 },
  { x: 51.9, y: 54.7, size: 1.8, period: 1700 },
] as const;

export const LOGO_CORE: Anchor = { x: 49.7, y: 15.4 };
export const LOGO_SATELLITES: readonly Anchor[] = [{ x: 46, y: 9.5 }, { x: 45.4, y: 24.8 }];

export const CITY_LIGHTS: readonly Anchor[] = [
  { x: 83.4, y: 55.8 }, { x: 86.2, y: 58.6 }, { x: 88.6, y: 56.9 }, { x: 80.6, y: 60.4 },
  { x: 91.2, y: 61.8 }, { x: 84.1, y: 63.2 }, { x: 78.9, y: 57.6 }, { x: 89.4, y: 52.2 },
];

// Foreground debris: phase spreads specks across the loop, speed is laps per cycle.
export const DUST = Array.from({ length: 14 }, (_, i) => ({
  phase: (i * 0.618) % 1,
  y: 30 + ((i * 37.3) % 65),
  size: i % 4 === 0 ? 3 : i % 2 ? 1.5 : 2,
  speed: 1 + (i % 3),
  opacity: 0.25 + (i % 4) * 0.12,
}));

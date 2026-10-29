/** Ten charged shields per concentric arc, with a right-hand gap for drone counts. */
type ShieldSite = { owner?: string | null; known?: boolean; destroyed?: boolean; shieldsDisabled?: boolean; shield?: number };
const SHIELDS_PER_ARC = 10;
const ARC_DEGREES = 260;

export function mapShields(site: ShieldSite): { radius: number; charge: number; path: string }[] {
  if (!site.owner || site.known === false || site.destroyed || site.shieldsDisabled) return [];
  const charge = Math.max(0, Math.floor(site.shield ?? 0));
  return Array.from({ length: Math.ceil(charge / SHIELDS_PER_ARC) }, (_, index) => {
    const radius = 22 + index * 4;
    const layerCharge = Math.min(SHIELDS_PER_ARC, charge - index * SHIELDS_PER_ARC);
    const sweep = ARC_DEGREES * layerCharge / SHIELDS_PER_ARC;
    const point = (angle: number) => `${radius * Math.cos(angle * Math.PI / 180)} ${radius * Math.sin(angle * Math.PI / 180)}`;
    return { radius, charge: layerCharge, path: `M ${point(50)} A ${radius} ${radius} 0 ${sweep > 180 ? 1 : 0} 1 ${point(50 + sweep)}` };
  });
}

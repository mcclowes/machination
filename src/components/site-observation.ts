import { siteKindLabel } from '../content/terminology';
/** Public site ownership stays distinct from sensor-only detail. */
import { FACTIONS, type Faction, type Rock } from '../game/simulation';

export function remoteSiteDescription(site: { owner?: Faction | null; kind: Rock['kind'] | 'unknown' }): string {
  const owner = site.owner === undefined ? 'Ownership unknown' : site.owner === null ? 'Unclaimed' : FACTIONS[site.owner].name;
  const type = site.kind === 'unknown' ? '' : ` · ${siteKindLabel(site.kind).toLowerCase()}`;
  const hidden = site.kind === 'unknown' ? 'type, drones, shields, and specialists' : 'drones, shields, and specialists';
  return `${owner}${type}. Outside sensor range; ${hidden} unknown.`;
}

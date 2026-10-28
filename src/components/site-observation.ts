/** Public site ownership stays distinct from sonar-only detail. */
import { FACTIONS, type Faction, type Rock } from '../game/simulation';

export function remoteSiteDescription(site: { owner?: Faction | null; kind: Rock['kind'] | 'unknown' }): string {
  const owner = site.owner === undefined ? 'Ownership unknown' : site.owner === null ? 'Unclaimed' : FACTIONS[site.owner].name;
  const type = site.kind === 'unknown' ? '' : ` · ${site.kind}`;
  const hidden = site.kind === 'unknown' ? 'type, drones, shields, and modules' : 'drones, shields, and modules';
  return `${owner}${type}. Outside sensor range; ${hidden} unknown.`;
}

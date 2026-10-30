/** Player-facing names for stable save and protocol values. */
import { displaySpecialistNames } from '../game/specialist-catalog';
import type { GameOptions } from '../game/rules';
import type { Rock } from '../game/simulation';

const SITE_LABELS = {
  core: 'Core site', reactor: 'Legacy reactor', factory: 'Factory',
  generator: 'Reactor', mine: 'Mine', unknown: 'Unknown site',
} as const;

export function siteKindLabel(kind: Rock['kind'] | 'unknown'): string {
  return SITE_LABELS[kind];
}

export function resourceName(mode: GameOptions['mode'] | undefined): string {
  return mode === 'pulse' ? 'pulse material' : 'cargo';
}

export function displayGameText(message: string, context: { version?: 1 | 2; rules?: { mode: GameOptions['mode'] } }): string {
  // Named locations and intelligences precede the telemetry separator.
  const start = message.indexOf(': ') + 2;
  const prefix = start > 1 ? message.slice(0, start) : '';
  const terms: Record<string, string> = {
    rock: 'site', rocks: 'sites', outpost: 'site', outposts: 'sites',
    generator: 'reactor', generators: 'reactors', sonar: 'sensor coverage',
  };
  if (context.version !== 1) Object.assign(terms, { module: 'specialist', modules: 'specialists' });
  if (context.rules?.mode === 'pulse') terms.cargo = 'pulse material';
  const body = message.slice(prefix.length).replace(/\b(rocks?|outposts?|generators?|modules?|sonar|cargo)\b/gi, word => {
    const replacement = terms[word.toLowerCase()];
    if (!replacement) return word;
    return word[0] === word[0]!.toUpperCase() ? replacement[0]!.toUpperCase() + replacement.slice(1) : replacement;
  });
  return displaySpecialistNames(prefix + body).replace(/\bPulse Material\b/g, 'Pulse material');
}

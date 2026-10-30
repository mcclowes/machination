/** Keep isolated pre-cargo rule scenarios on their original map and economy. */
import { createConfiguredGame } from './world';
import type { GameOptions } from './rules';
import type { Faction } from './players';

export function createPreCargoGame(options: GameOptions, epoch: number, seed: number, recruitmentSeeds?: Partial<Record<Faction, number>>) {
  return createConfiguredGame(options, epoch, seed, recruitmentSeeds, options.mode === 'pulse' ? 16 : 14);
}

/** Finite local-solo reserves; ordinary configured worlds retain their original economy. */
import { createConfiguredGame } from './world';
import type { GameOptions } from './rules';
import type { Game, Rock } from './simulation';
import { observers } from './sensors';
import { recentEvents } from './events';

export const PLANET_RESERVES = 120;
export const LOW_RESERVES = 24;
export const SUPPLY_CYCLE = 8;
export const SUPPLY_RESERVES = 6;

export function createSoloGame(options: GameOptions, epoch: number, seed: number): Game {
  const game = createConfiguredGame(options, epoch, seed);
  game.rocks = game.rocks.map(r => ({ ...r, reserves: PLANET_RESERVES, ...(r.kind === 'generator' ? { supplyAt: SUPPLY_CYCLE } : {}) }));
  game.events = recentEvents([{ hour: 0, audience: game.rules!.players, message: 'Finite reserves: production and extraction consume resources. Generators spend six reserves every eight hours. Exhausted sites stop industry and power supply; expand toward fresh reserves.' }, ...game.events]);
  return game;
}

export function hasReserves(rock: Pick<Rock, 'reserves'>): boolean { return rock.reserves === undefined || rock.reserves > 0; }

/** Spend only completed output. Undefined reserves preserve older and multiplayer rules. */
export function spendReserves(game: Game, rock: Rock, amount: number): number {
  if (rock.reserves === undefined) return amount;
  const before = rock.reserves;
  const spent = Math.min(before, amount);
  rock.reserves -= spent;
  if ((before > 0 && rock.reserves === 0) || (before > LOW_RESERVES && rock.reserves <= LOW_RESERVES)) {
    game.events = recentEvents([{ hour: game.hour, audience: observers(game, rock), message: `${rock.name}: ${rock.reserves === 0 ? 'reserves exhausted. Industry and generator capacity have stopped; troops and routes remain available.' : `low reserves (${rock.reserves} remaining). Plan your next foothold.`}` }, ...game.events]);
  }
  return spent;
}

export function reserveDescription(rock: Pick<Rock, 'reserves' | 'kind'>): string | undefined {
  if (rock.reserves === undefined) return undefined;
  if (!rock.reserves) return 'Reserves exhausted · no production, extraction, or generator capacity';
  const usage = rock.kind === 'factory' ? '1 per drone produced' : rock.kind === 'mine' ? '1 per cargo extracted' : '6 per 8h of generator supply';
  return `${rock.reserves} / ${PLANET_RESERVES} reserves${rock.reserves <= LOW_RESERVES ? ' · low' : ''} · ${usage}`;
}

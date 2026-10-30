/**
 * ---
 * purpose: Version-two starting chart with equal territories, separate industry/power sites, and dormant expansion.
 * ---
 */
import { DEFAULT_TACTICAL_PULSE_CONFIG } from './tactical-pulse';
import { createPulseSystem, DEFAULT_PULSE_CONFIG } from './pulse';
import { afterWork } from './opening-clock';
import { seedDriftingBases } from './drift';
import { ALL_PLAYERS } from './players';
import { validateOptions, type GameOptions } from './rules';
import { generateWorld } from './generated-world';
import { newRecruitment } from './specialists';
import type { Faction, Game, Rock } from './simulation';

export function createGame(epoch = Date.now(), seeds?: Partial<Record<Faction, number>>): Game {
  const site = (id: string, name: string, x: number, y: number, kind: 'factory' | 'generator', owner: Faction | null = null, core = false): Rock => ({
    id, name, x, y, kind, owner, drones: owner && !core ? 40 : 0,
    shield: 0, shieldMax: kind === 'factory' ? 10 : 20, shieldAt: 48 / ((kind === 'factory' ? 10 : 20) + (core ? 20 : 0)), shieldsDisabled: false,
    productionAt: 8, specialists: core && owner ? [{ id: `core-${owner}`, owner, kind: 'queen' }] : [], ...(core && owner ? { coreOf: owner } : {}),
  });
  return {
    recruitment: { you: newRecruitment(seeds?.you ?? epoch), vesper: newRecruitment(seeds?.vesper ?? epoch + 1), null: newRecruitment(seeds?.null ?? epoch + 2) },
    version: 2, specialistVersion: 1, hour: 0, epoch, fleets: [], scheduled: [], cargo: { you: 0, vesper: 0, null: 0 }, minesDrilled: { you: 0, vesper: 0, null: 0 },
    eliminated: [], nextId: 1, winner: null,
    events: [{ hour: 0, audience: ['you', 'vesper', 'null'], message: 'Corporate uplink lost. Five sites assigned to each intelligence. Establish extraction to fulfill the contract.' }],
    rocks: [
      site('a', 'Mnemosyne', 17, 74, 'factory', 'you', true),
      site('b', 'Cinder', 39, 66, 'factory'),
      site('c', 'Suture', 10, 56, 'factory', 'you'),
      site('d', 'Pale relay', 58, 82, 'generator'),
      site('e', 'Vesper', 84, 52, 'factory', 'vesper', true),
      site('f', 'Hollow', 71, 42, 'factory', 'vesper'),
      site('g', 'Null prime', 38, 14, 'factory', 'null', true),
      site('h', 'Lacuna', 20, 23, 'factory', 'null'),
      site('i', 'Quietus', 42, 42, 'factory'),
      site('j', 'Faraday', 63, 24, 'generator'),
      site('k', 'Morrow', 68, 64, 'factory'),
      site('l', 'Ash', 38, 86, 'generator'),
      site('m', 'Thread', 25, 59, 'factory', 'you'),
      site('n', 'Flux', 11, 88, 'generator', 'you'),
      site('o', 'Helix', 29, 78, 'generator', 'you'),
      site('p', 'Ember', 85, 32, 'factory', 'vesper'),
      site('q', 'Vane', 89, 73, 'generator', 'vesper'),
      site('r', 'Bastion', 72, 85, 'generator', 'vesper'),
      site('s', 'Cipher', 50, 17, 'factory', 'null'),
      site('t', 'Obelisk', 13, 12, 'generator', 'null'),
      site('u', 'Stillpoint', 29, 34, 'generator', 'null'),
      site('v', 'Aperture', 54, 59, 'factory'),
      site('w', 'Lumen', 55, 36, 'generator'),
      site('x', 'Isotope', 48, 73, 'factory'),
    ],
  };
}

export function createConfiguredGame(options: GameOptions, epoch: number, mapSeed: number, seeds?: Partial<Record<Faction, number>>): Game {
  const settings = validateOptions(options);
  const players = ALL_PLAYERS.slice(0, settings.playerCount);
  const { rocks, width, height } = generateWorld(players, mapSeed);
  if (settings.driftingBases) seedDriftingBases(rocks, { rules: { map: { width, height, topology: 'torus' } } });
  const game: Game = { ...createGame(epoch, seeds), rocks,
    rules: { mechanicsVersion: settings.mode === 'pulse' ? 16 : 14, ...(settings.mode === 'pulse' ? { pulse: { ...DEFAULT_PULSE_CONFIG }, tacticalPulse: { ...DEFAULT_TACTICAL_PULSE_CONFIG } } : {}), driftingBases: !!settings.driftingBases, players, ...(settings.portraits ? { portraits: [...settings.portraits] } : {}), mode: settings.mode, victoryTarget: settings.mode === 'pulse' ? 1 : settings.mode === 'mining' ? 200 : rocks.length / 2, map: { generator: 'balanced.v2', topology: 'torus', seed: mapSeed, width, height } },
    cargo: Object.fromEntries(players.map(owner => [owner, 0])),
    minesDrilled: Object.fromEntries(players.map(owner => [owner, 0])),
    recruitment: Object.fromEntries(players.map((owner, index) => [owner, newRecruitment(seeds?.[owner] ?? (mapSeed + index + 1) >>> 0, settings.mode === 'pulse')])),
    events: [{ hour: 0, audience: players, message: `Corporate uplink lost. Five sites assigned to each intelligence. ${settings.mode === 'pulse' ? 'Mine Pulse Material, charge your King, and eliminate every rival King.' : settings.mode === 'mining' ? 'Establish extraction to fulfill the contract.' : 'Control half of the chart to secure domination.'}` }],
  };
  for (const rock of game.rocks) {
    if (rock.productionAt !== undefined) rock.productionAt = afterWork(game, 0, rock.productionAt);
    if (rock.shieldAt !== undefined) rock.shieldAt = afterWork(game, 0, rock.shieldAt);
  }
  if (settings.mode === 'pulse') game.pulse = createPulseSystem(game);
  return game;
}

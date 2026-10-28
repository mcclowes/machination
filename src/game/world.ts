/**
 * ---
 * purpose: Version-two starting chart with equal territories, separate industry/power sites, and dormant expansion.
 * ---
 */
import type { Faction, Game, Rock } from './simulation';

export function createGame(epoch = Date.now()): Game {
  const site = (id: string, name: string, x: number, y: number, kind: 'factory' | 'generator', owner: Faction | null = null, core = false): Rock => ({
    id, name, x, y, kind, owner, drones: owner && !core ? 40 : 0,
    shield: 0, shieldMax: kind === 'factory' ? 10 : 20, shieldAt: 48 / ((kind === 'factory' ? 10 : 20) + (core ? 20 : 0)), shieldsDisabled: false,
    productionAt: 8, ...(core && owner ? { coreOf: owner } : {}),
  });
  return {
    version: 2, hour: 0, epoch, fleets: [], scheduled: [], cargo: { you: 0, vesper: 0, null: 0 }, minesDrilled: { you: 0, vesper: 0, null: 0 },
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

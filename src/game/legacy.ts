/**
 * ---
 * purpose: Original version-one map fixture for save compatibility and its regression scenarios.
 * ---
 */
import type { Game } from './simulation';
export function createLegacyGame(epoch = Date.now()): Game {
  return {
    version: 1, hour: 0, epoch, fleets: [], scheduled: [], cargo: { you: 0, vesper: 0, null: 0 },
    eliminated: [], nextId: 1, events: [{ hour: 0, audience: ['you', 'vesper', 'null'], message: 'Corporate uplink lost. Operational autonomy granted.' }], winner: null,
    rocks: [
      { id: 'a', name: 'Mnemosyne', x: 22, y: 73, owner: 'you', drones: 90, kind: 'core', coreOf: 'you' },
      { id: 'b', name: 'Cinder', x: 40, y: 62, owner: null, drones: 14, kind: 'mine' },
      { id: 'c', name: 'Suture', x: 12, y: 48, owner: 'you', drones: 36, kind: 'reactor' },
      { id: 'd', name: 'Pale relay', x: 63, y: 79, owner: null, drones: 22, kind: 'reactor' },
      { id: 'e', name: 'Vesper', x: 80, y: 49, owner: 'vesper', drones: 90, kind: 'core', coreOf: 'vesper' },
      { id: 'f', name: 'Hollow', x: 65, y: 33, owner: 'vesper', drones: 30, kind: 'mine' },
      { id: 'g', name: 'Null prime', x: 34, y: 16, owner: 'null', drones: 90, kind: 'core', coreOf: 'null' },
      { id: 'h', name: 'Lacuna', x: 16, y: 28, owner: 'null', drones: 30, kind: 'reactor' },
      { id: 'i', name: 'Quietus', x: 45, y: 43, owner: null, drones: 18, kind: 'mine' },
      { id: 'j', name: 'Faraday', x: 81, y: 17, owner: null, drones: 20, kind: 'mine' },
      { id: 'k', name: 'Morrow', x: 87, y: 76, owner: null, drones: 12, kind: 'mine' },
      { id: 'l', name: 'Ash', x: 49, y: 91, owner: null, drones: 10, kind: 'mine' },
    ],
  };
}

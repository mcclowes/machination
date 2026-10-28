/** Declarative observed history only; no private engine or command archive belongs in this format. */
import type { Faction } from '../game/players';
import type { ReplayScene } from './presentation';

export type ReplayGroup = { hour: number; states: ReplayScene[] };
export type ReplaySpan = { from: number; through: number; scene: ReplayScene };
export type SharedReplay = {
  kind: 'machination.observed-timeline';
  schemaVersion: 1 | 2;
  presentationVersion: 1;
  history: 'canonical-events';
  perspective: Faction;
  from: number;
  through: number;
  groups: ReplayGroup[];
  spans: ReplaySpan[];
};

export const SHARED_REPLAY_LIMITS = { bytes: 64 * 1024 * 1024, records: 250_000, sites: 1_000, fleets: 10_000, units: 20_000, text: 200, coordinate: 1e9, depth: 32 } as const;

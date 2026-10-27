import type { Faction, Game } from '../game/simulation';
export type Message = { id: number; from: Faction; to: Faction; text: string; sentAt: number };
export type Snapshot = {
  id: string; invite: string; status: 'game.lobby' | 'game.active' | 'game.finished';
  faction: Faction; host: boolean; members: Faction[]; revision: number;
  game: Game; messages: Message[]; serverTime: number;
};
export type Order = { requestId: string; revision: number; from: string; to: string; drones: number };
export type Transmission = { requestId: string; to: Faction; text: string };
export type Issue = { issue: string; severity: 'error'; correlationId: string; dateTime: string; message: { title: string; detail: string } };

import type { SpecialistKind } from '../game/specialist-catalog';
import type { HaulerChange } from '../game/transport';
import type { ModuleKind } from '../game/modules';
import type { GameView } from '../game/visibility';
import type { Faction } from '../game/simulation';
export type Message = { id: number; from: Faction; to: Faction; text: string; sentAt: number };
export type Snapshot = {
  id: string; invite: string; status: 'game.lobby' | 'game.active' | 'game.finished';
  faction: Faction; host: boolean; members: Faction[]; revision: number;
  recoveryEnabled?: boolean;
  visibility: 'sensors.v1'; game: GameView; messages: Message[]; serverTime: number;
};
export type Order = { requestId: string; revision: number; from: string; to: string; drones: number; specialists?: string[]; carryModule?: boolean };
export type GiftOrder = Order & { recipient: Faction };
export type InterceptOrder = { requestId: string; revision: number; from: string; target: number; drones: number; specialists?: string[] };
export type ScheduleOrder = Order & { executeAt: number };
export type CancelSchedule = { requestId: string; revision: number; planId: string };
export type SpecialistOrder = { requestId: string; revision: number } & ({ action: 'hire'; kind: SpecialistKind } | { action: 'promote' | 'release'; unit: string });
export type ModuleOrder = { requestId: string; revision: number; rock: string; module: ModuleKind };
export type HaulerOrder = HaulerChange & { requestId: string; revision: number };
export type SiteOrder = { requestId: string; revision: number; rock: string } & ({ action: 'mine' } | { action: 'shields'; disabled: boolean });
export type Transmission = { requestId: string; to: Faction; text: string };
export type Issue = { issue: string; severity: 'error'; correlationId: string; dateTime: string; message: { title: string; detail: string } };

export type RecoverySetup = { requestId: string; secret: string };
export type RecoverSeat = { secret: string };

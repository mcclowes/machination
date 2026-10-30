import type { PulseAction } from '../game/pulse';
import type { LaunchEdit } from '../game/orders';
import type { FutureAction } from '../game/future-actions';
import type { SpecialistKind } from '../game/specialist-catalog';
import type { HaulerChange } from '../game/transport';
import type { ModuleKind } from '../game/modules';
import type { GameView } from '../game/visibility';
import type { Faction } from '../game/simulation';
export type Message = { id: number; from: Faction; to: Faction; text: string; sentAt: number };
export const DIPLOMACY_LIMITS = { name: 60, text: 1000, groupsPerParticipant: 16, messagesPerChannel: 100 } as const;
export type Group = { id: string; name: string; members: Faction[]; createdBy: Faction; createdAt: number };
export type ChannelMessage = { id: string; from: Faction; text: string; sentAt: number };
export type Channel = { id: string; kind: 'public' | 'private'; messages: ChannelMessage[] };
export type CreateGroup = { requestId: string; name: string; members: Faction[] };
export type ChannelTransmission = { requestId: string; channelId: string; text: string };
export type ObjectReference = { version: 1; gameId: string; kind: 'outpost' | 'hauler'; ref: string; hour: number };
export type ObjectReferences = { version: 1; outposts: { id: string; ref: string }[]; haulers: { id: number; ref: string }[] };
export type Snapshot = {
  id: string; invite: string; status: 'game.lobby' | 'game.active' | 'game.finished';
  faction: Faction; host: boolean; members: Faction[]; revision: number;
  recoveryEnabled?: boolean;
  inactivity?: { expiresAt: number };
  groups?: Group[]; channels?: Channel[];
  history?: { from: number; through: number };
  references?: ObjectReferences;
  visibility: 'sensors.v1'; game: GameView; messages: Message[]; serverTime: number;
};
export type HistorySnapshot = { id: string; faction: Faction; visibility: 'sensors.v1'; history: { from: number; through: number; at: number }; game: GameView; references?: ObjectReferences };
export type ResignOrder = { requestId: string; revision: number };
export type Order = { requestId: string; revision: number; from: string; to: string; drones: number; specialists?: string[]; carryModule?: boolean };
export type GiftOrder = Order & { recipient: Faction };
export type InterceptOrder = { requestId: string; revision: number; from: string; target: number; drones: number; specialists?: string[] };
export type ScheduleOrder = (Order & { executeAt: number }) | { requestId: string; revision: number; executeAt: number; action: FutureAction };
export type CancelSchedule = { requestId: string; revision: number; planId: string };
export type SpecialistOrder = { requestId: string; revision: number } & ({ action: 'hire'; kind: SpecialistKind } | { action: 'promote' | 'release'; unit: string });
export type ModuleOrder = { requestId: string; revision: number; rock: string; module: ModuleKind };
export type HaulerOrder = HaulerChange & { requestId: string; revision: number };
export type SiteOrder = { requestId: string; revision: number; rock: string } & ({ action: 'mine' } | { action: 'shields'; disabled: boolean });
export type FundingOrder = { requestId: string; revision: number; recipient: Faction; enabled: boolean };
export type Transmission = { requestId: string; to: Faction; text: string };
export type Issue = { issue: string; severity: 'error'; correlationId: string; dateTime: string; message: { title: string; detail: string } };

export type RecoverySetup = { requestId: string; secret: string };
export type RecoverSeat = { secret: string };

export type EditSchedule = { requestId: string; revision: number } & LaunchEdit;

export type PulseOrder = { requestId: string; revision: number; action: PulseAction };

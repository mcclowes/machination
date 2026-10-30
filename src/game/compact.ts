/** Daily council ballots, rotating agendas, and temporary permissions under the Belt compact. */
import type { Faction, Game } from './simulation';
import { playersIn } from './players';
import { COMPACT_POLICIES, COMPACT_POLICY_IDS, COUNCIL_DAY, COUNCIL_WAIVER_HOURS, COUNCIL_HISTORY, COUNCIL_VOTE_CHANGES, isCompactPolicy, type CompactPolicy } from './compact-policies';
export type CouncilChoice = 'yes' | 'no' | 'abstain';
export type CouncilAction = { motionId: number } & ({ action: 'vote'; choice: CouncilChoice } | { action: 'nominate'; policy: CompactPolicy | null });
export type CouncilChange = { owner: Faction; choice: CouncilChoice; hour: number };
export type CouncilMotion = { id: number; policy: CompactPolicy; proposer?: Faction; opensAt: number; closesAt: number; electorate: Faction[]; changes: CouncilChange[] };
export type CouncilResult = CouncilMotion & { result: 'passed' | 'failed' | 'canceled'; resolvedAt: number };
export type BeltCompact = { version: 1; motion?: CouncilMotion; proposals: Partial<Record<Faction, CompactPolicy>>; waivers: Partial<Record<CompactPolicy, { startsAt: number; expiresAt: number }>>; history: CouncilResult[] };
export type CompactWorld = { hour?: number; compact?: BeltCompact };
export const isCouncilChoice = (value: unknown): value is CouncilChoice => value === 'yes' || value === 'no' || value === 'abstain';
export function cloneCompact(compact: BeltCompact): BeltCompact {
  const motion = <T extends CouncilMotion>(m: T): T => ({ ...m, electorate: [...m.electorate], changes: m.changes.map(c => ({ ...c })) });
  return { version: 1, ...(compact.motion ? { motion: motion(compact.motion) } : {}), proposals: { ...compact.proposals }, waivers: Object.fromEntries(Object.entries(compact.waivers).map(([key, value]) => [key, { ...value }])), history: compact.history.map(motion) };
}
export function createCompact(players: readonly Faction[]): BeltCompact {
  return { version: 1, motion: { id: 1, policy: 'transit', opensAt: 0, closesAt: COUNCIL_DAY, electorate: [...players], changes: [] }, proposals: {}, waivers: {}, history: [] };
}
export function waiverActive(game: CompactWorld, policy: CompactPolicy): boolean {
  const waiver = game.compact?.waivers[policy];
  return !!waiver && (game.hour ?? 0) >= waiver.startsAt && (game.hour ?? 0) < waiver.expiresAt;
}
export function compactAllows(game: CompactWorld, policy: CompactPolicy): boolean { return !game.compact || waiverActive(game, policy); }
export function compactTransitMultiplier(game: CompactWorld): 1 | 1.5 { return waiverActive(game, 'transit') ? 1.5 : 1; }
export function councilBallots(motion: CouncilMotion): Partial<Record<Faction, CouncilChoice>> { return Object.fromEntries(motion.changes.map(c => [c.owner, c.choice])); }
function requireCouncil(game: Game, owner: Faction): BeltCompact {
  if (!game.compact || !game.compact.motion || game.winner || game.draw || !playersIn(game).includes(owner) || game.eliminated.includes(owner)) throw new Error('Council actions need an active intelligence in an operation under the Belt compact.');
  return cloneCompact(game.compact);
}
export function proposeCouncilPolicy(game: Game, owner: Faction, policy: CompactPolicy | null, motionId: number): Game {
  const compact = requireCouncil(game, owner);
  if (compact.motion!.id !== motionId || game.hour >= compact.motion!.closesAt) throw new Error('The council agenda has changed. Refresh before nominating a policy.');
  if (policy !== null && !isCompactPolicy(policy)) throw new Error('Choose a convention from the Belt compact.');
  if (policy === null) delete compact.proposals[owner]; else compact.proposals[owner] = policy;
  return { ...game, compact };
}
export function castCouncilVote(game: Game, owner: Faction, motionId: number, choice: CouncilChoice): Game {
  const compact = requireCouncil(game, owner); const motion = compact.motion!;
  if (!Number.isSafeInteger(motionId) || motion.id !== motionId || game.hour < motion.opensAt || game.hour >= motion.closesAt || !motion.electorate.includes(owner)) throw new Error('This ballot is closed or you are not in its electorate.');
  if (!isCouncilChoice(choice)) throw new Error('Choose yes, no, or abstain.');
  if (councilBallots(motion)[owner] === choice) return game;
  if (motion.changes.length >= COUNCIL_VOTE_CHANGES) throw new Error('This ballot has reached its vote-change limit.');
  motion.changes.push({ owner, choice, hour: game.hour });
  return { ...game, compact };
}
export function nextCouncilEvent(game: CompactWorld): number { return game.compact?.motion?.closesAt ?? Infinity; }
/** Called only on simulation-owned copies, at deadline boundaries and after victory checks. */
export function settleCouncil(game: Game): void {
  const compact = game.compact; const motion = compact?.motion;
  if (!compact || !motion) return;
  if (game.winner || game.draw) {
    compact.history.push({ ...motion, result: 'canceled', resolvedAt: game.hour });
    compact.history = compact.history.slice(-COUNCIL_HISTORY); delete compact.motion; compact.proposals = {}; return;
  }
  if (game.hour < motion.closesAt) return;
  const ballots = councilBallots(motion);
  const passed = motion.electorate.filter(f => ballots[f] === 'yes').length > motion.electorate.length / 2;
  compact.history.push({ ...motion, result: passed ? 'passed' : 'failed', resolvedAt: motion.closesAt });
  compact.history = compact.history.slice(-COUNCIL_HISTORY);
  for (const id of COMPACT_POLICY_IDS) if ((compact.waivers[id]?.expiresAt ?? Infinity) <= game.hour) delete compact.waivers[id];
  if (passed) compact.waivers[motion.policy] = { startsAt: motion.closesAt, expiresAt: motion.closesAt + COUNCIL_WAIVER_HOURS };
  const audience = [...playersIn(game)];
  game.events.unshift({ hour: game.hour, audience, message: `Belt council: ${COMPACT_POLICIES[motion.policy].motion} ${passed ? 'passed; permission granted for 48 hours' : 'failed; the convention remains in force'}.` });
  const electorate = audience.filter(f => !game.eliminated.includes(f));
  const agenda = audience.map((_, i) => audience[(motion.id + i) % audience.length]!).filter(f => electorate.includes(f));
  const proposer = agenda.find(f => compact.proposals[f] !== undefined);
  const policy = proposer ? compact.proposals[proposer]! : COMPACT_POLICY_IDS[motion.id % COMPACT_POLICY_IDS.length]!;
  if (proposer) delete compact.proposals[proposer];
  for (const f of audience) if (game.eliminated.includes(f)) delete compact.proposals[f];
  compact.motion = { id: motion.id + 1, policy, ...(proposer ? { proposer } : {}), opensAt: motion.closesAt, closesAt: motion.closesAt + COUNCIL_DAY, electorate, changes: [] };
}

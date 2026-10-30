/** Validate compact snapshots at persistence and network boundaries. */
import type { Faction } from './players';
import { councilBallots, isCouncilChoice, type BeltCompact, type CouncilMotion, type CouncilResult } from './compact';
import { COUNCIL_DAY, COUNCIL_WAIVER_HOURS, COUNCIL_HISTORY, COUNCIL_VOTE_CHANGES, isCompactPolicy } from './compact-policies';
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const number = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const shape = (v: Record<string, unknown>, required: string[], optional: string[] = []) => required.every(k => Object.hasOwn(v, k)) && Object.keys(v).every(k => required.includes(k) || optional.includes(k));
export function validCompact(value: unknown, players: readonly Faction[], hour: number, finished = false, transitional = false): value is BeltCompact {
  if (!record(value) || !shape(value, ['version', 'proposals', 'waivers', 'history'], ['motion']) || value.version !== 1 || !record(value.proposals) || !Object.entries(value.proposals).every(([owner, policy]) => players.includes(owner as Faction) && isCompactPolicy(policy)) || !record(value.waivers) || !Array.isArray(value.history) || value.history.length > COUNCIL_HISTORY) return false;
  function motion(v: unknown, resolved: boolean): v is CouncilMotion {
    if (!record(v) || !shape(v, ['id', 'policy', 'opensAt', 'closesAt', 'electorate', 'changes', ...(resolved ? ['result', 'resolvedAt'] : [])], ['proposer']) || !Number.isSafeInteger(v.id) || (v.id as number) < 1 || !isCompactPolicy(v.policy)
      || v.opensAt !== ((v.id as number) - 1) * COUNCIL_DAY || v.closesAt !== (v.id as number) * COUNCIL_DAY || (v.opensAt as number) > hour
      || !Array.isArray(v.electorate) || !v.electorate.length || new Set(v.electorate).size !== v.electorate.length || !v.electorate.every(f => players.includes(f))
      || v.proposer !== undefined && !v.electorate.includes(v.proposer) || !Array.isArray(v.changes) || v.changes.length > COUNCIL_VOTE_CHANGES) return false;
    let prior = v.opensAt as number;
    for (const c of v.changes) {
      if (!record(c) || !shape(c, ['owner', 'choice', 'hour']) || !v.electorate.includes(c.owner) || !isCouncilChoice(c.choice) || !number(c.hour) || c.hour < prior || c.hour >= (v.closesAt as number) || c.hour > hour) return false;
      prior = c.hour;
    }
    if (!resolved) return transitional ? (v.closesAt as number) >= hour : (v.closesAt as number) > hour;
    if (!['passed', 'failed', 'canceled'].includes(v.result as string) || !number(v.resolvedAt) || v.resolvedAt > hour || v.resolvedAt < (v.opensAt as number)) return false;
    if (v.result === 'canceled') return finished && v.resolvedAt <= (v.closesAt as number);
    const ballots = councilBallots(v as unknown as CouncilMotion);
    const passed = v.electorate.filter(f => ballots[f as Faction] === 'yes').length > v.electorate.length / 2;
    return v.resolvedAt === v.closesAt && v.result === (passed ? 'passed' : 'failed');
  }
  const history = value.history;
  if (!history.every(v => motion(v, true)) || history.some((v, i) => i > 0 && v.id !== history[i - 1]!.id + 1)) return false;
  if (finished ? value.motion !== undefined : !motion(value.motion, false)) return false;
  if (value.motion && record(value.motion) && history.length && value.motion.id !== history.at(-1)!.id + 1) return false;
  return Object.entries(value.waivers).every(([policy, w]) => isCompactPolicy(policy) && record(w) && shape(w, ['startsAt', 'expiresAt']) && number(w.startsAt) && w.startsAt <= hour && w.startsAt >= COUNCIL_DAY && w.startsAt % COUNCIL_DAY === 0 && w.expiresAt === w.startsAt + COUNCIL_WAIVER_HOURS && (history as CouncilResult[]).some(m => m.policy === policy && m.result === 'passed' && m.resolvedAt === w.startsAt));
}

import { isCompactPolicy } from '../src/game/compact-policies';
import { isCouncilChoice } from '../src/game/compact';
import type { CouncilOrder } from '../src/contracts/protocol';
import { Failure } from './failure';
export function councilCommand(value: unknown): CouncilOrder {
  const v = value as CouncilOrder;
  const keys = v?.action === 'vote' ? ['requestId', 'action', 'motionId', 'choice'] : ['requestId', 'action', 'motionId', 'policy'];
  if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).length !== keys.length || !Object.keys(v).every(k => keys.includes(k)) || typeof v.requestId !== 'string' || !/^[a-zA-Z0-9-]{16,80}$/.test(v.requestId) || !Number.isSafeInteger(v.motionId) || v.motionId < 1
    || !(v.action === 'vote' && isCouncilChoice(v.choice) || v.action === 'nominate' && (v.policy === null || isCompactPolicy(v.policy)))) throw new Failure(400, 'council.validation.command', 'Choose a current ballot and a known convention or vote.');
  return v.action === 'vote' ? { requestId: v.requestId, action: v.action, motionId: v.motionId, choice: v.choice } : { requestId: v.requestId, action: v.action, motionId: v.motionId, policy: v.policy };
}

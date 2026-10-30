/**
 * ---
 * purpose: One short practice drill per specialist that the tutorial catalog never features.
 * related:
 *   - ./specialist-introductions.ts - which exercise introduces each specialist
 *   - ./training.ts - attempt lifecycle and assessment
 * ---
 */
import { dispatch, type Game, type Rock } from './simulation';
import { activeUnits } from './specialists';
import { SPECIALISTS, type SpecialistKind } from './specialist-catalog';
import { refreshUnitEffects } from './specialist-effects';
import { droneInventory, powerCapacity } from './economy';
import { exportArchive, traceReplayTo, type GameCommand } from './replay';
import type { LocalOperation } from './operation-save';
import type { FutureAction } from './future-actions';
import { scheduleTransfer } from './orders';

const name = (kind: SpecialistKind) => SPECIALISTS[kind].name;

export const SPECIALIST_DRILLS = [
  { id: 'custodian-recharge', introduces: 'inspector', title: 'Recharged perimeter', instruction: `Send the ${name('inspector')} from Core berth to Foundry before the twelve-drone raid lands.`, objective: 'Keep Foundry by recharging its drained shields on arrival.', hints: ['Foundry’s shields are empty and its five drones cannot hold alone.', `The ${name('inspector')} fully charges shields when it arrives at a friendly site.`], deadline: 6, focus: 'works' },
  { id: 'bulwark-capacity', introduces: 'security', title: 'Raise the wall', instruction: `At hour three, promote the ${name('inspector')} at Core berth to a ${name('security')} before the forty-five-drone raid arrives.`, objective: 'Hold Core berth with shields alone.', hints: ['Thirty shields cannot absorb forty-five drones.', 'Extra capacity still has to recharge, so promote early.'], deadline: 24, focus: 'home' },
  { id: 'hijacker-raid', introduces: 'thief', title: 'Borrowed drones', instruction: `At hour three, recruit a ${name('thief')} at Core berth and attack Quiet landing with it and eighteen drones.`, objective: 'Capture the nineteen-drone garrison with fewer drones than it holds.', hints: ['Eighteen drones lose to nineteen defenders.', `The ${name('thief')} converts defenders to your side when it attacks.`], deadline: 6, focus: 'home' },
  { id: 'navigator-course', introduces: 'navigator', title: 'Change of course', instruction: `Your hauler is flying into Distant anchor’s shields. Use its ${name('navigator')} to turn it toward Quiet landing.`, objective: 'Capture Quiet landing with the redirected hauler.', hints: ['Select the hauler in flight and choose a new destination.', 'The course change takes ten minutes to settle.'], deadline: 6, focus: 'home' },
  { id: 'admiral-swarm', introduces: 'admiral', title: 'Swarm speed', instruction: `At hour three, promote the ${name('navigator')} at Core berth to a ${name('admiral')}, then send Far post’s thirty drones to Foundry with no specialists aboard.`, objective: 'Reinforce Foundry before the forty-drone raid lands.', hints: ['At normal speed the reinforcements arrive after the raid.', 'The speed bonus applies to haulers carrying no specialists.'], deadline: 8, focus: 'works' },
  { id: 'envoy-release', introduces: 'diplomat', title: 'Diplomatic channel', instruction: `At hour three, recruit an ${name('diplomat')} at Core berth to free your captive ${name('warHero')} from Quiet landing.`, objective: 'Bring the captive home without attacking its hundred-drone prison.', hints: ['Quiet landing is far too strong to capture.', `An ${name('diplomat')} frees your captives at sites within its sensor range.`], deadline: 6, focus: 'home' },
  { id: 'fallback-core', introduces: 'princess', title: 'Line of succession', instruction: `Core berth cannot survive the eighty-drone raid. At hour three, recruit a ${name('princess')} and move it to Foundry before the raid lands.`, objective: 'Lose Core berth and its core without losing the operation.', hints: ['Evacuating the core is not the lesson; it must stay at Core berth.', 'The nearest fallback core takes over when the current core is lost.'], deadline: 6, focus: 'home' },
  { id: 'assimilator-convert', introduces: 'hypnotist', title: 'Change of loyalty', instruction: `At hour three, recruit an ${name('hypnotist')} at Core berth to take over Vesper’s captive ${name('warHero')}, then attack Quiet landing with it and ten drones.`, objective: 'Capture the twenty-five-drone garrison with a converted specialist.', hints: ['Releasing the captive would return it to Vesper.', `Ten drones and a ${name('warHero')} outfight twenty-five defenders.`], deadline: 6, focus: 'home' },
  { id: 'overclock-siege', introduces: 'king', title: 'Overclocked swarm', instruction: `At hour three, promote the ${name('hypnotist')} at Core berth to ${name('king')}, then attack Quiet landing with eighteen drones and no specialists.`, objective: 'Capture the nineteen-drone garrison using a global combat bonus.', hints: ['Eighteen drones lose to nineteen defenders.', 'The bonus applies to every battle you fight, wherever the specialist is.'], deadline: 6, focus: 'home' },
  { id: 'watchdog-fire', introduces: 'sentry', title: 'Watchdog', instruction: `At hour three, promote the ${name('warHero')} at Foundry to a ${name('sentry')} and keep it there while the raid passes.`, objective: 'Keep Core berth by thinning the raid in flight.', hints: ['Thirty-one drones beat Core berth’s thirty shields by one.', 'The watchdog fires every two hours at nearby enemy haulers.'], deadline: 6, focus: 'works' },
  { id: 'governor-capacity', introduces: 'energy', title: 'Power governor', instruction: `Your drones exceed capacity, so Foundry has stopped producing. At hour three, promote its ${name('tinkerer')} to a ${name('energy')}.`, objective: 'Resume production at Foundry.', hints: [`The ${name('tinkerer')} alone does not add enough capacity.`, 'The governor adds capacity at the cost of one drone per factory cycle.'], deadline: 8, focus: 'works' },
  { id: 'overseer-output', introduces: 'tycoon', title: 'Overseer', instruction: `At hour three, promote Foundry’s ${name('smuggler')} to an ${name('tycoon')} before the twenty-five-drone raid lands.`, objective: 'Keep Foundry by speeding up its production.', hints: ['Foundry is empty and nothing can reach it in time.', 'The overseer speeds every factory and adds drones where it is stationed.'], deadline: 12, focus: 'works' },
] as const;
export type SpecialistDrillId = typeof SPECIALIST_DRILLS[number]['id'];
/** Disruptors only exist under pulse rules, which practice does not run. */
export const PRACTICE_EXCLUDED_SPECIALISTS: readonly SpecialistKind[] = ['disruptor'];

export function isSpecialistDrill(id: string): id is SpecialistDrillId { return SPECIALIST_DRILLS.some(d => d.id === id); }

/** Mutates only a fresh private baseline; scripted orders then use ordinary dispatch and scheduling. */
export function configureSpecialistDrill(game: Game, id: SpecialistDrillId): Game {
  const at = (site: string) => game.rocks.find(r => r.id === site)!;
  const home = at('home'), works = at('works'), relay = at('relay'), rival = at('rival-home');
  const unit = (site: Rock, kind: SpecialistKind, unitId = `training-${kind}`, owner = site.owner!) => site.specialists!.push({ id: unitId, kind, owner });
  const enemy = (drones: number) => Object.assign(relay, { owner: 'vesper', drones, shield: 0, shieldAt: 4.8 });
  const idle = (site: Rock) => Object.assign(site, { kind: 'generator', drones: 0 });
  const recruit = (offers: SpecialistKind[]) => { game.cargo.you = 5; game.recruitment!.you!.offers = offers; };
  const scripts: { from: string; to: string; drones: number; executeAt?: number; specialists: string[] }[] = [];
  const incoming = (from: string, to: string, drones: number, specialists: string[] = []) => scripts.push({ from, to, drones, specialists });
  const queue = (from: string, to: string, drones: number, executeAt: number) => scripts.push({ from, to, drones, executeAt, specialists: [] });
  game.cargo = { you: 0, vesper: 0 }; game.minesDrilled = { you: 0, vesper: 0 };
  switch (id) {
    case 'custodian-recharge': Object.assign(works, { drones: 5, shield: 0 }); unit(home, 'inspector'); rival.drones = 12; queue('rival-home', 'works', 12, 1); break;
    case 'bulwark-capacity': idle(works); unit(home, 'inspector'); rival.drones = 45; queue('rival-home', 'home', 45, 17); break;
    case 'hijacker-raid': idle(works); home.drones = 18; enemy(19); recruit(['thief', 'inspector', 'helmsman']); break;
    case 'navigator-course': idle(works); home.drones = 30; enemy(20); unit(home, 'navigator'); incoming('home', 'rival-home', 30, ['training-navigator']); break;
    case 'admiral-swarm': {
      const post = at('remote-0'); Object.assign(post, { name: 'Far post', owner: 'you', x: 50, y: 40, drones: 30, shield: 10 });
      works.drones = 5; unit(home, 'navigator'); rival.drones = 40; queue('rival-home', 'works', 40, 2.5); break;
    }
    case 'envoy-release': idle(works); enemy(100); relay.specialists!.push({ id: 'training-captive', owner: 'you', kind: 'warHero', captive: true }); recruit(['lieutenant', 'inspector', 'diplomat']); break;
    case 'fallback-core': rival.drones = 80; recruit(['lieutenant', 'inspector', 'princess']); queue('rival-home', 'home', 80, 1); break;
    case 'assimilator-convert':
      idle(works); home.drones = 10; enemy(25); home.specialists!.push({ id: 'enemy-warHero', owner: 'vesper', kind: 'warHero', captive: true }); recruit(['lieutenant', 'inspector', 'hypnotist']); break;
    case 'overclock-siege': idle(works); home.drones = 18; enemy(19); unit(home, 'hypnotist'); break;
    case 'watchdog-fire': idle(works); unit(works, 'warHero'); enemy(31); queue('relay', 'home', 31, 4); break;
    case 'governor-capacity': {
      unit(works, 'tinkerer'); works.drones = 0; refreshUnitEffects(game);
      home.drones = powerCapacity(game, 'you') - droneInventory(game, 'you') + 10; break;
    }
    case 'overseer-output': Object.assign(works, { drones: 0 }); unit(works, 'smuggler'); rival.drones = 25; queue('rival-home', 'works', 25, 6.5); break;
  }
  game.events = [{ hour: 0, audience: [...game.rules!.players], message: SPECIALIST_DRILLS.find(d => d.id === id)!.instruction }];
  refreshUnitEffects(game);
  for (const order of scripts) {
    const owner = game.rocks.find(r => r.id === order.from)!.owner!;
    if (order.executeAt !== undefined) game = scheduleTransfer(game, { ...order, owner, id: `training-wave-${game.nextId}-plan`, executeAt: order.executeAt });
    else {
      game = dispatch(game, order.from, order.to, order.drones, owner, false, order.specialists);
      const fleet = game.fleets.at(-1)!; fleet.arrives -= fleet.departed; fleet.departed = 0; delete fleet.preparing;
    }
  }
  return game;
}

export function specialistDrillPassed(id: SpecialistDrillId, operation: LocalOperation): boolean {
  const { game, archive } = operation, history = exportArchive(archive);
  const at = (site: string) => game.rocks.find(r => r.id === site)!;
  const ended = game.hour >= SPECIALIST_DRILLS.find(d => d.id === id)!.deadline;
  const entries = history.entries.filter(e => e.hour <= game.hour && 'owner' in e.command && e.command.owner === 'you');
  const commands = entries.flatMap<GameCommand | FutureAction>(e => e.command.type === 'schedule-action' ? e.command.plan.executeAt <= game.hour ? [e.command.plan.action] : [] : [e.command]);
  const used = (test: (c: GameCommand | FutureAction) => boolean) => commands.some(test);
  const hired = (kind: SpecialistKind) => used(c => c.type === 'hire' && c.kind === kind);
  const promoted = (unitId: string) => used(c => c.type === 'promote' && c.id === unitId);
  const has = (site: string, unitId: string, owner = 'you') => at(site).specialists?.some(u => u.id === unitId && u.owner === owner && !u.captive) ?? false;
  const everyState = (test: (state: Game) => boolean) => {
    let valid = true;
    traceReplayTo(archive, game.hour, { rivals: false, knownThrough: game.hour }, record => { if (record.type === 'point') valid &&= test(record.game); });
    return valid;
  };
  const held = (site: string) => everyState(state => state.rocks.find(r => r.id === site)!.owner === 'you');
  const captured = at('relay').owner === 'you' && at('relay').drones > 0;
  switch (id) {
    case 'custodian-recharge': return ended && held('works') && has('works', 'training-inspector') && used(c => c.type === 'dispatch' && c.to === 'works' && !!c.specialists?.includes('training-inspector'));
    case 'bulwark-capacity': return ended && held('home') && promoted('training-inspector');
    case 'hijacker-raid': return captured && hired('thief') && at('relay').specialists!.some(u => u.owner === 'you' && u.kind === 'thief');
    case 'navigator-course': return captured && used(c => c.type === 'hauler' && c.change.action === 'course' && c.change.to === 'relay');
    case 'admiral-swarm': return ended && held('works') && promoted('training-navigator');
    case 'envoy-release': return ended && hired('diplomat') && at('relay').owner === 'vesper' && game.rocks.some(r => r.owner === 'you' && has(r.id, 'training-captive'));
    case 'fallback-core': return ended && !game.eliminated.includes('you') && hired('princess') && !activeUnits(game, 'you').some(u => u.id === 'core-you') && activeUnits(game, 'you').some(u => u.kind === 'queen');
    case 'assimilator-convert': return captured && hired('hypnotist') && has('relay', 'enemy-warHero');
    case 'overclock-siege': return captured && promoted('training-hypnotist');
    case 'watchdog-fire': return ended && held('home') && promoted('training-warHero') && everyState(state => !!state.rocks.find(r => r.id === 'works')!.specialists?.some(u => u.id === 'training-warHero'));
    case 'governor-capacity': return ended && promoted('training-tinkerer') && droneInventory(game, 'you') > droneInventory(history.baseline, 'you');
    case 'overseer-output': return ended && held('works') && promoted('training-smuggler');
  }
}

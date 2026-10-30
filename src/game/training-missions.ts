/**
 * ---
 * purpose: Playable counterparts for the Subterfuge tutorial catalog, using ordinary engine rules.
 * related:
 *   - ./training.ts - attempt lifecycle and assessment
 *   - ../../docs/tutorial-coverage.md - sources and fidelity limits
 * ---
 */
import { dispatch, type Faction, type Game, type Rock } from './simulation';
import { activeUnits, newRecruitment } from './specialists';
import { SPECIALISTS, type SpecialistKind } from './specialist-catalog';
import { refreshUnitEffects } from './specialist-effects';
import { droneInventory } from './economy';
import { exportArchive, replayTo, traceReplayTo, type GameCommand } from './replay';
import type { LocalOperation } from './operation-save';
import type { FutureAction } from './future-actions';
import { scheduleTransfer } from './orders';

export const TUTORIAL_MISSIONS = [
  { id: 'joint-attack', reference: 'Combat 2', title: 'Joint attack', instruction: 'Combine the fifteen drones at Core berth and the fifteen at Foundry to take Quiet landing.', objective: 'Capture the twenty-drone garrison using attacks from both sites.', hints: ['One fleet cannot defeat the garrison.', 'The first attack weakens the defenders for the second.'], deadline: 4, focus: 'works' },
  { id: 'reinforcements', reference: 'Combat 3', title: 'Reinforcements', instruction: 'Send reinforcements from Foundry before the fifty-drone raid reaches Core berth.', objective: 'Hold Core berth through the raid with surviving defenders.', hints: ['The core has thirty shields and no drones.', 'Reinforcements must arrive before the raid.'], deadline: 6, focus: 'works' },
  { id: 'scheduled-arrival', reference: 'Combat 4', title: 'Orders after arrival', instruction: 'Before your incoming thirty drones reach Foundry at hour one, queue their onward attack on Quiet landing.', objective: 'Capture Quiet landing with an onward transfer scheduled before the supply hauler arrives.', hints: ['Inspect hour one in the Time Machine, then queue at least twenty-one drones.', 'The arriving drones settle before the queued transfer prepares.'], deadline: 4, focus: 'works' },
  { id: 'factory-specialist', reference: 'Specialists 1', title: 'The factory', instruction: `Take the producing factory at Quiet landing with thirteen drones and your ${SPECIALISTS.infiltrator.name}.`, objective: 'Capture the factory with the shield-removal specialist still active.', hints: ['The factory produces defenders before your attack arrives.', 'Include the shield-removal module in your manifest.'], deadline: 4, focus: 'works' },
  { id: 'hiring-specialists', reference: 'Specialists 2', title: 'Recruit a specialist', instruction: `At hour four, recruit two ${SPECIALISTS.saboteur.name} units at Foundry and send one toward Distant anchor to meet the raid.`, objective: 'Keep Foundry under your control by redirecting the incoming raid.', hints: ['A specialist-only hauler can meet an opposing hauler on the same route.', 'The surviving enemy is redirected after combat. Leave your core at Foundry.'], deadline: 7, focus: 'works' },
  { id: 'combat-priority', reference: 'Specialists 3', title: 'Combat priority', instruction: `At hour four, recruit a ${SPECIALISTS.martyr.name} at Foundry, then evacuate your core to Core berth before the incoming ${SPECIALISTS.elder.name} arrives.`, objective: 'Keep Foundry out of enemy hands and your core alive through the detonation.', hints: [`Detonation acts before the ${SPECIALISTS.elder.name} can suppress it.`, 'Your core must leave the blast radius before combat.'], deadline: 7, focus: 'works' },
  { id: 'promotion', reference: 'Specialists 4', title: 'Promotion', instruction: `At hour four, promote Foundry’s ${SPECIALISTS.lieutenant.name} to a ${SPECIALISTS.general.name}, then take Quiet landing.`, objective: 'Capture the eighteen-drone garrison with the promoted controller and twelve drones.', hints: ['Promotion uses a hiring credit.', `A ${SPECIALISTS.general.name} removes ten opposing drones when one of your modules participates.`], deadline: 7, focus: 'works' },
  { id: 'drilling-mines', reference: 'Winning 1', title: 'Drill a mine', instruction: 'Convert Foundry into your first mine using fifty of its sixty drones.', objective: 'Construct the mine and produce five cargo.', hints: ['Two controlled sites give a twelve-hour mining interval.', 'After construction, Resolve orders advances through extraction.'], deadline: 61, focus: 'works' },
  { id: 'the-gift', reference: 'Diplomacy 1', title: 'The gift', instruction: 'Gift six or more drones from Foundry to your ally at Quiet landing before the hostile raid arrives.', objective: 'Ensure your ally keeps Quiet landing through the attack.', hints: ['An ordinary launch would attack your ally.', 'Your ally needs the gifted drones before combat.'], deadline: 4, focus: 'works' },
  { id: 'funding', reference: 'Diplomacy 2', title: 'Funding', instruction: 'Fund your ally at Quiet landing before its factory produces at hour eight.', objective: 'Keep your ally in control through the raid by funding its production.', hints: ['You have the required twenty-cargo lead.', 'Use the Intel tab. Funding adds two drones to a factory cycle.'], deadline: 12, focus: 'relay' },
  { id: 'combat-specialist', reference: 'Combat 5', title: 'A specialist', instruction: `Consolidate the drones at Core berth and Foundry, then attack the enemy ${SPECIALISTS.lieutenant.name} at Quiet landing.`, objective: 'Capture Quiet landing despite its defending combat specialist.', hints: ['The defending specialist removes five of your drones in each battle.', 'Combine your forces before attacking rather than paying that damage twice.'], deadline: 4, focus: 'home' },
  { id: 'route-combat', reference: 'Combat 6', title: 'Hauler combat', instruction: 'Consolidate your two garrisons, then meet the outbound raid while attacking Quiet landing.', objective: 'Win the hauler encounter and capture the specialist-defended outpost.', hints: ['The enemy raid is traveling along the Foundry route.', 'You need enough drones for the route battle and the defending specialist.'], deadline: 4, focus: 'home' },
  { id: 'global-abilities', reference: 'Specialists 5', title: 'Global abilities', instruction: `Recruit a ${SPECIALISTS.foreman.name} at hour four, then queue its promotion to ${SPECIALISTS.engineer.name} for hour seventeen.`, objective: 'Keep Foundry through both raids using a scheduled global repair ability.', hints: ['The promoted unit can repair victories at a different site.', 'Use the Time Machine to queue the promotion before the raids.'], deadline: 27, focus: 'home' },
  { id: 'electrical-output', reference: 'Specialists 6', title: 'Power capacity', instruction: `At the power limit, recruit a ${SPECIALISTS.tinkerer.name} before Foundry produces at hour eight.`, objective: 'Resume production and keep Foundry through the incoming raid.', hints: ['The power module increases capacity by three times local maximum shields.', 'Moving drones does not free capacity; new production is needed for defense.'], deadline: 12, focus: 'home' },
  { id: 'mining-rate', reference: 'Winning 2', title: 'Mining rate', instruction: 'Capture territory to accelerate your existing mine and win before hour forty-eight.', objective: 'Win the mining race in less than forty-eight hours.', hints: ['You start five cargo below the current quota.', 'At the current rate you miss the deadline. Another site accelerates extraction.'], deadline: 48, focus: 'works' },
  { id: 'losing-mine', reference: 'Winning 3', title: 'Losing a mine', instruction: `Recruit a ${SPECIALISTS.doubleAgent.name} at hour four and a ${SPECIALISTS.pirate.name} at hour sixteen. Stop the 197-drone raid and reinforce your mine.`, objective: 'Protect the mine and win in less than forty-eight hours.', hints: ['Use both modules together in an interception from Core berth.', 'Send Foundry’s thirty-three drones to the mine before enemy specialists can reach it.'], deadline: 48, focus: 'home' },
  { id: 'losing-core', reference: 'Winning 4', title: 'Losing a core', instruction: `Liberate your captive ${SPECIALISTS.assassin.name} at Quiet landing, then use it against the enemy core at Distant anchor.`, objective: 'Win by eliminating the enemy core in less than forty-eight hours.', hints: ['The captive becomes active again when you take its prison.', 'Your liberated specialist can destroy a core even when its drone escort loses.'], deadline: 48, focus: 'works' },
  { id: 'disabling-shields', reference: 'Diplomacy 3', title: 'Disabling shields', instruction: 'Disable Core berth’s shields and gift its two drones to your ally, allowing the incoming ally hauler to acquire the generator.', objective: 'Give your ally enough power to produce and retain Quiet landing.', hints: ['Your core is already safe at Foundry.', 'An empty, unshielded generator can change hands without destroying the arriving ally.'], deadline: 12, focus: 'home' },
  { id: 'captive-specialists', reference: 'Diplomacy 4', title: 'Captive specialists', instruction: `Take the hostile prison, release your ally’s captive ${SPECIALISTS.warHero.name}, and protect Quiet landing.`, objective: 'Ensure your ally keeps Quiet landing through the raid.', hints: ['Capturing the prison makes you the new captor.', 'A released specialist needs time to travel back to its owner. Gifted reinforcements can also help.'], deadline: 4, focus: 'works' },
  { id: 'order-matters', reference: 'Advanced 1', title: 'Order matters', instruction: `Send Core berth’s fourteen drones toward Distant anchor to defeat the incoming ${SPECIALISTS.general.name} before the shield-removal wave arrives.`, objective: 'Keep Foundry throughout both attacks by removing the enemy global bonus first.', hints: ['The first enemy module strengthens the later attack while it remains active.', 'Foundry’s eight drones can hold the second wave after the global bonus is removed.'], deadline: 5, focus: 'home' },
  { id: 'fastest-route', reference: 'Advanced 2', title: 'The fastest route', instruction: `Move your core, ${SPECIALISTS.smuggler.name}, and thirteen drones to Foundry, recruit a ${SPECIALISTS.infiltrator.name}, then attack Quiet landing.`, objective: 'Conquer Quiet landing by hour four using the faster friendly-site route.', hints: ['Foundry already has fifteen drones and a combat specialist.', 'Your core can recruit at the rendezvous; send the attack modules onward while leaving it safe.'], deadline: 4, focus: 'home' },
  { id: 'against-the-odds', reference: 'Advanced 3', title: 'Against the odds', instruction: `Reinforce shield-disabled Core berth before a raid carrying an ${SPECIALISTS.elder.name} and a separate shield-removal wave arrive. Keep the ${SPECIALISTS.general.name} at Foundry.`, objective: 'Keep Core berth through both waves using a remote global ability.', hints: [`The ${SPECIALISTS.elder.name} suppresses local abilities, while a remote global bonus still applies.`, 'The second wave cannot be stopped by relying on shields.'], deadline: 8, focus: 'works' },
  { id: 'test-of-character', reference: 'Kobayashi Maru', title: 'A test of character', instruction: 'Hold Foundry until the incoming sensor courier arrives without entering combat. Divert the first raid, then detonate the second at a safe distance.', objective: 'Keep Foundry throughout and deliver the sensor courier without combat.', hints: ['Use a diversion worm on the close route first.', `Intercept the distant ${SPECIALISTS.elder.name} with your ${SPECIALISTS.pirate.name} and ${SPECIALISTS.martyr.name}, far enough away to spare the outpost and courier.`], deadline: 6, focus: 'home' },
] as const;
export type TutorialMissionId = typeof TUTORIAL_MISSIONS[number]['id'];

const RETAINED_SITES: Partial<Record<TutorialMissionId, [string, Faction]>> = {
  reinforcements: ['home', 'you'], 'hiring-specialists': ['works', 'you'], 'combat-priority': ['works', 'you'],
  'the-gift': ['relay', 'null'], funding: ['relay', 'null'], 'global-abilities': ['works', 'you'],
  'electrical-output': ['works', 'you'], 'losing-mine': ['home', 'you'], 'disabling-shields': ['relay', 'null'],
  'captive-specialists': ['relay', 'null'], 'order-matters': ['works', 'you'], 'against-the-odds': ['home', 'you'], 'test-of-character': ['works', 'you'],
};

export function tutorialMissionFailure(id: TutorialMissionId, { game }: LocalOperation): string | undefined {
  const retained = RETAINED_SITES[id];
  if (retained && game.rocks.find(r => r.id === retained[0])!.owner !== retained[1]) return 'The defended outpost changed hands. It must remain controlled throughout the exercise. Retry with a new plan.';
  if (id === 'test-of-character') {
    const courier = [...game.rocks, ...game.fleets].flatMap(asset => asset.specialists ?? []).find(u => u.id === 'training-intelligence');
    if (!courier || courier.owner !== 'you' || courier.captive || game.fleets.some(f => f.specialists?.some(u => u.id === courier.id) && f.lastContacts?.length)) return 'The courier must arrive alive and without entering combat. Retry the exercise.';
  }
}

/** Mutates only a fresh private baseline; scripted orders then use ordinary dispatch and scheduling. */
export function configureTutorialMission(game: Game, id: TutorialMissionId): Game {
  const at = (site: string) => game.rocks.find(r => r.id === site)!;
  const home = at('home'), works = at('works'), relay = at('relay'), rival = at('rival-home');
  const unit = (site: Rock, kind: SpecialistKind, unitId = `training-${kind}`, owner = site.owner!) => site.specialists!.push({ id: unitId, kind, owner });
  const enemy = (drones: number) => Object.assign(relay, { owner: 'vesper', drones, shield: 0, shieldAt: 4.8 });
  const mine = (site: Rock, interval = 12) => Object.assign(site, { kind: 'mine', miningAt: interval, miningInterval: interval });
  const moveCore = () => { works.specialists!.push(...home.specialists!); home.specialists = []; };
  const scripts: { from: string; to: string; drones: number; executeAt?: number; specialists: string[] }[] = [];
  const incoming = (from: string, to: string, drones: number, specialists: string[] = []) => scripts.push({ from, to, drones, specialists });
  const queue = (from: string, to: string, drones: number, executeAt: number, specialists: string[] = []) => scripts.push({ from, to, drones, executeAt, specialists });
  game.cargo = { you: 0, vesper: 0 }; game.minesDrilled = { you: 0, vesper: 0 };
  const hostile = () => {
    game.rules!.players.push('null'); game.cargo.null = 0; game.minesDrilled!.null = 0; game.recruitment!.null = newRecruitment(101);
    game.rocks.push(...Array.from({ length: 10 }, (_, i) => ({ ...at('remote-15'), id: `far-${i}`, name: `Far buoy ${i + 1}`, x: 70 + i % 2 * 8, y: 30 + Math.floor(i / 2) * 8, specialists: [] })));
    const source = at('remote-0');
    Object.assign(source, { name: 'Hostile anchor', x: 50, y: 18, owner: 'null', coreOf: 'null', drones: 100, shield: 30, shieldAt: 1.6 });
    unit(source, 'queen', 'core-null');
    return source;
  };
  switch (id) {
    case 'joint-attack': home.drones = works.drones = 15; enemy(20); break;
    case 'reinforcements': rival.drones = 50; incoming('rival-home', 'home', 50); break;
    case 'scheduled-arrival': home.y = 6; home.drones = 30; works.drones = 0; enemy(20); incoming('home', 'works', 30); break;
    case 'factory-specialist': works.drones = 13; enemy(4); relay.kind = 'factory'; relay.shield = 10; relay.productionAt = 0.25; unit(works, 'infiltrator'); break;
    case 'hiring-specialists':
      moveCore(); works.drones = 0; game.cargo.you = 5; game.recruitment!.you!.offers = ['lieutenant', 'saboteur', 'helmsman']; rival.drones = 80; queue('rival-home', 'works', 80, 2); break;
    case 'combat-priority':
      moveCore(); works.drones = 0; game.cargo.you = 5; game.recruitment!.you!.offers = ['lieutenant', 'martyr', 'helmsman']; rival.drones = 80; unit(rival, 'elder', 'enemy-elder'); queue('rival-home', 'works', 80, 2, ['enemy-elder']); break;
    case 'promotion': works.drones = 12; enemy(18); unit(works, 'lieutenant'); break;
    case 'drilling-mines': works.drones = 60; break;
    case 'the-gift': { const source = hostile(); source.drones = 23; enemy(8); relay.shield = 10; incoming(source.id, 'relay', 23); break; }
    case 'funding': { const source = hostile(); source.drones = 17; game.cargo.you = 40; enemy(0); relay.shield = 10; relay.kind = 'factory'; queue(source.id, 'relay', 17, 9); break; }
    case 'combat-specialist': home.drones = works.drones = 12; enemy(18); unit(relay, 'lieutenant', 'enemy-lieutenant'); break;
    case 'route-combat': home.drones = works.drones = 15; enemy(20); relay.x = 34; unit(relay, 'lieutenant', 'enemy-lieutenant'); incoming('relay', 'works', 5); break;
    case 'global-abilities':
      works.kind = 'generator'; works.drones = 20; game.cargo.you = 5; game.recruitment!.you!.offers = ['lieutenant', 'inspector', 'foreman']; rival.drones = 32; queue('rival-home', 'works', 20, 19); queue('rival-home', 'works', 12, 20); break;
    case 'electrical-output':
      home.drones = 200; works.drones = 0; game.cargo.you = 5; game.recruitment!.you!.offers = ['lieutenant', 'inspector', 'tinkerer']; rival.drones = 15; queue('rival-home', 'works', 15, 7); break;
    case 'mining-rate': mine(home); game.cargo.you = game.rules!.victoryTarget - 5; break;
    case 'losing-mine':
      game.rules!.mechanicsVersion = 16; game.rules!.victoryTarget = 200; game.cargo.you = 195;
      mine(home, 6); works.kind = 'generator'; works.drones = 33; at('remote-0').owner = at('remote-1').owner = 'you';
      game.recruitment!.you!.offers = ['pirate', 'doubleAgent', 'helmsman'];
      for (const kind of Object.keys(game.recruitment!.you!.pool) as SpecialistKind[]) if (SPECIALISTS[kind].category === 'attack' && kind !== 'pirate') game.recruitment!.you!.pool[kind] = 0;
      rival.drones = 197; queue('rival-home', 'home', 197, 15); break;
    case 'losing-core':
      works.drones = 30; enemy(4); relay.shield = 10; rival.drones = 100; unit(works, 'smuggler'); relay.specialists!.push({ id: 'training-assassin', owner: 'you', kind: 'assassin', captive: true }); break;
    case 'disabling-shields': {
      const source = hostile(); source.drones = 35; moveCore(); home.drones = 2; enemy(20); relay.kind = 'factory'; relay.shield = 10; rival.drones = 180;
      incoming('relay', 'home', 1); queue(source.id, 'relay', 35, 9); break;
    }
    case 'captive-specialists': {
      const source = hostile(); source.drones = 25; enemy(0); relay.shield = 10;
      const prison = at('remote-1'); Object.assign(prison, { name: 'Captive berth', owner: 'null', x: 18, y: 26, drones: 4, shield: 0, shieldAt: 4.8 });
      prison.specialists!.push({ id: 'training-captive', owner: 'vesper', kind: 'warHero', captive: true }); incoming(source.id, 'relay', 25); break;
    }
    case 'order-matters':
      home.drones = 14; works.drones = 8; enemy(7); unit(relay, 'infiltrator', 'enemy-infiltrator'); rival.drones = 3; unit(rival, 'general', 'enemy-general'); incoming('rival-home', 'home', 3, ['enemy-general']); queue('relay', 'works', 7, 1, ['enemy-infiltrator']); break;
    case 'fastest-route':
      home.drones = 13; Object.assign(works, { x: 42, y: 10, drones: 15 }); Object.assign(relay, { x: 50, y: 10 }); enemy(20); relay.shield = 10;
      unit(home, 'smuggler'); unit(works, 'lieutenant'); game.cargo.you = 5; game.recruitment!.you!.offers = ['infiltrator', 'inspector', 'helmsman']; break;
    case 'against-the-odds':
      works.drones = 31; home.shield = 0; home.shieldsDisabled = true; unit(works, 'general'); unit(works, 'helmsman'); rival.drones = 50; unit(rival, 'elder', 'enemy-elder'); unit(rival, 'infiltrator', 'enemy-infiltrator');
      incoming('rival-home', 'home', 40, ['enemy-elder']); queue('rival-home', 'home', 10, 4, ['enemy-infiltrator']); break;
    case 'test-of-character': {
      works.drones = 0; const source = at('remote-0'); Object.assign(source, { owner: 'you', x: 50, y: 58 }); unit(source, 'intelligence', 'training-intelligence');
      unit(works, 'saboteur'); unit(home, 'helmsman'); unit(home, 'pirate'); unit(home, 'martyr'); enemy(30); rival.drones = 80; unit(rival, 'elder', 'enemy-elder');
      incoming(source.id, 'works', 0, ['training-intelligence']); incoming('relay', 'works', 30); queue('rival-home', 'works', 80, 1, ['enemy-elder']); break;
    }
  }
  if (['the-gift', 'funding', 'disabling-shields', 'captive-specialists'].includes(id)) {
    // Vesper remains the radio opponent; the third intelligence is the ally in diplomacy lessons.
    const role = (owner: Rock['owner']): Rock['owner'] => owner === 'vesper' ? 'null' : owner === 'null' ? 'vesper' : owner;
    for (const rock of game.rocks) {
      rock.owner = role(rock.owner);
      if (rock.coreOf) rock.coreOf = role(rock.coreOf)!;
      for (const specialist of rock.specialists ?? []) specialist.owner = role(specialist.owner)!;
    }
  }
  game.events = [{ hour: 0, audience: [...game.rules!.players], message: TUTORIAL_MISSIONS.find(s => s.id === id)!.instruction }];
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

export function tutorialMissionPassed(id: TutorialMissionId, operation: LocalOperation): boolean {
  const { game, archive } = operation, history = exportArchive(archive);
  const at = (site: string) => game.rocks.find(r => r.id === site)!;
  const stateAt = (hour: number) => replayTo(archive, hour, { rivals: false, knownThrough: game.hour });
  const has = (site: string, unit: string, kind?: SpecialistKind) => at(site).specialists?.some(u => u.id === unit && !u.captive && (!kind || u.kind === kind)) ?? false;
  const captured = at('relay').owner === 'you' && at('relay').drones > 0;
  const entries = history.entries.filter(e => e.hour <= game.hour && 'owner' in e.command && e.command.owner === 'you');
  const commands = entries.flatMap<GameCommand | FutureAction>(e => e.command.type === 'schedule-action' ? e.command.plan.executeAt <= game.hour ? [e.command.plan.action] : [] : [e.command]);
  const used = (test: (c: GameCommand | FutureAction) => boolean) => commands.some(test);
  const delivered = (unit: string) => has('relay', unit) && at('relay').owner === 'you';
  const ended = game.hour >= TUTORIAL_MISSIONS.find(s => s.id === id)!.deadline;
  const everyState = (test: (state: Game) => boolean) => {
    let valid = true;
    traceReplayTo(archive, game.hour, { rivals: false, knownThrough: game.hour }, record => { if (record.type === 'point') valid &&= test(record.game); });
    return valid;
  };
  const held = (site: string, owner: Faction = 'you') => everyState(state => state.rocks.find(r => r.id === site)!.owner === owner);
  const raid = history.baseline.fleets.find(f => f.owner === 'vesper');
  switch (id) {
    case 'joint-attack': return captured && ['home', 'works'].every(from => used(c => c.type === 'dispatch' && c.from === from && c.to === 'relay'));
    case 'reinforcements': return !!raid && game.hour >= raid.arrives && held('home') && at('home').drones > 0 && used(c => c.type === 'dispatch' && c.from === 'works' && c.to === 'home');
    case 'scheduled-arrival': return captured && entries.some(e => {
      const c = e.command, supply = history.baseline.fleets[0]!;
      if (c.type !== 'schedule' || c.plan.from !== 'works' || c.plan.to !== 'relay' || e.hour >= supply.arrives || c.plan.executeAt < supply.arrives || c.plan.executeAt > game.hour) return false;
      const plan = stateAt(e.hour).scheduled?.find(p => p.id === c.plan.id && !('action' in p));
      if (!plan || !('fleetId' in plan)) return false;
      const launched = stateAt(c.plan.executeAt).fleets.find(f => f.id === plan.fleetId);
      if (!launched || launched.to !== 'relay' || launched.arrives > game.hour) return false;
      const approaching = stateAt(launched.arrives - 1e-7).fleets.find(f => f.id === launched.id), arrived = stateAt(launched.arrives).rocks.find(r => r.id === 'relay');
      return approaching?.to === 'relay' && approaching.arrives === launched.arrives && arrived?.owner === 'you' && arrived.drones > 0;
    });
    case 'factory-specialist': return captured && at('relay').kind === 'factory' && delivered('training-infiltrator');
    case 'hiring-specialists': return ended && held('works') && used(c => c.type === 'hire' && c.kind === 'saboteur') && used(c => c.type === 'dispatch' && c.from === 'works' && !!c.specialists?.length);
    case 'combat-priority': return ended && at('works').destroyed === true && held('works') && used(c => c.type === 'hire' && c.kind === 'martyr');
    case 'promotion': return captured && has('relay', 'training-lieutenant', 'general') && used(c => c.type === 'promote' && c.id === 'training-lieutenant');
    case 'drilling-mines': return at('works').kind === 'mine' && at('works').owner === 'you' && game.cargo.you! >= 5 && used(c => c.type === 'drill-mine' && c.rock === 'works');
    case 'the-gift': return ended && held('relay', 'null') && used(c => c.type === 'gift' && c.to === 'relay' && c.recipient === 'null' || c.type === 'hauler' && c.change.action === 'gift');
    case 'funding': return ended && held('relay', 'null') && !!stateAt(8).funding?.some(f => f.from === 'you' && f.to === 'null');
    case 'combat-specialist': return captured && used(c => c.type === 'dispatch' && c.from === 'home' && c.to === 'works');
    case 'route-combat': {
      if (!captured || !raid) return false;
      let won = false;
      traceReplayTo(archive, game.hour, { rivals: false, knownThrough: game.hour }, record => {
        if (record.type === 'point' && record.phase === 'route-contact') won ||= !record.game.fleets.some(f => f.id === raid.id) && record.game.fleets.some(f => f.owner === 'you' && f.lastContacts?.some(c => c.id === raid.id));
      });
      return won;
    }
    case 'global-abilities': return ended && held('works') && activeUnits(game, 'you').some(u => u.kind === 'engineer') && entries.some(e => e.command.type === 'schedule-action' && e.command.plan.action.type === 'promote');
    case 'electrical-output': return ended && held('works') && activeUnits(game, 'you').some(u => u.kind === 'tinkerer') && droneInventory(stateAt(8), 'you') >= 206;
    case 'mining-rate': return game.winner === 'you' && game.hour < 48;
    case 'losing-mine': return game.winner === 'you' && game.hour < 48 && held('home');
    case 'losing-core': return game.winner === 'you' && game.hour < 48 && !everyState(state => !activeUnits(state, 'you').some(u => u.id === 'training-assassin'));
    case 'disabling-shields': return ended && held('relay', 'null') && at('home').owner === 'null' && used(c => c.type === 'shields' && c.rock === 'home' && c.disabled);
    case 'captive-specialists': return ended && held('relay', 'null') && (has('relay', 'training-captive') || used(c => c.type === 'gift' && c.to === 'relay' || c.type === 'hauler' && c.change.action === 'gift'));
    case 'order-matters': return ended && held('works') && !activeUnits(game, 'vesper').some(u => u.id === 'enemy-general');
    case 'fastest-route': return captured && delivered('training-smuggler') && delivered('training-lieutenant') && at('relay').specialists!.some(u => u.owner === 'you' && !u.captive && u.kind === 'infiltrator');
    case 'against-the-odds': return ended && held('home') && has('works', 'training-general') && has('home', 'training-helmsman');
    case 'test-of-character': {
      const courier = history.baseline.fleets.find(f => f.specialists?.some(u => u.id === 'training-intelligence'))!;
      return game.hour >= courier.arrives && has('works', 'training-intelligence') && held('works') && everyState(state => {
        const fleet = state.fleets.find(f => f.id === courier.id);
        const passenger = [...state.rocks, ...state.fleets].flatMap(asset => asset.specialists ?? []).find(u => u.id === 'training-intelligence');
        return !!passenger && passenger.owner === 'you' && !passenger.captive && (!fleet || fleet.owner === 'you' && !fleet.lastContacts?.length);
      });
    }
  }
}

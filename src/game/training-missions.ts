/**
 * ---
 * purpose: Playable counterparts for the Subterfuge tutorial catalog, using ordinary engine rules.
 * related:
 *   - ./training.ts - attempt lifecycle and assessment
 *   - ../../docs/tutorial-coverage.md - sources and fidelity limits
 * ---
 */
import { dispatch, type Game, type Rock } from './simulation';
import { activeUnits } from './specialists';
import { SPECIALISTS, type SpecialistKind } from './specialist-catalog';
import { refreshUnitEffects } from './specialist-effects';
import { droneInventory } from './economy';
import { exportArchive, replayTo, traceReplayTo, type GameCommand } from './replay';
import type { LocalOperation } from './operation-save';
import type { FutureAction } from './future-actions';

export const TUTORIAL_MISSIONS = [
  { id: 'joint-attack', reference: 'Combat 2', title: 'Joint attack', instruction: 'Combine the fifteen drones at Core berth and the fifteen at Foundry to take Quiet landing.', objective: 'Capture the twenty-drone garrison using attacks from both sites.', hints: ['One fleet cannot defeat the garrison.', 'The first attack weakens the defenders for the second.'], deadline: 4, focus: 'works' },
  { id: 'reinforcements', reference: 'Combat 3', title: 'Reinforcements', instruction: 'Send reinforcements from Foundry before the fifty-drone raid reaches Core berth.', objective: 'Hold Core berth through the raid with surviving defenders.', hints: ['The core has thirty shields and no drones.', 'Reinforcements must arrive before the raid.'], deadline: 6, focus: 'works' },
  { id: 'scheduled-arrival', reference: 'Combat 4', title: 'Orders after arrival', instruction: 'Before your incoming thirty drones reach Foundry at hour one, queue their onward attack on Quiet landing.', objective: 'Capture Quiet landing with an onward transfer scheduled before the supply hauler arrives.', hints: ['Inspect hour one in the Time Machine, then queue at least twenty-one drones.', 'The arriving drones settle before the queued transfer prepares.'], deadline: 4, focus: 'works' },
  { id: 'factory-specialist', reference: 'Specialists 1', title: 'The factory', instruction: `Move the ${SPECIALISTS.foreman.name} from Core berth to Foundry before its first production cycle.`, objective: `Have the ${SPECIALISTS.foreman.name} at Foundry when it produces at least ten drones at hour eight.`, hints: ['This module adds four drones to the normal six per cycle.', 'A module can travel without drones.'], deadline: 9, focus: 'home' },
  { id: 'hiring-specialists', reference: 'Specialists 2', title: 'Recruit a specialist', instruction: `Advance to hour four, then recruit a ${SPECIALISTS.lieutenant.name} at your core.`, objective: `Spend a hiring credit and five cargo on a ${SPECIALISTS.lieutenant.name}.`, hints: ['Recruitment opens at hour four.', 'Use the modules panel at Core berth.'], deadline: 6, focus: 'home' },
  { id: 'combat-priority', reference: 'Specialists 3', title: 'Combat priority', instruction: `Take Quiet landing with six drones, a ${SPECIALISTS.assassin.name}, and a ${SPECIALISTS.lieutenant.name}.`, objective: `Defeat the defending ${SPECIALISTS.lieutenant.name} and eight drones while preserving both attacking modules.`, hints: [`${SPECIALISTS.assassin.name}s act before ${SPECIALISTS.lieutenant.name}s.`, `A ${SPECIALISTS.lieutenant.name} alone is destroyed before it can deal damage.`], deadline: 4, focus: 'works' },
  { id: 'promotion', reference: 'Specialists 4', title: 'Promotion', instruction: `At hour four, promote Foundry’s ${SPECIALISTS.lieutenant.name} to a ${SPECIALISTS.general.name}, then take Quiet landing.`, objective: 'Capture the eighteen-drone garrison with the promoted controller and twelve drones.', hints: ['Promotion uses a hiring credit.', `A ${SPECIALISTS.general.name} removes ten opposing drones when one of your modules participates.`], deadline: 7, focus: 'works' },
  { id: 'drilling-mines', reference: 'Winning 1', title: 'Drill a mine', instruction: 'Convert Foundry into your first mine using fifty of its sixty drones.', objective: 'Build the mine and extract at least one cargo.', hints: ['Use the site’s mine construction action.', 'Two controlled sites give a twelve-hour mining interval.'], deadline: 13, focus: 'works' },
  { id: 'the-gift', reference: 'Diplomacy 1', title: 'The gift', instruction: 'Gift at least six drones from Foundry to Vesper at Quiet landing.', objective: 'Deliver the gift without taking ownership of Quiet landing.', hints: ['Use a gift order rather than an ordinary attack.', 'Ownership changes when the gift reaches its recipient.'], deadline: 4, focus: 'works' },
  { id: 'funding', reference: 'Diplomacy 2', title: 'Funding', instruction: 'Use your forty-cargo lead to fund Vesper before its factory produces at hour eight.', objective: 'Keep funding active until Vesper’s Quiet landing factory produces eight drones.', hints: ['Funding requires a lead of at least twenty cargo.', 'Funding adds two drones to each factory cycle. Use the Intel tab.'], deadline: 9, focus: 'relay' },
  { id: 'combat-specialist', reference: 'Combat 5', title: 'A specialist', instruction: `Attack Quiet landing’s eight drones with six drones and Foundry’s ${SPECIALISTS.lieutenant.name}.`, objective: `Capture the site with your ${SPECIALISTS.lieutenant.name} still active.`, hints: ['The daemon removes five defenders before drone combat.', 'Include the module in your launch manifest.'], deadline: 4, focus: 'works' },
  { id: 'route-combat', reference: 'Combat 6', title: 'Hauler combat', instruction: 'Send twenty-five drones along the Quiet landing route to meet its twenty-drone outbound raid.', objective: 'Win the ordinary hauler encounter, then capture Quiet landing.', hints: ['Opposing haulers meet when traveling the same route.', 'Shields protect sites, not haulers in transit.'], deadline: 4, focus: 'works' },
  { id: 'global-abilities', reference: 'Specialists 5', title: 'Global abilities', instruction: `Leave the ${SPECIALISTS.general.name} at Core berth. Send Foundry’s ${SPECIALISTS.helmsman.name} and six drones against Quiet landing’s fifteen.`, objective: `Capture the site using the remote ${SPECIALISTS.general.name}’s bonus.`, hints: [`A ${SPECIALISTS.general.name} can affect battles at other sites.`, 'One of your modules must remain present after the specialist phase.'], deadline: 4, focus: 'works' },
  { id: 'electrical-output', reference: 'Specialists 6', title: 'Power capacity', instruction: `You are at the two-hundred-drone power limit. At hour four, recruit a ${SPECIALISTS.tinkerer.name} so Foundry can produce.`, objective: 'Increase capacity and manufacture six additional drones by hour eight.', hints: ['A capacitor adds three times its site’s maximum shields to power capacity.', 'Moving existing drones does not free production capacity.'], deadline: 9, focus: 'home' },
  { id: 'mining-rate', reference: 'Winning 2', title: 'Mining rate', instruction: 'Capture Quiet landing before your Core berth mine’s first extraction.', objective: 'Expand to three sites and extract cargo before hour ten.', hints: ['More controlled sites accelerate every mine.', 'Three sites reduce each mine’s interval from twelve hours to eight.'], deadline: 10, focus: 'works' },
  { id: 'losing-mine', reference: 'Winning 3', title: 'Losing a mine', instruction: 'Capture Vesper’s mine at Quiet landing to reduce its stockpile.', objective: 'Take the mine and reduce Vesper’s one hundred cargo to eighty or less.', hints: ['Losing a mine removes twenty percent of the former owner’s cargo.', 'The attacker receives the mine, not the lost cargo.'], deadline: 4, focus: 'works' },
  { id: 'losing-core', reference: 'Winning 4', title: 'Losing a core', instruction: 'Capture Vesper’s intelligence core at Distant anchor while keeping your own safe.', objective: 'Eliminate Vesper by capturing its only core.', hints: ['The enemy core has thirty shields.', 'Send more than thirty drones from Foundry.'], deadline: 7, focus: 'works' },
  { id: 'disabling-shields', reference: 'Diplomacy 3', title: 'Disabling shields', instruction: 'Hand Quiet landing to Vesper’s one-drone incoming hauler by disabling its shields.', objective: 'Let Vesper acquire Quiet landing while preserving the arriving drone.', hints: ['Use Quiet landing’s shield controls.', 'An enabled shield would destroy the arriving drone.'], deadline: 4, focus: 'relay' },
  { id: 'captive-specialists', reference: 'Diplomacy 4', title: 'Captive specialists', instruction: `Release Vesper’s captive ${SPECIALISTS.helmsman.name} from Foundry.`, objective: 'Return the module alive to Vesper’s Quiet landing site.', hints: ['Use the captive module’s release action.', 'Release begins a real journey to the nearest site its owner controls.'], deadline: 4, focus: 'works' },
  { id: 'order-matters', reference: 'Advanced 1', title: 'Order matters', instruction: `Send the ${SPECIALISTS.infiltrator.name} to Quiet landing first, then follow with Foundry’s ten drones.`, objective: 'Remove the shields before your drone attack arrives and capture the site.', hints: [`Send the ${SPECIALISTS.infiltrator.name} without drones.`, 'Let it arrive first. The eight defenders can then be beaten by ten drones.'], deadline: 4, focus: 'works' },
  { id: 'fastest-route', reference: 'Advanced 2', title: 'The fastest route', instruction: `Deliver the ${SPECIALISTS.navigator.name} from Core berth to Quiet landing before hour three.`, objective: `Use the ${SPECIALISTS.smuggler.name}’s friendly-site speed to make the delivery in time.`, hints: ['The direct hostile route takes more than five hours.', 'Travel with the courier to friendly Foundry first, then launch the onward leg.'], deadline: 3, focus: 'home' },
  { id: 'against-the-odds', reference: 'Advanced 3', title: 'Against the odds', instruction: `A ${SPECIALISTS.elder.name} leads forty drones toward shield-disabled Core berth. Reinforce it while keeping the ${SPECIALISTS.general.name} at Foundry.`, objective: 'Keep Core berth through the raid using a remote global ability.', hints: ['The shields are disabled, and the kernel suppresses local combat abilities.', `The remote ${SPECIALISTS.general.name} still removes ten drones if one of your modules is present.`], deadline: 6, focus: 'works' },
  { id: 'test-of-character', reference: 'Kobayashi Maru', title: 'A test of character', instruction: 'Two hundred drones are coming for Core berth. Evacuate your intelligence core to Foundry and survive the loss of home.', objective: 'Save the core at Foundry while Vesper takes Core berth.', hints: ['There are too few drones to hold your starting position.', 'Your core can travel without drones; losing a site does not end an operation if the core survives.'], deadline: 6, focus: 'home' },
] as const;
export type TutorialMissionId = typeof TUTORIAL_MISSIONS[number]['id'];

/** Mutates only a fresh, private training baseline, before its archive is created. */
export function configureTutorialMission(game: Game, id: TutorialMissionId): Game {
  const at = (site: string) => game.rocks.find(r => r.id === site)!;
  const home = at('home'), works = at('works'), relay = at('relay'), rival = at('rival-home');
  const unit = (site: Rock, kind: SpecialistKind, unitId = `training-${kind}`, owner = site.owner!) => site.specialists!.push({ id: unitId, kind, owner });
  const enemy = (drones: number) => Object.assign(relay, { owner: 'vesper', drones, shield: 0, shieldAt: 4.8 });
  const mine = (site: Rock) => Object.assign(site, { kind: 'mine', miningAt: 12, miningInterval: 12 });
  const incoming = (from: string, to: string, drones: number, owner: 'you' | 'vesper', specialists: string[] = []) => {
    game = dispatch(game, from, to, drones, owner, false, specialists);
    const fleet = game.fleets.at(-1)!;
    fleet.arrives -= fleet.departed; fleet.departed = 0; delete fleet.preparing;
  };
  game.cargo = { you: 0, vesper: 0 };
  game.minesDrilled = { you: 0, vesper: 0 };
  switch (id) {
    case 'joint-attack': home.drones = works.drones = 15; enemy(20); break;
    case 'reinforcements': rival.drones = 50; incoming('rival-home', 'home', 50, 'vesper'); break;
    case 'scheduled-arrival':
      home.drones = 30; works.drones = 0; enemy(20); incoming('home', 'works', 30, 'you'); break;
    case 'factory-specialist': works.drones = 0; unit(home, 'foreman'); break;
    case 'hiring-specialists': game.cargo.you = 5; game.recruitment!.you!.offers = ['lieutenant', 'inspector', 'helmsman']; break;
    case 'combat-priority': works.drones = 6; enemy(8); unit(works, 'assassin'); unit(works, 'lieutenant'); unit(relay, 'lieutenant', 'enemy-lieutenant'); break;
    case 'promotion': works.drones = 12; enemy(18); unit(works, 'lieutenant'); break;
    case 'drilling-mines': works.drones = 60; break;
    case 'the-gift': enemy(0); break;
    case 'funding': game.cargo.you = 40; enemy(0); relay.kind = 'factory'; break;
    case 'combat-specialist': works.drones = 6; enemy(8); unit(works, 'lieutenant'); break;
    case 'route-combat': enemy(20); incoming('relay', 'works', 20, 'vesper'); break;
    case 'global-abilities': works.drones = 6; enemy(15); unit(home, 'general'); unit(works, 'helmsman'); break;
    case 'electrical-output':
      home.drones = 200; works.drones = 0; game.cargo.you = 5; game.recruitment!.you!.offers = ['lieutenant', 'inspector', 'tinkerer']; break;
    case 'mining-rate': mine(home); break;
    case 'losing-mine': enemy(10); mine(relay); game.cargo.vesper = 100; break;
    case 'losing-core': works.drones = 60; break;
    case 'disabling-shields':
      Object.assign(relay, { owner: 'you', drones: 0, shield: 10 }); Object.assign(rival, { x: 26, y: 18, drones: 1 }); incoming('rival-home', 'relay', 1, 'vesper'); break;
    case 'captive-specialists': enemy(0); works.specialists!.push({ id: 'training-captive', owner: 'vesper', kind: 'helmsman', captive: true }); break;
    case 'order-matters': works.drones = 10; enemy(8); relay.shield = 10; unit(works, 'infiltrator'); break;
    case 'fastest-route':
      Object.assign(works, { x: 42, y: 10, drones: 0 }); Object.assign(relay, { x: 50, y: 10 }); enemy(0); unit(home, 'smuggler'); unit(home, 'navigator'); break;
    case 'against-the-odds':
      works.drones = 31; home.shield = 0; home.shieldsDisabled = true; unit(works, 'general'); unit(works, 'helmsman'); rival.drones = 40; unit(rival, 'elder', 'enemy-elder');
      incoming('rival-home', 'home', 40, 'vesper', ['enemy-elder']); break;
    case 'test-of-character': works.drones = 0; rival.drones = 200; incoming('rival-home', 'home', 200, 'vesper'); break;
  }
  refreshUnitEffects(game);
  return game;
}

export function tutorialMissionPassed(id: TutorialMissionId, operation: LocalOperation): boolean {
  const { game, archive } = operation;
  const history = exportArchive(archive);
  const at = (site: string) => game.rocks.find(r => r.id === site)!;
  const has = (site: string, unit: string, kind?: SpecialistKind) => at(site).specialists?.some(u => u.id === unit && !u.captive && (!kind || u.kind === kind)) ?? false;
  const captured = at('relay').owner === 'you' && at('relay').drones > 0;
  const entries = history.entries.filter(e => e.hour <= game.hour && 'owner' in e.command && e.command.owner === 'you');
  // Expand queued actions only after their execution time; a queued click is never completion.
  const commands = entries.flatMap<GameCommand | FutureAction>(e => e.command.type === 'schedule-action' ? e.command.plan.executeAt <= game.hour ? [e.command.plan.action] : [] : [e.command]);
  const used = (test: (c: GameCommand | FutureAction) => boolean) => commands.some(test);
  const delivered = (unit: string) => has('relay', unit) && at('relay').owner === 'you';
  const raid = history.baseline.fleets.find(f => f.owner === 'vesper');
  const defended = !!raid && game.hour >= raid.arrives && !game.fleets.some(f => f.id === raid.id) && at('home').owner === 'you';
  switch (id) {
    case 'joint-attack': return captured && ['home', 'works'].every(from => used(c => c.type === 'dispatch' && c.from === from && c.to === 'relay'));
    case 'reinforcements': return defended && at('home').drones > 0 && used(c => c.type === 'dispatch' && c.from === 'works' && c.to === 'home');
    case 'scheduled-arrival': return captured && entries.some((e, i) => {
      const c = e.command;
      if (c.type !== 'schedule' || c.plan.from !== 'works' || c.plan.to !== 'relay' || e.hour >= 1 || c.plan.executeAt < 1 || c.plan.executeAt > game.hour) return false;
      // The scheduled fleet must really reach the target; canceling then launching manually cannot borrow its proof.
      const submitted = replayTo(archive, e.hour, { rivals: false, knownThrough: game.hour });
      const plan = submitted.scheduled?.find(p => p.id === c.plan.id && !('action' in p));
      if (!plan || !('fleetId' in plan)) return false;
      const launched = replayTo(archive, c.plan.executeAt, { rivals: false, knownThrough: game.hour }).fleets.find(f => f.id === plan.fleetId);
      if (!launched || launched.to !== 'relay' || launched.arrives > game.hour) return false;
      const approaching = replayTo(archive, launched.arrives - 1e-7, { rivals: false, knownThrough: game.hour }).fleets.find(f => f.id === launched.id);
      const arrived = replayTo(archive, launched.arrives, { rivals: false, knownThrough: game.hour }).rocks.find(r => r.id === 'relay');
      return approaching?.to === 'relay' && approaching.arrives === launched.arrives && arrived?.owner === 'you' && arrived.drones > 0
        && !entries.slice(i + 1).some(later => later.command.type === 'cancel-schedule' && later.command.id === c.plan.id && later.hour < c.plan.executeAt);
    });
    case 'factory-specialist': return game.hour >= 8 && has('works', 'training-foreman') && at('works').drones >= 10
      && !!replayTo(archive, 8, { rivals: false, knownThrough: game.hour }).rocks.find(r => r.id === 'works')?.specialists?.some(u => u.id === 'training-foreman' && !u.captive);
    case 'hiring-specialists': return used(c => c.type === 'hire' && c.kind === 'lieutenant') && activeUnits(game, 'you').some(u => u.kind === 'lieutenant');
    case 'combat-priority': return captured && delivered('training-assassin') && delivered('training-lieutenant');
    case 'promotion': return captured && has('relay', 'training-lieutenant', 'general') && used(c => c.type === 'promote' && c.id === 'training-lieutenant');
    case 'drilling-mines': return at('works').kind === 'mine' && at('works').owner === 'you' && game.cargo.you! >= 1 && used(c => c.type === 'drill-mine' && c.rock === 'works');
    case 'the-gift': return at('relay').owner === 'vesper' && at('relay').drones >= 6 && used(c => c.type === 'gift' && c.from === 'works' && c.to === 'relay' && c.recipient === 'vesper');
    case 'funding': return game.hour >= 8 && at('relay').owner === 'vesper' && at('relay').drones >= 8 && !!game.funding?.some(f => f.from === 'you' && f.to === 'vesper')
      && !!replayTo(archive, 8, { rivals: false, knownThrough: game.hour }).funding?.some(f => f.from === 'you' && f.to === 'vesper');
    case 'combat-specialist': return captured && delivered('training-lieutenant');
    case 'route-combat': {
      if (!captured || !raid || !used(c => c.type === 'dispatch' && c.from === 'works' && c.to === 'relay')) return false;
      let won = false;
      traceReplayTo(archive, game.hour, { rivals: false, knownThrough: game.hour }, record => {
        if (record.type !== 'point' || record.phase !== 'route-contact') return;
        won ||= !record.game.fleets.some(f => f.id === raid.id) && record.game.fleets.some(f => f.owner === 'you' && f.lastContacts?.some(c => c.id === raid.id));
      });
      return won;
    }
    case 'global-abilities': return captured && has('home', 'training-general') && delivered('training-helmsman');
    case 'electrical-output': return game.hour >= 8 && activeUnits(game, 'you').some(u => u.kind === 'tinkerer') && droneInventory(game, 'you') >= 206 && used(c => c.type === 'hire' && c.kind === 'tinkerer');
    case 'mining-rate': return captured && at('home').miningInterval! <= 8 && game.cargo.you! >= 1;
    case 'losing-mine': return captured && at('relay').kind === 'mine' && game.cargo.vesper! <= 80;
    case 'losing-core': return game.eliminated.includes('vesper') && at('rival-home').owner === 'you' && used(c => c.type === 'dispatch' && c.to === 'rival-home');
    case 'disabling-shields': return !!raid && game.hour >= raid.arrives && at('relay').owner === 'vesper' && at('relay').drones >= 1 && used(c => c.type === 'shields' && c.rock === 'relay' && c.disabled);
    case 'captive-specialists': return at('relay').owner === 'vesper' && has('relay', 'training-captive') && used(c => c.type === 'release' && c.id === 'training-captive');
    case 'order-matters': return captured && delivered('training-infiltrator') && used(c => c.type === 'dispatch' && c.drones === 0 && !!c.specialists?.includes('training-infiltrator'));
    case 'fastest-route': return delivered('training-navigator') && delivered('training-smuggler') && used(c => c.type === 'dispatch' && c.from === 'home' && c.to === 'works');
    case 'against-the-odds': return defended && has('works', 'training-general') && has('home', 'training-helmsman');
    case 'test-of-character': return !!raid && game.hour >= raid.arrives && at('home').owner === 'vesper' && has('works', 'core-you', 'queen');
  }
}

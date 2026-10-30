/** Mission radio scripts. Dialogue follows assessed live progress, never an inspected forecast. */
import type { TrainingId } from './training';

export type DialogueSpeaker = 'commander' | 'enemy';
export type DialoguePhase = 'briefing' | 'underway' | 'passed' | 'failed';
export type DialogueLine = { speaker: DialogueSpeaker; text: string };
type MissionDialogue = Record<DialoguePhase, readonly DialogueLine[]>;
const commander = (text: string): DialogueLine => ({ speaker: 'commander', text });
const enemy = (text: string): DialogueLine => ({ speaker: 'enemy', text });

export const TRAINING_DIALOGUE: Record<TrainingId, MissionDialogue> = {
  'first-launch': {
    briefing: [
      commander('Welcome to the quiet belt, Captain. Vesper holds the far approach. Before we can push farther, we need a foothold at Quiet landing.'),
      enemy('Another captain hiding behind the admiral? There are four drones on that rock. Try not to lose your whole fleet taking it.'),
      commander('Launch from Foundry. Send enough to win with drones left over, and allow ten minutes to prepare. You have six hours. Make your first order count.'),
    ],
    underway: [enemy('The clock is running, Captain. Quiet landing is still a long way from being yours.')],
    passed: [enemy('A deserted rock and you call it a victory. Enjoy the view while it lasts.'), commander('Foothold secured. A small command, carried through. That is how we begin.')],
    failed: [enemy('Four drones. One rock. And somehow you made a mess of it.'), commander('We needed a surviving garrison before the deadline. Reset the exercise and check your numbers and travel time.')],
  },
  'shield-combat': {
    briefing: [
      commander('Vesper has fortified Quiet landing. Its shield grid protects eight defenders. We need that position open before our supply ships can pass.'),
      enemy('Ten points of shielding. Eight drones behind it. Come closer, Captain. I would love to see your arithmetic.'),
      commander('Shields absorb your drones before the garrison fights. Send more than eighteen from Foundry. We need survivors, not a heroic tie.'),
    ],
    underway: [enemy('My shields cost less than your mistakes. Think about that on the way in.')],
    passed: [enemy('Fine. You can count. Next time I will bring a bigger garrison.'), commander('The perimeter is broken. Always account for the shield grid before committing your fleet.')],
    failed: [enemy('You brought drones to a shield fight. Just not enough of them.'), commander('The position held. Review the shield strength, the defenders, and the deadline, then plan another attack.')],
  },
  'unit-transport': {
    briefing: [
      commander('Our thruster is needed at Foundry. Move it from Core berth alone. No drones, no other modules, and absolutely no intelligence core aboard.'),
      enemy('Your channels have gone quiet, Admiral. Moving something precious? I do enjoy guessing which ship to break.'),
      commander('Let Vesper guess. Select only the thruster in the manifest and set drones to zero. Keep the core at home. Six hours, Captain.'),
    ],
    underway: [enemy('All this empty space, and nowhere to hide forever. Keep your little secrets.')],
    passed: [enemy('A courier slipped through. Hardly a fleet to be proud of.'), commander('Thruster delivered. Core secure. Sometimes the right manifest matters more than the largest one.')],
    failed: [enemy('Something missing from your manifest, Captain? Or something you should have left at home?'), commander('The thruster must arrive alone, and the core must stay at Core berth. Reset and inspect every selected passenger.')],
  },
  'future-production': {
    briefing: [
      commander('Foundry is empty, but its first six drones will be ready at hour eight. Queue their launch before production, then take Quiet landing by hour ten.'),
      enemy('An empty factory and a promise. Is that the admiral’s grand strategy now?'),
      commander('Inspect hour eight and schedule the transfer there. Production happens before the queued launch. Give the order before hour eight, then advance the actual clock.'),
    ],
    underway: [enemy('Still waiting for tomorrow’s drones? I prefer fleets that exist.')],
    passed: [enemy('You sent them the moment they came off the line. Annoyingly punctual.'), commander('Production met the order, and the landing is ours. You can command tomorrow without waiting for it.')],
    failed: [enemy('Your grand future seems to have arrived without you.'), commander('Queue six drones before hour eight, for departure at hour eight. Then allow preparation and travel before the hour-ten deadline.')],
  },
  interception: {
    briefing: [
      commander('Incoming raid. Forty hostile drones are already heading for Core berth. Foundry has a interceptor and sixty drones. Stop that hauler before it reaches us.'),
      enemy('No need to come looking for me, Captain. My drones already have your core’s address.'),
      commander('Use Foundry’s Interceptor targets list to target the inbound hauler. The interceptor doubles your outbound speed. Bring enough drones to finish the job.'),
    ],
    underway: [enemy('Every minute you spend thinking is another minute my fleet spends closing on your core.')],
    passed: [enemy('You caught one raid. Do not expect the next one to be so polite.'), commander('Raid stopped. Core secure. You took the fight off our doorstep. That concludes this set of exercises, Captain.')],
    failed: [enemy('I told you where I was going. You still let me knock.'), commander('We needed an interception before the raid arrived. Reset, select the hostile hauler as the target, and check your drone strength.')],
  },
};

export function trainingDialoguePhase(status: 'active' | 'passed' | 'failed', hour: number): DialoguePhase {
  return status === 'active' ? hour > 0 ? 'underway' : 'briefing' : status;
}

/** Mission radio scripts. Dialogue follows assessed live progress, never an inspected forecast. */
import { TRAINING_SCENARIOS, type TrainingId } from './training';

export type DialogueSpeaker = 'commander' | 'enemy';
export type DialoguePhase = 'briefing' | 'underway' | 'passed' | 'failed';
export type DialogueLine = { speaker: DialogueSpeaker; text: string };
type MissionDialogue = Record<DialoguePhase, readonly DialogueLine[]>;
const commander = (text: string): DialogueLine => ({ speaker: 'commander', text });
const enemy = (text: string): DialogueLine => ({ speaker: 'enemy', text });

const originalDialogue: Partial<Record<TrainingId, MissionDialogue>> = {
  'first-launch': {
    briefing: [
      commander('Welcome to the quiet belt, Captain. Vesper holds the far approach. We need a foothold at Quiet landing. She also has our radio frequency. That part was not my decision.'),
      enemy('Vesper, since he skipped the introduction. Four old sentry drones on that site, Captain. I learned to fly dodging their guns. Do try to leave something for the scrap merchants.'),
      commander('She has had years to rehearse that. Launch from Foundry, send more than four drones, and allow ten minutes to prepare. Capture Quiet landing with survivors before hour six.'),
    ],
    underway: [enemy('Quiet landing. Whoever named it never landed there. Take your time with the numbers, Captain. Just remember the clock charges by the hour.')],
    passed: [enemy('A foothold, a few surviving drones, and no speech? You are already better company than the Admiral. Keep that channel open.'), commander('Foothold secured. Ignore her invitation. You allowed for the defenders, preparation, and travel, and left a garrison standing.')],
    failed: [enemy('Those sentries are older than your commission. I would offer you flying lessons, but I suspect the Admiral would stop paying for this channel.'), commander('We needed a surviving garrison before hour six. Reset and check your numbers and travel time. Her commentary is optional.')],
  },
  'shield-combat': {
    briefing: [
      commander('Vesper has fortified Quiet landing. Ten shield points protect eight defenders. We need that position open before our supply ships can pass.'),
      enemy('Eight drones, ten shield points, and a chair I hauled across half the belt. The chair stays. Admiral, I assume you have explained what happens to a fleet that forgets the shields?'),
      commander('I was getting to it. Shields absorb your drones before the garrison fights. Send more than eighteen from Foundry and capture the site with survivors before hour six. She can file a claim for the chair.'),
    ],
    underway: [enemy('I fitted that shield grid myself. Ugly wiring, excellent coverage. The Admiral would have spent the budget on matching uniforms.')],
    passed: [enemy('You broke my grid. I spent three shifts getting that thing to stop humming. If the chair survived, keep it out of the sun.'), commander('The perimeter is broken. She sounds more upset about the wiring than the garrison. Always count shields and defenders before committing your fleet.')],
    failed: [enemy('The grid holds. Hear that hum, Admiral? That is the sound of a sensible investment.'), commander('The position held. Count ten shield points plus eight defenders, then leave a margin for survivors. Reset and allow for preparation, travel, and the hour-six deadline.')],
  },
  'unit-transport': {
    briefing: [
      commander('Our thruster is needed at Foundry. Move it from Core berth alone. No drones, no other specialists, and absolutely no intelligence core aboard. Vesper listens for careless cargo talk.'),
      enemy('A thruster, is it? I flew couriers before I had a fleet, Captain. Nobody ever put the interesting cargo on the paperwork. What are you really carrying?'),
      commander('You can remain curious. Select only the thruster in the manifest and set drones to zero. Deliver it to Foundry before hour six, and keep the core at Core berth throughout.'),
    ],
    underway: [enemy('Back when I flew couriers, the manifest always said machine parts. Jewels, listening gear, somebody’s runaway heir. Such versatile things, machine parts.')],
    passed: [enemy('A thruster. You really did ship a thruster. I have wasted perfectly good suspicion on a delivery of machine parts.'), commander('Cargo delivered. Core secure. Let her complain. You chose the exact cargo the job required.')],
    failed: [enemy('You might want to read the cargo list again, Captain. I once signed for a crate without checking. Still have the scar.'), commander('The thruster must arrive alone before hour six, and the core must stay at Core berth throughout. Reset and inspect every selected passenger.')],
  },
  'future-production': {
    briefing: [
      commander('Foundry is empty, but its first six drones will be ready at hour eight. Queue their launch before production, then take Quiet landing by hour ten. Vesper thinks an empty factory buys her time.'),
      enemy('I checked the loading bays myself. Empty. Have you started paying crews in promises, Admiral? Mine insist on food. Very difficult people.'),
      commander('Then let us avoid keeping them waiting. Inspect hour eight and schedule six drones from Foundry to Quiet landing for that hour. Submit before hour eight. Production precedes the queued launch; advance the actual clock to carry it out.'),
    ],
    underway: [enemy('I used to know a foreman who swore by his production schedule. Slept with it under his pillow. I am beginning to see why you two would get along.')],
    passed: [enemy('Straight off the line and into my business. The paint cannot even be dry. I will have to start reading your factory schedules as well as your radio traffic.'), commander('Production met the order, and the landing is ours. A queued launch still needs preparation and travel. You left time for both.')],
    failed: [enemy('Lovely factory, Admiral. Shame about the shipping department. Shall I send someone over to run it?'), commander('We missed the planned capture. Before hour eight, queue six drones to depart at hour eight. Preparation and travel must fit before the hour-ten deadline.')],
  },
  interception: {
    briefing: [
      commander('Incoming raid. Vesper has forty drones heading for Core berth. Foundry has an interceptor and sixty drones. Stop that hauler before it reaches us.'),
      enemy('Enough listening. Forty drones, every engine serviced, every gun checked by me. I would rather you stepped aside, Captain. My quarrel with the Admiral predates your commission.'),
      commander('She can take it up with me after we secure the core. Use Foundry’s interception list to target the inbound hauler. The specialist doubles your outbound speed. Bring more than forty drones and intercept before the raid arrives.'),
    ],
    underway: [enemy('You have an interceptor. Of course you do. Helm, keep watching Foundry. The Captain has been listening.')],
    passed: [enemy('Forty drones. I knew the rattle in every engine. Well flown, Captain. Next time I hear your call sign, I will clear my schedule.'), commander('Raid stopped. Core secure. You earned her attention. I would have preferred a quieter graduation, but you are ready to command.')],
    failed: [enemy('A straight course, Captain. I gave you a straight course and you left it open. Tell the Admiral I am done waiting outside.'), commander('We needed an interception before the raid arrived. Reset, target the hostile hauler through Foundry’s interception list, and check your drone strength and arrival time.')],
  },
};

export const TRAINING_DIALOGUE = Object.fromEntries(TRAINING_SCENARIOS.map(scenario => [scenario.id, originalDialogue[scenario.id] ?? {
  briefing: [commander(scenario.instruction), enemy('You have your orders, Captain. Let us see whether they survive contact.'), commander(`${scenario.objective} You have ${scenario.deadline} hours. Time stays paused until you advance it.`)],
  underway: [enemy('The clock is running. Your plan still has to reach its destination.')],
  passed: [enemy('This position is settled. The next one will be harder.'), commander(`Exercise complete: ${scenario.title.toLowerCase()}. ${scenario.objective}`)],
  failed: [enemy('A plan is only as good as its outcome, Captain.'), commander(`Reset the exercise and try again. ${scenario.hints[0] ?? scenario.objective}`)],
}])) as Record<TrainingId, MissionDialogue>;

export function trainingDialoguePhase(status: 'active' | 'passed' | 'failed', hour: number): DialoguePhase {
  return status === 'active' ? hour > 0 ? 'underway' : 'briefing' : status;
}

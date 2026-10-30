# Subterfuge tutorial coverage

Tracked in [#101](https://github.com/mcclowes/machination/issues/101). Practice now contains 28 exercises: a playable counterpart for every entry in the 24-mission [community puzzle catalog](https://subterfuge.fandom.com/wiki/Puzzles), plus four existing supplementary exercises. This is lesson coverage, not verified replication of the original missions. Original coordinates, inventories, deadlines, scripted orders, victory predicates, and progression gates remain unverified.

The catalog establishes mission names and order. The official [rulebook](https://subterfuge-game.com/rulebook/index.html) and [specialist reference](https://subterfuge-game.com/rulebook/Specialists.html) establish the corresponding mechanics. Several individual mission pages were inaccessible during this audit. The [Combat 4 description](https://subterfuge.fandom.com/wiki/Combat_4) specifically confirms scheduling an onward attack before a supply hauler arrives. The other counterparts use the catalog’s named subject and Machination’s ordinary rules; that evidence does not establish identical puzzles.

| Original mission | Original title | Machination exercise ID | Assessed lesson |
| --- | --- | --- | --- |
| Combat 1 | Launching a Sub | `first-launch` | Launch and capture with survivors |
| Combat 2 | Joint Attack | `joint-attack` | Combine attacks from two sites |
| Combat 3 | Reinforcements | `reinforcements` | Reinforce before an incoming raid |
| Combat 4 | Scheduled Orders | `scheduled-arrival` | Queue an onward attack before incoming supply arrives |
| Specialists 1 | The Factory | `factory-specialist` | Move a production specialist to a factory |
| Specialists 2 | Hiring Specialists | `hiring-specialists` | Recruit with an earned credit and available cargo |
| Specialists 3 | Combat Priority | `combat-priority` | Kill an opposing specialist before its damage phase |
| Specialists 4 | Promotion | `promotion` | Promote before attacking a stronger garrison |
| Winning 1 | Drilling Mines | `drilling-mines` | Construct a mine and extract cargo |
| Diplomacy 1 | The Gift | `the-gift` | Deliver drones without attacking the recipient |
| Diplomacy 2 | Funding | `funding` | Sustain funding through the recipient’s production cycle |
| Combat 5 | A Specialist | `combat-specialist` | Win with a combat specialist’s local damage |
| Combat 6 | Sub to Sub Combat | `route-combat` | Win a real route encounter, then capture its source |
| Specialists 5 | Global Abilities | `global-abilities` | Apply a remote specialist’s combat bonus |
| Specialists 6 | Electrical Output | `electrical-output` | Raise power capacity to permit production |
| Winning 2 | Mining Rate | `mining-rate` | Capture territory to accelerate extraction |
| Winning 3 | Losing a Mine | `losing-mine` | Capture a mine and reduce its former owner’s cargo |
| Winning 4 | Losing a Queen | `losing-core` | Capture the only enemy core and eliminate its owner |
| Diplomacy 3 | Disabling Shields | `disabling-shields` | Disable shields to permit a peaceful site handover |
| Diplomacy 4 | Captives Specialists | `captive-specialists` | Release a captive and complete its return journey |
| Advanced 1 | Order Matters | `order-matters` | Send a shield-removal wave before the drone attack |
| Advanced 2 | The Fastest Way From A to B | `fastest-route` | Beat direct travel using a fast friendly-site leg |
| Advanced 3 | Against All Odds | `against-the-odds` | Defend without shields against local ability suppression |
| Kobayashi Maru | A Test of Character | `test-of-character` | Evacuate the core before losing the starting site |

## Adaptations and remaining fidelity work

All maps, quantities, dialogue, and deadlines are original Machination content. Specialist names come from the shared catalog. The worlds use current mining mechanics, stationary sites, and no rival automation. Construction exercises explicitly start without a drilled mine; recruitment exercises supply five cargo for the current hiring fee. These starting conditions are intentional teaching fixtures, rather than ordinary new-game allocations.

Advanced 1 and 2 are provisional interpretations of their catalog titles. Their original ability combinations and required order sequences have not been established. The final mission is also provisional: evacuation is a playable interpretation of an overwhelming-force test, not a verified reconstruction of Subterfuge’s final objective. Keep #101 open until those objectives and the other original baselines can be checked against recordings or the game.

The community [Advanced 3 page](https://subterfuge.fandom.com/wiki/Advanced_3) reports that the original became unwinnable when the Infiltrator changed to remove all shields. Our counterpart starts with shields disabled and uses a remote global damage bonus against an Elder-led raid. It remains solvable under the current rules. Putting an Elder and Infiltrator together would suppress the Infiltrator too, so this counterpart does not pretend that combination pierces shields.

The existing `shield-combat`, `unit-transport`, `future-production`, and `interception` IDs remain available after the main catalog. Their completion marks retain the existing storage key and content version. Future-production scheduling and Pirate interception remain supplementary; neither substitutes for the distinct arrival-scheduling and ordinary route-combat lessons.

## Verification contract

`src/game/training-missions.test.ts` drives every added mission through public replay commands and the shared local lifecycle. It checks passing solutions, idle failure, core loss, deadlines, deterministic retries, detached attempts, save/replay validation, reconstruction, split advancement, and stopping at the first actual result. Negative plans exercise insufficient forces, missing specialists, wrong priority, reversed arrival order, direct travel, unmarked attacks, withdrawn funding, and wrong destinations. Canceled scheduling and a raid that merely reaches a station cannot supply completion proof.

`src/game/training-progress.test.ts` checks that existing completion records accept new mission IDs. `visual-tests/tutorial-missions.spec.ts` checks catalog access and a complete recruitment lesson through browser controls at desktop and phone viewport sizes. These checks establish Machination behavior; they do not verify original Subterfuge layouts or physical-device gestures.

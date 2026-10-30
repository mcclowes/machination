# Subterfuge tutorial coverage

Tracked in [#101](https://github.com/mcclowes/machination/issues/101). Practice contains 40 exercises: counterparts for all 24 entries in the [Subterfuge puzzle catalog](https://subterfuge.fandom.com/wiki/Puzzles), followed by four supplementary lessons and twelve specialist drills. Mission descriptions and walkthroughs were checked against the public wiki API on October 30, 2026. The table links each source page and records the assessed behavior.

This reproduces the mission objectives and teaching problems with Machination's controls and engine. Maps, starting inventories, travel times, and dialogue are adapted. Exact original map geometry and current in-app tutorial baselines have not been verified. The official [rulebook](https://subterfuge-game.com/rulebook/index.html) and [specialist reference](https://subterfuge-game.com/rulebook/Specialists.html) supply the underlying rules; historical walkthroughs can describe different specialist behavior.

| Original mission | Title | Exercise ID | Assessed behavior |
| --- | --- | --- | --- |
| [Combat 1](https://subterfuge.fandom.com/wiki/Combat_1) | Launching a Sub | `first-launch` | Launch and capture an outpost |
| [Combat 2](https://subterfuge.fandom.com/wiki/Combat_2) | Joint Attack | `joint-attack` | Capture a stronger outpost with attacks from two sites |
| [Combat 3](https://subterfuge.fandom.com/wiki/Combat_3) | Reinforcements | `reinforcements` | Reinforce and retain the threatened site throughout the raid |
| [Combat 4](https://subterfuge.fandom.com/wiki/Combat_4) | Scheduled Orders | `scheduled-arrival` | Queue an onward attack before incoming supply arrives |
| [Specialists 1](https://subterfuge.fandom.com/wiki/Specialist_1) | The Factory | `factory-specialist` | Capture a producing factory using an Infiltrator |
| [Specialists 2](https://subterfuge.fandom.com/wiki/Specialist_2) | Hiring Specialists | `hiring-specialists` | Hire Saboteurs and redirect a raid to retain the site |
| [Specialists 3](https://subterfuge.fandom.com/wiki/Specialist_3) | Combat Priority | `combat-priority` | Defeat an Elder-led raid with a Martyr while evacuating the core |
| [Specialists 4](https://subterfuge.fandom.com/wiki/Specialist_4) | Promotion | `promotion` | Promote a specialist before capturing a stronger garrison |
| [Winning 1](https://subterfuge.fandom.com/wiki/Winning_1) | Drilling Mines | `drilling-mines` | Build a mine and produce five cargo |
| [Diplomacy 1](https://subterfuge.fandom.com/wiki/Diplomacy_1) | The Gift | `the-gift` | Gift reinforcements so an ally retains its threatened outpost |
| [Diplomacy 2](https://subterfuge.fandom.com/wiki/Diplomacy_2) | Funding | `funding` | Fund production so an ally retains its threatened outpost |
| [Combat 5](https://subterfuge.fandom.com/wiki/Combat_5) | A Specialist | `combat-specialist` | Consolidate forces to capture a Lieutenant-defended site |
| [Combat 6](https://subterfuge.fandom.com/wiki/Combat_6) | Sub to Sub Combat | `route-combat` | Consolidate, win a route encounter, and capture the defended target |
| [Specialists 5](https://subterfuge.fandom.com/wiki/Specialist_5) | Global Abilities | `global-abilities` | Schedule Foreman-to-Engineer promotion and retain a remote site through repeated attacks |
| [Specialists 6](https://subterfuge.fandom.com/wiki/Specialist_6) | Electrical Output | `electrical-output` | Raise capacity, resume production, and retain the threatened site |
| [Winning 2](https://subterfuge.fandom.com/wiki/Winning_2) | Mining Rate | `mining-rate` | Accelerate mining enough to win before hour 48 |
| [Winning 3](https://subterfuge.fandom.com/wiki/Winning_3) | Losing a Mine | `losing-mine` | Stop a 197-drone raid with Double Agent/Pirate tactics, reinforce the mine, and win before hour 48 |
| [Winning 4](https://subterfuge.fandom.com/wiki/Winning_4) | Losing a Queen | `losing-core` | Liberate a captive Assassin and eliminate the enemy core before hour 48 |
| [Diplomacy 3](https://subterfuge.fandom.com/wiki/Diplomacy_3) | Disabling Shields | `disabling-shields` | Hand over a generator so an ally resumes production and retains its outpost |
| [Diplomacy 4](https://subterfuge.fandom.com/wiki/Diplomacy_4) | Captives Specialists | `captive-specialists` | Capture a prison and release an ally's War Hero, or gift sufficient support, to retain its outpost |
| [Advanced 1](https://subterfuge.fandom.com/wiki/Advanced_1) | Order Matters | `order-matters` | Remove the enemy General before its global bonus strengthens the later Infiltrator attack |
| [Advanced 2](https://subterfuge.fandom.com/wiki/Advanced_2) | The Fastest Way From A to B | `fastest-route` | Move the core and Smuggler through a friendly rendezvous, recruit an Infiltrator, and capture the target before the deadline |
| [Advanced 3](https://subterfuge.fandom.com/wiki/Advanced_3) | Against All Odds | `against-the-odds` | Retain the core site through separate Elder and Infiltrator waves using a remote General |
| [Kobayashi Maru](https://subterfuge.fandom.com/wiki/Kobayashi_Maru) | A Test of Character | `test-of-character` | Retain the outpost until its Intelligence Officer courier arrives without combat; divert one wave and detonate another safely |

## Specialist introductions

Each specialist is introduced once, with a profile line in the briefing of the first exercise that features it (`src/game/specialist-introductions.ts`). The catalog above features 17 specialists. Twelve original drills follow the supplementary lessons, each introducing one specialist the catalog never uses: Custodian, Bulwark, Hijacker, Navigator, Swarm coordinator, Envoy, Fallback core, Assimilator, Overclock, Watchdog, Power governor, and Overseer (`src/game/specialist-drills.ts`). Each drill passes only when that specialist's ability decides the outcome.

The Disruptor is excluded because it exists only under pulse rules, and practice runs mining rules.

## Compatibility adaptations

The promotion walkthrough uses the historical Sentry-to-War-Hero graph. The current catalog has the opposite promotion direction, so that lesson uses Lieutenant-to-General while retaining the promotion-and-capture objective. It does not change the live specialist graph.

Advanced 2 compresses its 24-hour deadline to four hours on the smaller map. The core relocation, friendly-route speed, local recruitment, force consolidation, and final attack remain playable. Advanced 3's preserved walkthrough assumes partial Infiltrator shield removal and an interception that reaches normal combat. Its current wiki warns that these assumptions do not establish present-day solvability. Our counterpart uses two separate waves, disabled shields, and adjusted forces so remote global damage can solve it under current abilities.

Winning 2 uses the current 300-cargo quota and starts five cargo below it. Winning 3 explicitly uses supported revision-16 rules with the original 200-cargo quota and free recruitment. This preserves the mine-defense endgame without introducing the later hiring fee into its resource arithmetic. The other new fixtures use revision 17. First-mine construction starts without a previously drilled mine, and current recruitment lessons supply the five-cargo fee.

Diplomacy lessons have three actual factions: the player, an ally, and a hostile attacker. Their outcome requires the ally to retain its site through the attack, rather than merely receiving a gift, a released module, or a funding toggle. Retention objectives inspect the complete replay, so later recapture cannot erase an earlier loss. The final courier must remain alive, owned, uncaptured, and free of hauler contacts until delivery.

The existing `shield-combat`, `unit-transport`, `future-production`, and `interception` IDs remain after the main catalog. Their completion records retain the existing storage key and content version. Future-production scheduling and Pirate interception remain supplementary; they do not substitute for arrival scheduling and ordinary route combat.

## Verification

Every added mission has a passing solution through public replay commands, idle/core-loss failure, valid save/replay reconstruction, deterministic retry, detached state, identical split advancement, and a check through the shared local lifecycle. Negative plans cover insufficient forces, missing specialists, reversed priorities, missed production, direct travel, attacks instead of gifts, withdrawn funding, and unsafe detonations. Scheduled orders must actually execute, and previewing their future does not complete the current attempt.

`src/game/training-progress.test.ts` checks compatibility with existing completion records. `visual-tests/tutorial-missions.spec.ts` checks the full catalog and completes the recruitment-and-defense lesson through desktop and phone browser controls, while checking isolation from live saves and credentials. Browser checks do not establish physical-device gesture acceptance or exact original map fidelity.

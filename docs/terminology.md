# Terminology

Use one name per gameplay concept across controls, accessibility labels, dialogue, telemetry display, the manual, and the player guide. Keep instructions literal; let machine identities and industrial language carry the setting.

## Preferred vocabulary

| Concept | Use | Guidance |
| --- | --- | --- |
| Player’s machine mind | Intelligence | Use player for the human, account, seat, or setup choice. |
| One game | Operation | Solo operation, multiplayer operation, or practice exercise. |
| Selectable chart location | Site | Use controlled site, friendly site, or enemy site. Rock and outpost are historical labels. |
| Structure at a site | Installation | A factory, reactor, or mine. A site and its installation are different concepts. |
| Drone production | Factory | Produces drones in cycles. |
| Power installation | Reactor | Raises drone capacity. The saved kind remains `generator`. |
| Maximum supported drones | Drone capacity | Counts stationed and traveling drones. Explain reactors as its power supply. |
| Resource production | Mine | Drill a mine; mining or extraction describes its activity. |
| Ordinary combatant | Drone | Garrison means drones stationed at a site. |
| Transport | Hauler | Avoid ship or fleet as competing labels in controls. Fleet remains an internal identifier. |
| Loaded contents | Manifest | Drones, specialists, and legacy modules explicitly assigned to a hauler. |
| Movable ability-bearing machine | Specialist | Recruit, load, promote, capture, or release a specialist. Unit is generic; module belongs to version one. |
| Leadership specialist | Intelligence core | Core after introduction. Fallback core is a separate role. |
| Pulse-mode leadership | King | The intelligence core in King’s Pulse. Overclock is a separate specialist. |
| Mined resource | Cargo | Used in mining and domination, including hiring and funding eligibility. |
| Same resource in King’s Pulse | Pulse material | Use in balance, cost, recruitment, and funding labels. Capitalize only at the start of a sentence or label. |
| Recruitment currency | Hiring credit | Credit after introduction. Avoid time credit. |
| Visibility | Sensors, sensor range, sensor coverage | Avoid sonar. Range is a distance; coverage is the visible area. |
| Map | Chart | Use chart units for distances. Asteroid base describes a drifting site, rather than every site. |
| Future inspection | Time Machine | Established feature name. A forecast is conditional and does not advance live time. |
| Future command | Scheduled order | Schedule an order; queue is the list or the verb. Preparing launch means an order has begun reserving its manifest. |

Use the approved specialist names from [#100](https://github.com/mcclowes/machination/issues/100). Name Subterfuge counterparts explicitly as references, so Queen, King, and Revered Elder cannot be mistaken for current specialist names.

Intelligence describes a participant’s machine mind. Faction describes persistent membership in the faction system; team describes the operation’s fixed victory group. These are separate concepts.

## Compatibility and legacy rules

Player-facing labels live in `src/content/terminology.ts` where raw values need translation. Keep saved kind IDs, API fields, command types, recruitment identities, and replay fixtures unchanged. Translate canonical telemetry for display; never rewrite stored events to update vocabulary. Preserve location names and named identities.

Version-one operations retain drone-built modules and a drone-producing **legacy reactor**. They do not acquire current specialist or reactor mechanics through a label change. Keep module where the action concerns that legacy device, including occupied module bays.

Use sentence case, US English, and concrete verbs. The player glossary defines the concepts; the shared field manual and specialist catalog supply generated guide references. Update those sources when changing terminology, then regenerate and build the guide.

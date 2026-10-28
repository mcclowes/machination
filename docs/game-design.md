# Machination

A slow strategy game about rival intelligences operating mining concerns in the asteroid belt. Their corporations are too distant to interfere. Players negotiate as machines; betrayal can be delivered as a routine change in policy.

## Vocabulary

| Concept | Machination |
| --- | --- |
| Player | Intelligence |
| Outpost | Rock |
| Submarine | Hauler |
| Driller | Drone |
| Generator | Reactor |
| Queen | Core |
| Victory resource | Cargo, commodity deliberately unspecified |
| Specialist | Module or unusual unit |

The Director can become the corporate authority in flavor text. The core is the vulnerable operational entity on the map.

## First playable

Three intelligences begin with a core and a second rock. Cores and reactors create four drones per hour; mines produce two cargo per hour. Reach 300 cargo or eliminate both rival cores to win.

Transfers immediately reserve a positive integer number of drones. Transit takes one hour per eight map units, rounded up, with a minimum of one hour. Ordinary transfers cannot turn back; interception missions return after contact. This is a fixed-chart travel approximation; moving orbits, launch windows, and fuel are outside the current simulation.

At arrival, friendly drones reinforce. Hostile drones cancel defenders one for one. A positive attacker surplus acquires the rock. A tie leaves the existing owner with zero defenders. Drone production can create fractional inventories between ticks; orders can only use whole drones.

Capturing a core eliminates its original intelligence, neutralizes its remaining rocks, and removes its haulers. The captured core becomes an ordinary production site. Simultaneous arrivals resolve in launch sequence. Arrivals resolve before victory checks and rival orders at the same timestamp.

Rivals decide every six hours. They retain 35% of their strongest eligible garrison and send the remainder toward the nearest affordable enemy or unclaimed rock. This AI has full map information.

The forecast runs the same simulation on a copy. It includes known orders and deterministic rival decisions, assumes no further human orders, and cannot issue orders. Local saves resume elapsed wall-clock time. The +6h control accelerates the solo operation.

## Product direction

The defining feature should be human diplomacy under long travel commitments. AI opponents establish a playable loop but cannot validate that experience. Keep the first online version small: invite-only games, server-owned time, private bilateral messages, and a readable order history.

Potential module mappings: scavenger rig, routing daemon, conversion virus, and self-destruct charge. The initial playable rules are specified below; further balancing needs human playtests.

## Release milestones

1. Local vertical slice: simulation, command map, forecast, persistence, and basic rival AI.
2. Multiplayer: invite-only authoritative service, seat identity, invitations, order authorization, and reconnect synchronization are implemented for local playtests. Public hosting and account recovery remain.
3. Diplomacy: private bilateral messages are implemented. Alliances, gifts, group channels, and push notifications remain.
4. Strategic depth: modules and server-filtered sensor visibility are implemented. Scheduled transfers are implemented. Moving-hauler interception is implemented. Map generation and balance sessions remain.
5. Mobile release: physical-device testing, accessible controls, onboarding, native icons, signing, privacy disclosures, and store submissions.

Use original assets, writing, and implementation. The design takes inspiration from slow multiplayer strategy; it doesn't use Subterfuge assets or code.

## Modules

Modules are built at a controlled rock by spending its drones. A rock has one module bay. Building is forbidden after elimination or game end. Modules must be explicitly loaded onto a hauler; loading vacates the departure bay. All haulers still require at least one drone.

| Module | Cost | Effect while carried |
| --- | --- | --- |
| Routing daemon | 24 drones | Travel speed ×1.5; the final transit duration is rounded up to whole hours, minimum one hour |
| Conversion virus | 36 drones | Before hostile combat, converts floor(20% of defenders), capped at 20, from defenders to attackers |
| Scavenger rig | 28 drones | Can intercept enemy haulers; after winning combat, restores floor(25% of its drones lost) |
| Self-destruct charge | 20 drones | On hostile contact, consumes the entire hauler and destroys up to twice its payload in defending drones; does not change rock ownership or destroy a core |

Routing, virus, and scavenger modules survive a winning attack and occupy the acquired rock's bay. A losing or tied attack destroys the carried module. Parked modules have no combat effect and are destroyed when their rock is captured. Friendly arrivals unload their module if the bay is free; if occupied, the incoming module is scrapped without refund. Friendly delivery never detonates a charge. The charge doesn't damage parked modules.

Simultaneous arrivals resolve by launch sequence, including module effects. A charge arriving before a normal hauler can clear a garrison for that second hauler to claim. Defenders still produce drones until arrival, so a charge can't guarantee a later capture.

These are initial Machination balance rules. The scavenger rig combines interception with combat salvage. The charge's limited blast differs from the remake's destructive Martyr behavior. The core and module identities follow the proposed theme without importing the remake's full specialist catalog.


## Sensor visibility

Online intelligence comes from owned rocks (32 map units) and haulers (16 map units). Public chart locations remain targetable, but remote ownership, garrisons, modules, and enemy haulers are withheld by the server. Players know only their own cargo totals; elimination and contract completion are public broadcasts.

Combat participants and observers retain event telemetry; discovering a rock doesn't reveal its earlier hidden history. This creates a reason to scout, exchange information, and negotiate. The online forecast uses only observations and marks arrivals at unobserved destinations as unresolved. It never assumes an unknown garrison is empty. See multiplayer.md for the exact response contract and legacy handling.

## Scheduled transfers

Players can queue up to 20 private transfers, each up to seven days ahead. Plans don't reserve drones and may use production or friendly reinforcements that will arrive before the launch. A carried module is pinned to the selected module type; if it leaves the departure bay, the plan fails unless a matching module is there at execution.

At each event timestamp, production settles first, interceptions resolve by launch sequence, then station arrivals resolve by launch sequence, and quota/core victory is checked. If the game is still active, due plans execute in submission order, followed by solo rival AI decisions. A plan either launches its full manifest or aborts once with private telemetry. It never sends a partial fleet or automatically retries later. Ownership is checked before inspecting a lost rock's module bay. Core elimination removes that intelligence's future plans; game completion removes every remaining plan.

Cancellation is allowed only before execution. The server catches up to its current clock before processing cancellation, so a delayed cancel cannot undo a launch that has already happened. Queued plans and their cancellation logs are visible only to their owner. Launching produces the normal sensor-visible activity.

Whole inventories within 1e-9 units are normalized after production to prevent fractional polling intervals from leaving floating-point dust at an exact launch threshold. Other fractional inventories remain intact. This is threshold stabilization, not a conversion of the whole economy to fixed-point arithmetic.

## Interception

A scavenger rig can launch immediately from an owned rock against a reachable enemy hauler. Online targets must be in current sensor contact. Solo training exposes the full map. The drone manifest and rig leave the rock together; interception cannot be queued.

The rig travels at eight map units per hour to the earliest continuous rendezvous on the target's current leg. It must arrive before that leg ends. At contact, equal forces destroy each other. A surviving attacking rig salvages its losses and returns to its departure rock. A defending scavenger that wins also salvages and returns home; other surviving defenders continue their existing leg. A defending virus converts attacking drones before combat, and a defending charge detonates against the rig.

If the target disappears or changes course away from the committed meeting point, the rig returns without combat. Return transit rounds up to whole hours, with a minimum of one hour. Returning to a captured home triggers normal hostile arrival rules. Interceptions settle before station arrivals at the same timestamp. Approach and return geometry persist in saves and drive both sensors and map rendering.

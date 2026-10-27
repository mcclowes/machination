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

Transfers immediately reserve a positive integer number of drones. Transit takes one hour per eight map units, rounded up, with a minimum of one hour. Haulers cannot turn back. This is a fixed-chart travel approximation; moving orbits, launch windows, and fuel are outside the current simulation.

At arrival, friendly drones reinforce. Hostile drones cancel defenders one for one. A positive attacker surplus acquires the rock. A tie leaves the existing owner with zero defenders. Drone production can create fractional inventories between ticks; orders can only use whole drones.

Capturing a core eliminates its original intelligence, neutralizes its remaining rocks, and removes its haulers. The captured core becomes an ordinary production site. Simultaneous arrivals resolve in launch sequence. Arrivals resolve before victory checks and rival orders at the same timestamp.

Rivals decide every six hours. They retain 35% of their strongest eligible garrison and send the remainder toward the nearest affordable enemy or unclaimed rock. This AI has full map information.

The forecast runs the same simulation on a copy. It includes known orders and deterministic rival decisions, assumes no further human orders, and cannot issue orders. Local saves resume elapsed wall-clock time. The +6h control accelerates the solo operation.

## Product direction

The defining feature should be human diplomacy under long travel commitments. AI opponents establish a playable loop but cannot validate that experience. Keep the first online version small: invite-only games, server-owned time, private bilateral messages, and a readable order history.

Potential module mappings: scavenger rig, routing daemon, conversion virus, and self-destruct charge. Modules need balance rules before implementation.

## Release milestones

1. Local vertical slice: simulation, command map, forecast, persistence, and basic rival AI.
2. Multiplayer: invite-only authoritative service, seat identity, invitations, order authorization, and reconnect synchronization are implemented for local playtests. Public hosting and account recovery remain.
3. Diplomacy: private bilateral messages are implemented. Alliances, gifts, group channels, and push notifications remain.
4. Strategic depth: fog of war, modules, scheduled orders, map generation, and balance sessions.
5. Mobile release: physical-device testing, accessible controls, onboarding, native icons, signing, privacy disclosures, and store submissions.

Use original assets, writing, and implementation. The design takes inspiration from slow multiplayer strategy; it doesn't use Subterfuge assets or code.

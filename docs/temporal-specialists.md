# Temporal specialists

Implementation reference for [#116](https://github.com/mcclowes/machination/issues/116), following the proposal in [#96](https://github.com/mcclowes/machination/issues/96). New operations use mechanics revision 18. Earlier operations keep their recruitment decks and recorded mechanics.

Dilation promotes to Anchor. Hastener is an attack hire; Dilation and Foresight are defense hires; Overclock and Hindsight are other hires. Hire and promotion costs follow the existing recruitment rules. The former combat specialist named Overclock is now **Siege controller**; its King behavior and persisted event identity are unchanged.

## Dilation

A stationed Dilation halves friendly and hostile hauler speed within its controlled site's sensor range. Fields don't stack. Entering, leaving, capturing, or removing a field changes remaining travel without recalculating completed progress. Preparing haulers begin moving at their departure boundary.

This buys warning time but delays your own reinforcements, retreats, and specialist deliveries. It affects interception travel too; a slowed target or pursuer can miss a previously committed rendezvous. Field crossings account for drifting sites, toroidal charts, and opening acceleration. Pulse propagation, production, and queued order timestamps keep their ordinary clocks.

## Anchor

Activate a docked Anchor from the specialist panel or its site. Stasis lasts two game hours. Both the specialist and the site have a twelve-hour cooldown, preventing several Anchors from keeping one site frozen indefinitely. Activation can also be scheduled from the Time Machine.

During stasis:

- Local factory output, mining, reactor depletion, shield recharge, timed specialist actions, and King and Disruptor charging pause.
- Preparing departures return their manifests to the site. New departures, hiring, promotion, release, construction, shield changes, and charge/fire commands at the site are refused.
- Remote Envoy rescues wait until the prison site's stasis lifts.
- Friendly and hostile haulers reaching the site wait without docking or resolving site combat. On thaw, they resolve in the existing launch-ID order. Held haulers follow a drifting site's position, cannot reroute, and don't participate in transit combat or receive additional engine delays.
- Already-emitted pulses continue to propagate and can damage the site. Stasis provides no pulse immunity; shield energy can still drain under exposure.

Local work resumes from its remaining progress, without catch-up output. Queued local actions use their usual execution-time validation and abort privately if they execute during stasis. Queued launches aren't teleported to their destination.

Anchor buys time to stage reinforcements nearby. They can't enter during the freeze, and the delayed enemy attack still resolves when it lifts. The normal arrival ordering remains relevant when both sides are waiting.

## Overclock

Activate a docked Overclock at a controlled factory. For four game hours, local production cycles run twice as fast. The following four game hours produce nothing there. Drones per cycle and fleet capacity limits are unchanged. Opening acceleration and existing industrial speed bonuses still apply.

The loan belongs to the site. Moving, losing, capturing, or promoting the specialist doesn't remove repayment, and another Overclock can't open a second loan there until it ends. Converting the site into a mine retains the loan clock; it gives no mining bonus. Destruction removes the factory's ability to produce. Anchor pauses both the loan phases and local production progress.

The boost and repayment deadlines are visible at an observed site and in specialist management. After repayment, the remaining factory cycle resumes without catch-up output. An Overclock used at full capacity can waste its benefit while retaining its debt.

This implements the power-for-time idea as borrowed production. Power remains fleet capacity; this release adds no consumable energy reserve or separate accelerator.

## Hindsight

A stationed Hindsight records successful enemy actions originating within twice its site's sensor range, including launches outside ordinary coverage. Reports arrive two game hours later. Scheduling a future action doesn't reveal that private plan; the executed action can be discovered later.

Each report retains the original action hour and a separate discovery hour. Historical gameplay remains read-only, and replaying what the player knew before discovery doesn't reveal the later report. Public shared replays can retain the disclosed report without exposing the private pending ledger.

Only an action description is revealed, not the enemy's complete historical state or current queue. Information can already be stale when it arrives. Coverage is checked when the action occurs, so hiring Hindsight doesn't expose earlier history. Each observer retains up to 80 pending discoveries, matching the existing recent-telemetry limit.

## Foresight

An active Foresight warns when the current committed simulation would kill one of your active specialists within 24 game hours. It considers enemy private orders and already-launched haulers. A warning identifies the threatened specialist, predicted death time, and relevant hostile transfer or encounter, while leaving unrelated orders private. Capture alone isn't death.

Predictions refresh after player commands and at simulation event boundaries, including hourly horizon checks. Canceling or changing a lethal plan withdraws its current prediction. Earlier warning events remain part of the historical record. The specialist panel shows the current warnings and opens the threatened unit's location. Speculative forecasts retain disclosed warnings without generating new private intelligence.

Warnings are conditional on committed plans. They grant information without immunity, and say nothing about attacks the opponent hasn't ordered. Live actions that kill immediately have no guaranteed response interval. Foresight doesn't introduce a new attack delay or change command commitment rules.

## Hastener

On hostile arrival, a Hastener pulls the defending site's pending outbound transfer orders forward after that arrival's combat, provided the defender still controls the site. It triggers even if the Hastener is captured. Requiring survival would make a sacrificial scouting delivery ineffective.

The post-combat trigger preserves the existing ten-minute preparation window: launches preparing before combat otherwise return their drones to defend. A follow-up strike after the forced departure can exploit the stripped defense; arriving during preparation still allows those drones to defend normally.

Eligible orders are snapshotted once and executed in existing queue order against present resources. An early failure consumes that order and logs a private abort; no drones are borrowed from future production. There is no recursive queue pull. This arrival effect runs outside the ordered combat ability phase. Gifts, interceptions, recruitment, shield changes, and other action types keep their scheduled times.

An empty queue gives it nothing to pull forward. It can accelerate a useful enemy reinforcement or escape, so reading the opponent's plans matters. The ability reveals no unrelated queue contents.

## Commands, persistence, and verification

The existing specialist command accepts `activate` with a scoped specialist identity. The server validates control, ownership, captivity, cooldown, site type, operation revision, and retry receipts. The same action can be scheduled, and the canonical private replay command is `activate`. Clients cannot supply duration, speed, or production multipliers.

Temporal clocks, held arrivals, cooldowns, production loans, delayed discoveries, and death warnings are validated on save loading. Shared replay projection includes disclosed site effects and intelligence, with fresh export identities and no pending private ledger. Earlier operation decks exclude all six temporal kinds.

Behavioral coverage lives beside the engine, specialist panels, service, and replay code. See the implementation issue for the final checks and their limits. Numerical balance remains provisional pending multiplayer playtests.

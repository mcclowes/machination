# Disruptor

Implementation and gameplay reference for [#90](https://github.com/mcclowes/machination/issues/90), alongside [King’s Pulse](kings-pulse.md).

New pulse operations use mechanics revision 16. The Disruptor joins the attack recruitment deck. Revision-15 pulse saves, older recruitment decks, mining operations, and domination operations retain their recorded rules.

## Material and charging

A stationed Disruptor commits 10–25 integer units from the same mined Pulse Material reserve used by the King. It charges for 0.5 game hours, unaffected by opening acceleration, and fires automatically. Canceling, movement into launch preparation, capture, source destruction, or faction elimination cancels the unfinished charge without a refund. Orders and retries use the existing authoritative pulse endpoint and private command archive.

After launch, the finite wave has a fixed origin and survives movement, capture, or destruction of its source. It travels at eight chart units/hour. Launched waves are public telemetry; charge orders, command receipts, source identities, and unseen hit records remain private. An operation’s terminal outcome still stops its simulation.

## Attenuation and effects

Strength is `material × 5 − distance × 0.9`, floored at zero. A 20-material pulse reaches distance 50 with strength 55. The ring fades as strength falls and disappears at zero. This is a single passing wavefront: remaining behind it causes no further effects, and each site or hauler can be hit only once per wave. Geometry includes asteroid drift, moving haulers, and toroidal chart images.

| Arrival strength | Effect |
| --- | --- |
| Below 20 | No disruption |
| 20 to below 60 | Local sensor range halved for one hour |
| 60 or above | Sensor jam, one-hour mining and engine outages, and 25 pulse shield energy lost at sites |
| 60 or above at a charging or ready King | Charge and committed material lost; King returns to idle |
| 60 or above at a firing King | Strategic propagation runs at half speed for one hour; emission continues |

A King affected by a charge reset or wave slowdown gets six hours of resistance to either effect. Further hits during resistance do not stack slowdowns or extend resistance. Other asset disruption can still occur. A restarted King can complete its normal six-hour charge during that interval. Very precisely timed arrivals at resistance expiry remain a threat.

Tactical pulses spare their own faction. Every other faction is hostile, including funding partners. Tactical effects never directly remove drones, specialists, sites, or Kings. Shield damage can expose a site to an existing strategic pulse. Mining resumes its remaining extraction interval without catch-up output; disabled haulers retain their manifests and resume their route when engines recover. Navigation cannot bypass the outage.

## Balance and verification

All values are provisional playtest settings in `DEFAULT_TACTICAL_PULSE_CONFIG`. New operations snapshot a validated `rules.tacticalPulse` configuration; saved operations keep their balance. Durations use engine game hours, distances use chart units, and propagation speeds use chart units/hour. The visual ring carries its saved attenuation.

`node --import tsx --test src/game/tactical-pulse.test.ts server/pulse.test.ts src/components/PulseControls.test.ts` covers costs, retries, exact arrivals, attenuation, cancellation, source loss, King resistance, firing slowdown, outages, privacy, old saves, private/shared replay, authoritative restart, and control interaction. `npx playwright test visual-tests/disruptor.spec.ts` checks live material commitment, cancellation without refund, automatic launch, and fading rings on desktop and phone layouts. Delivery checks are `npm run check` and `npm run build:web`.

Regional distortion where two wavefronts intersect remains an exploratory mechanic. This implementation applies a temporary uniform slowdown when a strong tactical pulse reaches the emitting King. Native device behavior and balance under sustained multiplayer pressure need playtesting.

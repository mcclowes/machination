# Endless frontier proposal

Status: design proposal. Only the depletion-only experiment is implemented, in [solo depletion](solo-depletion.md). Keep time-bound multiplayer rules unchanged.

An endless solo operation should reward surviving, exploring, and making good local decisions without accumulating an empire the player can no longer manage. A large map provides somewhere to go; it shouldn't require watching the entire map. This is useful practice between multiplayer turns, but isn't a substitute for assessed tutorials.

## Recommendation

Prototype a migrating frontier with finite planetary reserves, a limited sustainable fleet, and a small active command area. Expand the world as the player explores. Preserve discoveries and accomplishments while allowing old territory to stop demanding attention.

Depletion alone doesn't prevent dominance. Faster expansion can finance more expansion, while previously produced drones and captured specialists keep accumulating. Existing generators constrain production but don't remove excess drones after capacity falls. Endless mode therefore needs an explicit maintenance rule as well as resource exhaustion.

## Planet lifecycle

- Productive: factories spend reserves to produce drones, mines spend reserves to extract material, and generators spend reserves to sustain fleet capacity. Ownership alone doesn't consume reserves. Idle production doesn't secretly exhaust a planet.
- Low reserves: show estimated remaining operating time and a migration warning. Changes in output change that estimate, so also show the reserve amount.
- Exhausted: production and capacity stop. Give a visible evacuation window, then retire the settlement, its shields, sensors, and ownership benefits. No permanent scouting chain or free rear fortress remains.
- Retired: keep a historical map marker, hide it from ordinary orders and alerts, and remove it from AI target selection. Existing travel must resolve or evacuate before retirement; never delete an occupied destination or strand a specialist.

Start with one shared reserve per planet. Building conversions and capture preserve its remaining reserve. Accelerating production consumes it faster. No capture, demolition, or ownership cycle refills it. Reserve consumption, warnings, and retirement use explicit simulation events so forecasts and saved games agree.

Retired planets can remain passable coordinates without being selectable destinations. Removing them from space entirely adds route and interception complications without helping the first experiment. Whether shields and sensors need their own operating cost can wait until playtests show players exploiting the evacuation window.

## Prevent accumulated military dominance

Prototype maintenance against live generator capacity. Above capacity, production stops immediately and drones consume a finite supply buffer. Once that buffer runs out, excess drones suffer predictable attrition. Include traveling drones; otherwise fleets become free storage. Display projected losses before launching or retiring supply sites. Establish a deterministic allocation rule for losses before implementing this mechanic.

This gives an approximate long-term bound: sustainable drones follow the player's current productive footprint, rather than lifetime conquests. It doesn't automatically bound that footprint. Begin with a fixed number of supported settlements, explained as command capacity; additional planets can be scouted or contested, but activating one requires retiring another. Test whether this feels like choosing a useful portfolio or an arbitrary restriction. Don't increase that limit through endless progression.

Capacity should leave room for several viable army compositions. Specialist stacking, recruitment credits, and material stockpiles also need bounds or recurring uses; otherwise they become alternate compounding engines. Initially retain a bounded active specialist roster and avoid permanent combat upgrades between runs. A wealthy player must still need current supply and expose something valuable to replace it.

## Player attention and waiting

Begin with a tuning hypothesis of 6–10 active settlements and two contested fronts. This is a usability target, not a validated limit. Use sector summaries at distant zoom levels, a focused local chart, grouped movements, and alerts for decisions rather than every economy tick. Measure simultaneous decisions and required orders as well as total owned planets.

Make endless solo pause immediately and save independently when entering multiplayer. Resume only on request, with no offline losses. Allow accelerated travel and safe stopping at the next consequential event. The existing solo wall-clock catch-up policy isn't appropriate for this waiting activity. Preserve manual fleet control initially; add standing logistics orders only if playtests demonstrate repetitive work.

Generate fresh sectors deterministically beyond the explored frontier, with local AI factions that enter and leave the conflict. Don't wrap the map back into exhausted territory. Bound active simulation and forecast work; a larger chart must not multiply the existing per-seat speculative AI budget indefinitely. Archive settled sectors only after fleets, orders, effects, and possible return visits have an explicit resolution policy.

Eliminating local rivals opens the next frontier rather than ending the operation. Losing the King ends the run, with retry available. Exploration records, optional objectives, and personal bests provide progress without a global resource quota. AI uses the same reserve, supply, and settlement rules, and difficulty is explicit rather than covertly matching every player gain.

## Specialists

**Terraformer:** a one-use unit that restores a fixed reserve amount at a depleted but not retired planet. Mark the planet permanently restored so repeated hires or captures can't create an infinite engine. Require travel, time, and exposure; it should buy one more useful chapter for a valuable location.

**Conservator:** the proposed precursor can prevent depletion while stationed, but only by putting the planet into conservation. Conservation halts extraction and production and provides no fleet capacity, shields, or sensor advantage. Moving or promoting the specialist resumes normal depletion. A productive planet that never depletes would invalidate the frontier; a slower-depletion/output tradeoff is another candidate if conservation isn't useful enough.

Keep both specialists out of the first balance experiment. Prove migration is enjoyable before introducing exceptions. Add a retirement grace period long enough to reach a clearly forecast restoration decision; don't make specialist arrival race a hidden expiry.

## Tutorial quality and first experiment

When this proposal was written, five exercises covered capture, shields, specialist transport, future production, and interception. On October 30, 2026, their engine, progress, and dialogue tests passed: 22 checks. That establishes executable solutions and assessment safeguards, not teaching quality. Practice has since grown to 40 exercises; see [tutorial coverage](tutorial-coverage.md). Existing documentation still lists rendered, small-screen, accessibility, and native acceptance gaps.

First play through every exercise using the actual UI on desktop and a small touch screen. Verify objective wording, discoverable controls, hints, resolution playback, retry, completion persistence, and returning to a retained solo save. Observe an unfamiliar player without coaching. Fix blockers before adding depletion lessons.

Then compare a larger-map baseline, depletion alone, and depletion plus supply and settlement limits using the same seeds. Run accelerated AI soaks over many planet lifecycles, followed by human sessions with pauses and interruptions. Track active settlement count, force and material concentration, orders per minute, simultaneous threats, migration frequency, idle travel, and time to recover after losses. A useful outcome is sustained local competition without monotonically growing forces or administrative work. Set numerical acceptance thresholds after measuring the baseline, before choosing the winning variant.

Test stalled production, captured reserves, capture loops, troop storage in transit, repeated restoration, specialist stacking, supply collapse, evacuation with pending orders, split versus large advancement, save/replay reconstruction, and deterministic frontier generation. No depletion rule should enter ordinary saved operations accidentally.

## MMO gate

This could support a persistent shared frontier, but depletion doesn't solve offline vulnerability, veteran advantages, newcomer access, griefing, or coordination across time zones. Solo's pause policy also can't transfer directly. Consider an MMO only after long solo runs demonstrate bounded attention and power, then test shared regional conflicts with explicit offline protection and limits on moving wealth or armies between regions. An infinite map by itself doesn't establish a viable MMO.

Related: [solo AI](solo-ai.md), [tactical training](tactical-training.md), and [map generation](map-generation.md).

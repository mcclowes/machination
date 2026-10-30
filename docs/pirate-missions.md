# Pirate mission scope

The [official Pirate entry](https://subterfuge-game.com/rulebook/Specialists.html) ties double outbound speed and quadruple return speed to targeting a sub. The previous implementation gave quadruple speed to every return carrying an active Pirate and redirected ordinary route-battle winners home. The [independent audit](specialist-acceptance-audit.md) reproduced both cases.

Operations from `rules.mechanicsVersion: 3` onward apply this correction. A released Pirate travels at ordinary speed, subject to other applicable speed specialists. A Pirate aboard an ordinary site-bound hauler continues to that destination after winning a route encounter. Genuine targeted interception returns keep quadruple speed, including surviving specialists returning after a tie. Failed or ended interception missions also return through the existing mission resolver. These rules follow the scope stated in the current reference; original-client interaction acceptance remains open.

A returning fleet records `interceptionReturn: true` when it actually came from an interception. Speed reconciliation reads that marker after the live target link has been removed. It survives snapshots, save/reload, forecasts, and historical reconstruction. Navigator redirection clears the marker and uses the new route's ordinary specialist speed. Save validation rejects the marker on a non-returning fleet or under an older mechanics version. Captive and ordinary release convoys don't acquire it.

| Saved mechanics | Behavior |
| --- | --- |
| Field absent | Original prototype-era rules and deterministic replay behavior. |
| Version 2 | Rounded mine capture losses and owned, inert wrecks; previous Pirate return behavior retained. |
| Version 3 | Version 2 corrections plus mission-scoped Pirate return speed and routing. |

Loading never silently upgrades a running game. New operation creation selects the current rules. Game version 1/2 and map-generator version are separate existing contracts; their meanings haven't changed.

Verification covers released captives, ordinary route victories, targeted returns through polling and saved reload, tied interception convoys, Navigator redirection, invalid mission markers, and older mechanics. A server scenario verifies authorized targeting, retries, scoped identities, forecast, history, and durable restart. The integrated suite passes 249 tests, TypeScript, web export, and the standalone server checks. Native/browser interaction remains unverified while computer-use bindings report `cgWindowNotFound`.

The audit's five interpretation gaps and the wider interaction matrix remain open. This correction doesn't establish complete specialist parity.

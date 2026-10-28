# Funding

Tracking: [#18](https://github.com/mcclowes/machination/issues/18).

Version-two operations implement the [official funding rule](https://subterfuge-game.com/rulebook/): a sponsor with at least 20 more cargo than an active recipient can grant support for free. Each grant adds 50 capacity and two drones per factory cycle. It can be withdrawn at any time and automatically ends when the gap falls below 20 or either party is eliminated. Expired support never silently restarts. Losing a core also removes that core's 150 base power; surviving generators and active specialists still supply power.

The rulebook does not specify multiple-sponsor stacking or identity visibility. The implementation applies the stated bonus per grant. Each player sees their incoming and outgoing sponsor identities; everyone sees counts and cargo standings. This matches the firsthand [Subterfuge FAQ account](https://herbertzhb.wordpress.com/2016/06/28/subterfuge-2/) of multiple funders and colored versus anonymous dots. That account is supporting observational evidence, not an official specification. Cargo standings are deliberately public; hidden site ownership, inventories, recruitment pools, and unrelated sponsor identities remain redacted.

`POST /v1/games/:id/funding` accepts `{ requestId, revision, recipient, enabled }`. The sponsor is the authenticated seat. It returns the filtered snapshot, follows existing durable command receipts, and rejects stale orders, absent seats, invalid relationships, eliminated players, and insufficient cargo leads. A replay after automatic expiry returns current state without recreating funding. Existing saves without funding remain valid; malformed, duplicate, or ineligible grants are refused on load.

Forecasts preserve the player's known grants and use public cargo standings. Other players' anonymous sponsors cannot be fully modeled; the forecast flags that uncertainty instead of disclosing their identities. New hidden mining or combat outcomes can also change eligibility, as with other forecasts.

Funding is controlled from the Intel drawer in solo and multiplayer. It does not transfer cargo, create an enforced alliance, or share sonar.

Verification: all 140 tests pass, including exact threshold, per-sponsor bonuses, withdrawal, elimination, split polling, save validation, scoped observations, forecasting, HTTP authorization, retry, restart, and offline expiry. TypeScript and rendered UI acceptance are checked separately during integration.

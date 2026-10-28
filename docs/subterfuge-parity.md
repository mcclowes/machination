# Subterfuge parity

Tracking: [#18](https://github.com/mcclowes/machination/issues/18). Reviewed October 28, 2026.

Machination's original theme and visual style stay. The target is equivalent strategic choices, information, timing, and command workflows. Existing prototype milestones don't establish parity.

## Reference rules

The [official rulebook](https://subterfuge-game.com/rulebook/) defines the baseline:

| System | Reference contract |
| --- | --- |
| Start | Five outposts each; four carry 40 drillers, one a Queen; dormant outposts undefended; no initial mines. |
| Economy | Factories: six drillers per eight hours. Capacity: 150 plus 50 per generator. |
| Defense | Shields: 10/20 maximum, 48-hour recharge; can be disabled. |
| Orders | Ten-minute editable launch preparation; opposing-route encounters. |
| Combat | Specialist, shield, driller, capture phases; outpost wins equal ties. |
| Mining | Mine cost: 50, 100, 200, 300…; daily output scales with owned outposts; losing one removes 20% of reserves. |
| Victory | 200 mined units, last survivor, or configurable domination target. |
| Sensors | Outpost coverage; incoming and owned subs visible; mine locations public. |
| Gifts | Ownership transfers on contact; ten-minute cancellation. |
| Funding | Twenty-unit lead enables free support: +50 capacity, +2 factory output. |
| Elimination | Queen loss, resignation, or inactivity; assets persist, mining and orders stop. |
| Recruitment | First hire at hour four, then every 18 hours; promotion replaces hiring. |

The [official specialist reference](https://subterfuge-game.com/rulebook/Specialists.html) is the ability specification. Machination's four drone-built modules aren't substitutes for the roster. Multiple transported units, movable leadership, promotions, captives, local/global effects, and ability priorities need explicit support. Reference examples include double-speed transport, conversion rounded upward, interception with accelerated return, and area destruction. Names and descriptions remain original.

## Interaction baseline

The [official Time Machine tutorial](https://vimeo.com/114210812), linked from the [game website](https://subterfuge-game.com/), is the primary UI reference. The developer's [Steam description](https://store.steampowered.com/app/4831650/Subterfuge/) also describes inspection of visible future movement/combat/production and issuing future orders in that context. UI details require visual verification; written descriptions alone don't verify gesture parity.

Acceptance scenarios:

- The chart is the primary play surface on a phone. Pan and zoom without leaving it, select a rock or moving hauler, and inspect its details through contextual controls.
- Ownership, inventories, site types, defenses, modules, sensor boundaries, routes, destination, arrival time, and selected state are legible. Hidden information remains unknown.
- Choose a departure and destination on the map; adjust the manifest, inspect arrival/combat, then confirm. Preparations and queued orders can be reviewed and canceled.
- Move through time precisely, return to live time, inspect known outcomes, and create future orders using the same actions. A forecast doesn't imply knowledge of new human orders or hidden forces.
- Replay observed history, including battles missed while away. History never reveals information the player couldn't observe.
- Reach private and group diplomacy, standings, specialist management, events, and game settings from persistent navigation. Connection/recovery settings don't displace the active chart.
- Preserve accessible controls and large touch targets. Validate keyboard handling, safe areas, and phone layouts as well as desktop export.

## Audit of the starting implementation

| Area | Observed Machination behavior | Initial assessment |
| --- | --- | --- |
| Starting map | Three seats, two owned rocks each, defended dormant rocks, prebuilt mines | Different |
| Economy | Every core/reactor produces continuously at four/hour; no capacity or generator distinction | Different |
| Mining | Flat two/hour; no construction or loss penalty; quota 300 | Different |
| Defense | No shields | Missing |
| Leadership | Immobile core bound to site; loss neutralizes territory and deletes haulers | Different |
| Specialists | One bay, four drone-built modules, altered effects | Different |
| Combat | Sequential site arrivals; scavenger-only encounters; no capture phase | Partial |
| Transport | Instant launch; rounded travel hours; no editable preparation | Different |
| Gifts | Recipient owns immediately; restricted to currently observed recipient rock | Different |
| Sensors | Moving haulers reveal territory; remote site types public; incoming haulers may be hidden | Different |
| Time Machine | Four future offsets, no replay, commands disabled while forecasting | Partial |
| Map | Fixed chart; rocks selectable, haulers aren't; no pan/zoom | Partial |
| Navigation | Long scrolling operation/settings/forms; bilateral messages below chart | Different |
| Diplomacy | Private messages and immediate gifts; no group channels or funding | Partial |
| Multiplayer | Three fixed seats; server authority, retries, recovery, private plans | Sound foundation; limited scope |
| Release | Native simulator and web foundation; physical devices/push/public hosting outstanding | Incomplete |

## Implementation order

1. Shared time inspection and future-order context; chart interaction and contextual inspection.
2. Versioned faithful economy and combat foundations, with explicit handling of old saves.
3. Launch preparation, route encounters, gifts, and persistent eliminated assets.
4. Movable leadership, recruitment, promotions, capture, and specialist effects.
5. Authoritative sensor/history contracts, group diplomacy, funding, game modes, and seat counts.
6. Phone, web, server, persistence, replay, and complete-match acceptance checks.

Keep this issue open and the goal active until the outstanding contracts are implemented and verified. Passing prototype tests alone isn't completion.

## Progress

The first UI slice replaces fixed forecast offsets with a shared Time Machine: minute-precision inspection, seven-day scrubbing, event markers/jumps, stable inspected timestamps, and transfers scheduled directly from the forecast. The chart now supports pinch/button zoom, drag panning while zoomed, and contextual hauler inspection. Future module construction, interception scheduling, observed-history replay, and persistent map navigation remain outstanding.

Verification: baseline 72 tests; new future-inventory scheduling and timestamp/horizon scenarios; TypeScript; web export. Chrome verified a +6.5h transfer of all 116 predicted drones, its private live queue, projected fleet, hauler inspector, and zoom controls. Native gestures and complete UI parity remain unverified.

The economy slice introduces version-two new operations and preserves version-one saves/rooms. New operations implement equal starting territories, dormant expansion, industry cycles, generator capacity, mining construction and territorial output, mine-loss penalties, shield recharge/combat, and authorized site controls. New economy scenarios and an authoritative persistence/authorization scenario pass; all 82 tests pass. Full specialist, transport, sensor, leadership, replay, and navigation parity remains open.

The transport slice adds ten-minute launch preparation, manifest editing/cancellation, continuous transit, ordinary opposing-route encounters, contact-time gift delivery, in-transit gift orders/cancellation, and preserved eliminated assets. New game and server scenarios cover launch ownership, private preparation, retries, restart, route combat, gift interception, and eliminated-state persistence. The handling of a site attacked during preparation is an explicit implementation inference: preparation is canceled and reserved drones defend the site. Specialist cargo/capture and full interaction parity remain outstanding.

Transport validation: 90 tests pass, TypeScript passes, and web export succeeds. Safari accessibility checks exercised preparation and a 20-to-30-drone manifest edit; complete visual/native interaction acceptance remains outstanding.

The specialist slice replaces version-two module construction with the full reference roster under Machination names. It adds time-based recruitment and promotion, multiple cargo units, movable cores and succession, captives and release, priority-based combat, local/global production and defense effects, timed sentries, area destruction, accelerated interception/return, and Navigator course changes. The server scopes unit identities, keeps recruitment pools private, and persists retries and movement. Version-one operations retain their original rules; pre-specialist version-two saves migrate cores, cargo, and queued module transfers.

Validation: all 120 tests, TypeScript, and web export pass. Safari verified migration of an existing operation, selection of a core with zero drones, ten-minute preparation, and cancellation returning it to its site. The [independent review](specialist-parity-review.md) found three defects; Inspector suppression is fixed, and the two sensor findings are addressed by the sensor slice below. Promotion works while the core travels, and redirection no longer permanently blocks Navigator changes. Full specialist interaction and native acceptance remain outstanding.

The navigation slice keeps the chart, compact Time Machine, and section navigation on screen. Asset inspection uses a bottom drawer on smaller screens and a sidebar on desktop. Orders, recruitment/promotion, signals/diplomacy, intelligence, and connection/recovery each have a dedicated drawer. Destination selection dismisses the drawer and returns directly to review; owned hauler inspection links to order management. Cargo selection no longer requires scrolling past recruitment offers. Keyboard avoidance and shared bottom safe-area handling are included, with native acceptance still pending.

Safari verified desktop and compact layouts, site inspection, destination review, Orders and Units navigation, expanded Time Machine controls, and multiplayer entry. An isolated three-seat HTTP room verified lobby/start, authoritative preparation/cancellation, and access to private diplomacy. TypeScript and web export pass. Screenshot assets on the official App Store page did not load during visual inspection; full reference-gesture and phone acceptance remain open. Replay, group channels, funding, variable seats/modes, and other outstanding rules are still tracked under #18.

The sensor slice removes mobile hauler sonar from version-two games, preserves incoming/owned hauler visibility outside coverage, keeps foreign preparations private, and hides distant site types unless they are mines or an Intelligence Officer reveals them. The chart renders unknown types explicitly. Version-one behavior remains compatible. Snapshot/forecast purity and HTTP seat scoping are covered; the integrated suite passes all 129 tests.

The integration follow-up shares the contact policy between observations and interception authorization. A visible incoming hauler can be targeted outside sonar, while hidden unrelated ships remain unavailable. The new public-interface regression reproduces the former mismatch before the fix.

The diplomacy slice adds [funding](funding.md), public cargo standings, and [public/private group channels](group-diplomacy.md), with explicit recipients, private sponsor identities, durable retries, and server membership enforcement. Intel exposes support controls; Signals preserves per-thread drafts across drawer switches and clears text only after acknowledgment. All 140 tests pass; TypeScript and web export pass. Safari verified grant/withdrawal, public delivery, group creation/delivery, and draft retention; local test-seat HTTP snapshots independently verified group exclusion. Native keyboard/touch, replay, broader future commands, variable seats/modes, inactivity/resignation, and complete-match acceptance remain outstanding.

The mining cadence correction replaces daily lump payouts with one-unit events throughout the day at the official territory-scaled daily rate. The [firsthand FAQ](https://herbertzhb.wordpress.com/2016/06/28/subterfuge-2/) describes that cadence more explicitly than the official rulebook; the exact one-unit interval and progress-preserving territorial retiming are the implementation interpretation. Mine capture resets the new clock, funding rechecks at each payout, and destroyed mines no longer advertise an active remote mine. Existing daily-clock saves preserve their remaining fractional progress toward the next payout without retroactively inventing cargo. New scenarios cover unit payouts, expansion, independent mines, split polling, migration, and remote wrecks.

Mining validation: all 148 tests and TypeScript pass, including territorial contraction, exact quota timing, and rejection of non-advancing saved clocks. Site inspection shows the per-unit interval and next payout. Reference cadence interpretation and legacy-clock migration remain explicit above; this is not complete-match or native acceptance.

The replay slice adds immutable canonical command histories, validated private persistence, and authenticated historical sensor views. Local operations and multiplayer use the same command executor for every game action; polling and deterministic training rivals do not create duplicate entries. Commands and live state commit together. Old operations begin history at their complete saved state, before offline advancement; earlier history is unavailable. Invalid or unsupported history is refused rather than silently replaced. See the [private replay contract](replay-contract.md) for versions, bounds, retention limits, and identity scoping.

Both Time Machines now scrub backward, accept signed hour offsets, jump to prior events or the available baseline, and return to live time. Historical site, fleet, unit, signal, economy, and queued-order panels use the displayed frame and disable game commands. Current diplomacy remains available and labeled. Multiplayer requests debounce and cancel stale responses; loading and failure states preserve navigation and expose Now/retry without displaying current information as an old frame. Map zoom survives history loading. Expanded time controls scroll within a bounded area so the chart and navigation remain reachable.

Solo live views and forecasts now use the same sensor boundary as multiplayer. Forecasts simulate current observations, including uncertainty at hidden destinations; they do not expose hidden training-rival state. Historical reconstruction uses coverage at the requested hour, without merging later discoveries. The private local archive survives reload and deterministic offline advancement.

Replay validation: all 174 regression tests, TypeScript, and web export pass. HTTP scenarios cover offline battles, historical sonar, scoped aliases, retries, restart, old-room baselines, invalid ranges, and corrupt archives. Local persistence scenarios cover command reconstruction, offline rivals, detached data, and clock rollback. Network scenarios cover identity isolation, invalid envelopes, authorization failures, cancellation, and late responses. Safari verified a missed capture, earlier unknown territory, live versus historical shield state, read-only actions, signed seeking, reload persistence, retained time controls, and retained map zoom. Native touch/keyboard, original-app gesture comparison, shared replay exports, and complete-match acceptance remain unverified.

Remaining parity contracts: variable player counts and game modes/maps; resignation and inactivity; future commands beyond transfers; full specialist interaction acceptance; onboarding/puzzle coverage; native phone interaction and complete matches. The goal and issue #18 remain open.

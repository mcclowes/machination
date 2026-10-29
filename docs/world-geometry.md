# World geometry

New configured operations record `map.generator: balanced.v2` and `map.topology: torus`, with public width and height. Both axes wrap. Fixed charts and `balanced.v1` saves remain planar, including their existing journeys, training decisions, and replay calculations. Loading never regenerates coordinates or adds wrapping to an old game. Missing or unsupported topology on a `balanced.v2` save is rejected.

The [official rulebook](https://subterfuge-game.com/rulebook/) describes circular sonar, same-route encounters, and nearest-friendly-site returns, but doesn't specify map topology. Firsthand player reports describe [a world without map edges](https://www.neogaf.com/threads/subterfuge-a-week-long-real-time-strategy-game.1122946/) and explicitly identify [a toroidal map](https://www.webdiplomacy.net/forum.php?viewthread=1335126). These are player observations rather than an official geometry specification. The implementation uses the shortest displacement independently on each axis. Exactly half-width or half-height ties retain the sign of the original displacement, so reversed routes remain reversed.

`geometry.ts` owns wrapped distances, canonical points, nearest translated images, and adjacent tile offsets. Ordinary transfers, edited launches, navigation, returns, succession, sonar, event audiences, production auras, sentry fire, captive rescue, and explosions use that geometry. Training rivals use wrapped travel estimates only in torus games; previous planar decisions remain unchanged.

Flight endpoints describe an unwrapped straight leg. Fleet positions are reduced into the canonical rectangle for observation. Redirection and speed changes start from the current position and preserve the short remaining leg. Interception solves for the earliest reachable image of the moving target before arrival, retaining its velocity after a seam crossing. Route encounters compare translated positions while retaining straight-leg velocities and exclude previously resolved contacts.

The chart repeats adjacent images of sites, fleets, routes, and coverage. Selecting a translated image selects the same asset. Panning is periodic at Fit and zoomed scales; zoom preserves the viewed center. Home finds the smallest circular interval containing owned observed sites on each axis. Fit resets to one full tile. Multiplayer's parent owns its camera across polling and historical frame loading.

## Verification and limits

### Ordinary route eligibility

[Issue #50](https://github.com/mcclowes/machination/issues/50) reproduced a default-game mismatch with real commands: two ordinary fleets on four distinct, collinear outposts fought when their paths overlapped. The publisher's Subs rule restricts ordinary encounters to journeys between the same two outposts. New configured games use mechanics revision 12 and require matching undirected endpoint IDs before applying the existing position/time solver. Matching coordinates or a shared geometric corridor do not substitute for site identity. The same pair remains eligible in either direction, including a faster fleet catching an older fleet after their departure site's ownership changes.

The relative-motion solver, opening clock, seam translations, arrival exclusion, contact suppression, and same-hour leg checks remain authoritative after eligibility. Admiral speed refresh may replace a leg's geometric start while preserving its outpost pair; this does not make an ordinary journey a special one. Ordinary gifts use the same eligibility rule before applying their noncombat transfer outcome. Existing profiles through revision 11 retain their recorded broader contact policy, including strict saves and canonical/shared replay.

The publisher's available descriptions do not settle incidental contact identity on generated return convoys or Navigator redirects, and moving bases are an explicit rebuild variant. Those legs retain their previous geometric eligibility rather than gaining unproven immunity or invented origin outposts. A completed Navigator turn sets `courseChanged` on the fleet in revision 12. The marker persists if the Navigator later dies, is validated in saves, and follows current observations into forecasts/history; it is absent before physical activation and does not disclose pending orders. Forced return clears it because `returning` then owns the special-leg classification. Public shared replay presentation omits this simulation metadata and records actual outcomes. The drifting variant keeps its prior contact policy even in revision 12. These preserved special/variant contracts are not current-original-client certification.

Eighteen arranged engine scenarios cover distinct/coincident identities, torus overlap and true seam contacts, reciprocal and same-direction encounters, gifts, ordinary speed refresh, a turned fleet surviving Navigator death and a later encounter, released/captured return cargo, targeted Pirate interception, Saboteur return, moving-base behavior, old-profile results, metadata validation, strict saves, canonical/shared replay, and forecasts. Two durable-service scenarios verify ordinary and redirected results across scoped commands, retries, historical observations, forecasts, and disk restart. These twenty focused checks, TypeScript, web export, and three production server bundle checks pass; #50 records repository-wide results and their scope. A separate bounded read-only source review supported the ordinary-pair restriction and identified the special-leg classification issue; `/tmp/machination-route-eligibility-review.txt` records its scope and unsuccessful sandboxed probe, not an independent passing test run.

Engine scenarios cover seam and corner travel, sonar, route combat with split polling, interception before/after wrapping, returns, redirection, global speed changes, local specialist effects, succession, explosions, and save validation. A server scenario covers authoritative commands/retries, forecast/live agreement, restart, and historical reconstruction. Camera/projection scenarios cover translated positions, shortest routes, seam-spanning Home, periodic pan, and zoom centering. Generator scenarios use wrapped spacing and expansion scoring for every player count from 2 through 10.

`src/game/fixtures/planar-replay-aec9546.json` is a synthetic 24-hour training save generated by the engine at commit `aec9546`, before wrapping changes. Its replay must still load to the exact saved state. This catches changed rival decisions that fresh same-engine replay tests cannot detect. It contains generated test data, not a player's save.

Safari verified that an existing planar training save still loads and that a fresh two-player torus lobby opens with territory framing. Further native browser interaction checks became unavailable when both Safari and Chrome bindings returned `cgWindowNotFound`. Actual seam dragging, translated-copy selection, retained camera through live history requests, physical-phone gestures, and full-match acceptance remain unverified. Pure projection tests do not substitute for those checks.

The generator remains an approximation, described in [Generated charts](map-generation.md). Wrapping doesn't establish exact map-generation or travel-speed fidelity. Specialist interaction acceptance, mine-loss semantics, foreign preparation visibility, broader future actions, shared replay export, and complete matches remain tracked in #18.

## Travel calibration evidence

[Travel calibration (#45)](https://github.com/mcclowes/machination/issues/45) records a measurable profile discrepancy. The official [Time Machine tutorial](https://vimeo.com/114210812) at 02:00 shows 18h16m remaining for a selected 40-driller sub. The captured frame is `.fettle/shots/subterfuge-tutorial-02m00s.png`. Its historical build, complete route context, and game settings aren't established. It doesn't specify a current-client speed constant.

For current stationary configured games, an ordinary shortest leg cannot exceed `hypot(width / 2, height / 2) / 8` hours. The limits are independent of generated coordinates:

| Seats | Maximum ordinary leg |
| --- | --- |
| 2 | 7.217 hours |
| 3 | 8.839 hours |
| 8 | 14.434 hours |
| 10 | 16.137 hours |

Even with ten-minute preparation, that profile can't reproduce the frame's duration as an ordinary shortest leg. This identifies a calibration question, not whether speed, map scale, game settings, or historical behavior explains it. A [2015 Ron Carmel design interview](https://www.gamedeveloper.com/design/-a-brawl-and-a-race-designing-for-the-long-game-in-i-subterfuge-i-) describes roughly twelve-hour trips and matches lasting about a week, but doesn't define the trip distribution. It isn't an exact replacement-value specification.

A bounded probe of seeds 0, 7, 73, and 2026 at 2/3/8/10 seats measures nearest-site medians of 1.118–1.486 hours, nearest-dormant-destination medians from owned sites of 1.449–2.685 hours, and all-pairs medians of 3.977–9.139 hours, varying with seat count. These distributions aren't interchangeable. Probe and output: `/tmp/machination-travel-calibration-probe.ts` and `/tmp/machination-travel-calibration-probe.log`. Current-client route and sonar-scale measurements remain necessary before choosing a calibrated profile. Existing saved journeys must retain their recorded rules.

The [launch trailer](https://www.youtube.com/watch?v=WECvxdJv3kk&t=169s) at 169 seconds adds a time-machine route frame: a moving sub with two specialists, an eleven-hour forecast, and two unlabeled times. Their meaning is unverified, so they do not select a new ordinary-travel constant. Source trace: `/tmp/machination-yt-trailers/FINDINGS.md`.

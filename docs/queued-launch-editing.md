# Queued launch review and editing

Queued transfers, gifts, and interceptions can be reviewed and have their drone and specialist manifests edited before execution. The queue also offers a direct jump to each order's forecast. This complements commands scheduled for a hauler's later preparation window.

## Reference evidence

The [official homepage](https://subterfuge-game.com/) describes issuing and modifying orders. Its [Time Machine tutorial](https://vimeo.com/114210812), uploaded December 11, 2014, was directly inspected through the public Vimeo player on October 28, 2026. Sampled frames show:

| Timestamp | Observed UI |
| --- | --- |
| 00:24–00:29 | A map-centered history view controlled by a dial, showing relative hours in the past. |
| 02:00 | A selected sub's arrival estimate and a direct arrival-jump control. |
| 02:10 | A hire-in-progress panel with cancellation and finalization controls, while inspecting the future. A cancellation hint displays 11 minutes remaining. |
| 02:15 | A future launch's source/sub manifest controls, cancellation, gifting, specialist cargo, and arrival jump. The timeline lists a future hire and launch. |
| 02:20 | Absolute day/time display alongside the future-order list. |

Screenshots are saved locally under the ignored `.fettle/shots/subterfuge-tutorial-02m*.png` paths. These are sampled visual observations of an early official build, not a transcript or proof of every current-client rule. In particular, rounded clock labels and a single cancellation hint do not establish exact confirmation timing, automatic finalization, undo effects, or order-versus-departure timing. The controls' existence is now directly evidenced; their complete behavior still needs reconstruction. Out-of-range sites also appear as colored symbols in these frames, warranting a separate audit of ownership visibility rather than assuming that hidden strength implies hidden ownership.

## Edit contract

An edit replaces only the drone count and, optionally, specialist selection of an owned, unexecuted launch. It preserves the plan ID, owner, reserved fleet identity, execution time, route/target/recipient, cargo module, and insertion position. It consumes no counter value and reserves no resources. Ordinary transfers, gift launches, and interceptions share this operation; other scheduled actions remain reviewable through their forecast and cancelable.

Omitting the specialist field preserves the previous manifest. An explicit empty array clears it. Version-one operations retain their cargo module and omit empty specialist fields so the result remains a valid legacy save. Counts must be whole, nonnegative numbers, with an ordinary empty launch requiring at least one drone. Interceptions can retain their automatic rig selection.

New selections must refer to known owned units or the caller's queued hires. Previously selected references may be retained after their hire is canceled or the unit is no longer available. That retains an already known private reference, not hidden new information. Unknown added references fail. Exact ownership, location, credits, inventory, contact, and reachability remain execution-time requirements; unmet dependencies abort privately.

The review shows both order time and departure time, names and locations for units, and a provisional-inventory explanation. Drafts reset across operation, seat, and view-mode changes. History uses its historical queue and disables editing. Inspecting an order clears unrelated route-selection state. A queued edit is a present modification of a future plan, even when the chart is inspecting the future.

## Transport and history

`POST /v1/games/:id/edit-schedule` accepts `{requestId, revision, planId, drones, specialists?}`. The server snapshots and strictly validates the body before its asynchronous transaction. Owner, fleet ID, time, route, and extra-field injection are rejected. Specialist aliases resolve through the authenticated seat, including that owned plan's previous manifest. Missing, foreign, executed, canceled, and nonlaunch plans share an unavailable-plan response.

Successful edits use the usual atomic persistence, seat revision, and canonical receipt contract. Omitted and empty manifests have distinct receipts. Retrying preserves the original request; historical views prohibit retrying gameplay commands. Failed edits roll back receipts and queue changes. The new canonical replay command is `edit-schedule`; earlier history retains the original manifest, while later history and execution use its replacement. No saved mechanics are upgraded.

## Verification and remaining acceptance

All 302 tests pass, along with TypeScript, web export, and two standalone production-server checks. Coverage includes transfers, gifts, interceptions, stable dependent commands, same-position replacement, resource preservation, planned and canceled hire references, private aliases, invalid fields, stale revisions, input mutation, retries, save/replay, restart, and legacy cargo compatibility.

Chrome solo acceptance changed a queued launch from 20 to 10 drones while retaining its order time and ten-minute departure offset. The forecast showed the preparing 10-drone hauler; returning to live time retained all 40 drones at its source. Reloading preserved the edited queue. Historical review disabled the drone field, specialist checkboxes, saving, and cancellation. The disposable test launch was canceled afterward. Local evidence is in `.fettle/shots/queued-launch-review.png` , `queued-launch-forecast.png`, and `queued-launch-history.png`. Multiplayer transport is covered by HTTP/service tests; direct multiplayer and physical-phone editor acceptance remain open.

Changing a queued launch's time, route, or mission is outside this manifest edit contract. Direct selected-hauler arrival jumps are implemented in [arrival inspection](arrival-inspection.md), with interaction acceptance still open. Exact original-client editing/finalization semantics, hire/promotion undo behavior, numeric planning horizon, and full-match acceptance remain in #18. This change does not establish complete fidelity.

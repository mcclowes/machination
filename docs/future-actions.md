# Future actions

The Time Machine queues transfers, gifts, interceptions, recruitment, promotions, captive releases, mine construction, shield changes, funding, and hauler commands at the inspected future time. Hauler commands include preparation edits and cancellation, gift conversion and cancellation, and Navigator course changes. Historical gameplay remains read-only. Live actions use their immediate command paths.

The [official Steam description](https://store.steampowered.com/app/4831650/Subterfuge/) describes scheduling orders from the Time Machine. The [firsthand 2016 FAQ](https://herbertzhb.wordpress.com/2016/06/28/subterfuge-2/) explicitly discusses private future hires and promotions. Site and funding scheduling, execution ordering, and cancellation behavior here are the implementation interpretation; original-client acceptance is still required. This isn't a claim of complete future-order parity.

## Queue and execution

Transfers and actions share `game.scheduled` and the existing seven-day horizon. There is no gameplay limit on the number of queued orders. The [developer's Google Play listing](https://play.google.com/store/apps/details?gl=ES&hl=en_IE&id=com.snappytouch.subterfuge) explicitly offers unlimited scheduled orders with full access; Machination provides that planning behavior without a purchase tier. The former 20-order cap has been removed from submission and save validation for all operation versions. Existing successful commands and replay results are unchanged. A transfer keeps its old shape. An action has `id`, `owner`, `executeAt`, and `action`. Supported action payloads are:

| Type | Additional fields |
| --- | --- |
| `hire` | `kind` |
| `promote`, `release` | `id` of the specialist |
| `drill-mine` | `rock` |
| `shields` | `rock`, `disabled` |
| `funding` | `to`, `enabled` |
| `gift` | `from`, `to`, `drones`, `recipient`, optional `carryModule` and `specialists` |
| `intercept` | `from`, `target`, `drones`, optional `specialists` |
| `hauler` | `change`, using the existing hauler command shape |

No drones, specialists, credits, or cargo are reserved. Existing economy/arrival processing occurs first at an event hour, then due orders execute in queue insertion order. Each action uses the same engine operation as its live equivalent. A failed action logs a private abort and consumes no resources. Canceled dependencies can make later orders abort. Defeat, resignation, and game completion retain the existing queue cleanup.

Site identifiers are public, so a future site action can anticipate a conquest without probing hidden future state at submission. Runtime ownership, inventory, credit, promotion, and funding rules remain authoritative. Self-funding, absent recipients, invalid types, unknown fields, and domination mining/funding plans are rejected before persistence.

The UI labels future buttons with Schedule and the selected clock time, retains the real private queue while forecasting, and offers cancellation through the same queue panel. Map/timeline markers include all queued order times. Queue captions identify haulers by route rather than opaque server identifiers. Forecast controls use provisional inventory, preparation windows, gift windows, and course cooldowns; the engine rechecks these at execution.

Scheduled launches still prepare for ten minutes when their order executes. Gift conversion starts its ten-minute cancellation window at execution; a queued cancellation must execute before that deadline. This follows the [official rulebook's launch and gift windows](https://subterfuge-game.com/rulebook/). Interceptions require an observed enemy at submission and an eligible, reachable target at execution. Hauler commands accept only an owned live hauler or an identity reserved by the caller's pending launch. Canceling the launch dependency leaves later orders to abort privately.

## Planned haulers

From mechanics version 4, queueing a transfer, gift launch, or interception reserves a numeric fleet identity and advances the private counter. Execution creates that identity without consuming the counter again. Failed and canceled orders burn the identity; it is never reassigned. This reserves no drones or specialists. Seat-scoped views map the reservation and every command reference through the same opaque identity function as a live hauler.

Forecasts simulate only visible fleets and the caller's queued references, then restore their stable aliases. A planned hauler is therefore addressable before launch and keeps its identity across forecasting, execution, restart, and replay. Earlier mechanics retain their original allocation-at-execution behavior. Their synthetic forecast haulers cannot be selected for future commands; existing live haulers remain eligible. Loading a save never upgrades its mechanics.

## Planned hires and privacy

A queued hire pins the current recruitment cycle and choice. If a different hire or promotion consumes that cycle first, the plan aborts rather than selecting from a new private offer. Forecasts expose credit usage but clear unknown subsequent offers and mark recruitment uncertainty. They don't simulate new offers from the forecast's placeholder RNG and present them as known choices.

Each planned hire reserves stable specialist *identities*, not resources: `hire:<owner>:<plan-id>:<index>`. Action plan IDs are limited to 60 characters so these identities fit the existing 80-character specialist-ID contract. The actual hire creates those identities directly; they don't depend on hidden counter values or collide with observed numbered specialists. This allows queued promotions and transfers to refer to a recruit that doesn't exist yet.

Public views translate planned and existing unit references through the caller's identity mapping. The server accepts only current caller-visible specialist aliases or identities from that caller's queued hires. Raw canonical IDs, foreign aliases, and hidden scoped identities fail uniformly. Future transfer manifests can refer to owned units currently elsewhere or to a queued hire, while exact departure availability is rechecked at execution. An ordered conquest can also establish a future departure site.

## Transport and persistence

`POST /v1/games/:id/schedules` accepts either the existing transfer body or `{requestId, revision, executeAt, action}`. Both use seat authentication, canonical receipts, revision checks, atomic persistence, and the existing cancel-schedule endpoint. The new canonical replay command is `schedule-action`; executing a queued action doesn't append a second command. Old transfer saves and histories retain their format and behavior. Mixed queues validate exact action shapes, private hire-cycle data, and stable hire identities before loading.

## Verification and open acceptance

All 302 engine, component-helper, server, network, and plugin tests pass, along with TypeScript, web export, and standalone production server checks. Cases cover timing, future production, private aliasing, unknown offers, save/replay reconstruction, chained hires and haulers, anticipated conquests, counter collisions, queue ordering, malformed data, HTTP ownership injection, nested request mutation, canonical retries, restart, cancellation, queued launch edits, and changed requirements. Prior-engine compatibility fixtures remain in the full suite. Component-helper checks now run in the default test command.

Chrome acceptance verified a two-player operation, future transfer, a gift command on its not-yet-launched hauler, a later gift cancellation inside the ten-minute window, and the real private queue throughout forecasting. Restarting the disposable server with an advanced test clock executed all three orders: the 20-drone hauler launched, its gift marker was cleared, and its queue emptied. Replaying the earlier gift window showed the pending cancellation and disabled historical controls. It also exposed and verified fixes for opaque queue captions, a clipped manifest button, and a regression that showed the live queue in history. Screenshots are saved in the ignored `.fettle/shots/` directory. This is desktop browser acceptance, not physical-phone or original-client acceptance; interception and Navigator controls still need direct interaction acceptance.

Queue-cap regressions cover 50 mixed private orders through engine execution, scoped forecasting, cancellation, save loading, HTTP, canonical retry receipts, restart, and historical reconstruction. Operational protections still bound replay archives to 10,000 player commands and 16 Mi UTF-16 code units of serialized history, and server receipts to 10,000 commands; those are separate lifetime resource limits, not a per-player pending-order cap. Longer histories remain an acceptance concern.

Original finalization/confirmation behavior, the seven-day horizon, and less common rescue/ownership dependencies remain to compare against the original client. The older firsthand FAQ describes a 48-hour forecast horizon, while current official marketing promises orders days ahead without specifying a bound. The current seven-day range remains an explicit implementation choice pending stronger current evidence. Full specialist, native gesture, and complete-match acceptance remain tracked in #18.

The earlier scheduling reference audit could not inspect the tutorial. Subsequent direct inspection of its 02:10 frame shows a hire-in-progress panel with cancellation and finalization controls. Exact deadlines, automatic confirmation, undo effects, and current-client behavior remain unresolved; no numeric maximum horizon was established. [Queued launch review and editing](queued-launch-editing.md) now retains reserved identities and downstream references while changing the original manifest. Scheduling a later preparation edit remains a separate workflow. The linked contract records source timestamps, test coverage, and browser acceptance.

# Future actions

The Time Machine can now queue recruitment, promotions, captive releases, mine construction, shield changes, and funding at the inspected future time. Transfers retain their existing timing controls. Historical gameplay remains read-only. Live actions still use their immediate command paths.

The [official Steam description](https://store.steampowered.com/app/4831650/Subterfuge/) describes scheduling orders from the Time Machine. The [firsthand 2016 FAQ](https://herbertzhb.wordpress.com/2016/06/28/subterfuge-2/) explicitly discusses private future hires and promotions. Site and funding scheduling, execution ordering, and cancellation behavior here are the implementation interpretation; original-client acceptance is still required. This isn't a claim of complete future-order parity.

## Queue and execution

Transfers and actions share `game.scheduled`, the existing seven-day horizon, and the existing 20-order-per-player capacity. A transfer keeps its old shape. An action has `id`, `owner`, `executeAt`, and `action`. Supported action payloads are:

| Type | Additional fields |
| --- | --- |
| `hire` | `kind` |
| `promote`, `release` | `id` of the specialist |
| `drill-mine` | `rock` |
| `shields` | `rock`, `disabled` |
| `funding` | `to`, `enabled` |

No drones, specialists, credits, or cargo are reserved. Existing economy/arrival processing occurs first at an event hour, then due orders execute in queue insertion order. Each action uses the same engine operation as its live equivalent. A failed action logs a private abort and consumes no resources. Canceled dependencies can make later orders abort. Defeat, resignation, and game completion retain the existing queue cleanup.

Site identifiers are public, so a future site action can anticipate a conquest without probing hidden future state at submission. Runtime ownership, inventory, credit, promotion, and funding rules remain authoritative. Self-funding, absent recipients, invalid types, unknown fields, and domination mining/funding plans are rejected before persistence.

The UI labels future buttons with Schedule and the selected clock time, retains the real private queue while forecasting, and offers cancellation through the same queue panel. Map/timeline markers include all queued order times. Hauler commands, interceptions, and gifts remain live-only in this slice.

## Planned hires and privacy

A queued hire pins the current recruitment cycle and choice. If a different hire or promotion consumes that cycle first, the plan aborts rather than selecting from a new private offer. Forecasts expose credit usage but clear unknown subsequent offers and mark recruitment uncertainty. They don't simulate new offers from the forecast's placeholder RNG and present them as known choices.

Each planned hire reserves stable specialist *identities*, not resources: `hire:<owner>:<plan-id>:<index>`. Action plan IDs are limited to 60 characters so these identities fit the existing 80-character specialist-ID contract. The actual hire creates those identities directly; they don't depend on hidden counter values or collide with observed numbered specialists. This allows queued promotions and transfers to refer to a recruit that doesn't exist yet.

Public views translate planned and existing unit references through the caller's identity mapping. The server accepts only current caller-visible specialist aliases or identities from that caller's queued hires. Raw canonical IDs, foreign aliases, and hidden scoped identities fail uniformly. Future transfer manifests can refer to owned units currently elsewhere or to a queued hire, while exact departure availability is rechecked at execution. An ordered conquest can also establish a future departure site.

## Transport and persistence

`POST /v1/games/:id/schedules` accepts either the existing transfer body or `{requestId, revision, executeAt, action}`. Both use seat authentication, canonical receipts, revision checks, atomic persistence, and the existing cancel-schedule endpoint. The new canonical replay command is `schedule-action`; executing a queued action doesn't append a second command. Old transfer saves and histories retain their format and behavior. Mixed queues validate exact action shapes, private hire-cycle data, and stable hire identities before loading.

## Verification and open acceptance

All 268 engine, server, network, and plugin tests pass, along with TypeScript, web export, and standalone production server checks. New cases cover timing, future production, private aliasing, unknown offers, save/replay reconstruction, chained hire/promotion/transfers, anticipated conquests, existing-numbered-unit collisions, queue ordering, malformed data, HTTP ownership injection, retries, restart, cancellation, and changed requirements. Prior-engine compatibility fixtures remain in the full suite.

Real browser and phone acceptance remains incomplete because Safari bindings still return `cgWindowNotFound`. Future hauler changes, interception and gift planning, original finalization/confirmation behavior, the seven-day horizon and 20-order capacity, and less common rescue/ownership dependencies remain to compare against the original client. Full specialist, native gesture, and complete-match acceptance remain tracked in #18.

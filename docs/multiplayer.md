# Multiplayer service

The app now supports invite-only operations with two to ten human players. Solo operations stay local and continue using rival AI.

For Machination account login, account restoration, and legacy seat linking, see [account setup](accounts.md). The local review below uses device tokens when Clerk is not configured.

## Local review

```sh
npm run server
npm run web
```

In **Multiplayer uplink**, use `http://localhost:8787`. Create an operation, share its invitation code with the other players, and start once all configured seats are occupied. Browser seats are stored per tab in session storage; use separately opened tabs for independent seats. Native credentials are stored through [Expo SecureStore](https://docs.expo.dev/versions/v55.0.0/sdk/securestore/).

For the Android emulator, use `http://10.0.2.2:8787`. Remote devices require an HTTPS endpoint; the current local server is bound to loopback. Set `EXPO_PUBLIC_GAME_SERVER` before starting/exporting the app to change its initial server address. Native runtime and device networking still need verification.

The host controls Mnemosyne; later players control Vesper, Null collective, and the remaining intelligences in seat order. Every seat is human controlled. The lobby clock is frozen. The host's start command anchors server time. Afterward, one wall-clock hour is one game hour. Each request settles elapsed time, including arrivals and victory, so the result doesn't depend on someone keeping the app open. Online forecasts simulate known orders without inventing rival decisions.

Launches and private messages carry unique command IDs. The app saves a pending command before sending it and retains it through uncertain network failures. Retrying that command cannot apply it twice. A definitive HTTP rejection clears the pending command and refreshes the operation. Order revisions reject stale plans after another accepted order or module build by the same seat. Rival actions are validated through current state without exposing their command counts. Friendly reinforcement is supported through destination selection.

Private messages are returned only to their sender and recipient. They are stored on the server and are not end-to-end encrypted. Client and API messages are limited to 1,000 characters. The selected channel renders its latest 100 messages, with **Show earlier messages** loading more; the server retains the full history up to its documented limit.

## HTTP contract

`POST /v1/games` and `POST /v1/join` accept an optional top-level `preferredColor`: `teal`, `rust`, `gold`, `olive`, `plum`, `blue`, `coral`, `violet`, `lime`, or `orange`. This preference is separate from host-controlled game options. Joined seats keep their colors; unoccupied seats can yield their colors to a joiner's preference. A collision falls back to an available color. Retrying create/join returns the existing assignment. New operations expose the assigned palette IDs in `game.rules.colors`, in player order. These assignments persist in saves, observations, historical views, and replay exports; older games without the optional field retain portrait-based colors.

Base path: `/v1`. When Clerk is not configured, all game endpoints except `/games/:id/recover` use the **seat token** scheme: `Authorization: Bearer <64 lowercase hex characters>`. A client generates this token from 32 cryptographically random bytes and saves it before bootstrap. The server stores only its SHA-256 hash. Possession of the token controls that seat. A player can opt into offline seat recovery, described below. With Clerk configured, new and linked seats use [verified account sessions](accounts.md#http-authentication); Clerk provides account recovery. `/health` is public.

| Method | Path | JSON body | Result |
| --- | --- | --- | --- |
| POST | `/games` | `{}` | Create a host seat; repeat token resumes its existing operation |
| POST | `/join` | `{invite}` | Claim the next seat; repeat token resumes that seat |
| GET | `/games/:id` | none | Authorized game view and participant-filtered messages |
| POST | `/games/:id/start` | `{}` | Host starts once every configured seat is occupied; retry is harmless |
| POST | `/games/:id/orders` | `{requestId, revision, from, to, drones, carryModule?}` | Validate against the current server state and dispatch |
| POST | `/games/:id/gifts` | `{requestId, revision, from, to, drones, recipient, carryModule?}` | Launch immediate support owned by another active intelligence; destination must be its currently observed rock |
| POST | `/games/:id/intercepts` | `{requestId, revision, from, target, drones}` | Launch an owned interceptor against a visible enemy hauler |
| POST | `/games/:id/modules` | `{requestId, revision, rock, module}` | Spend drones on an owned rock and occupy its module bay |
| POST | `/games/:id/recovery` | `{requestId, secret}` | Register or replace a private recovery secret using the current seat token |
| POST | `/games/:id/recover` | `{secret}` | Recovery-code scheme: consume the secret and bind the seat to a fresh token |
| POST | `/games/:id/messages` | `{requestId, to, text}` | Private bilateral transmission |

A successful response is a `Snapshot` defined in `src/contracts/protocol.ts`. Failures use an `issues` array with a namespaced issue code, severity, correlation ID, timestamp, and user-readable message. Module keys are `routing`, `virus`, `scavenger`, and `charge`. Orders carry a module only when `carryModule` is true; otherwise it stays parked. A command ID reused with different content returns 409. The client must retain the same payload when retrying an uncertain command.

For a standalone runtime, container, health checks, and backup verification, see [hosted playtests](hosting.md).

## Voluntary support

Select a controlled departure and an observed rival rock, keep the launch delay at Now, then review and confirm a gift. The ordinary launch control still sends an attack. A gift immediately transfers hauler ownership, drones, any loaded module, and normal hauler sensors to the destination's intelligence. The donor cannot recall it. The recipient reinforces a still-friendly destination or fights if it changes hands. Gift launch telemetry goes to both participants and nearby observers; unrelated intelligences get no extra information. The donor retains only normal sensor contact with the hauler.

Gifts cannot be scheduled. The service rechecks current observation, recipient ownership, source control, module availability, and inventory atomically. Invalid or hidden destinations share the same failure. Both participants' command revisions advance because their owned assets changed. Retrying an identical gift request cannot donate twice, including after restart. Losing the donor core does not revoke the gift; losing the recipient core removes the recipient's haulers normally. Existing snapshots need no schema migration because gifts become ordinary recipient-owned haulers.

## Persistence and operation

The service uses a serialized transaction queue and a versioned JSON database. Mutations apply to a copy, write and flush a replacement file, and rename it before publishing the new in-memory state. A failed write doesn't publish a partial mutation. Startup refuses damaged or unsupported data. Snapshots, seat hashes, messages, and retry receipts survive a restart.

Run **one process per data file**. This is a small hosted-playtest backend, not a horizontally scalable service. The data file defaults to `.data/games.json`; back it up and preserve its filesystem permissions. No scheduled game worker is required: simulation catches up from the server clock on access.

| Environment variable | Default | Purpose |
| --- | --- | --- |
| `MACHINATION_DATA` | `.data/games.json` | Persistent database file |
| `MACHINATION_HOST` | `127.0.0.1` | Bind address |
| `PORT` | `8787` | Listening port |
| `MACHINATION_ORIGINS` | `http://localhost:8081,http://localhost:8082` | Exact allowed browser origins, comma separated |

Public hosting needs HTTPS termination, a persistent volume, backups, and an explicit allowed browser origin. The adapter limits JSON requests to 8 KB and 120 requests per minute per direct peer address. When proxied, the current limiter groups requests by the proxy's address. Operation capacity is 1,000 rooms, 10,000 accepted command IDs per room, and 5,000 private messages per room; reaching a limit returns an explicit failure rather than evicting retry history.

Remaining release work includes production account sign-in, general session management, push notification delivery, moderation, native device QA, and scaling beyond one process.

## Sensors and incomplete information

Every snapshot, including command and private-message responses, passes through the same server-owned observation filter. The response declares `visibility: "sensors.v1"`; the current client refuses an older full-state server response. Update client and server together for this protocol change.

An owned rock sees within 32 map units; an owned hauler sees within 16 units of its current transfer position. Boundaries are inclusive. Own rocks and haulers are always visible. The public chart retains each rock's fixed identity, name, coordinates, and initial kind, so players can send scouts to an unknown destination. Out-of-range rocks have `known: false` and omit ownership, drone counts, module bays, and core ownership. Enemy haulers outside coverage are absent. Cargo includes only the requesting seat's total. Elimination and the winner are public.

Hauler and private-message IDs are opaque, stable, and scoped to the authenticated seat. The hauler array retains the relative launch order of observed units, which forecasts use to resolve simultaneous arrivals. The global next-launch counter isn't returned. Command revisions count only the seat's own accepted orders and module builds, plus the host's initial start; hidden rival commands don't change them. Orders are still validated against current authoritative ownership, inventory, and elimination even if sensor information is stale.

Events record their audience when they occur. The server retains each observer's latest 80 telemetry events independently, so unseen activity cannot evict that player's history. Visible observers and combat participants retain that telemetry after contact is lost; later discovery never reveals earlier hidden events. Victory and elimination broadcasts go to all seats. Legacy events with no audience are withheld from online views because their original observers are unknown. Legacy seats without a private revision start at zero on load; previously accepted retry receipts remain valid, and an unaccepted stale pending order is rejected without a launch.

The online forecast operates only on the actual observations. It projects visible production, known transfers, and combat at observed destinations. It never simulates a garrison at a hidden destination or reveals newly covered territory from the authoritative server. An arrival at a hidden destination is marked **outcome unknown**; refresh after scouting to resolve it. Sensor coverage and contacts can disappear when predicted scouts or assets are lost. Hidden forces, earlier rival quota progress, and subsequent commands can change all projected outcomes. Solo remains a full-information training simulation.

## Scheduled orders

`POST /games/:id/schedules` accepts `{requestId, revision, from, to, drones, executeAt, carryModule?}`. `executeAt` is an absolute game hour, strictly after current server game time and no more than 168 hours ahead. The request ID becomes the private plan ID. `POST /games/:id/cancel-schedule` accepts `{requestId, revision, planId}`. Both use the normal seat token, private revision, and persistent retry receipt contract.

Snapshots include only the requesting player's plans in `game.scheduled`. Plan creation and cancellation increment that seat's revision. Actual clock-driven execution doesn't increment a command revision; every immediate command still validates current resources and ownership. Accepted scheduling/cancellation requests can be retried after execution or restart without repeating the action. A late cancellation fails once the plan has launched. Rate limiting retains an uncertain client command so it can be retried using its original ID.

Queues are persisted with the world and settled at the exact simulated launch time when the server processes a request. No player needs to remain connected. Queued launches participate in online forecasts, but hidden destination outcomes remain unresolved. Older saves without a queue load as having no pending plans. Update client and server together; the client now requires a scheduled-plan array in the response contract.

## Interception contract

`target` is the requesting seat's opaque hauler ID. Raw simulation IDs and another seat's IDs are rejected. Current visibility, ownership, payload, module, and reachability are checked authoritatively. Accepted requests use durable retry receipts before target validation on replay, so a retry remains harmless after combat or restart.

Visible fleets include explicit route geometry for interception and return legs. An interception's target reference is included only while that target is visible and uses the same seat-scoped ID mapping. The forecast sets `interceptionUncertain: true` when a projected rendezvous has no observed target; it invents neither a combat result nor a return payload. Refreshing the authoritative view resolves the actual outcome.

## Offline seat recovery

While connected, choose **Generate recovery code** and save the code with the server address in a private place, such as a password manager. The app displays the code only after the server confirms registration. It contains the operation ID and a cryptographically generated 32-byte secret. Generating another code replaces the old one. Codes remain valid until replaced or used; they are offline backup credentials rather than email reset links.

On another device, enter the same server address and the saved code under **Restore your seat**. Restoration revokes the old connection and consumes the code. Generate and save a new code after recovery. Without a code saved earlier, a lost credential cannot be recovered. There is no external identity verification or email recovery service.

`POST /games/:id/recovery` uses the **seat token** scheme and accepts `{requestId, secret}`. The secret must be 64 lowercase hex characters. Its SHA-256 hash, not its plaintext value, is persisted. The registration receipt contains only that hash. Replaying a registration after its code was replaced or consumed returns `409 recovery.conflict.superseded`; the client must not present that old code as active. Registration and recovery do not change game-order revisions.

`POST /games/:id/recover` uses the **recovery-code** scheme. Send the saved secret in JSON as `{secret}` and a newly generated 32-byte seat token as `Authorization: Bearer <64 lowercase hex characters>`. The new token is the destination credential, not proof of the old seat. The service authenticates the saved recovery secret. A code cannot move the seat onto an already assigned credential. Invalid, replaced, or consumed codes return `401 recovery.unauthorized.code`.

The code is consumed and the new token hash is committed atomically before success is returned. A hash-only recovery receipt permits exact retries with the same secret and replacement token after a lost response or server restart. Other replacement tokens cannot reuse the consumed code. A failed durable write publishes neither credential replacement nor code consumption. The app persists its fresh credential and pending recovery request before sending it. Uncertain failures retain that request; definitive recovery rejection removes the unclaimed local connection so the player can correct the code.

Recovery preserves the seat's faction, private plans, messages, order receipts, revisions, and opaque contact IDs. The ID mapping retains its original private key across credential replacement. Snapshots expose only `recoveryEnabled` for the requesting seat; they never expose hashes, secrets, or recovery receipts. Legacy seats without recovery metadata continue to load with recovery disabled. Update the client and server together to use the recovery endpoints.

The offline-code design follows [OWASP's recovery guidance](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html) on cryptographic randomness, one-way storage, and single-use credentials.

## Persistent factions

After your first completed online operation, open **Factions and next operation** and choose a permanent allegiance. Wins, losses, and draws qualify once the whole operation finishes; leaving a lobby or being eliminated while a match continues doesn't qualify. Solo and tactical practice don't contribute to this server-owned progression.

| Faction | Starting elite in faction mode |
| --- | --- |
| Mnemosyne | Bulwark (Security Chief): global and local shield capacity |
| Vesper | Warmind (General): global combat support |
| Null collective | Overseer (Tycoon): faster global factory production |

Review the faction's specialist before pressing **Join … permanently**. Choose **Faction mode** when creating your next operation, or join a faction-mode invitation. Every participant needs a faction before joining. Seat order, portrait, and corporation identity don't change allegiance. Multiple players can belong to the same faction and still compete individually. Faction mode currently uses free-for-all victories.

Each participant receives one extra elite at their core when the host starts. The core, hiring credits, recruitment offers, and cargo remain intact. The elite uses ordinary specialist movement, capture, combat, and global-effect rules. Standard operations retain their normal opening.

The **Faction leaderboard** shows total wins from completed faction-mode operations on this server. Each operation awards one win to its winner's frozen faction; draws award none. Standard wins aren't counted retroactively. The server derives totals from completed rooms, so refreshes, retries, and restarts cannot count a match twice. Standings refresh also settles elapsed server time, including unattended finishes.

Use **Create next operation** or **Join next operation** after a match to keep the same identity and faction. Account login, seat recovery, and account linking preserve faction membership. A device-only player's progression requires their retained credential or saved recovery code; disconnecting and creating a fresh device identity starts fresh progression. Keep the server database when moving hosts.

### Faction HTTP contract

`GET /v1/factions` returns `{completedGames, faction?, leaderboard: [{faction, wins}]}`. `POST /v1/factions` takes exactly `{faction}` with `mnemosyne`, `vesper`, or `null`. Both accept verified account authentication or a current device-seat credential. Repeating the selected faction is harmless; changing it returns `409 faction.conflict.chosen`. Selecting before completing an online operation returns `409 faction.conflict.locked`.

Create with `POST /v1/games` and `{options, variant: "faction"}`. Omit `variant` for a standard operation. Invitations inherit the host's variant. Players without an allegiance receive `409 faction.conflict.required`. Faction snapshots add `variant: "faction"` and `allegiances: [{player, faction}]`; standard snapshots omit both. The extra specialists are part of the initial replay baseline, so history, forecasts, and restarts retain the same opening. Existing database files load without faction metadata.

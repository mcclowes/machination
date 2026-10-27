# Multiplayer service

The app now supports invite-only operations with three human players. Solo operations stay local and continue using rival AI.

## Local review

```sh
npm run server
npm run web
```

In **Multiplayer uplink**, use `http://localhost:8787`. Create an operation, share its invitation code with two players, and start once all seats are occupied. Browser seats are stored per tab in session storage; use separately opened tabs for independent seats. Native credentials are stored through [Expo SecureStore](https://docs.expo.dev/versions/v55.0.0/sdk/securestore/).

For the Android emulator, use `http://10.0.2.2:8787`. Remote devices require an HTTPS endpoint; the current local server is bound to loopback. Set `EXPO_PUBLIC_GAME_SERVER` before starting/exporting the app to change its initial server address. Native runtime and device networking still need verification.

The host controls Mnemosyne; the next players control Vesper and Null collective. All three seats are human controlled. The lobby clock is frozen. The host's start command anchors server time. Afterward, one wall-clock hour is one game hour. Each request settles elapsed time, including arrivals and victory, so the result doesn't depend on someone keeping the app open. Online forecasts simulate known orders without inventing rival decisions.

Launches and private messages carry unique command IDs. The app saves a pending command before sending it and retains it through uncertain network failures. Retrying that command cannot apply it twice. A definitive HTTP rejection clears the pending command and refreshes the operation. Order revisions reject stale plans after another accepted order. Friendly reinforcement is supported through destination selection.

Private messages are returned only to their sender and recipient. They are stored on the server and are not end-to-end encrypted. Client messages are limited to 300 characters; the API accepts up to 1,000. Only the latest 30 messages in the selected bilateral channel are rendered; the server retains the full history up to its documented limit.

## HTTP contract

Base path: `/v1`. All endpoints other than `/health` use the **seat token** scheme: `Authorization: Bearer <64 lowercase hex characters>`. A client generates this token from 32 cryptographically random bytes and saves it before bootstrap. The server stores only its SHA-256 hash. Possession of the token controls that seat. No account recovery or token rotation is implemented yet.

| Method | Path | JSON body | Result |
| --- | --- | --- | --- |
| POST | `/games` | `{}` | Create a host seat; repeat token resumes its existing operation |
| POST | `/join` | `{invite}` | Claim the next seat; repeat token resumes that seat |
| GET | `/games/:id` | none | Authorized game view and participant-filtered messages |
| POST | `/games/:id/start` | `{}` | Host starts with three occupied seats; retry is harmless |
| POST | `/games/:id/orders` | `{requestId, revision, from, to, drones, carryModule?}` | Validate against the current server state and dispatch |
| POST | `/games/:id/modules` | `{requestId, revision, rock, module}` | Spend drones on an owned rock and occupy its module bay |
| POST | `/games/:id/messages` | `{requestId, to, text}` | Private bilateral transmission |

A successful response is a `Snapshot` defined in `src/online/protocol.ts`. Failures use an `issues` array with a namespaced issue code, severity, correlation ID, timestamp, and user-readable message. Module keys are `routing`, `virus`, `scavenger`, and `charge`. Orders carry a module only when `carryModule` is true; otherwise it stays parked. A command ID reused with different content returns 409. The client must retain the same payload when retrying an uncertain command.

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

Remaining release work includes hosting, account recovery, revocation, push notifications, moderation, native device QA, and scaling beyond one process.

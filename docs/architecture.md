# Architecture and change boundaries

The simulation is shared by the server, local operations, forecasts, and replay generation. Keep that shared behavior independent of React, native APIs, storage, and HTTP. Run `npm run check:architecture` to enforce the dependency direction.

| Owner | Responsibility | Allowed dependencies |
| --- | --- | --- |
| `src/game` | Simulation, commands, observation rules, save formats, and replay reconstruction | Other game modules |
| `src/contracts` | Wire types, notification constants, and runtime envelope decoding | Contracts and game modules |
| `src/replay` | Shareable replay generation, presentation, playback, and platform file adapters | Game and presentation formats; keep file adapters outside server generation paths |
| `src/solo` | Local persistence and the operation's load/save/clock lifecycle | Game rules and platform storage |
| `src/online` | Seat connections, durable pending commands, notifications, and multiplayer presentation | Contracts, game rules, and platform adapters |
| `src/components` | Focused controls, chart interactions, and screen composition | Props, shared decision functions, and explicit workflow hooks |
| `server` | HTTP, transactions, authoritative settlement, and server policies | Server, contracts, game, and shared replay code |

`App.tsx` composes screens. Its local operation uses `useLocalOperation` for restoration, persistence, and elapsed time. Multiplayer uses `useOnlineConnection` for credentials, restoration, polling, recovery, and durable retries. `useNotificationTap` reads each tap's current binding and consent before requesting navigation. The screen owns selection, drawers, and visible messages.

Transfer planning and course selection share an exclusive state in `planning-mode.ts`. Closing one interaction doesn't cancel the other accidentally. Keep local execution and server-authoritative execution separate; their persistence, visibility, and retry guarantees differ.

The server service owns authorization order, settlement, and transaction boundaries. `seat-credentials.ts` owns credential mechanics, `command-receipts.ts` owns idempotency, and `diplomacy.ts` owns fixed membership and message retention. These policies accept transaction-local data. They don't start transactions or call the service back. Notification enqueue and the corresponding command still commit together.

## Checks and formatting

- `npm run check:quality` runs hooks/boundary lint, formatting, architecture checks, and TypeScript.
- `npm test` runs behavior tests; `npm run test:server-build` checks standalone packaging and restart behavior.
- `npm run test:smoke` exercises the real web chart, inspection, time tray, and scheduled-order editing on desktop and phone viewports.
- `npm run benchmark:service` measures the existing persistence and history model before a backend change.

Prettier is adopted through its standard `@format` pragma. The operation screens, extracted workflows, shared contracts, and server orchestration are migrated. This keeps formatter adoption separate from unrelated concurrent gameplay work. To migrate a file, run `npm run format -- --insert-pragma --no-require-pragma path/to/file.ts`. Subsequent `format:check` runs enforce its formatting. Keep future edits to migrated files formatted.

Hooks lint runs across production TypeScript. Use effect events for values that must be current when an explicit epoch, request, or layout signal changes. Adding a moving game object to a camera effect's dependencies can reset a player's pan on every poll; adding a fresh seat object to a history effect can cause repeated requests. Keep the actual triggering key explicit, and verify the observable lifecycle when changing it. The pinned React Native 0.83 / React 19.2 runtime [supports effect events](https://reactnative.dev/blog/2025/12/10/react-native-0.83).

Node UI tests replace explicit platform adapters while retaining real React components and handlers. `src/test-support/native-component.ts` owns repeated bundling and React-instance resolution. Keep each scenario's native, clock, storage, and network fakes local. The browser smoke checks complement these tests; they don't establish physical-device permissions, gestures, or notification delivery.

## CI and repository policy

CI runs source quality, behavior, server packaging, platform exports, the player guide, and browser smoke independently. Its final `check` job requires all six to succeed. A container failure no longer hides platform or guide results. Browser failures retain traces and screenshots for seven days.

`main` requires an up-to-date passing `check` through a pull request. No second-person approval is required. Force pushes and deletion are blocked, including for administrators. Local commits remain automatic; publishing and pushing still require explicit authorization.

## Persistence capacity

The current service intentionally uses one process and an atomic JSON file. Transactions clone and serialize the whole database, snapshots may settle time, and historical reconstruction shares the transaction queue. Don't add replicas against the same file.

See the [measured service baseline](service-capacity.md). Run `npm run benchmark:service -- --rooms=1,10 --commands=100 --samples=20 --hours=24` through the machine's normal scheduler. It uses disposable databases and reports command, poll, history, catch-up, queued-room, event-loop, and file-size measurements with the exact Node/V8 versions. These are local workload measurements, not a production capacity guarantee. Choose checkpoints or room-scoped/SQLite persistence only after the measured bottleneck justifies them.

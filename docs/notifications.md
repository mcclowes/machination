# Message notifications

Tracking: [#74](https://github.com/mcclowes/machination/issues/74), under [fidelity #18](https://github.com/mcclowes/machination/issues/18). This is the implementation contract; delivery acceptance is not yet complete.

## Reference and scope

Ron Carmel's [October 15, 2015 interview](https://www.gamedeveloper.com/design/-a-brawl-and-a-race-designing-for-the-long-game-in-i-subterfuge-i-) describes automatic push notifications for information players could not have predicted. This establishes a historical design principle, not the current client's complete trigger list. Incoming messages are the first rebuild interpretation of that principle. Exact current-original message preferences remain unobserved.

This slice provides opt-in native notifications for incoming bilateral, private-group, and public-channel messages. Existing audience authorization applies, and senders receive no notification for their own messages. It does not establish parity for unexpected game-state changes. The separate contextual Alerts sheet remains [#75](https://github.com/mcclowes/machination/issues/75); no alarm options are inferred from its icon.

## Device preference API

Both endpoints use the existing seat credential contract: a legacy seat bearer, or the configured Clerk account bearer resolved to that room's seat. Device IDs and bodies never select a recipient faction. Preferences do not settle game time, renew inactivity, change order revisions, or enter command replay.

- `GET /v1/games/:id/notifications?deviceId=<64 lowercase hex characters>` returns `MessageNotificationSettings`.
- `POST /v1/games/:id/notifications` accepts `SetMessageNotifications` and returns the same view.

Types live in [notification-contract.ts](../src/online/notification-contract.ts). A device ID is generated once per installation and kept in native secure storage. Requests use the existing request-ID syntax. The revision belongs to the device preference, independently of game orders. Set requests reject stale revisions; identical request retries return the current preference without reapplying an old enable operation. Disabled records retain their revision. Responses expose no push token or credential hash.

An enabled request requires a valid Expo push token; a disabled request omits it. Reject unknown fields and malformed values. Registration is bound to the authenticated credential generation, so account linking or legacy recovery invalidates old bindings. Tokens belong to at most one current binding across rooms; registering this physical installation for another seat detaches the former binding without exposing it. Keep bounded device records and active-device limits, and report capacity errors explicitly.

`available` reports whether the operator enabled server delivery. It does not certify provider credentials or device delivery. Disabled servers reject enable requests while still permitting disable and status reads. Migration leaves existing rooms unsubscribed.

## Durable delivery

Enqueue notifications in the same atomic transaction as an accepted new message. Use the message's actual audience, exclude its sender, and enqueue only for current enabled bindings. No old-message backfill occurs when enabling. Request retries, failed writes, and restarts must not create duplicate logical jobs. Notification failures must not undo an accepted message.

The visible text is generic: title `Machination`, body `New transmission received.` No message body, sender, group name, asset, credentials, recovery data, or hidden game state enters the push payload. Data contains only `MessageNotificationData`. Binding IDs are server-generated opaque values; notification IDs are stable across retries. Use the same stable ID for provider collapse/replacement fields.

The background worker claims bounded batches with durable leases, sends outside database transactions, records Expo tickets, and checks receipts. It handles backoff, invalid tokens, malformed responses, expiry, restart, disable, and credential invalidation. It must not renew player activity or simulate unrelated game time. Queue limits must be explicit and must not make ordinary chat unavailable. Closing the host stops new claims and drains or releases its current work within the existing shutdown grace period.

Expo's [delivery documentation](https://docs.expo.dev/push-notifications/sending-notifications/) distinguishes tickets from receipts and describes best-effort delivery. Stable IDs and collapse/replacement reduce duplicate presentation; exactly-once device delivery is not promised. Provider acceptance does not prove that a person received a notification.

## Native client

An explicit Message notifications action requests OS permission and registers the current installation. Reading settings or opening the app never requests permission. Denial, unsupported builds, token failures, unavailable servers, and unsuccessful disabling retain an honest state and a retry path. Opt-in state is scoped to the server, authenticated seat, game, and installation. Session changes and stale async completions cannot enable the wrong seat.

Use Expo SDK 55's native notification adapter; web and offline entry must remain independent of it. Foreground OS banners are suppressed because existing in-app signals handle that context. A notification tap can open multiplayer, but only opens Signals after its game and binding match the restored authenticated operation. Ignore foreign or stale payloads, deduplicate responses, and clear consumed native response state. Never issue a game command or overwrite another operation merely because a payload names it.

The app requires a configured EAS project ID and native push capabilities. The operator controls server delivery separately. No Expo project, signing credential, deployment, OS permission, or live push is created by writing this code.

## Acceptance

Exercise actual service and HTTP boundaries for audience privacy, authentication, registration, revision and retry behavior, failed-write rollback, recovery/link invalidation, restart, and unavailable delivery. Use a fake provider for deterministic ticket, receipt, backoff, expiry, and shutdown scenarios; record that it does not prove real device delivery.

Drive real client state through permission denial, opt-in/off, reload, token rotation, account changes, network failure, and notification taps. Export web and native bundles, compile the native capabilities, and verify background/closed-app receipt and safe tap navigation on configured target runtimes before closing #74. Foreground logs, host tests, and successful packaging are insufficient delivery evidence.

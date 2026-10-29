# Message notifications

Tracking: [#74](https://github.com/mcclowes/machination/issues/74), under [fidelity #18](https://github.com/mcclowes/machination/issues/18). This is the implementation contract; delivery acceptance is not yet complete.

## Reference and scope

Ron Carmel's [October 15, 2015 interview](https://www.gamedeveloper.com/design/-a-brawl-and-a-race-designing-for-the-long-game-in-i-subterfuge-i-) describes automatic push notifications for information players could not have predicted. This establishes a historical design principle, not the current client's complete trigger list. Incoming messages are the first rebuild interpretation of that principle. Exact current-original message preferences remain unobserved.

This slice provides opt-in native notifications for incoming bilateral, private-group, and public-channel messages. Existing audience authorization applies, and senders receive no notification for their own messages. It does not establish parity for unexpected game-state changes. The separate contextual Alerts sheet remains [#75](https://github.com/mcclowes/machination/issues/75); no alarm options are inferred from its icon.

The publisher-linked [launch trailer](https://www.youtube.com/watch?v=WECvxdJv3kk&t=32s) shows an incoming-attack push with attacker, drillers, and ETA; at 94 seconds it shows the same information over the chart. This is staged alpha-era footage, also reused by the 2014 trailer and Steam Crossplay. Exact firing time, defaults, rounding, and bell linkage remain unknown. [#80](https://github.com/mcclowes/machination/issues/80) tracks implementation with those limits.

The server audit found a required delivery boundary: game time currently settles during HTTP transactions, while the worker only sends existing message jobs. With every client closed, a prepared attack is not materialized as a departure until the next request catches up. Incoming delivery therefore needs background settlement, observed-threat detection, typed jobs with fresh claim-time information, and consent; a new text template alone cannot provide it. The selected contract and legacy API compatibility requirements are in #80. This work is underway separately; incoming delivery is not implemented in the current shared tree.

## Device preference API

Both endpoints use the existing seat credential contract: a legacy seat bearer, or the configured Clerk account bearer resolved to that room's seat. Device IDs and bodies never select a recipient faction. Preferences do not settle game time, renew inactivity, change order revisions, or enter command replay.

- `GET /v1/games/:id/notifications?deviceId=<64 lowercase hex characters>` returns `MessageNotificationSettings`.
- `POST /v1/games/:id/notifications` accepts `SetMessageNotifications` and returns the same view.

Types live in [notification-contract.ts](../src/online/notification-contract.ts). A device ID is generated once per installation and kept in native secure storage. Requests use the existing request-ID syntax. The revision belongs to the device preference, independently of game orders. Set requests reject stale revisions; identical retries retained in a record return the current preference without reapplying an old enable. Disabled records retain their revision while stored. Evicting a disabled record raises a persisted seat revision floor above that record's last revision; unknown devices then read that floor, and old requests fail as stale. Responses expose no push token or credential hash.

An enabled request requires a valid Expo push token; a disabled request omits it. Reject unknown fields and malformed values. Registration is bound to the authenticated credential generation, so account linking or legacy recovery invalidates old bindings. Tokens belong to at most one current binding across rooms; registering this physical installation for another seat detaches the former binding without exposing it. Keep bounded device records and active-device limits, and report capacity errors explicitly.

`available` reports whether the operator enabled server delivery. It does not certify provider credentials or device delivery. Disabled servers reject enable requests while still permitting disable and status reads. Migration leaves existing rooms unsubscribed.

Each seat keeps at most four device records, replacing its oldest disabled or invalidated record when necessary. Four active devices cause an explicit `notification.capacity.devices` conflict. Each record keeps sixteen request receipts. The server limits stored bindings to 40,000 and queued/in-flight jobs to 5,000 overall, with at most eight jobs per binding; excess jobs are skipped while chat remains accepted. Each send has at most eight attempts within 24 hours, including attempts lost to expired leases or shutdown. Receipts are checked after fifteen minutes and retained for at most 24 hours after ticket acceptance.

## Durable delivery

Enqueue notifications in the same atomic transaction as an accepted new message. Use the message's actual audience, exclude its sender, and enqueue only for current enabled bindings. No old-message backfill occurs when enabling. Request retries, failed writes, and restarts must not create duplicate logical jobs. Notification failures must not undo an accepted message.

The visible text is generic: title `Machination`, body `New transmission received.` No message body, sender, group name, asset, credentials, recovery data, or hidden game state enters the push payload. Data contains only `MessageNotificationData`. Binding IDs are server-generated opaque values; notification IDs are stable across retries. Use the same stable ID for provider collapse/replacement fields.

The background worker claims bounded batches with durable leases, sends outside database transactions, records Expo tickets, and checks receipts. It handles backoff, invalid tokens, malformed responses, expiry, restart, disable, and credential invalidation. It must not renew player activity or simulate unrelated game time. Queue limits must be explicit and must not make ordinary chat unavailable. Closing the host stops new claims and drains or releases its current work within the existing shutdown grace period.

Expo's [delivery documentation](https://docs.expo.dev/push-notifications/sending-notifications/) distinguishes tickets from receipts and describes best-effort delivery. Stable IDs and collapse/replacement reduce duplicate presentation; exactly-once device delivery is not promised. Provider acceptance does not prove that a person received a notification.

## Native client

An explicit Message notifications action requests OS permission and registers the current installation. Reading settings or opening the app never requests permission. Denial, unsupported builds, token failures, unavailable servers, and unsuccessful disabling retain an honest state and a retry path. Opt-in state is scoped to the server, authenticated seat, game, and installation. Session changes and stale async completions cannot enable the wrong seat.

Use Expo SDK 55's native notification adapter; web and offline entry must remain independent of it. Foreground OS banners are suppressed because existing in-app signals handle that context. A notification tap can open multiplayer, but only opens Signals after its game and binding match the restored authenticated operation. Each new tap reads the current server binding rather than trusting cached settings. Transient restore or settings failures keep it pending with Retry and Dismiss actions; a rejected seat or confirmed mismatch consumes it. Ignore foreign or stale payloads, deduplicate responses, and clear consumed native response state. Never issue a game command or overwrite another operation merely because a payload names it. Normal foreground connection and presence behavior still applies when multiplayer opens.

The app requires a configured EAS project ID and native push capabilities. The operator controls server delivery separately. No Expo project, signing credential, deployment, OS permission, or live push is created by writing this code.

## Operator setup

Set `EXPO_PUBLIC_EAS_PROJECT_ID` to the existing Expo project's UUID before building the native app. The notification plugin includes the Android `machination-messages` channel configuration and a white notification icon. Physical iOS and Android delivery also need the project's APNs or FCM credentials and platform signing configuration. Adding this dependency requires a fresh native build; replacing only JavaScript in a pre-notification binary is insufficient.

The server defaults to delivery off. Set `MACHINATION_PUSH_ENABLED=1` to start the Expo worker; `0` or unset keeps it off, and other values refuse startup. Set server-only `EXPO_ACCESS_TOKEN` if the Expo project requires enhanced push security. Never expose that token as an `EXPO_PUBLIC_` variable. Enabling the worker reports availability, not successful credential validation.

After connecting a seat, open Setup and choose Turn on message notifications. Permission denial sends no enable request. Registration is only shown as enabled after a successful server response; a lost response can be retried safely. Turning it off keeps its revision and cancels pending work. Preference errors preserve explicit server details; a stale revision reloads the current setting before another change.

If an accepted enable response is lost and the token then changes, Retry first reconciles with the server. An enabled binding gets the current token; a later server-side disable stays off. A failed account restore keeps the tap pending until an explicit retry. An expired account credential while linking does not invalidate the existing device seat; a rejected device-seat credential still clears access.

Expo SDK 55 persists its native-token auto-registration after an opt-in and refreshes that mapping when the SDK next loads. The app loads it at startup after a prior registration and does not request permission or acquire a new Expo token on every launch. After a successful registration in the mounted seat, repeated native events for the same Expo token do not rewrite the subscription.

## Acceptance

Exercise actual service and HTTP boundaries for audience privacy, authentication, registration, revision and retry behavior, failed-write rollback, recovery/link invalidation, restart, and unavailable delivery. Use a fake provider for deterministic ticket, receipt, backoff, expiry, and shutdown scenarios; record that it does not prove real device delivery.

Drive real client state through permission denial, opt-in/off, reload, token rotation, account changes, network failure, and notification taps. Export web and native bundles, compile the native capabilities, and verify background/closed-app receipt and safe tap navigation on configured target runtimes before closing #74. Foreground logs, host tests, and successful packaging are insufficient delivery evidence.

# Chat object references

Issue #18 implements the publisher's [version 11782 release note](https://apps.apple.com/us/app/subterfuge/id702951905): copying subs and outposts into chat. The exact original gesture, syntax, and tap behavior haven't been verified. The rebuild uses explicit Copy reference controls and recipient-filtered map inspection.

## Contract

References identify an object without granting visibility or commands. Server responses add an optional `references` sidecar containing version 1, public outpost IDs, observed recipient-local hauler aliases, and room-stable opaque digests. A private random room key produces domain-separated HMAC-SHA256 references. No canonical fleet ID, seat key, donor snapshot, unit identity, or private plan is embedded. Missing sidecars remain compatible with old servers and clients.

The text grammar is `[[machination:v1:<gameId>:<outpost|hauler>:<64 lowercase hex digest>:<hour>]]`. Operation IDs contain 24 lowercase hex characters. Hours use JavaScript's finite, nonnegative canonical number representation, including scientific notation where necessary, and round-trip exactly. Tokens are ordinary text, retaining existing message limits, private audiences, persistence, and retry receipts. Unknown or malformed tokens remain literal text. The parser doesn't execute markup or navigate URLs.

Copying uses only authoritative live or historical frames. Forecast objects and private queued launches aren't assigned copy references. Clipboard writes require an explicit action; the app never reads the clipboard in the background. Pasting uses the normal chat editor and preserves its selected thread and cursor.

Tapping a reference inspects its copied operation hour. Inspect now is a separate action. Existing authenticated history responses provide the recipient's frame and sidecar; matching occurs only inside that filtered frame. A separate resolver endpoint isn't needed. Missing/unobservable objects give one generic unavailable result. Wrong-game references don't switch connections. Hours outside retained history or ahead of live observations aren't silently substituted. The token hour is requested context, not certified evidence of what the sender saw.

Inspection cancels route planning and course selection before focusing the wrapped chart and opening the recipient's inspector. It never uses an order-producing selection callback. Navigation, time changes, seat/operation/origin changes, and new taps invalidate pending inspection. Late historical replies can't reopen an old target. Private/public/group drafts survive map navigation and remain scoped to the connection identity.

## Acceptance

Verify stable opaque identities across seats, restart, recovery, and history, with no references for unobserved contacts. Preserve old rooms and replay archives; persist migration before exposing a new key. Test malformed storage and failed writes. Keep command aliases seat-scoped.

Exercise literal reference text through every chat type, lost replies, duplicate requests, restart, changed-payload conflicts, and retention eviction. Verify strict parsing, mixed prose, malformed/unknown versions, hostile markup, exact fractional-hour round trips, and message bounds.

Verify copied-hour and live inspection with different recipient aliases and sonar; stale arrivals and hidden contacts must not expose details. Test wrong operations, identity changes, canceled/late historical loads, wrapped camera focus, and armed route/course selection. TypeScript, the complete suite, web export, and production server checks are required. Browser/native clipboard and tap acceptance remain separate from source and automated checks.

## Implementation and verification

The server identity/projection and codec/chat components are committed in `5eda9af` and `93312e2`. Integration adds live and historical outpost/hauler copy controls, copied-time or current inspection, recipient-local alias resolution, camera focus across seams, and explicit cancellation on time/navigation/identity changes. Public/private/group chat use the same text representation and existing saved requests. Readable labels replace recognized wire tokens in modern chat; Copy reference forwards the exact original token. Unknown syntax and unsupported clients retain literal text.

Automated checks cover strict sidecar validation and live operation identity, parser bounds and hostile content, real inspection handlers, hidden contacts, copied-time limits, terminal-frame context, wrapped focus, durable room migration/failure/recovery, and real HTTP chat-to-recipient-to-history-to-restart inspection. The existing historical loader tests cover canceled and late requests keyed to server, token, operation, seat, and time. Root inspection clears armed route/course state directly and never calls the map order-selection callback. That wiring is source-reviewed; automated helper and HTTP tests do not prove physical UI interaction.

Chrome remains unavailable with `cgWindowNotFound`. Clipboard writes, paste/cursor behavior, navigation while history loads, small-screen layout, keyboard/screen-reader use, and native phone gestures remain unverified in the rendered application. No full shared-replay viewer is implemented by chat references. Recruitment lifecycle and the broader fidelity goal remain open.

Final validation: 333 tests pass, as do TypeScript, web export, and the standalone production server's two acceptance checks. No original-client interaction or physical-phone acceptance is implied by these checks.

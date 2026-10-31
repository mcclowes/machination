# Multiplayer client compatibility

Tracking: [#135](https://github.com/mcclowes/machination/issues/135). This describes the source contract, not a verified production rollout or physical-device acceptance.

The distributed TestFlight 0.1.0 (2) client uses strict rule decoders from `e93faf68e9696f3218538d642440c9df29ad8bee`. It rejects `rules.colors` and mechanics revision 19. HTTP responses therefore negotiate a representation independently of each operation's recorded rules. Resource routes remain under `/v1`.

| Request | New operation | Response |
| --- | --- | --- |
| No explicit version, a wildcard, or `application/json` | Revision 18 | Omits `rules.colors` from serialized snapshots, account envelopes, history, and observed replay scenes |
| Preferred `application/vnd.machination.v2+json` | Revision 19 | Includes canonical player colors and supports current gravity rules |

Current clients send `Accept: application/vnd.machination.v2+json, application/json` from both the ordinary API and replay request paths. The server respects positive quality values and prefers the explicitly supported current representation when its quality is at least that of JSON. A wildcard alone does not advertise a newer decoder. Responses vary on `Origin` and `Accept` and remain `no-store`.

An older server can ignore this Accept value and return ordinary JSON, which current decoders still accept. That fallback does not add support for newer command fields to the older server. Stage compatible server support before exposing new features in a client.

## Recorded state and access

Existing operations keep their mechanics revision, seats, colors, histories, and retry receipts. Projection removes only the presentation field from serialized rules; it does not rewrite stored data or label revision 19 as revision 18. New operations requested by older clients are created with actual revision 18 rules and gravity disabled. Current clients retain the current default of gravity enabled for stationary bases.

Older clients receive HTTP 503 with `client.unavailable.upgrade` and an instruction to update when an operation requires newer rules. Authorization precedes disclosure for seat-scoped reads. Unsupported commands, joining, bootstrap retries, recovery, account linking, and account restoration refuse before accepting incompatible state changes or rotating credentials. An unsupported gravity request does not create an operation. Notification preferences retain their existing permission and consent rules independently of the game representation.

The retryable status is deliberate: released clients treat definitive 4xx responses as rejected commands and delete a pending recovery connection. An upgrade response must retain the original request, recovery secret, and credential until a compatible client retries. No `Retry-After` is invented for a required software update.

## Verification

`server/fixtures/released-client/build-2.mjs` contains the actual released snapshot, history, replay, and network code. Its manifest records the full source commit, source hashes, bundler version, and generated-byte hash. Tests use these committed bytes, so shallow CI checkouts need no historical fetch. To reproduce the fixture with that commit available locally:

```sh
node scripts/build-released-client-fixture.mjs
```

The HTTP scenarios cover default legacy creation, current colors and gravity, mixed seats, private delivery, retries, restart, history, replay, account linking, restoration, and refusal of newer rules before writes. A recovery scenario first exercises the released request code, then retries the same secret and credential through the current request code after upgrading. An accepted retry remains idempotent.

These checks do not establish native keychain behavior, browser authentication, APNs delivery, physical-device interaction, or every earlier TestFlight build. The pinned released baseline is build 2. Verify the actual deployed revision and a signed compatible client before claiming release readiness; see [release gates](ios-release-readiness.md).

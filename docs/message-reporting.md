# Message reporting and operator review

Tracking: [#139](https://github.com/mcclowes/machination/issues/139). Reporting is disabled by default. This source change isn't a production rollout or a native acceptance result.

## Player behavior

An enabled server offers **Report message** beside another player's public, group, or bilateral transmission. The player selects a reason, optionally adds up to 500 characters, and confirms. The receipt means the report was saved for operator review; it doesn't mean anyone reviewed it or took action. Other players cannot see the report. Reporting doesn't block a player or affect tactical activity; [message blocking](message-blocking.md) remains separate.

The server resolves the reporting seat's actual message reference and copies canonical evidence. A caller cannot submit replacement evidence or report another group's private content. Bilateral references are seat-specific aliases, not canonical database IDs. Blocking presentation doesn't remove entitlement to report previously received messages. Reporting one's own message is refused.

An uncertain response retains its original request while the operation remains mounted. Closing the confirmation allows resuming and retrying that same intent. Confirmed receipts reopen without submitting again. Account, operation, device credential, and message changes revoke stale actions and completions. Report text isn't newly persisted on the device; process termination can lose an unconfirmed client intent. Server acknowledgements and review identities remain durable across service and SQL restart.

## Configure operators separately

The service needs all three fields together:

| Variable | Meaning |
| --- | --- |
| `MACHINATION_OPERATOR_CLERK_ISSUER` | Exact HTTPS issuer origin for the chosen operator Clerk instance |
| `MACHINATION_OPERATOR_CLERK_JWT_KEY` | RSA SPKI public PEM; literal `\n` separators are accepted |
| `MACHINATION_OPERATOR_ACCOUNTS` | Comma-separated, unique, exact `user_...` account IDs authorized to review all reports |

Missing all three disables operator access. Partial, empty, malformed, private-key, duplicate-account, or invalid-origin configuration refuses startup before opening storage. Verified sessions must satisfy signature, issuer, expiry, session, authorized-party, and account-allowlist checks. A host faction, player credential, or caller-provided role grants no operator authority.

These fields don't enable player `CLERK_*` authentication. Turning on the existing player verifier also requires accounts for new operation creation/joining, which needs a compatible client rollout. See [accounts](accounts.md).

First verify a real operator session can list reports, an unlisted account is refused, and existing guest clients can still create/join. Establish the actual review owner and response expectations. Then explicitly set `MACHINATION_REPORTING_ENABLED=1` in a reviewed deployment. `0` or absence leaves new collection disabled; any other value refuses startup. Collection cannot be enabled from the production entry point without configured operator verification. Disabling new collection doesn't remove earlier receipts or prevent authorized review of retained cases.

No operator account, credential, allowlist, hosted setting, or live collection is created automatically. A working local fixture isn't proof that a production operator can receive and handle cases.

## Operator workflow

Run the CLI from a private terminal using Node 24.14.1. Supply the operator's current session only through `MACHINATION_OPERATOR_SESSION` in a trusted environment; never put it in a URL, command argument, issue, or shared log. Output contains private report evidence and must remain private.

```sh
node --import tsx scripts/review-message-reports.ts list --origin=https://machination-api-production.up.railway.app --status=open
node --import tsx scripts/review-message-reports.ts show --origin=https://machination-api-production.up.railway.app --id=CASE_ID
node --import tsx scripts/review-message-reports.ts review --origin=https://machination-api-production.up.railway.app --id=CASE_ID --request-id=UUID --revision=0 --status=reviewed --note='Reviewed by the operator.'
```

Replace `CASE_ID` with the receipt's 32-character ID and `UUID` with a fresh request ID. Use the revision from the latest detail. After an uncertain review response, retry the exact same ID, revision, status, and note; don't invent a new intent merely because the response was lost. An exact retry returns current case state and retains the original audit entry. Conflicting reuse and stale new decisions are refused.

`list` returns at most 25 summaries without message text or review notes. Use `--after=CASE_ID` with the returned `next` value for another page. `show` returns canonical evidence, report context, current state, and operator history. The CLI validates response identity and review receipts, forces verified HTTPS even if Node's ambient TLS defaults are disabled, refuses redirects, bounds requests to 8 KB and responses to 64 KB, and aborts after four seconds. It never opens another database writer.

Review states are `open`, `reviewed`, and `escalated`. They record review intent, not message removal, player bans, notification to another team, or service-wide enforcement. Operators must follow through on an escalation; no external escalation service is configured here.

## Persistence and limits

The private ledger uses the existing single-writer transaction queue, outside rooms, game rules, snapshots, histories, replay exports, and notifications. Operator writes share that queue and require the current case revision. Don't open a second `GameService` or Postgres store as an operator console: loading it claims the writer and fences the running service. Direct SQL dispositions can also be overwritten by cached state.

Stored evidence uses a `message-report-source.v1` envelope containing serialized report JSON. File loading captures the original report-value source before whole-database cloning. SQL loading wraps its original row source without rewriting untouched rows. Unsupported, malformed, deeply nested, overflowing, or future report data remains opaque; reporting becomes unavailable while healthy game operations remain usable. Repeated restarts don't nest another envelope. Don't execute stored source or assume unsupported data is an empty queue.

Current limits are 1,000 cases per database, 32 accepted cases per reporting seat/operation, 16 review entries per case, and 500 characters per report detail/review note. Capacity refusal never evicts an unresolved case or its accepted retry identity. There is no automatic deletion or invented retention period. A full ledger requires reviewed maintenance and a retention/deletion policy before further collection; operator listing alone doesn't reclaim capacity.

Backups and restores must retain the complete `machination_state` table, including `messageReports`, alongside rooms and quarantine. Use a server version that understands this feature for recovery and review. These are private evidence copies, so future account/guest deletion must handle them as well as canonical player messages.

## Verification boundaries

The tests exercise actual HTTP authorization, SQL engine restart, failed-save rollback, pruning and exact retries, concurrent review, source preservation, stale callbacks, and the actual released build 2 decoders. Browser acceptance covers 320/1024-pixel confirmation, a dropped committed response, one stored case after retry, and unavailable collection. These checks don't establish physical iOS layout, VoiceOver, Dynamic Type, production operator access, or client intent recovery after process termination.

Reporting alone doesn't close public-launch requirements for filtering, service-wide enforcement, published contact/support ownership, timely handling, retention/deletion, native production login/push, or the other [release gates](ios-release-readiness.md).

# Quarantined operations

The server executable defaults to `MACHINATION_DATABASE_RECOVERY=quarantine`. It preserves isolated damaged operations before removing them from active state. Healthy operations keep their recorded rules, seats, private history, and retry receipts. Set `MACHINATION_DATABASE_RECOVERY=strict` to refuse new damage during startup. Library callers of `GameService.open` and `DatabaseStore.open` default to strict validation.

Quarantined operations return HTTP 503 with `game.unavailable.recovery`. Their identifiers remain recorded, so a creation retry cannot silently create a replacement operation. Account restoration and recovery codes remain retryable. The client retains its saved connection and pending request until a definitive response arrives. If identity damage makes ownership ambiguous, new enrollment and standings pause; known healthy seats can continue playing.

The loader quarantines every operation involved in a duplicate room identity or ambiguous active account assignment. Related notification bindings, jobs, revision floors, and incoming ledgers are retained in the archive and removed from active delivery. Healthy consent and queued work stay unchanged. Malformed shared structures, unknown database formats, invalid UTF-8, and incomplete SQL metadata stop startup. Malformed JSON errors omit saved content.

## Preserved source

| Backend | Archive |
| --- | --- |
| JSON file | `<MACHINATION_DATA>.quarantine/<incident>/database.json` contains the exact original bytes. `manifest.json` records `file.v1`, the SHA-256, and rejected array indices. The incident directory is private (0700), and its files use 0600. Files and directory entries are synced before activating the recovered database. A changed source or failed archive aborts recovery. |
| Existing Postgres state | `machination_quarantine.data` records `postgres.v1`, rejected room rows with their original JSON text, and original global metadata. Archival, removal, notification isolation, and unavailable markers commit in one transaction under the current writer fence. |
| First Postgres import | A `json-import.v1` record holds the entire original source text and rejected indices in the same transaction as the import. The legacy file stays unchanged. A target initialized by another writer is left intact, including its writer ownership. |

The SQL archive has row-level security enabled with no public policies. Archives contain private messages, identity hashes, and notification credentials. Keep them accessible only to trusted operators. The archive can contain damaged data; recovery still needs a valid backup or verified repair.

Startup logs the number of quarantined operations requiring recovery. `/health` remains listener liveness and can return 200 while an operation is unavailable. Strict mode validates existing unavailable markers; it does not reactivate an archive.

## Operator recovery

1. Preserve the incident archive and current authoritative backup. Record the application commit, affected operation, and recovery point without publishing private data.
2. Restore into an isolated environment with `MACHINATION_PUSH_ENABLED=0`, strict recovery mode, and no public endpoint. Validate the intended recorded mechanics, seats, account links, recovery metadata, private histories, and command receipts. Check the remaining quarantine markers explicitly.
3. Stop every writer before activating a repair. Healthy operations may have progressed since quarantine: prepare a merge that preserves their current state and removes only the repaired operation's unavailable markers. Replacing the whole database with an older incident snapshot would roll back that later progress.
4. Verify a second restart, unchanged command retries, and private access before reopening the repaired operation. Review notification consent and queued work before enabling delivery.

There is no automatic repair or unquarantine command. A controlled restore/merge must be prepared and verified for the incident. Provider backup configuration and a real recovery drill remain release gates; see [Postgres operations](postgres.md) and [iOS release readiness](ios-release-readiness.md).

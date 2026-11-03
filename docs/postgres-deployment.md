# Verified Postgres migration

On October 30, 2026, the invited-playtest service migrated from its Railway JSON volume to Supabase Postgres. This records the observed deployment; configuration and recovery instructions remain in [Postgres storage](postgres.md).

## Deployment

- Railway project: `61507efc-e9c6-43d4-ac4b-6c1555170576`; service: `machination-api`; environment: `production`.
- Supabase project: `pepytpvyprlhmtnribxb`, named `machination`, on the existing Pro organization.
- Supabase region: Ireland (`eu-west-1`). Railway remains in US West (`us-west2`); these regions differ. Cross-region performance was not measured.
- Connection: session pooler, port 5432, with certificate-chain and hostname verification. The project-linked Supabase CA is configured as `MACHINATION_DATABASE_CA`; Node's default roots alone rejected the certificate chain.
- Persistent settings include `DATABASE_URL`, `MACHINATION_STORAGE=postgres`, and `MACHINATION_DATABASE_TLS=verify-full`. Credentials remain server-only.
- Deployed commit: `d6930cd0fc741aa6071e292caaacfb5da4f4d978`, deployment `829a05c4-d450-489f-a1d5-d51b5ad3b69b`. Its [Check workflow](https://github.com/mcclowes/machination/actions/runs/41139406708) passed every job before rollout.
- One replica, zero deployment overlap, 20-second draining, sleeping disabled, and the existing volume retained. Push notifications remain disabled.

## Observed results

The first startup logged `Imported the JSON game snapshot into Postgres.` and `Game state stored in Postgres.` SQL readback found four operations: the three original operations and a synthetic acceptance operation created before migration. All three storage tables had RLS enabled with zero policies.

The original operations retained their seat credential hashes, existing messages, retry receipts, and recorded game/mechanics versions. A synthetic three-seat operation verified authorized access, a funded transfer, transfer retry deduplication, a scheduled order, participant-only private delivery, and rejection of a foreign credential.

A controlled Railway restart logged request draining and another Postgres startup without repeating the import. The same synthetic checks passed afterward. Railway reported `SUCCESS`, with this deployment as the only active deployment.

## Backup evidence and limits

Before migration, a private copy of the original JSON snapshot was saved outside the checkout under the operator's local backup directory. The 21,475-byte snapshot has SHA-256 `674327e314d4d4a3b3eed3e61c1985e829f55a2f4397ea91c5f18ecdfd31ee57`; its file mode is `0600`. Temporary Railway SSH access was revoked after download, readback confirmed no registered SSH keys, and the temporary local key pair was deleted.

That real backup was imported into an isolated local PGlite database using committed release code. All three original operations passed strict validation, preserved existing seat fields, messages, receipts, and replay data, and survived closing and reopening the local database. The backup source stayed unchanged. This was a local recovery rehearsal, not a restore of a Supabase-managed backup.

Supabase showed a daily physical backup. The account owner declined the paid PITR add-on; PITR remains disabled. Restoring a provider-managed backup into an isolated cloud project remains unverified. The original volume file is retained but is no longer updated by Postgres writes and must not be used as a current fallback.

### Current SQL recovery copy, October 31

A server-enforced `REPEATABLE READ READ ONLY` transaction captured the current game tables at `2026-10-31 00:22:35.634158+00`. The production connection closed before restoration began. No production writer was claimed. The 88,632-byte logical backup contains four operations and one archive, with SHA-256 `4a03ffedfc6e486224496506987a787838ef473316d4696d891329160efc5ed8`. A verified copy and its manifest are retained outside the checkout under `~/Backups/machination/2026-10-31T002235Z-4a03ffed/`, in a `0700` directory with `0600` files. This is on-machine storage, not an off-site backup.

An isolated local PGlite restore passed strict current-source validation and exact comparison of original room bytes, ordinal order, global metadata, and archive bytes. A separate synthetic operation verified participant-only message delivery, identical-command retry deduplication, and persistence across close/reopen. Original room bytes and the backup file remained unchanged. This does not establish restoration of a Supabase-managed backup; see [the detailed recovery evidence](https://github.com/mcclowes/machination/issues/111#issuecomment-6536453374).

### Native PostgreSQL recovery rehearsal, October 31

A newer read-only SQL capture at `2026-10-31 15:44:25.614542+00` contains five operations and one archive. The 121,616-byte backup has SHA-256 `187ac52d3aa327f00268450e866812fb35f9acc1c6e3d0db63b479ccce31dc4a`. It and a complete verification manifest are retained at `~/Backups/machination/2026-10-31T154425Z-187ac52d/`, with `0700` directory and `0600` file permissions. Files and directory entries were fsynced and read back. Keep this copy alongside the earlier captures.

An isolated native PostgreSQL 17 restore passed exact comparisons of original JSON bytes, room order, microsecond timestamps, metadata, and archive bytes using source `700ac794a9ff9ffa945643a604a10639d67b3d69`. Timestamp parameters traveled as SQL text to preserve microseconds. Strict startup preserved the original room rows. On the first ordinary write, one legacy operation gained only its missing seat revision `0` and empty diplomacy lists. Expected defaults were computed before the write, every other field remained exact, and the changed timestamp fell between local SQL clock samples. Subsequent writes and a native database restart preserved the exact resulting rows, metadata, and archive.

A separate synthetic three-seat operation passed participant-only private delivery, exclusion of the third seat, and identical retry receipts before and after restart. Fresh local writer identity and all three table RLS flags were checked. All 760 frozen source files and the backup checksum remained unchanged. The disposable database container and its owned volume were removed before the verification manifest was written. Production was never opened for writing during capture or restore. This proves local logical recovery, with the compatibility initialization above; provider-managed restoration and off-site retention remain unverified. See [the complete recovery evidence](https://github.com/mcclowes/machination/issues/111#issuecomment-6545902116).

### Release-candidate PostgreSQL recovery, October 31

A fresh capture at `2026-10-31 19:54:22.455649+00` contains five operations, two metadata rows, and one archive. Its 121,706 bytes have SHA-256 `e2c818369f607b2700ac01354bd298eb92dd84ca4d0e3fa5d298e3c0e6f0dd74`. Verified custom-CA TLS and a server-enforced repeatable-read/read-only transaction bounded counts, bytes, and query time. The production connection closed before any capture file was written. No production writer, migration, or configuration change ran.

The same unchanged capture passed an isolated native PostgreSQL 17 restore against release-candidate source `b25e30d`, with all 772 frozen files verified. Exact raw JSON, ordinal values, numeric room order, microsecond timestamps, metadata, and archive bytes survived strict startup. One legacy operation gained only genuinely missing seat revision `0` and empty diplomacy defaults on the first ordinary local write; its timestamp fell within local SQL clock brackets. Every other original field remained exact. Synthetic recipient-only messaging, identical retries, and the original post-default rows survived subsequent writes and a database container restart. Fresh writer identity and all three RLS flags passed. The owned container and its volumes were removed; an independent owner-label query found no remaining containers.

The first restore attempt stopped before creating a database because its private input validator incorrectly required numeric array ordering for a text-sorted SQL output alias. The corrected helper retains the original capture order and bytes, tests that case with synthetic data, and separately checks numeric order in SQL. PostgreSQL documents [output-alias precedence in `ORDER BY`](https://www.postgresql.org/docs/17/queries-order.html). Both attempts and their helper versions are retained; no recapture or data repair was needed.

The backup and 20 supporting files are retained at `~/Backups/machination/2026-10-31T195422Z-e2c81836/`, with `0700` directories and `0600` files, fsynced and read back. `MANIFEST.json` has SHA-256 `ace667336f27a67d28916aeb8fdec4100b816f5685cfecda47d643d0a2f8a9c9`. Retain the earlier copies too. This is current-source local logical recovery, with documented legacy initialization; provider-managed restore and off-site retention remain unverified. Tracking: [persistence #111](https://github.com/mcclowes/machination/issues/111).

### Provider backup status

The October 31 morning provider audit listed two completed physical backups. The newer one is timestamped `2026-10-31T01:49:26.860Z`, after migration; the earlier one is `2026-10-30T21:41:25.536Z`. This removes the earlier absence of an observed post-migration backup, but metadata alone does not prove its contents or successful recovery. A cloud rehearsal still needs restored-content verification and a reviewed cost preview. Supabase's [restore-to-new-project flow](https://supabase.com/docs/guides/platform/clone-project) supports daily physical backups on paid projects without requiring PITR, but creates an additional independent project with its own costs. PITR remains disabled.

The migration release selects storage by URL and predates enforcement of the explicit backend requirement in [#131](https://github.com/mcclowes/machination/issues/131). Keep the staged storage settings through subsequent releases, retain `DATABASE_URL`, and do not roll back to file-only images. See the rollback constraints in [Postgres storage](postgres.md).

Tracked in [#111](https://github.com/mcclowes/machination/issues/111).

# Postgres storage

Set `MACHINATION_STORAGE=postgres` and `DATABASE_URL` together to store game state in Postgres. Supabase is the intended host. Explicit Postgres mode refuses missing, empty, or whitespace-only URLs before opening game state, so a deployment cannot silently return to a stale JSON import file.

Use `MACHINATION_STORAGE=file` for local file storage; that mode refuses a nonempty `DATABASE_URL`. Invalid mode names, including an empty setting, fail startup. Leaving the mode entirely unset preserves the earlier URL-based selection for compatibility: a URL chooses Postgres, and an absent URL chooses the file. That compatibility behavior does not enforce a required backend. Hosted Postgres releases must keep the explicit setting.

## Layout

- `machination_rooms` holds one row per room. Each row is the full room, including its immutable command history (`replay`), so there's no separate command table.
- `machination_state` holds the database version, faction profiles, notification state, quarantined operation identifiers, and the current writer.
- `machination_quarantine` holds private recovery archives and the original source of a first import. The active loader does not publish those records.

Columns use `json`, not `jsonb`, so object key order survives exactly. Each save writes only the rooms that changed, inside one transaction. Validation is unchanged: rows are loaded and checked by the same code as the JSON file.

Row-level security is enabled with no policies, withholding row reads and writes from ordinary anonymous and authenticated API roles. Privileged database roles and Supabase service-role API credentials can bypass RLS; keep them server-only. Also verify least-privilege grants before production: RLS doesn't replace [Supabase's grant controls](https://supabase.com/docs/guides/database/postgres/row-level-security#grants-and-policies). The app doesn't connect to Supabase or use Supabase Auth.

## One writer

The service is still the only authority, holding state in memory. On startup each instance records itself as the writer. A save from an instance that has since been replaced fails with `WriterReplacedError` instead of overwriting newer state. Keep one replica.

On SIGTERM or SIGINT, the service stops accepting new connections, drains active requests and notification work, and closes its SQL client. Failed startup also closes an opened client. The existing fifteen-second grace deadline ends with a failure exit if work remains blocked; don't treat an interrupted request as a rejected command. Preserve its retry identity and reconnect to determine the authoritative result.

## Moving from the JSON file

On startup, if Postgres has no game state and `MACHINATION_DATA` points to an existing file, the service validates its UTF-8 and JSON and imports it, logging `Imported the JSON game snapshot into Postgres.` The original source text is archived in SQL in the same transaction as active state. The legacy file stays unchanged. With the executable's default quarantine policy, isolated damaged rooms remain unavailable while healthy rooms import. Strict mode refuses them. An incomplete database is refused, and a target initialized before the import commits is preserved. Later starts ignore the file. Take a restricted backup before migrating; subsequent Postgres writes do not update the legacy file. See [quarantine and recovery](storage-recovery.md).

## Supabase setup

1. Create a Pro project in the same region as the Railway service. Free projects pause when idle.
2. Enable point-in-time recovery.
3. Stage `MACHINATION_STORAGE=postgres` together with a direct or session-pooler **database connection string** in the server's `DATABASE_URL` secret. Replace any prior `file` selection. Use the exact hostname and username from the project's Connect dialog. Don't use the HTTP API URL or an API key, and never expose it through `EXPO_PUBLIC_` settings. Keep the direct/session connection choice from #111; don't substitute transaction mode for this release path.
4. Keep `MACHINATION_DATABASE_TLS=verify-full`, or leave it unset. Every connection encrypts traffic and verifies the certificate chain and the exact URL hostname. If the endpoint's CA isn't in Node's default trust roots, download the provider root certificate from the project's Database settings and supply its PEM text as the server-only `MACHINATION_DATABASE_CA` secret. This replaces the default trust roots; never put it in `EXPO_PUBLIC_` settings. Follow [Supabase's connection and SSL guidance](https://supabase.com/docs/guides/database/connecting-to-postgres) for the chosen direct or session endpoint, and enable the provider's enforcement of encrypted connections separately.
5. Stop the old writer, deploy one instance, and check `Game state stored in Postgres.` and the first-boot import line. Verify an authenticated synthetic operation, a retry, private delivery, and preserved access after restart. `/health` is listener liveness, so it can't establish storage readiness.

The connection URL can omit SSL parameters or use `sslmode=verify-full`. Weaker modes, duplicate SSL parameters, client-certificate flags, and `sslrootcert` file paths fail before connection. Use the PEM setting for a custom CA. `sslrootcert=system` is accepted only without a custom CA. Configuration errors don't echo the URL, password, CA contents, or an ignored certificate path.

For a disposable local database, explicitly set `MACHINATION_DATABASE_TLS=local`. It accepts only `127.0.0.1`, `::1`, or `localhost` (pinned to `127.0.0.1`) and disables TLS. It rejects a custom CA and every SSL URL flag except `sslmode=disable`. Never use this exception for hosted storage. Other `PGSSL*` environment settings cannot weaken the adapter's explicit TLS policy.

Prepared statements are disabled by the adapter. That setting doesn't choose the connection mode or provision database infrastructure. Local TLS and lifecycle checks don't establish a deployed Supabase connection, backup configuration, or cloud recovery.

## Backups and recovery

Confirm the project's actual backup schedule and recovery point in the provider dashboard. [Supabase's backup documentation](https://supabase.com/docs/guides/platform/backups) distinguishes daily backups from the separate PITR option; neither is enabled by setting `DATABASE_URL` in this repository.

Before migration or real-player use, restore a chosen backup into an isolated database and run the same source against it. Keep `MACHINATION_PUSH_ENABLED=0` and the restored endpoint private so restored notification jobs and credentials can't affect players. Check seats, scheduled commands, private messages, retry receipts, and recorded mechanics, then verify a second restart. Retain access-restricted backup copies outside the application checkout.

A database restore rolls state, credentials, and notification queues back to the selected recovery point. Switching back to the old JSON file after accepting Postgres writes also loses those later writes. Don't treat the initial import file or an older application image as a current database backup. Keep every writer stopped while replacing/restoring authoritative data.

Keep `MACHINATION_STORAGE=postgres` in Railway's persistent service variables across application releases and rollbacks. Stage the backend requirement and URL without triggering intermediate deployments, then start only the validated migration release. Verify the actual variable names and selected backend after deployment without printing credentials. An application rollback must retain these settings, use a build that enforces the requirement, and remain compatible with the stored rules and schema. Images predating the guard in [#131](https://github.com/mcclowes/machination/issues/131) ignore the setting and are unsafe rollback targets after migration. Removing both settings or deliberately selecting file storage disables the protection; that is not a database recovery procedure.

## Testing

`npm test` runs the Postgres store against in-process PGlite. The separate real-driver case skips unless `MACHINATION_TEST_DATABASE_URL` is provided; the default suite therefore doesn't prove a wire connection to Postgres. To check the driver against a disposable server:

```sh
docker run -d --rm --name machination-pg -e POSTGRES_PASSWORD=test -p 127.0.0.1:55432:5432 postgres:17-alpine
MACHINATION_TEST_DATABASE_URL=postgres://postgres:test@localhost:55432/postgres node --import tsx --test server/postgres-client.test.ts
```

That test drops and recreates the Machination tables, so point it only at a disposable database.

With Docker and OpenSSL available, `npm run test:postgres-tls` owns two disposable Postgres 17.11 containers and a two-day fixture CA. One server rejects plaintext; the other doesn't support TLS. It checks trusted encryption, unknown CA and hostname refusal, plaintext refusal, rollback, writer fencing, state/retry restoration, packaged TLS quarantine, and recovery imports. It removes only its own containers, volumes, and certificates. `npm run test:postgres-tls -- --full` runs the entire `npm run check` gate with both databases configured, including all SQL/TLS cases.

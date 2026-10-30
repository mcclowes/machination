# Postgres storage

Set `DATABASE_URL` to store game state in Postgres instead of the JSON file. Supabase is the intended host. Without `DATABASE_URL`, the service keeps using `MACHINATION_DATA` as before, which is what tests and local development use.

## Layout

- `machination_rooms` holds one row per room. Each row is the full room, including its immutable command history (`replay`), so there's no separate command table.
- `machination_state` holds the database version, faction profiles, notification state, and the current writer.

Columns use `json`, not `jsonb`, so object key order survives exactly. Each save writes only the rooms that changed, inside one transaction. Validation is unchanged: rows are loaded and checked by the same code as the JSON file.

Row-level security is enabled with no policies, withholding row reads and writes from ordinary anonymous and authenticated API roles. Privileged database roles and Supabase service-role API credentials can bypass RLS; keep them server-only. Also verify least-privilege grants before production: RLS doesn't replace [Supabase's grant controls](https://supabase.com/docs/guides/database/postgres/row-level-security#grants-and-policies). The app doesn't connect to Supabase or use Supabase Auth.

## One writer

The service is still the only authority, holding state in memory. On startup each instance records itself as the writer. A save from an instance that has since been replaced fails with `WriterReplacedError` instead of overwriting newer state. Keep one replica.

## Moving from the JSON file

On startup, if Postgres has no game state and `MACHINATION_DATA` points to an existing file, the service validates that file and copies it in, logging `Imported the JSON game snapshot into Postgres.` Later starts ignore the file. Take a restricted backup before importing: legacy validation can add missing metadata to the source file. The file remains in place, but subsequent Postgres writes don't update it. It isn't an ongoing backup.

## Supabase setup

1. Create a Pro project in the same region as the Railway service. Free projects pause when idle.
2. Enable point-in-time recovery.
3. Copy a direct or session-pooler **database connection string** into the server's `DATABASE_URL` secret. Use the exact hostname and username from the project's Connect dialog. Don't use the HTTP API URL or an API key, and never expose it through `EXPO_PUBLIC_` settings. Keep the direct/session connection choice from #111; don't substitute transaction mode for this release path.
4. Verify encryption and server-certificate validation before opening player operations. `sslmode=require` encrypts without authenticating the server. The current driver accepts `sslmode=verify-full` with its default trust roots, but the adapter doesn't load a custom CA file from a URL's `sslrootcert` path. A successful encrypted connection alone doesn't establish certificate validation. Follow [Supabase's connection and SSL guidance](https://supabase.com/docs/guides/database/connecting-to-postgres) for the chosen endpoint.
5. Stop the old writer, deploy one instance, and check `Game state stored in Postgres.` and the first-boot import line. Verify an authenticated synthetic operation, a retry, private delivery, and preserved access after restart. `/health` is listener liveness, so it can't establish storage readiness.

Prepared statements are disabled by the adapter. That setting doesn't choose the connection mode or provision database infrastructure. Local store tests don't establish a deployed Supabase connection, TLS behavior, backup configuration, or service shutdown.

## Backups and recovery

Confirm the project's actual backup schedule and recovery point in the provider dashboard. [Supabase's backup documentation](https://supabase.com/docs/guides/platform/backups) distinguishes daily backups from the separate PITR option; neither is enabled by setting `DATABASE_URL` in this repository.

Before migration or real-player use, restore a chosen backup into an isolated database and run the same source against it. Keep `MACHINATION_PUSH_ENABLED=0` and the restored endpoint private so restored notification jobs and credentials can't affect players. Check seats, scheduled commands, private messages, retry receipts, and recorded mechanics, then verify a second restart. Retain access-restricted backup copies outside the application checkout.

A database restore rolls state, credentials, and notification queues back to the selected recovery point. Switching back to the old JSON file after accepting Postgres writes also loses those later writes. Don't treat the initial import file or an older application image as a current database backup. Keep every writer stopped while replacing/restoring authoritative data.

## Testing

`npm test` runs the Postgres store against in-process PGlite. The separate real-driver case skips unless `MACHINATION_TEST_DATABASE_URL` is provided; the default suite therefore doesn't prove a wire connection to Postgres. To check the driver against a disposable server:

```sh
docker run -d --rm --name machination-pg -e POSTGRES_PASSWORD=test -p 127.0.0.1:55432:5432 postgres:17-alpine
MACHINATION_TEST_DATABASE_URL=postgres://postgres:test@localhost:55432/postgres node --import tsx --test server/postgres-client.test.ts
```

That test drops and recreates the Machination tables, so point it only at a disposable database.

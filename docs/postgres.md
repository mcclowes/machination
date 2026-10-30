# Postgres storage

Set `DATABASE_URL` to store game state in Postgres instead of the JSON file. Supabase is the intended host. Without `DATABASE_URL`, the service keeps using `MACHINATION_DATA` as before, which is what tests and local development use.

## Layout

- `machination_rooms` holds one row per room. Each row is the full room, including its immutable command history (`replay`), so there's no separate command table.
- `machination_state` holds the database version, faction profiles, notification state, and the current writer.

Columns use `json`, not `jsonb`, so object key order survives exactly. Each save writes only the rooms that changed, inside one transaction. Validation is unchanged: rows are loaded and checked by the same code as the JSON file.

Row-level security is enabled with no policies. Supabase's public API therefore can't read or write game state; only the service's direct database connection can.

## One writer

The service is still the only authority, holding state in memory. On startup each instance records itself as the writer. A save from an instance that has since been replaced fails with `WriterReplacedError` instead of overwriting newer state. Keep one replica.

## Moving from the JSON file

On startup, if Postgres has no game state and `MACHINATION_DATA` points to an existing file, the service validates that file and copies it in, logging `Imported the JSON game snapshot into Postgres.` Later starts ignore the file. The file is left in place as a backup; remove it only once Postgres backups are confirmed.

## Supabase setup

1. Create a Pro project in the same region as the Railway service. Free projects pause when idle.
2. Enable point-in-time recovery.
3. Copy the session pooler or direct connection string, with `sslmode=require`, into Railway as `DATABASE_URL`. The client disables prepared statements, so either pooler works.
4. Deploy. Check the logs for `Game state stored in Postgres.` and, on the first boot, the import line.

## Testing

`npm test` runs the Postgres store against in-process PGlite. To also check the real driver against a server:

```sh
docker run -d --rm --name machination-pg -e POSTGRES_PASSWORD=test -p 55432:5432 postgres:17-alpine
MACHINATION_TEST_DATABASE_URL=postgres://postgres:test@localhost:55432/postgres node --import tsx --test server/postgres-client.test.ts
```

That test drops and recreates the Machination tables, so point it only at a disposable database.

# Railway playtest deployment

Run one API service. The mobile client uses its generated HTTPS domain. Authoritative state now lives in Supabase Postgres; the retained Railway volume holds the old import file. See the [migration evidence](postgres-deployment.md). Public signup, distribution signing, and push delivery are separate work.

## Account and platform status

The account owner activated a paid plan on October 28, 2026. The invited-playtest API is live at **https://machination-api-production.up.railway.app**. This is a JSON API, not a web game frontend. Enter this origin in Multiplayer uplink, or set `EXPO_PUBLIC_GAME_SERVER` before building clients.

Project: `61507efc-e9c6-43d4-ac4b-6c1555170576`; service: `591b78ad-6b17-42ed-86d4-a26d85ab6802`; environment: `fabc11e7-5373-4143-857e-3af3df370b65`. The initial manual deployment `2edbe45f-9154-4635-82c0-8ce6a0011ed7` used committed snapshot `658150f`, uploaded from an isolated archive. The service is now connected to GitHub main for [CI-gated automatic releases](deployment-automation.md). Uncommitted local work is excluded. The unrelated existing Railway project was not modified.

Live acceptance passes HTTPS health, a three-seat host start, an authorized transfer, exact retry deduplication, recipient-only private delivery, anonymous/foreign credential rejection, and rejection of an unapproved browser origin. A controlled Railway restart retains all three seats, the message, the fleet, and its retry receipt. Logs show shutdown draining and a fresh service start; Railway reports deployment success. Readback confirms one replica, sleeping disabled, `/health`, no overlap, 20-second draining, and always-restart. The volume is attached at `/var/lib/machination` and ready.

**Cloud restore remains unverified.** Railway volume backups were unavailable on the initial plan. A restricted backup was later downloaded and the service migrated to Supabase, where a daily physical backup was observed. The owner declined paid PITR. A local PGlite restore rehearsal passed, but restoring a provider-managed backup into an isolated cloud project is still open. The retained volume is stale after SQL writes; it cannot serve as a current fallback. See the [backup evidence and limits](postgres-deployment.md#backup-evidence-and-limits).

Check [current platform status](https://status.railway.com/) before provisioning; availability is separate from evidence that a deployment succeeded.

## Image and local verification

```sh
docker build --platform linux/amd64 -f Dockerfile.railway -t machination-server:railway .
node scripts/test-railway-image.mjs
```

Select `linux/amd64` explicitly when building on Apple Silicon, as described in [Railway's container guide](https://railway.com/guides/private-container-registry). Local emulation verifies that target's execution, but does not measure hosted capacity.

`Dockerfile.railway` packages the same standalone Node service as the generic Dockerfile. Railway mounts volumes as root, without the ownership initialization Docker provides for ordinary named volumes. The entrypoint requires the expected Railway volume variable, prepares only `/var/lib/machination/state` as UID/GID 1000 with mode 0700, and starts Node through `gosu`. Node replaces the entrypoint as non-root PID 1 and receives SIGTERM directly. The parent volume remains root owned; the game file is private mode 0600. The generic Dockerfile and its runtime user are unchanged. See [Railway volume permissions](https://docs.railway.com/volumes).

The isolated image check rejects a missing volume declaration and exercises a root-owned mount, non-root Node, private directory/file permissions, an authenticated game, graceful shutdown, and state preserved across container replacement. It creates and removes only uniquely named test containers and volumes. This is local container evidence, not Railway runtime evidence.

### Local image checkpoint, October 31

Both Docker build stages include the root `tsconfig.json`, so their compiler settings match the host release gate. Source `1f13fbf` matches the verified 772-file snapshot. Its Linux/arm64 images use Node 24.14.1 and resolved base digest `sha256:b506e7321f176aae77317f99d67a24b272c1f09f1d10f1761f2773447d8da26c`:

- Generic local image ID: `sha256:693f502292075ddd3f7d28de124335dc93b9e97476326452278151af6e51c3cd`.
- Railway local image ID: `sha256:2fc608f614543146a8088cad80ab87d57b8183a33b73ece1fe6be4d929a679e7`.

Both contain the same standalone bundle, SHA-256 `78c2ed2e016391a1e6196ff6ee8b7da5ea149f5a86c5364d870bf5b84e9a902a`. All 277 source-map inputs and every code byte match the full host gate; only 29 generated dependency-path comments differ between installation roots. The general and Railway checks pass separately, including non-root PID 1, read-only runtime, health, graceful stop, and persistence. A separate Railway backup was copied into a fresh volume and restored with identical file bytes and game state, preserving private ownership and permissions.

Without rebuilding it, the exact image-produced bundle passes all 20 packaging checks on host Node 24.14.1 with native PostgreSQL 17/TLS fixtures and zero skips. The container smokes establish actual image execution; the host packaging suite separately establishes those bundle bytes' SQL/TLS behavior. All owned containers and volumes were removed. Evidence is retained in `/private/tmp/machination-155-fixed-images-3_ocbrx9/`. This local checkpoint does not establish a deployment, hosted capacity, or another CPU architecture. See [image verification #155](https://github.com/mcclowes/machination/issues/155).

### Local AMD64 checkpoint, October 31

Source `b25e30d` was frozen as 772 files with manifest SHA-256 `7dfeae124a138e9d221ce013e73b33581cd8ccfa7b3d1f026f9c4dfbf45612a4`. All 280 effective Docker inputs match the preceding checkpoint. Both builds explicitly selected `linux/amd64`:

- Generic local image ID: `sha256:b29a63d087dc350a517e384728559c4a381988837ebe8c05557159567b5d1685`.
- Railway local image ID: `sha256:c3acd302d203548ad6186b00a98b61b3fd4286115002f22c7ea04fa4a69a22db`.

Both contain the identical 678,802-byte bundle recorded above, SHA-256 `78c2ed2e016391a1e6196ff6ee8b7da5ea149f5a86c5364d870bf5b84e9a902a`. The AMD64 base descriptor is `sha256:e484ae3f1e3c378021c967fd42254f343c302a9263e412280eac32bf5bca7008` from the same pinned base index. Actual service processes report Linux/x64 and Node 24.14.1. Both image checks pass the binary64 runtime guard, non-root PID 1, read-only root, health, graceful shutdown, persistence, and startup refusal cases. A stopped Railway JSON backup was restored into a fresh volume with exact bytes and original game/seat state, preserving private ownership and permissions.

Both actual AMD64 service containers also pass PostgreSQL/TLS checks against an isolated native ARM64 PostgreSQL 17 fixture: required SQL storage, verified custom CA and matching hostname, observed encrypted service connections, persisted writes, and accepted-schedule retry deduplication across restart. An unrelated CA and a hostname mismatch each refuse startup with exit 1 without changing the SQL writer identity. This extends the earlier host-only SQL/TLS check across the actual container boundary. All owned containers, volumes, networks, and temporary private keys were removed.

Execution used local AMD64 emulation on an ARM64 host. It does not establish native AMD64 CI, hosted capacity, deployment, or iOS acceptance. The 21-file evidence index is retained at `/private/tmp/machination-156-amd64-dz8453r3/EVIDENCE.json`, SHA-256 `072235390dff9aaac2989726c5ab4f9c554def604e673465efc2463887d71cb3`. See [deployment-target image verification #156](https://github.com/mcclowes/machination/issues/156).

## Provisioning

Use the official CLI (`npx --yes @railway/cli@5.71.0` was inspected for this setup). Authenticate with `railway login`, then run the following from an isolated release directory containing only a committed snapshot. Do not upload the shared working tree while another agent is editing gameplay. Do not copy `.data`, native build trees, local credentials, or synthetic seat files.

```sh
railway init --name machination-playtest --workspace WORKSPACE_ID --json
railway add --service machination-api --json
railway service machination-api
railway volume add --mount-path /var/lib/machination --json
railway variable set --skip-deploys \
  NODE_ENV=production MACHINATION_HOST=0.0.0.0 PORT=8787 \
  MACHINATION_DATA=/var/lib/machination/state/games.json \
  MACHINATION_STORAGE=file \
  MACHINATION_ORIGINS=https://machination.invalid \
  RAILWAY_DOCKERFILE_PATH=Dockerfile.railway
```

The `.invalid` origin deliberately permits no real browser frontend. Native clients send no browser Origin. Replace it with the exact deployed web origin only if a browser frontend is deployed. Do not use a wildcard.

This provisioning example selects file storage explicitly. For the [Postgres migration](postgres.md), stage `MACHINATION_STORAGE=postgres` and the server-only `DATABASE_URL` together with deployment triggers suppressed. Keep the requirement in service variables for every later release and rollback. A missing URL then refuses startup instead of reopening the stale import file. Unset mode retains compatibility behavior and does not enforce Postgres. Verify the deployed build implements the guard; older images can ignore the variable. These instructions do not change the currently deployed service or establish a completed migration.

Apply the input in `deploy/railway-service-settings.json` with `deploy/railway-service-update.graphql`, supplying the new service and environment IDs in a separate JSON variables file. The mutation signature and input fields were inspected through the live Railway schema. Example:

```sh
railway api --file deploy/railway-service-update.graphql --variables @/private/tmp/machination-railway-variables.json
```

The variables object is `{ "serviceId": "...", "environmentId": "...", "input": <settings object> }`. These API settings use the current CLI instead of creating a deprecated `railway.json` or `railway.toml`. Do not send `builder: "DOCKERFILE"`: Docker is detected through the Dockerfile path/variable, but that value is absent from the live API input enum and was rejected. A future IaC import can use `railway config pull`; do not install agent plugins or modify account tooling as part of deploying the service.

Confirm one replica, sleeping off, `/health`, zero overlap, and a 20-second drain. Do not create a second writer against the same state. The file-storage example above is for a new isolated playtest; do not apply it to the migrated production service. Keep its Postgres requirement and URL. Before replacing or restoring authoritative state, verify the SQL backup and selected recovery point; the old `/var/lib/machination/state/games.json` file no longer contains later accepted writes.

Then deploy and obtain a generated HTTPS domain:

```sh
railway up --service machination-api --detach --message "Machination invited playtest"
railway deployment list --json
railway domain --port 8787
```

## Acceptance before sharing

Verify HTTPS `/health`, three synthetic seats, host start, an authorized transfer, private delivery withheld from the third seat, and persisted access after a Railway restart. Confirm actual Node UID, the attached volume, backup schedule, and service settings in the deployed environment. Check that anonymous or foreign credentials cannot read the operation. Record the deployed commit and domain; never publish seat credentials.

Set `EXPO_PUBLIC_GAME_SERVER` to the verified HTTPS origin before building native clients, or enter the origin manually in Multiplayer uplink. A phone's localhost is not this service. Test real device networking before claiming remote mobile playability.

The default direct-peer rate limiter groups traffic behind Railway's proxy. Source now supports `MACHINATION_CLIENT_IP=railway` for separate client budgets using the HTTP edge's validated `X-Real-IP`. [Railway's public networking contract](https://docs.railway.com/networking/public-networking/specs-and-limits) documents that header. Don't infer trust from a request's `Host`, `X-Forwarded-For`, or Railway-looking headers. The mode is an operator assertion that every route to the listener is trusted: private-network and TCP callers can supply their own headers, so don't expose those routes to untrusted callers. No live configuration change or ingress verification is implied by this source change. Follow the [ingress verification procedure](railway-ingress.md) to check independent budgets and refusal of spoofed client headers. The October 31 audit still found direct mode, and mapped IPv6 isn't an independent client.

`GET /health` remains available during gameplay throttling but proves listener liveness only. The server still settles time on requests. Its optional notification worker stays off unless `MACHINATION_PUSH_ENABLED=1` is set; see [device notifications](notifications.md).

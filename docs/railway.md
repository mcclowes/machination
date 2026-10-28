# Railway playtest deployment

Deploy one API service with one persistent volume. The mobile client uses its generated HTTPS domain. No separate database or frontend service is required for invited native playtests. Public signup, distribution signing, and push delivery are separate work.

## Account and platform status

The account owner activated a paid plan on October 28, 2026. The invited-playtest API is live at **https://machination-api-production.up.railway.app**. This is a JSON API, not a web game frontend. Enter this origin in Multiplayer uplink, or set `EXPO_PUBLIC_GAME_SERVER` before building clients.

Project: `61507efc-e9c6-43d4-ac4b-6c1555170576`; service: `591b78ad-6b17-42ed-86d4-a26d85ab6802`; environment: `fabc11e7-5373-4143-857e-3af3df370b65`; deployment: `2edbe45f-9154-4635-82c0-8ce6a0011ed7`. The deployed source is committed snapshot `658150f`, uploaded from an isolated archive. Later gameplay commits and concurrent edits are not automatically deployed. The unrelated existing Railway project was not modified.

Live acceptance passes HTTPS health, a three-seat host start, an authorized transfer, exact retry deduplication, recipient-only private delivery, anonymous/foreign credential rejection, and rejection of an unapproved browser origin. A controlled Railway restart retains all three seats, the message, the fleet, and its retry receipt. Logs show shutdown draining and a fresh service start; Railway reports deployment success. Readback confirms one replica, sleeping disabled, `/health`, no overlap, 20-second draining, and always-restart. The volume is attached at `/var/lib/machination` and ready.

**Backups remain incomplete.** Railway rejected the daily-backup request because manual backups and schedules require a Pro workspace on this account. No plan upgrade was made. The schedule query returns no enabled schedules. Independent backup download also remains unverified: Railway's file command requires SSH keys, temporary key registration failed without registering a key, and an explicit-identity SSH attempt returned a temporarily unavailable agent path. Runtime UID and permissions are proven by the local container check, not by cloud SSH inspection. Do not claim cloud backup, restore, native remote networking, or automatic client configuration from these HTTP checks.

Railway also reports paused new signups and intermittent builds in US East and EU West. Check [current status](https://status.railway.com/) before provisioning. These are platform observations, not evidence that a deployment succeeded.

## Image and local verification

```sh
docker build -f Dockerfile.railway -t machination-server:railway .
node scripts/test-railway-image.mjs
```

`Dockerfile.railway` packages the same standalone Node service as the generic Dockerfile. Railway mounts volumes as root, without the ownership initialization Docker provides for ordinary named volumes. The entrypoint requires the expected Railway volume variable, prepares only `/var/lib/machination/state` as UID/GID 1000 with mode 0700, and starts Node through `gosu`. Node replaces the entrypoint as non-root PID 1 and receives SIGTERM directly. The parent volume remains root owned; the game file is private mode 0600. The generic Dockerfile and its runtime user are unchanged. See [Railway volume permissions](https://docs.railway.com/volumes).

The isolated image check rejects a missing volume declaration and exercises a root-owned mount, non-root Node, private directory/file permissions, an authenticated game, graceful shutdown, and state preserved across container replacement. It creates and removes only uniquely named test containers and volumes. This is local container evidence, not Railway runtime evidence.

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
  MACHINATION_ORIGINS=https://machination.invalid \
  RAILWAY_DOCKERFILE_PATH=Dockerfile.railway
```

The `.invalid` origin deliberately permits no real browser frontend. Native clients send no browser Origin. Replace it with the exact deployed web origin only if a browser frontend is deployed. Do not use a wildcard.

Apply the input in `deploy/railway-service-settings.json` with `deploy/railway-service-update.graphql`, supplying the new service and environment IDs in a separate JSON variables file. The mutation signature and input fields were inspected through the live Railway schema. Example:

```sh
railway api --file deploy/railway-service-update.graphql --variables @/private/tmp/machination-railway-variables.json
```

The variables object is `{ "serviceId": "...", "environmentId": "...", "input": <settings object> }`. These API settings use the current CLI instead of creating a deprecated `railway.json` or `railway.toml`. Do not send `builder: "DOCKERFILE"`: Docker is detected through the Dockerfile path/variable, but that value is absent from the live API input enum and was rejected. A future IaC import can use `railway config pull`; do not install agent plugins or modify account tooling as part of deploying the service.

Confirm one replica, sleeping off, `/health`, zero overlap, and a 20-second drain. Use the project's selected region for its volume and service. Do not create a second writer against the same snapshot. Railway currently requires Pro for its daily volume backups; a paid Hobby workspace is insufficient. Until that is enabled, establish an independent restricted backup before opening real player operations or replacing/restoring data. Follow the stop-and-backup procedure in [hosting](hosting.md), using `/var/lib/machination/state/games.json` for this image.

Then deploy and obtain a generated HTTPS domain:

```sh
railway up --service machination-api --detach --message "Machination invited playtest"
railway deployment list --json
railway domain --port 8787
```

## Acceptance before sharing

Verify HTTPS `/health`, three synthetic seats, host start, an authorized transfer, private delivery withheld from the third seat, and persisted access after a Railway restart. Confirm actual Node UID, the attached volume, backup schedule, and service settings in the deployed environment. Check that anonymous or foreign credentials cannot read the operation. Record the deployed commit and domain; never publish seat credentials.

Set `EXPO_PUBLIC_GAME_SERVER` to the verified HTTPS origin before building native clients, or enter the origin manually in Multiplayer uplink. A phone's localhost is not this service. Test real device networking before claiming remote mobile playability.

The existing direct-peer rate limiter groups traffic behind Railway's proxy. This remains suitable only for small invited playtests; proxy-aware rate limiting is separate work. The server still settles time on requests; hosting it does not implement push notifications or a background notification worker.

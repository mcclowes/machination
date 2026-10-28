# Hosted playtests

The authoritative service builds into a standalone Node 24 program. Its runtime imports use Node built-ins; Expo and application `node_modules` aren't part of the runtime image. The mobile app still needs a reachable HTTPS service for remote play.

Railway is the selected invited-playtest host. See [Railway deployment](railway.md) for the volume-compatible image, verified local checks, and provisioning status.

Run one service process per data file. This backend uses serialized transactions and an atomically replaced JSON snapshot, not shared database coordination. Configure one replica and a persistent POSIX directory. Keep the same data file across releases.

## Build and check

```sh
npm ci
npm run test:server-build
npm run build:server-image
npm run test:server-image
```

The bundle check copies only `main.mjs` into a temporary directory, starts an authenticated operation, queues a transfer, simulates offline time, and restarts the process. It also finishes an in-flight command during graceful shutdown and verifies the result is persisted.

The image check uses uniquely named disposable containers and volumes. It verifies non-root execution, a read-only root filesystem, Docker health checks, authenticated state across container replacement, and restoration from a copied backup into a separate volume. It cleans up its own test resources. Set `MACHINATION_TEST_IMAGE` to check another locally built tag.

CI runs the game tests, type check, bundle check, image build, and image check. These checks don't publish an image or start a public service.

## Local container review

```sh
docker volume create machination-data
docker run -d --name machination-playtest \
  --read-only --tmpfs /tmp \
  --mount type=volume,src=machination-data,dst=/var/lib/machination \
  --publish 127.0.0.1:8788:8787 \
  --stop-timeout 20 --restart unless-stopped \
  machination-server:playtest
curl http://127.0.0.1:8788/health
```

Port 8788 avoids the development server's default port. The service listens on port 8787 inside the container. The persistent snapshot lives at `/var/lib/machination/games.json`, owned by the image's `node` user, UID/GID 1000. A fresh named volume inherits the image directory's ownership. Existing or bind-mounted storage must be writable by that user. [Docker's volume documentation](https://docs.docker.com/engine/storage/volumes/) explains initialization and persistence.

The build context uses an allowlist. Local game snapshots, credentials, native build trees, and caches aren't copied into the image. The runtime contains the service bundle and source map, not the build-stage application dependencies.

## Node host without Docker

```sh
npm ci
npm run build:server
NODE_ENV=production PORT=8788 MACHINATION_DATA=.data/playtest-games.json \
  node dist-server/main.mjs
```

Deploy `dist-server/main.mjs` and its source map to a Node 24 host. Install no application packages on that runtime host. Set `MACHINATION_DATA` to persistent storage owned by the process user. The default bind address remains `127.0.0.1`; set `MACHINATION_HOST` explicitly when the hosting platform requires a different internal interface.

`PORT=0` selects an ephemeral port for tests and logs the actual listening port. Invalid port configuration fails explicitly. SIGTERM and SIGINT stop new connections and let active requests finish, with a 15-second grace period; allow at least 20 seconds before a host forces termination. Run Node directly so it receives the stop signal.

## Public endpoint

Choose the host and DNS name before publishing. Terminate HTTPS at the hosting platform or a reverse proxy, then route to the private service port. Leave the data volume attached when replacing a container. Do not overlap replicas against the same snapshot.

For browser clients, set `MACHINATION_ORIGINS` to the exact HTTPS frontend origins, separated by commas. Native clients don't send a browser origin. See [the service contract](multiplayer.md) for limits and credentials. The rate limiter currently uses the direct peer address; requests through one proxy share its 120-request/minute bucket. This package is for small invited playtests, with proxy-aware rate limiting still needed for larger hosting.

Set `EXPO_PUBLIC_GAME_SERVER` to the HTTPS origin before exporting or compiling the app to make it the initial default. Players can also enter the origin in Multiplayer uplink. A phone's `localhost` refers to that phone, so the local review URL isn't a remote-player endpoint.

## Backups and replacement

Stop the service before taking an operational backup:

```sh
docker stop -t 20 machination-playtest
mkdir -p .data/backups
docker cp machination-playtest:/var/lib/machination/games.json \
  ".data/backups/games-$(date -u +%Y%m%dT%H%M%SZ).json"
docker start machination-playtest
```

Backups include private game state and messages; retain access-restricted copies outside the host too. A restore rolls back game and credential state to the chosen snapshot.

To restore, stop every writer, replace `games.json` in the persistent volume, and set its ownership to UID/GID 1000 and mode 0600 before starting the non-root image. `docker cp` into a container can create a root-owned file, so correct ownership is part of restoring. The image check exercises this restore into a separate volume and verifies authenticated access afterward.

For a release, build and test the new image, stop the old container, and replace it using the existing volume. Check `/health` before connecting clients. For an image rollback, stop the failed version and start the previous image against the preserved volume. Startup rejects damaged or unsupported snapshots instead of creating a replacement operation.

## Current evidence and remaining work

The standalone bundle and container checks pass locally, including graceful shutdown, container replacement, and backup restoration. No registry push, DNS change, TLS endpoint, or public deployment has been made. Selecting and validating a hosting target, operating backups, mobile push delivery, Android runtime checks, and store distribution remain release work.

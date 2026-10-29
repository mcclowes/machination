# Marginal Utility accounts

Machination uses the same Clerk user pool as Another, Broadsheet, Reached, and the [Marginal Utility account hub](https://account.marginalutility.dev). Use the existing instance rather than creating a separate Machination user pool. Solo and tactical practice work without an account or network.

## Configure the client and service

Copy `.env.example` to `.env.local`. Get matching keys from the shared Clerk instance. Use a development instance for local tests and the shared production instance for release builds.

| Variable | Where | Purpose |
| --- | --- | --- |
| `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` | Client build | Shared instance publishable key; enables multiplayer sign-in |
| `EXPO_PUBLIC_GAME_SERVER` | Client build | HTTPS game service origin, or loopback during local development |
| `CLERK_ISSUER` | Service | Exact Clerk Frontend API HTTPS origin for the shared instance, with no trailing slash |
| `CLERK_SECRET_KEY` | Service only | Verify Clerk tokens using Clerk's cached JWKS |
| `CLERK_JWT_KEY` | Service only | Optional PEM public key instead of a secret key for networkless verification; literal `\n` separators are accepted |
| `MACHINATION_ORIGINS` | Service | Comma-separated exact browser frontend origins, also used to check token authorized parties |

The publishable key belongs in the client; the secret key never does. The service requires the issuer and at least one verification key together. Partial configuration fails startup. Completely absent Clerk configuration preserves local device-token play. Configure both the client and server before releasing account login.

Expo loads `.env.local` for client commands. The Node service does not load it automatically. For local service runs with Node 22+, use:

```sh
node --env-file=.env.local --import tsx server/main.ts
```

For a bundled service, set host environment variables or run `node --env-file=.env.local dist-server/main.mjs`. Set `MACHINATION_HOST=0.0.0.0` when the hosting provider requires it. On Railway, configure service variables before deploying; this change does not deploy or alter the existing hosted playtest service.

## Register native and web clients

In the shared Clerk dashboard, enable the Native API and register the iOS bundle identifier and Android namespace/package `com.mcclowes.machination`. Allowlist `com.mcclowes.machination://callback` for iOS and `clerk://com.mcclowes.machination.hosted-callback` for Android. These are the defaults in the pinned Clerk SDK. The Clerk Expo plugin and browser authentication dependencies are included. Native Apple sign-in entitlements are disabled because this integration uses browser authentication; rebuild native apps after changing plugins. See [Clerk's Expo deployment guide](https://clerk.com/docs/guides/development/deployment/expo) and [hosted authentication guide](https://clerk.com/docs/expo/guides/account-portal/hosted-auth).

Native sign-in opens Clerk's Account Portal in a browser and activates the returned session. Web sign-in uses Clerk's modal. Both use the sign-in methods enabled on the shared instance. Native Clerk sessions are cached in Expo SecureStore. The root provider remains mounted through web OAuth callbacks and offline game screens.

When a publishable key is configured, that root can attempt background authentication requests even on offline screens. A [bounded native-path JS probe](shared-replays.md#configured-account-boundary) retained the installed SDK while rejecting transport: entry, local replay import, and causal seeking stayed available during 25 seconds of retries, without mounting game networking or writing operation state. This doesn't establish browser OAuth, physical-device, cached-session, or eventual retry-exhaustion behavior. The provider's position alone wasn't evidence of an offline rendering bug, and no provider change was made.

Host the web client under `marginalutility.dev` to share the production root domain, and add its exact origin to the service allowlist and Clerk's subdomain allowlist. Separate root domains require [Clerk satellite domain configuration](https://clerk.com/docs/guides/dashboard/dns-domains/satellite-domains), which is not configured here.

## Restore or link an operation

Sign in, then create or join an operation. Each account controls one operation per game server, matching the existing single-operation connection model. Opening multiplayer restores its saved connection or looks up the account at the default server. On another server, enter its origin and choose **Restore account operation**. Restoring does not create an operation, and changing devices does not revoke another signed-in device.

An existing device seat remains usable. Choose **Link seat to my account** while signed in. Linking proves possession of the existing token, is safe to retry, and prevents replacement by another account. It revokes the legacy token and all offline recovery codes. Seats are saved separately per Clerk user; changing accounts remounts the operation screen and removes the previous account's visible game state. Pending commands stay with their original account.

A legacy recovery code can still restore an unlinked seat; link it afterward. Linked seats use Clerk login and account recovery rather than offline recovery codes. Sign out revokes the local Clerk session and hides multiplayer state. Removing a local connection leaves the account's server seat available to restore.

## HTTP authentication

When Clerk is configured, new seats require `Authorization: Bearer <Clerk session JWT>`. The same JWT scheme authorizes every linked game, history, replay, and command endpoint. Tokens are fetched afresh for each client request and verified for signature, issuer, expiry, session ID, active session state, and allowed authorized party. Native tokens may omit `azp`; browser requests must have an `azp` matching their allowed `Origin`. See [Clerk token verification](https://clerk.com/docs/reference/backend/verify-token).

| Method | Path | Body | Result |
| --- | --- | --- | --- |
| GET | `/v1/account/session` | None | `{snapshot: Snapshot \| null}` for the verified user |
| POST | `/v1/account/link` | `{id, token}` | Linked snapshot; `token` is the existing device seat credential |

Account routes always require a verified Clerk session. The legacy bearer scheme remains available for existing unlinked seats and their offline recovery. A linked seat rejects its old bearer token. `/health` stays public. Never send credentials in a URL.

Account IDs and credential hashes stay out of snapshots. Linking retains the original seat identity, command receipts, and sensor perspective. Persistence adds an optional `accountId` to seats; old databases load unchanged, while malformed identities and duplicate account assignments are rejected. Back up the database before activation; older server versions do not enforce the account binding, so do not roll back to one with linked-seat data.

Session JWT verification is local or uses cached signing keys; it is not an online check of Clerk session revocation on every request. Already issued tokens can remain valid until their short expiry. A live shared-instance sign-in and native browser round trip still require configured keys and registered apps.

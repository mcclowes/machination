# Machination accounts

Machination now targets its [dedicated Clerk application](https://dashboard.clerk.com/apps/app_3LLM8dwZinMXaB6wYiCp8bJ4gFD/instances/ins_3LLM8hCmKUuaIwWTDdVu4VdM3m6), replacing the previously planned shared Marginal Utility user pool. The linked instance is for development: `ins_3LLM8hCmKUuaIwWTDdVu4VdM3m6`, with issuer `https://crisp-hagfish-1837.clerk.accounts.dev`. Solo and tactical practice work without an account or network.

## Configure the client and service

Local `.env.local` is configured with this instance’s publishable key, JWT public key, issuer, and account portal URL. It is ignored by Git and restricted to the local user. These keys were retrieved from Clerk; they were not generated locally. Server verification uses the JWT public key, so an administrative secret key is not required.

For another checkout, copy `.env.example` to `.env.local` and get matching keys from this application’s API keys page. Use development keys locally and matching production-instance keys for release builds. Never deploy this linked development instance to the live Railway service.

| Variable | Where | Purpose |
| --- | --- | --- |
| `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` | Client build | Selected instance publishable key; enables multiplayer sign-in |
| `EXPO_PUBLIC_CLERK_ACCOUNT_URL` | Client build | Selected instance’s hosted user profile URL; locally `https://crisp-hagfish-1837.accounts.dev/user` |
| `EXPO_PUBLIC_GAME_SERVER` | Client build | HTTPS game service origin, or loopback during local development |
| `CLERK_ISSUER` | Service | Exact Clerk Frontend API HTTPS origin for the selected instance, with no trailing slash |
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

The linked development instance already has native authentication enabled. Dashboard inspection on October 30, 2026, showed no registered iOS apps or mobile redirect URLs; native login has not been verified.

In this application’s Clerk dashboard, enable the Native API and register the iOS bundle identifier and Android namespace/package `com.mcclowes.machination`. Allowlist `com.mcclowes.machination://callback` for iOS and `clerk://com.mcclowes.machination.hosted-callback` for Android. These are the defaults in the pinned Clerk SDK. The Clerk Expo plugin and browser authentication dependencies are included. Native Apple sign-in entitlements are disabled because this integration uses browser authentication; rebuild native apps after changing plugins. See [Clerk's Expo deployment guide](https://clerk.com/docs/guides/development/deployment/expo) and [hosted authentication guide](https://clerk.com/docs/expo/guides/account-portal/hosted-auth).

Native sign-in opens Clerk's Account Portal in a browser and activates the returned session. Web sign-in uses Clerk's modal. Both use the sign-in methods enabled on the selected instance. Native Clerk sessions are cached in Expo SecureStore. The root provider remains mounted through web OAuth callbacks and offline game screens.

When a publishable key is configured, that root can attempt background authentication requests even on offline screens. A [bounded native-path JS probe](shared-replays.md#configured-account-boundary) retained the installed SDK while rejecting transport: entry, local replay import, and causal seeking stayed available during 25 seconds of retries, without mounting game networking or writing operation state. This doesn't establish browser OAuth, physical-device, cached-session, or eventual retry-exhaustion behavior. The provider's position alone wasn't evidence of an offline rendering bug, and no provider change was made.

For production, configure this application’s production domain and account portal URL, then add the web client’s exact origin to the service allowlist and Clerk’s allowed domains. Separate root domains require [Clerk satellite domain configuration](https://clerk.com/docs/guides/dashboard/dns-domains/satellite-domains), which is not configured here.

## Restore or link an operation

Sign in, then create or join an operation. An account may hold up to 10 unfinished operations per game server, with one seat in each. Finished operations don't count toward the limit. Creation requests carry a client `requestId`, so a retried request returns its operation instead of starting another. Requests without one keep the older behavior and return the account's unfinished operation if it has one. Opening multiplayer while signed in shows the account's operations at the default server: open one, or start or join another. The start screen also lists up to three active operations to resume directly, and a notification tap opens the operation it names. Each operation keeps its own saved connection and pending request on the device, so switching between them never drops an unsent command. A creation in flight waits in a separate draft slot until the server confirms it. Device seats without an account still keep a single saved connection. On another server, enter its origin and choose **Restore account operation**. Restoring does not create an operation, and changing devices does not revoke another signed-in device.

An existing device seat remains usable. Choose **Link seat to my account** while signed in. Linking proves possession of the existing token, is safe to retry, and prevents replacement by another account. It revokes the legacy token and all offline recovery codes. Seats are saved separately per Clerk user; changing accounts remounts the operation screen and removes the previous account's visible game state. Pending commands stay with their original account.

A legacy recovery code can still restore an unlinked seat; link it afterward. Linked seats use Clerk login and account recovery rather than offline recovery codes. Sign out revokes the local Clerk session and hides multiplayer state. Removing a local connection leaves the account's server seat available to restore.

## HTTP authentication

[Operator review](message-reporting.md) has separate issuer, public-key, and allowlist settings. Configuring operators doesn't enable player sign-in or require guest clients to upgrade. Player `CLERK_*` activation remains its own compatible rollout; hosting an operation grants no moderation authority.

When Clerk is configured, new seats require `Authorization: Bearer <Clerk session JWT>`. The same JWT scheme authorizes every linked game, history, replay, and command endpoint. Tokens are fetched afresh for each client request and verified for signature, issuer, expiry, session ID, active session state, and allowed authorized party. Native tokens may omit `azp`; browser requests must have an `azp` matching their allowed `Origin`. See [Clerk token verification](https://clerk.com/docs/reference/backend/verify-token).

| Method | Path | Body | Result |
| --- | --- | --- | --- |
| GET | `/v1/account/session` | None | `{snapshot: Snapshot \| null}` for the verified user's newest operation |
| GET | `/v1/account/operations` | None | `{operations: OperationListing[]}`, newest first: every unfinished operation plus the 20 most recent finished ones |
| POST | `/v1/account/link` | `{id, token}` | Linked snapshot; `token` is the existing device seat credential |

Account routes always require a verified Clerk session. The legacy bearer scheme remains available for existing unlinked seats and their offline recovery. A linked seat rejects its old bearer token. `/health` stays public. Never send credentials in a URL.

Account IDs and credential hashes stay out of snapshots. Linking retains the original seat identity, command receipts, and sensor perspective. Persistence adds an optional `accountId` to seats; old databases load unchanged, while malformed identities and two seats for one account in the same operation are rejected. Back up the database before activation; older server versions do not enforce the account binding, so do not roll back to one with linked-seat data.

Session JWT verification is local or uses cached signing keys; it is not an online check of Clerk session revocation on every request. Already issued tokens can remain valid until their short expiry. A live sign-in and native browser round trip still require registered apps. Changing Clerk applications creates a separate user pool; migrate existing account-linked seats explicitly before switching a populated service. This local setup does not alter hosted configuration or migrate users.

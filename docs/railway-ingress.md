# Verify Railway client budgets

Tracking: [HTTP limits #125](https://github.com/mcclowes/machination/issues/125). This procedure verifies the existing limiter through deployed HTTPS ingress. It doesn't measure service capacity or certify release readiness.

## Current observation

The read-only audit on October 31, 2026, at 11:10 UTC found one `machination-api` service, one `production` environment, one generated HTTPS domain targeting port 8787, no custom domains or TCP proxies, one replica, and `/health`. `MACHINATION_CLIENT_IP` was unset, so the direct-peer default remained active. PostgreSQL and verified TLS remained configured. No production settings were changed or gameplay request budget exercised.

Railway [documents `X-Real-IP`](https://docs.railway.com/networking/public-networking/specs-and-limits) as its client-address header. A [Railway moderator describes its overwrite behavior](https://station.railway.com/questions/supported-way-to-obtain-a-trusted-client-e09bae3b), with private networking and TCP proxies as bypass paths. The service's `railway` mode is an operator assertion that every caller reaching its listener is trusted to supply that header. A service inventory alone doesn't prove collaborator trust, private-network isolation, or future topology.

Production health passed over IPv4. DNS returned no native AAAA records; the system's IPv6 lookup synthesized an IPv4-mapped address. A successful health response over that socket isn't evidence of an independent client. The probe rejects it. Independent production budgets remain unverified and need a second network with a distinct outward address.

## Inspect without consuming a budget

Use Node 24.14.1 and the committed source. Default invocation prints a plan and makes no network request:

```sh
node --import tsx scripts/probe-http-ingress.ts
node --import tsx scripts/probe-http-ingress.ts --preflight
```

`--preflight` sends one health GET. Neither mode exercises gameplay limits. `--origin=https://host` selects another approved deployment; credentials, paths, queries, and fragments are refused. TLS verification stays enabled, redirects aren't followed, responses are capped at 8 KB, and each request has a four-second deadline. No seat credentials, messages, or game state are sent or printed.

## Prepare the deployment

1. Refresh the service/environment/domain/TCP inventory and private-caller trust assessment. Don't infer trust from `Host`, forwarding chains, or a Railway-looking header. Reassess after adding a service, private caller, TCP proxy, or domain.
2. Confirm the deployed commit contains the tested `server/client-address.ts`, the desired configuration has no unrelated staged changes, and the deployment preserves PostgreSQL with verified TLS. Record the current deployment and storage configuration without credentials.
3. Schedule staging or an agreed quiet window. The probe intentionally exhausts a request budget. With shared or misconfigured ingress it can throttle **every player** for up to 60 seconds. Even correctly configured ingress shares a budget among clients behind one outward IP address.
4. Apply the reviewed `MACHINATION_CLIENT_IP=railway` change to `machination-api` in `production` and observe its new deployment. This is a production configuration change, separate from running the local source checks. Don't push unrelated local commits to perform it.

The setting command, once authorized, is:

```sh
railway variable set --project 61507efc-e9c6-43d4-ac4b-6c1555170576 \
  --service machination-api --environment production MACHINATION_CLIENT_IP=railway
```

## Exercise the public edge

After verifying the deployed configuration and a fresh, otherwise unused IPv4 budget:

```sh
node --import tsx scripts/probe-http-ingress.ts --execute
```

This sends at most 128 credential-free GETs. It checks 120 application-level not-found responses on one unique nonexistent route, a correlated JSON 429 with `Retry-After`, refusal to bypass that limit using four supplied header variants, and healthy probes while throttled. It checks before and after every gameplay request that less than 45 seconds has elapsed. A partial initial budget, window rollover, wrong JSON failure, proxy-generated throttle, network error, or slow response stops acceptance. Don't repeatedly rerun against a busy source address.

The result's `checksPassed` applies only to those observations. `independentBudget: "unverified"` explicitly leaves client separation open. Ignoring headers in direct mode can also pass these single-source checks; the deployed configuration is a required separate observation. This is evidence that the supplied variants didn't bypass the observed limit, not universal proof of header rewriting.

For independent IPv4 clients, retain the result's `probePath` and `observedAt`. Within 45 seconds of that timestamp, capture these three requests in order: the original network gets the same correlated JSON 429; a second network gets a correlated JSON 404 with `request.not_found.route` on the same path; the original network still gets 429. Use a second outward address, such as a separate cellular network, and no credentials. A second app, socket, browser, or device on the same Wi-Fi isn't a separate outward address. Retain status, issue code, correlation ID, and UTC timestamps; raw client IPs aren't needed.

On each network, the credential-free request is:

```sh
curl --ipv4 --max-time 4 --include 'https://machination-api-production.up.railway.app/PROBE_PATH'
```

Replace `/PROBE_PATH` with the exact `probePath`, including its leading slash. Do not use `/health` for the independent-budget comparison: health bypasses the limiter. If time expires or any result differs, leave separation unverified and arrange a fresh quiet window.

For deployments with native IPv4 and IPv6 connectivity, `--preflight --dual-stack` checks both health routes and `--execute --dual-stack` adds a bounded IPv6 comparison, for at most 131 GETs. Mapped IPv6 sockets are refused before consuming the IPv4 budget. This optional path isn't currently available on the production domain; IPv6 support isn't a game release requirement.

## Refusal and rollback

If spoofed headers bypass the limit, restore `MACHINATION_CLIENT_IP=direct` on the same service and observe a healthy deployment. Keep the issue open. The direct mode prevents callers from choosing identities but restores the shared-proxy limitation; it isn't the final multiplayer configuration. If the failure is an already-consumed budget or expired window, don't call it a header vulnerability without further evidence.

Restore only the client-IP setting. Don't roll back to a file-store image, unset `DATABASE_URL`, change storage mode, or weaken database TLS. Retain deployment IDs, commits, setting observations, test output, and limits on #125. Passing host tests, health, or this probe alone doesn't close native, capacity, persistence, or other release gates.

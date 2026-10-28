# Automated playtest releases

The Railway `machination-api` service is connected to `mcclowes/machination`, branch `main`, with **Wait for CI** enabled. Local commits do not release until pushed. Pull requests run checks; pushing the resulting commit to main runs them again before Railway can release that commit.

## Release path

1. GitHub's `Check` workflow installs the locked dependencies, generates brand assets, runs game/HTTP/native-plugin tests and TypeScript, tests the standalone service, builds and tests both container images, checks Expo compatibility, and exports iOS, Android, and web bundles.
2. Railway holds the commit in `WAITING` until the GitHub Actions check suites finish successfully. Keep release checks on every main push. Do not use skip-CI markers for releases or cancel mandatory checks. The check workflow deliberately does not cancel in-progress runs.
3. Railway builds `Dockerfile.railway` from that commit and checks `/health` before completing the rollout. Keep one replica, no deployment overlap, sleeping disabled, and a 20-second drain. The persistent volume stays attached, so a release briefly interrupts service rather than starting concurrent JSON writers.
4. Railway's GitHub deployment-status event triggers `Deployment health`. It checks the fixed public HTTPS endpoint with certificate validation, bounded retries, and a JSON `status: ok` assertion. A failed health run is visible in GitHub Actions. It does not follow an event-supplied URL or need a Railway token.

GitHub workflow tokens have read-only repository permissions. Checkout/setup actions are pinned to inspected commit SHAs; Dependabot checks action updates monthly. No Railway credential is stored in GitHub Actions. Dependency updates remain ordinary PRs and must pass checks.

This pipeline deploys the server. Expo exports verify bundling but do not sign, install, or distribute native apps. Native release pipelines and push notification delivery are separate work.

## Verified release

On October 28, 2026, commit `7f093ec` was observed in Railway `WAITING` while its [Check run](https://github.com/mcclowes/machination/actions/runs/40725057620) executed. Every check step passed. Railway then automatically deployed that same SHA as `20efa258-3a11-431f-ad1b-5369dfb13185` and reported `SUCCESS`; its [post-deployment health run](https://github.com/mcclowes/machination/actions/runs/40725508636) also passed. The existing synthetic operation retained all three seats, its private message, fleet, and original retry receipt after this rollout. This is evidence of the complete push/check/deploy/health path, rather than configuration alone.

## Inspect or repair the connection

Use Railway service settings to inspect repository, trigger branch, and Wait for CI. With the authenticated CLI, read the actual trigger:

```graphql
query {
  deploymentTriggers(
    projectId: "61507efc-e9c6-43d4-ac4b-6c1555170576"
    environmentId: "fabc11e7-5373-4143-857e-3af3df370b65"
    serviceId: "591b78ad-6b17-42ed-86d4-a26d85ab6802"
  ) {
    edges { node { id repository branch checkSuites } }
  }
}
```

`checkSuites` must be true. During setup, CLI 5.71.0's source-connect operation replaced the preexisting trigger, reset that flag, and immediately deployed the current branch. Creating a CI-enabled trigger beforehand did not preserve it. The replacement trigger was corrected and read back; future source reconnections need the same verification. Do not reconnect the source merely to trigger an ordinary release. See [Railway's CI-wait semantics](https://docs.railway.com/deployments/github-autodeploys).

## Failed releases and rollback

A failed check should leave the new commit waiting or skipped; inspect the exact SHA in both GitHub and Railway before retrying. Fix the cause and push a new commit. Do not repeatedly upload local code to bypass the gate. A healthy old release can continue serving while the new build runs; volume-backed replacement still has downtime.

Use Railway's deployment history to inspect and roll back to an earlier compatible release when needed. Rolling back application code does not roll back persisted games or make an incompatible schema safe. No workflow automatically rolls back data. Backups and tested restore remain a separate operational requirement; this workspace currently lacks Railway's Pro-only snapshot feature. See [Railway deployment and evidence](railway.md).

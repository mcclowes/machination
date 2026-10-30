# Player guide

Machination's player-facing Docusaurus site. It follows the `mcclowes.com` setup: Docusaurus 3.10.2, explicit sidebars, Markdown pages, SCSS modules, the glossary preset, and Vercel-compatible static output. Local search works without an external account.

## Run

Use the repository's Node version in `.nvmrc`. From the repository root:

```sh
npm ci --prefix website
npm run docs
```

Open `http://localhost:3000`. Tutorial Markdown and styles reload during development. Restart the docs server after changing the shared game manual, specialist catalog, or copied artwork so the reference generator runs again.

## Check and preview

```sh
npm run check:docs
npm run test:docs
npm --prefix website run serve
```

`check:docs` checks the site's TypeScript and creates a production build. Broken page links, Markdown links, images, and anchors fail the build. `test:docs` uses the repository's Playwright dependency against the production output, covering desktop and phone navigation, specialist deep links, glossary, and local search. Install Chromium with `npx playwright install chromium` if the browser isn't already available.

Set `MACHINATION_DOCS_SCREENSHOTS=1` when running browser checks to save desktop and phone homepage captures in `.fettle/shots/`. Routine checks leave screenshot capture off.

The site has its own package and lockfile so Docusaurus's React 18 dependencies don't enter the Expo app's React 19 dependency tree. The root TypeScript check excludes `website`; the separate site check owns it. CI installs both lockfiles and runs both checks.

## Edit the right source

| Content | Source |
| --- | --- |
| Tutorials and task guides | `docs/learn/` and `docs/guides/` |
| Worked combat examples | `docs/reference/combat.md` |
| Rules reference and in-app manual | `../src/content/field-manual.ts` |
| Specialist names, abilities, and promotions | `../src/game/specialist-catalog.ts` |
| Glossary | `glossary/glossary.json` |
| Navigation | `sidebars.ts` and `docusaurus.config.ts` |
| Branding and layout | `src/css/` and `src/pages/` |

`npm run generate --prefix website` creates the ignored `docs/reference/rules.md`, `docs/reference/specialists.md`, and `static/img/` files. It also runs before development and production builds. Never hand-edit those generated files. Rule changes belong in the shared manual; check worked examples and tutorials when behavior changes. The rule reference keeps stable section anchors, and specialists use their catalog keys as anchors, such as `/specialists/#pirate`.

Internal implementation notes in the repository's root `docs/` directory aren't published by this site.

## Host on Vercel

Import `mcclowes/machination` as a separate Vercel project, using **website** as the root directory. Enable **Include source files outside of the Root Directory in the Build Step**: generation imports the shared manual and specialist catalog and copies artwork from the repository root.

The included `vercel.json` sets the install command (`npm ci`), build command (`npm run build`), output (`build`), and trailing slashes. No server, API credentials, analytics account, or game database is needed. See [Vercel's root-directory settings](https://vercel.com/docs/builds/configure-a-build#root-directory).

The canonical origin comes from `DOCUSAURUS_URL`, falling back to [Vercel's `VERCEL_PROJECT_PRODUCTION_URL`](https://vercel.com/docs/environment-variables/system-environment-variables#vercel_project_production_url) when available. Local builds default to `http://localhost:3000`. Set `DOCUSAURUS_URL` to the final HTTPS origin when adding a custom domain. `DOCUSAURUS_BASE_URL` defaults to `/`; set a leading and trailing slash, such as `/guide/`, if hosting below a path. Use the same values when building and serving the output.

Publishing this guide doesn't publish the Expo web game or alter the Railway API. This task prepares and verifies the site locally; no Vercel project, deployment, or domain is created automatically.

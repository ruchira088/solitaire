<!-- Moved out of CLAUDE.md, which keeps a one-line rule pointing here. This is the
     reasoning behind that rule: read it before changing what the rule protects. -->

# Dependencies: the reasoning behind the table

The table in CLAUDE.md says what is installed; this is why, and how the CDK side is kept current.

- **`vite`**: besides the dev server and the bundle, `createServer` serves the app for
  the screenshot script and `preview` serves `dist/` for the smoke test. Its `engines`
  allows Node 20.19+, but Vitest no longer does.
- **`vitest`** is configured separately in `vitest.config.ts`. Since 5.0 its `engines`
  field (`^22.12 || ^24 || >=26`) is what sets the Node 22.12+ floor.
- **`oxlint`, not ESLint**: `typescript-eslint` hard-errors on TypeScript 7 (it checks
  the version and refuses; see typescript-eslint#10940), and the only workaround is
  running a second, older TypeScript side by side. oxlint parses TS itself and has no
  `typescript` peer dependency, so it costs one binary and no version coupling.
- **`playwright-core`** drives *system* Chrome — `scripts/smoke.mjs` (which runs in
  CI), `scripts/rasterize-cards.mjs`, `scripts/shoot-screenshots.mjs` and the visual
  checks. `-core` on purpose: no browser binaries are downloaded, so CI uses the
  runner's preinstalled Chrome.

`.github/dependabot.yml` watches three ecosystems — this lockfile, `cdk-deploy`'s,
and the workflow actions — and **groups minor/patch bumps into one PR per ecosystem
while leaving majors ungrouped, deliberately**: a major is exactly the case that
drags the table above and README along with it, and that review shouldn't arrive
buried in a five-package bump. Dependabot branches are linted, typechecked, tested
and smoke-tested like any other but stop at `upload-bundle`, which skips them — and
skips `deploy-to-dev` with it. Each dev environment is a real CloudFront
distribution, `pr-cleanup.yml` only tears down a *merged* PR's stack, and a
Dependabot-triggered run gets a restricted token that couldn't assume the deploy
role anyway.

`cdk-deploy` pins `aws-cdk-lib` through its lockfile rather than `package.json` (it
arrives as a peer dependency of `react-app-cdk-deploy`), and **`aws-cdk-lib` bundles
its own dependencies** — so an advisory against something nested inside it can't be
fixed with an `overrides` entry or by `npm audit fix`, which will happily *downgrade*
`aws-cdk-lib` and still land in the vulnerable range. `npm update aws-cdk-lib` is the
lever: a newer release carries a newer bundle.

`react-app-cdk-deploy` itself is a **git dependency on a moving `#v1` tag**, so
`npm outdated` never reports it; `git ls-remote --tags` against the repo, compared
with the commit in the lockfile, is how to tell it has moved, and `npm update
react-app-cdk-deploy` refreshes it. Two npm 12 gates sit on that: `cdk-deploy/.npmrc`
sets `allow-git=root` (npm 12 refuses git deps by default, and `root` permits them
in this `package.json` only), and `allowScripts` in `package.json` is keyed on the
**resolved commit**, so it has to move with the tag — `npm install-scripts approve
react-app-cdk-deploy` writes the new key, then drop the old one.

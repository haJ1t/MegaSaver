# Releasing Mega Saver

## How releases work

Every `v*` tag triggers `.github/workflows/release.yml`. Two jobs run:

1. **`github-release`** — always runs. Builds the standalone `mega.mjs`
   bundle and attaches it to a GitHub Release. Uses the built-in
   `GITHUB_TOKEN`; no extra secrets needed.

2. **`npm-publish`** — runs only if the `NPM_TOKEN` repo secret is set.
   Publishes `@megasaver/cli` to npm. Without the secret the job is skipped
   and the workflow still succeeds.

## One-time maintainer setup for npm publishing

1. Own or claim the `@megasaver` scope on [npmjs.com](https://www.npmjs.com/).
2. Create an **automation access token** with publish rights on your npm account.
3. Add it as the `NPM_TOKEN` repo secret:
   `Settings → Secrets and variables → Actions → New repository secret → Name: NPM_TOKEN`.

After that, every `v*` tag also publishes to npm automatically.

## Tagging a release

```sh
# Bump versions with changesets first
pnpm changeset version
pnpm install          # update lockfile
git add -u
git commit -m "chore: version packages"

# Tag and push
git tag v1.0.1
git push origin main v1.0.1
```

The tag push starts the release workflow. The GitHub Release and (if
`NPM_TOKEN` is set) the npm publish happen automatically.

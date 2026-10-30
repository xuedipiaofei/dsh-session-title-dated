# Publishing dsh-session-title-dated

This repository is already shaped as a DSH bundle and a format-1 market entry.

## Current releases

- **0.3.0 (2026-10-30)**: turn/end refresh, backfill, `/retitle`, browser
  refresh button, and hover cost/duration; publish and tag `v0.3.0`.
- **0.2.0 (2026-10-30)**: published on npm, tagged `v0.2.0` on GitHub.
- **0.1.0 (2026-10-28)**: published on npm, tag `v0.1.0`, listed in the
  community directory (PR #10248 merged).
- The community listing points at the repository/npm package, so a version bump
  does not need a new awesome-list PR.

| Field | Value |
|---|---|
| GitHub owner/repo | `xuedipiaofei/dsh-session-title-dated` |
| npm package | `dsh-session-title-dated` |
| License | MIT, copyright `xuedipiaofei` |
| DSH range | `>=0.2.1-rc.3 <0.3.0` |

If any of these change, update every occurrence with:

```sh
grep -R "xuedipiaofei\|dsh-session-title-dated" -n \
  package.json cordis.patch.yml market README.md README.zh.md PUBLISHING.md
```

## 0. Prerequisites

- A GitHub account (`xuedipiaofei`) and a public repository named
  `dsh-session-title-dated`.
- An npm account, logged in on this machine:

  ```sh
  npm login
  npm whoami
  ```

  This machine is **not** currently authenticated to npm.
- No build step is required; the package ships plain ESM.

## 1. Verify the repository

```sh
cd ~/Documents/deepseek-harness/default-workspace/dsh-session-title-dated
npm test
npm pack --dry-run
```

`npm test` runs the format tests, the provider tests with a stubbed executor,
and metadata/index checks. `npm pack --dry-run` must list only:

```text
lib/index.js
lib/format.js
cordis.patch.yml
market/index.json
icon.svg
README.md
README.zh.md
LICENSE
package.json
```

No `node_modules`, test fixtures, or profile files should appear.

## 2. Create and push the GitHub repository

Create an **empty public** repository (no README, no license) at
<https://github.com/new> with the name `dsh-session-title-dated`, then:

```sh
git init -b main
git add .
git commit -m "Initial release: dated, categorised DSH session titles"
git remote add origin git@github.com:xuedipiaofei/dsh-session-title-dated.git
git push -u origin main
```

On the repository page, add the topic **`dsh-plugin`**. The community list
requires it, and it makes the repository discoverable.

## 3. Publish to npm

The name is unscoped, so public access is the default. Publish only after the
tests and the tarball inspection pass.

npm currently requires proof-of-presence for direct publishing. On an
`auth-and-writes` account the web-login token can be refused with `E403`, and a
granular token with bypass-2FA may be blocked by the token form. **Staged
publishing avoids that**: staging accepts the normal login token, and approval
performs the 2FA step.

```sh
# 1. Stage (no 2FA)
npm stage publish --access public
# → staged with id <stage-id>

# 2. Approve (prompts for OTP), or use the web page:
#    https://www.npmjs.com/settings/xuedipiaofei/staged-packages
npm stage approve <stage-id>

# 3. Verify
npm view dsh-session-title-dated version
npm view dsh-session-title-dated dist.tarball
```

A direct `npm publish --access public` is still valid when the account or token
allows it. If it returns `E403` about 2FA, use the staged flow above instead of
creating a bypass token.

### Preferred: OIDC trusted publishing

The repository ships `.github/workflows/publish.yml`. Configure npm **Trusted
Publishing** for the package (GitHub owner `xuedipiaofei`, repository
`dsh-session-title-dated`, workflow `publish.yml`), then push a `v*` tag. The
workflow publishes with `--provenance` using GitHub OIDC; no npm token, PAT, or
2FA prompt is involved.

This is the cleanest path for future releases. If the trusted publisher is not
configured yet, the staged flow above remains the fallback.

If npm rejects the name because it was claimed in the meantime, switch to a
scope. Change the package name in **three** places, re-run `npm test`, then
publish:

- `package.json` → `name`
- `cordis.patch.yml` → the inserted `name:`
- `market/index.json` → `plugins[0].name`

A scoped package (`@your-scope/dsh-session-title-dated`) also needs
`"publishConfig": { "access": "public" }` (already present).

npm versions are effectively permanent; do not publish a version you have not
tested, and do not reuse `0.1.0` after unpublishing.

## 4. Tag the release

```sh
git tag v0.2.0
git push origin v0.2.0
```

## 5. Update and host the market index

`market/index.json` currently pins the first public GitHub commit, so the index
works **before** npm publication. Every time the plugin code changes, re-pin the
commit and refresh `publishTimestamp`:

```sh
COMMIT=$(git rev-parse HEAD)
PUBLISHED=$(date +%s) node - <<'NODE'
const fs = require('node:fs')
const file = 'market/index.json'
const index = JSON.parse(fs.readFileSync(file, 'utf8'))
const version = index.plugins[0].versions[0]
version.source = {
  type: 'git',
  url: 'https://github.com/xuedipiaofei/dsh-session-title-dated',
  commit: process.env.COMMIT,
}
version.publishTimestamp = Number(process.env.PUBLISHED)
fs.writeFileSync(file, `${JSON.stringify(index, null, 2)}\n`)
NODE
npm run validate:index
```

After the npm release, you may switch the same version to the registry source
instead of the Git commit:

```json
"source": { "type": "npm" }
```

Either source is valid; Git makes the index usable immediately, npm gives faster
installs and a download count. Do not list the same version twice.

`npm run validate:index` needs the official validator once:

```sh
npm install --no-save --no-package-lock @deepseek-ai/dsh-plugin-market-index@0.2.1-rc.3
npm run validate:index
rm -rf node_modules
```

Commit and push the index change.

### Index URL to share

Use jsDelivr over GitHub (HTTPS, no redirects, no Pages setup):

```text
https://cdn.jsdelivr.net/gh/xuedipiaofei/dsh-session-title-dated@v0.3.0/market/index.json
```

Prefer the tag URL: jsDelivr caches `@main` for a long time, and a cached copy
can still point at an older source. `@v0.2.0` was fetched fresh after the tag
was pushed; bump the tag for each release. GitHub Pages also works: enable Pages
from the repository root and use

```text
https://xuedipiaofei.github.io/dsh-session-title-dated/market/index.json
```

DSH refuses index URLs with redirects, credentials, fragments, or queries.

### Test a real install

In DSH: **Plugins → Discover → Index sources**, add the jsDelivr URL, install
**Dated session titles**, then start a new conversation and send one message.
The sidebar title should become `DATE | CATEGORY | NAME` after the first
request starts.

For a CLI profile:

```sh
dsh plugin --profile title-test add dsh-session-title-dated@0.3.0
dsh --profile title-test --dump-config | grep -A8 session-title
```

Verify the composed tree disables `session-title-llm` and inserts
`session-title-dated`. Do **not** enable
`@deepseek-ai/dsh-experimental-session-titles-bundle` in the same profile.

## 6. Submit to the community list

The main community index is generated from
[awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin).
It feeds `dsh-market`, `https://cdn.jsdelivr.net/npm/dsh-plugin-catalog/index.json`,
and the site.

1. Fork `awesome-dsh-plugin/awesome-dsh-plugin`.
2. Copy `market/awesome-entry.yml` to:

   ```text
   data/plugins/xuedipiaofei__dsh-session-title-dated.yml
   ```

3. Commit only that file and open a pull request.
4. Keep the repository public and at least **1 day old**; CI checks the age,
   the `dsh.bundle` manifest, the `dsh-plugin` topic, and formatting.
5. A maintainer reads the source and checks the description against it. Do not
   overstate features in the one-line description.

### Automated submission

After the one-day gate, `scripts/community-pr.mjs` can perform the fork, commit,
and pull request through the GitHub REST API. It also adds the required
`dsh-plugin` topic and is idempotent: an existing branch, identical file, or open
PR is detected instead of duplicated.

```sh
cd ~/Documents/deepseek-harness/default-workspace/dsh-session-title-dated
node scripts/community-pr.mjs --check     # public preflight, no writes
node scripts/community-pr.mjs --dry-run --force  # show planned calls
node scripts/community-pr.mjs             # do it
```

Authentication, in priority order:

1. `GH_TOKEN` or `GITHUB_TOKEN` in the environment.
2. A token file at `DSH_GITHUB_TOKEN_FILE` or `~/.dsh/github-token`
   (`chmod 600`).
3. `gh auth token`, when the GitHub CLI is installed and logged in.

A classic token with `public_repo` (or `repo`) is the simplest; the script needs
to fork a public repository and open a PR against it. Without a token it only
performs public reads and prints the manual steps, so it is safe to run early.

After merge, the community catalog and dsh-market pick the entry up
automatically. Users can then add only the community catalog source:

```text
https://cdn.jsdelivr.net/npm/dsh-plugin-catalog/index.json
```

The repository's `package.json` `repository` field points back at the listed
repository, which is what links npm downloads to the entry.

## 7. Future releases

For each release:

1. Bump `version` in `package.json`.
2. Add a `CHANGELOG.md` entry.
3. Update `market/index.json` version, `publishTimestamp`, and — for a Git
   source — the pinned 40-character commit.
4. Run `npm test` and `npm run validate:index`.
5. `npm publish --access public`.
6. `git tag vX.Y.Z && git push --tags`.
7. Push the index update.

Keep `engines.dsh` in sync with the DSH versions you actually test. If DSH 0.3
changes the session-title API, update the plugin and widen the range in a new
release; do not widen it without testing, because the bundle row ids and the
executor import are version-sensitive.

## Pre-publish checklist

- [ ] `npm test` passes
- [ ] `npm pack --dry-run` lists only intended files
- [ ] `private` is absent from `package.json`
- [ ] `repository`/`homepage`/`bugs` point at `xuedipiaofei/dsh-session-title-dated`
- [ ] README links and index URL use the same owner
- [ ] `assets/icon-180.png` exists (awesome-list icon)
- [ ] `npm run validate:index` passes with the official validator
- [ ] `market/index.json` pins a pushed 40-character commit (or an npm version)
- [ ] GitHub repository is public and has the `dsh-plugin` topic
- [ ] npm login works and the package name is still available
- [ ] A test profile installs the bundle and a new session gets the expected title
- [ ] The official session-titles experimental bundle is not enabled alongside it

# Contributing

## Checks

From a clone, with Node 22.15 or newer, Git, Bash and sqlite3:

- `npm test`
- `npm run sync:share -- --check`
- `npm run check:version`
- `herdr-app check <mod folder>`

`herdr-app check kanso/mods/kanso-guard` is one. `herdr-app check` passes for the `kanso-*` mods and `open-with`.

## Version

Pull requests target `develop`. Add entries for changes to what kansō installs under `## [Unreleased]` in [CHANGELOG.md](CHANGELOG.md), using Added, Changed, Fixed, Removed or another supported category. Never edit a numbered section or `kanso/mods/kanso-chrome/version.json` in a pull request. What kansō installs is `kanso/mods`, `kanso/themes`, `kanso/layouts`, `kanso/keys.json` and `kanso/keys.windows.json`. Docs need no entry.

Until a release candidate is cut, version.json stays at the newest stable version. Once CI passes on all three platforms, a push to develop publishes a beta with the Unreleased entries as its notes. Its version is computed from the newest stable tag: Breaking or Removed means a major bump, Added or Deprecated means a minor bump, anything else a patch. Existing beta numbers continue upward. The beta job creates a detached commit with only version.json set to the computed version, tags that commit and pushes only the tag. Develop keeps its version file, and the updater gets an archive whose version matches its tag.

Run the manual Release candidate workflow on `develop` to prepare the next version. It computes the same bump, moves Unreleased into a dated, numbered section, updates version.json, commits those files to develop and publishes `vX.Y.Z-rc.N`. Later candidates combine that numbered section with new Unreleased entries and recompute the bump from the newest stable tag. The number can go up until stable, but never down. A larger bump renames the section in place, updates version.json and starts rc.N at 1 for the new version; otherwise only N increases. Betas compute their version from the same combined entries. Merging develop into main releases the version in version.json.

`npm run check:version -- --branch develop` checks the develop rules; CI also checks that a pull request leaves version.json and numbered history alone. `npm run check:version` checks main's stable rules. Technical debt goes under Unreleased too and ships with the next release.

## Shared files

Herdr loads a mod's files from its own folder only, so a file used by more than one mod has one source and copies of it. Edit the source, then `npm run sync:share`. The sources are the `source` fields in `scripts/sync-share.mjs`. `npm run sync:share -- --check` fails when a copy differs.

## Runtime

A mod runs in Herdr's runtime, not in Node. That runtime is QuickJS, and a step that runs long is cut off. Node is a separate program a mod starts when it needs one: Spend and Memory name it in `runtime.json`, and Simulator starts `node` for the device stream.

## Try a build

Set `HERDR_APP_HOME` to a separate directory, so the try does not use your own Herdr home, then run `sh ./scripts/local-install.sh`. The script copies the layout, themes and mods there and switches Herdr to kansō. Merge the `layout:kanso` section of `kanso/keys.json` into that home's `keys.json`. On Windows, merge `kanso/keys.windows.json` instead.

## Pull requests

Use `type(scope): subject` for the PR title, with `type` one of `feat`, `fix`, `perf`, `test`, `ci`, `docs` or `chore`. Do not use `bug` as a type or put a version or issue number in the title. Branch names use `<type>/<slug>`.

Kansō tracks users' GitHub issues, not tickets. When a user's issue prompted the change, put `Closes #N` under Why in the PR body and end the related CHANGELOG entry with `(#N)`. With no issue, omit both references.

[.github/PULL_REQUEST_TEMPLATE.md](.github/PULL_REQUEST_TEMPLATE.md) keeps five sections: Why, What, Tests, Not verified and Version.

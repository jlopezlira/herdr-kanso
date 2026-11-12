# Contributing

## Checks

From a clone, with Node 22.15 or newer, Git, Bash and sqlite3:

- `npm test`
- `npm run sync:share -- --check`
- `npm run check:version`
- `herdr-app check <mod folder>`

`herdr-app check kanso/mods/kanso-guard` is one. `herdr-app check` passes for the `kanso-*` mods and `open-with`.

## Version

Pull requests target `develop`. A change to what kansō installs adds its entries to the next version's section in [CHANGELOG.md](CHANGELOG.md), and raises `kanso/mods/kanso-chrome/version.json` only when its category needs a bigger bump than that section already has. What it installs is `kanso/mods`, `kanso/themes`, `kanso/layouts`, `kanso/keys.json` and `kanso/keys.windows.json`. Docs do not bump the version.

A release that lists Breaking or Removed changes is a major version, one that lists Added or Deprecated is a minor version, anything else is a patch. `npm run check:version` checks this, a push to `develop` publishes a beta once CI passes on all three platforms, the Release candidate workflow publishes a release candidate, and merging `develop` into `main` releases the version in `version.json`. Technical debt stays under `## [Unreleased]` and goes out with the next release.

## Shared files

Herdr loads a mod's files from its own folder only, so a file used by more than one mod has one source and copies of it. Edit the source, then `npm run sync:share`. The sources are the `source` fields in `scripts/sync-share.mjs`. `npm run sync:share -- --check` fails when a copy differs.

## Runtime

A mod runs in Herdr's runtime, not in Node. That runtime is QuickJS, and a step that runs long is cut off. Node is a separate program a mod starts when it needs one: Spend and Memory name it in `runtime.json`, and Simulator starts `node` for the device stream.

## Try a build

Set `HERDR_APP_HOME` to a separate directory, so the try does not use your own Herdr home, then run `sh ./scripts/local-install.sh`. The script copies the layout, themes and mods there and switches Herdr to kansō. Merge the `layout:kanso` section of `kanso/keys.json` into that home's `keys.json`. On Windows, merge `kanso/keys.windows.json` instead.

`sh ./scripts/try.sh start` does this for a checkout in the demo home `~/.cache/kd` and opens its window on its own core session; `sh ./scripts/try.sh stop` closes both.

## Pull requests

[.github/PULL_REQUEST_TEMPLATE.md](.github/PULL_REQUEST_TEMPLATE.md) asks for Why, What, Tests, Not verified and Version.

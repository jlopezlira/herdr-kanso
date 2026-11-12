<!-- Title: type(scope): subject; type is feat, fix, perf, test, ci, docs or chore -->
<!-- Branch: <type>/<slug>. No bug type, version or issue numbers in the title. -->

Pull requests target `develop`. A push there publishes the next beta when what kansō installs changed. The Release candidate workflow, run on `develop`, publishes a release candidate. Merging `develop` into `main` publishes the stable version.

## Why
<!-- Explain the reason for the change in one or two sentences. -->

<!-- If a user's issue asked for this: Closes #N -->

## What
<!-- Use one bullet per change a user or reviewer would notice. -->

## Tests
<!-- Use one bullet per command run, with its real result (e.g. npm test: passed/failed with counts; npm run check:version; npm run check:mods). Include failures and name the failing tests or checks. -->

## Not verified
<!-- List what was not run or cannot run here and why, including checks only the owner can try on his machine. -->

## Version
<!-- CHANGELOG entries go under Unreleased, ending with (#N) when a user's issue asked for it. A pull request does not change version.json; the release candidate sets the number. Docs only: no entry. -->

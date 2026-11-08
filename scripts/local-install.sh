#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
APP_HOME=${HERDR_APP_HOME:-"$HOME/.config/herdr-app"}

mkdir -p "$APP_HOME/layouts" "$APP_HOME/themes" "$APP_HOME/mods"
cp "$ROOT/kanso/layouts/kanso.json" "$ROOT/kanso/layouts/kanso.png" "$APP_HOME/layouts/"
cp "$ROOT"/kanso/themes/*.json "$APP_HOME/themes/"
cp -R "$ROOT"/kanso/mods/kanso-* "$ROOT/kanso/mods/open-with" "$APP_HOME/mods/"

printf '%s\n' "Installed kansō files to $APP_HOME." \
  "Merge the \"layout:kanso\" section of $ROOT/kanso/keys.json into $APP_HOME/keys.json."

herdr-app do layout.switch --name kanso

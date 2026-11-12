#!/bin/sh
# Try this checkout in the demo window, apart from your own: sh scripts/try.sh start|stop
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
DEMO_HOME=${HERDR_APP_HOME:-"$HOME/.cache/kd"}
LIVE_HOME="$HOME/.config/herdr-app"
SESSION=kanso-demo

same_dir() { [ -d "$1" ] && [ -d "$2" ] && [ "$(cd "$1" && pwd -P)" = "$(cd "$2" && pwd -P)" ]; }
running() { HERDR_APP_HOME="$DEMO_HOME" herdr-app status >/dev/null 2>&1; }
left() { procs=$(ps -axo pid,command); printf '%s\n' "$procs" | grep -F -e "$SESSION" -e "$DEMO_HOME/" || true; }

if same_dir "$DEMO_HOME" "$LIVE_HOME"; then
  echo "Refusing: $DEMO_HOME is your own Herdr home." >&2
  exit 1
fi

start() {
  if running; then
    HERDR_APP_HOME="$DEMO_HOME" sh "$ROOT/scripts/local-install.sh" >/dev/null
  else
    KANSO_NO_SWITCH=1 HERDR_APP_HOME="$DEMO_HOME" sh "$ROOT/scripts/local-install.sh" >/dev/null
    HERDR_APP_HOME="$DEMO_HOME" HC_SESSION="$SESSION" nohup herdr-app >/dev/null 2>&1 &
  fi
  dirty=$([ -z "$(git -C "$ROOT" status --porcelain)" ] || echo " with uncommitted changes")
  echo "Installed $(git -C "$ROOT" rev-parse --abbrev-ref HEAD) at $(git -C "$ROOT" rev-parse --short HEAD)$dirty in $DEMO_HOME."
}

stop() {
  HERDR_APP_HOME="$DEMO_HOME" herdr-app do app.quit >/dev/null 2>&1 || true
  HC_SESSION="$SESSION" hc server stop >/dev/null 2>&1 || true
  for _ in 1 2 3 4 5; do [ -z "$(left)" ] && break; sleep 1; done
  rest=$(left)
  if [ -z "$rest" ]; then echo "Demo stopped: nothing left."; else printf 'Still running:\n%s\n' "$rest"; fi
}

case "${1:-}" in
  start) start ;;
  stop) stop ;;
  *) echo "Usage: sh scripts/try.sh start|stop" >&2; exit 2 ;;
esac

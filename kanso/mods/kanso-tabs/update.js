// Kanso's own updates, by jlopezlira (https://github.com/jlopezlira/herdr-kanso). Apache-2.0.
import { exec, readTextFile, appHome, shared, setShared, notify, layout, run } from "herdr";
import { tryOr, tryOrAsync } from "./pure.js";

export const SOURCE = {
  remote: "https://github.com/jlopezlira/herdr-kanso.git",
  tarball: (v) => `https://github.com/jlopezlira/herdr-kanso/archive/refs/tags/v${v}.tar.gz`,
  file: (v, path) => `https://raw.githubusercontent.com/jlopezlira/herdr-kanso/v${v}/${path}`,
  checker: "herdr-app",
};

const STATE = "kanso.update";
// ls-remote costs no GitHub API quota; EVERY keeps copies from asking twice.
const TICK = 5 * 60 * 1000;
const EVERY = 4 * 60 * 1000;
// A look or an install whose copy was replaced mid-way stops showing after these. Only what the
// buttons show: the install lock (HOLD) is what keeps two installs apart, and it never expires.
const LOOK_MS = 60 * 1000;
const SHOWN_MS = 15 * 60 * 1000;
// Preparing (the keys and layout, read before the install starts) takes seconds; a mark still
// preparing after this lost its copy before it started anything.
const PREPARE_MS = 2 * 60 * 1000;
// Under Herdr's home: the lock, and per install its staging folder, pid, log and outcome.
const UPDATES = ".kanso-updates";
// The footer is its account chip and a 34px row (and its gap) for each of Update, Settings and
// Add machine that shows; a row a switch hides gives its place back.
const FOOTER = "sidebar-footer";
const FOOTER_BASE_PX = 84, ROW_PX = 36;
const OPTIONAL = ["footer.machine"];
export const footerPx = (hidden, update) => FOOTER_BASE_PX + ROW_PX * (1 + (update ? 1 : 0) + OPTIONAL.filter((id) => !hidden.has(id)).length);
// Every size this sets, now or before (228 and 264 in 3.9.1), so one you sized yourself stays.
const OURS = (px) => px >= FOOTER_BASE_PX + ROW_PX && px <= FOOTER_BASE_PX + ROW_PX * 5 && (px - FOOTER_BASE_PX) % ROW_PX === 0;

function findNode(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return null;
}

export const parseVersion = (v) => {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(v ?? "").trim());
  return m ? m.slice(1).map(Number) : null;
};

export function compareVersions(a, b) {
  const x = parseVersion(a), y = parseVersion(b);
  const i = [0, 1, 2].find((k) => x[k] !== y[k]);
  return i === undefined ? 0 : x[i] - y[i];
}

export function newestTag(stdout) {
  const best = String(stdout).split("\n").reduce((best, line) => {
    const tag = line.split("refs/tags/")[1]?.trim();
    return parseVersion(tag) && (!best || compareVersions(tag, best) > 0) ? tag : best;
  }, null);
  return best && best.replace(/^v/, "");
}

// Three-way merge: keys you changed stay yours, keys you removed stay removed, the rest follow the release.
export function mergeKeys(user, before, after) {
  const copy = JSON.parse(JSON.stringify(user));
  const sections = [...new Set([...Object.keys(before), ...Object.keys(after)])].map((section) => {
    const was = before[section] ?? {}, now = after[section] ?? {};
    const mine = copy[section] ?? {};
    const fate = (key) => {
      if (was[key] === now[key]) return null;
      if (!(key in mine)) return !(key in was) && key in now ? "add" : null;
      if (mine[key] === now[key]) return null;
      if (mine[key] === was[key]) return key in now ? "set" : "drop";
      return "kept";
    };
    const fates = [...new Set([...Object.keys(was), ...Object.keys(now)])].map((key) => [key, fate(key)]);
    const of = new Map(fates);
    const changed = fates.some(([, f]) => f && f !== "kept");
    const next = !changed ? mine : Object.fromEntries([
      ...Object.entries(mine).filter(([k]) => of.get(k) !== "drop").map(([k, v]) => [k, of.get(k) === "set" ? now[k] : v]),
      ...fates.filter(([k, f]) => f === "add" || (f === "set" && !Object.hasOwn(mine, k))).map(([k]) => [k, now[k]]),
    ]);
    const kept = fates.filter(([, f]) => f === "kept").map(([k]) => k);
    return { section, next, changed, kept, put: Object.keys(next).length > 0 || section in copy };
  });
  return {
    keys: { ...copy, ...Object.fromEntries(sections.filter((x) => x.put).map((x) => [x.section, x.next])) },
    changed: sections.some((x) => x.changed),
    kept: sections.flatMap((x) => x.kept),
  };
}

const sameJson = (a, b) => {
  try { return JSON.stringify(JSON.parse(a)) === JSON.stringify(JSON.parse(b)); } catch { return a === b; }
};

// hold FILE: an exclusive lock on FILE through fd 9, held by this shell (and whatever it execs)
// until it ends, however it ends: the kernel lets go, so a lock is never left by a dead install
// and never needs taking back. 75 when another holds it. flock on Linux, lockf's fd form on
// macOS, perl where that lockf takes only a file.
export const HOLD = `hold() {
  exec 9>>"$1" || return 1
  if command -v flock >/dev/null 2>&1; then flock -n 9 && return 0; return 75; fi
  lockf -s -t 0 9 2>/dev/null; got=$?
  case $got in 0|75) return $got ;; esac
  perl -MFcntl=:flock -e 'open(my $f, ">&=9") or exit 1; flock($f, LOCK_EX | LOCK_NB) or exit 75'
}
`;

// The swap, as a journal that can be replayed from any point. <stage>/slots lists each thing the
// install replaces, one per line ("<had> <slot>": had 1 when you had one before). A slot is three
// paths: L where it lives, B the one you had (moved aside), S the release's. Every step looks at
// the disk and makes one rename or none, so running it twice does nothing more.
// Forward, slot by slot: L aside to B, then S to L. The updaters (kanso-tabs, then kanso-chrome,
// whose version.json says which release is in) go last, so whenever the install dies one of them
// is on disk, old or new, to start recovery. Every B stays until the `committed` mark.
// Back, in reverse: L to S where the release's is in place, then B to L; then the slot's line
// leaves the journal. Its S stays until then, so a slot already put back is never undone again.
// Either way the journal goes before the stage does: a stage without one is leftovers.
// `step` counts what is done; KANSO_UPDATE_STOP=<n> kills the process after the n-th (the tests).
const JOURNAL = `step() { n=$((n + 1)); if [ "$n" = "\${KANSO_UPDATE_STOP:-0}" ]; then kill -9 $$; fi; }
slot() {
  case $1 in
    keys) L="$home/keys.json"; B="$st/old/keys.json"; S="$st/keys.json" ;;
    layout) L="$home/layouts/kanso.json"; B="$st/old/kanso.json"; S="$st/kanso.json" ;;
    picture) L="$home/layouts/kanso.png"; B="$st/old/kanso.png"; S="$st/src/kanso/layouts/kanso.png" ;;
    themes/*) L="$home/$1"; B="$st/old/$1"; S="$st/src/kanso/$1" ;;
    *) L="$home/mods/$1"; B="$st/old/mods/$1"; S="$st/src/kanso/mods/$1" ;;
  esac
}
swap() {
  slot "$2"
  if [ "$1" = 1 ] && [ -e "$S" ] && [ -e "$L" ] && [ ! -e "$B" ]; then mv "$L" "$B" || return 1; step; fi
  if [ -e "$S" ] && [ ! -e "$L" ]; then mv "$S" "$L" || { echo "could not put $2 in place" >&2; return 1; }; step; fi
}
undo() {
  slot "$2"
  if [ ! -e "$S" ] && [ -e "$L" ]; then mv "$L" "$S" || return 1; step; fi
  if [ "$1" = 1 ] && [ -e "$B" ] && [ ! -e "$L" ]; then mv "$B" "$L" || return 1; step; fi
  [ -e "$S" ] && { [ "$1" = 0 ] || { [ -e "$L" ] && [ ! -e "$B" ]; }; } || return 1
  awk -v line="$1 $2" '$0 != line' "$st/slots" > "$st/slots.part" && mv "$st/slots.part" "$st/slots" || return 1
  step
}
forward() { while read -r had name; do swap "$had" "$name" || return 1; done < "$st/slots"; }
backward() {
  sed '1!G;h;$!d' "$st/slots" > "$st/slots.back" || return 1
  while read -r had name; do undo "$had" "$name" || return 1; done < "$st/slots.back"
}
# Committed, nothing is copied (themes and the picture are slots too): the layout you had is kept
# as kanso.json.old-<time>, a rename done once, so a stage half removed only finishes going.
keep() { if [ -e "$st/old/kanso.json" ]; then mv "$st/old/kanso.json" "$home/layouts/kanso.json.old-$(cat "$st/stamp")" || return 1; step; fi; }
# Ends the stage $st either way: committed, it finishes; otherwise it is undone, and removed only
# once every slot is back as it was. What it holds then is only backups and copies no slot needs.
settle() {
  if [ -f "$st/slots" ]; then
    if [ -f "$st/committed" ]; then keep || return 1; else backward || return 1; fi
    rm -f "$st/slots"; step
  fi
  chmod -R u+w "$st" 2>/dev/null; rm -rf "$st"
}
# A stage lives only while its install holds the lock, so under the lock any other is a dead one's.
recover() {
  for left in "$dir"/*/; do
    st=\${left%/}
    [ -d "$st" ] && [ "$st" != "$stage" ] || continue
    settle || { echo "an update that stopped could not be undone; its files are in $st" >&2; return 1; }
  done
}
`;

// The whole install, one detached process (LAUNCH): neither exec's 30 s limit nor a mod reload
// reaches it, and the lock is its own from before the download to the end of the swap. Its
// outcome goes to <id>.status, one write, once the swap is committed or undone: ok, busy (another
// install holds the lock), already (one put a newer version in place) or error, then the reason.
export const INSTALL_SCRIPT = `set -eu
${HOLD}
${JOURNAL}
url="$1"; home="$2"; dir="$3"; id="$4"; want="$5"; from="$6"; checker="$7"; stamp="$8"; shift 8
keys="$1"; layout="$2"; stage="$dir/$id"; n=0
say() { printf '%s\\n%s\\n' "$1" "$2" > "$dir/$id.status.part" && mv -f "$dir/$id.status.part" "$dir/$id.status"; }
finish() {
  code=$?; set +e; trap - EXIT
  why=$(tail -n 1 "$dir/$id.log" 2>/dev/null)
  if [ -d "$stage" ]; then st=$stage; settle || why="$why; what you had is in $stage/old"; fi
  case $code in 0) say ok "" ;; 75) say busy "" ;; 4) say already "$why" ;; *) say error "\${why:-the update failed}" ;; esac
}
trap finish EXIT
trap 'exit 1' HUP INT TERM
taken=0; hold "$dir/lock" || taken=$?
[ "$taken" = 0 ] || { [ "$taken" = 75 ] || echo "the update lock could not be taken" >&2; exit "$taken"; }
say running download
recover
find "$dir" -maxdepth 1 -type f -mtime +1 ! -name lock ! -name "$id.*" -exec rm -f {} + 2>/dev/null || true
version() { sed -n 's/.*"version"[^"]*"\\([^"]*\\)".*/\\1/p' "$1" 2>/dev/null || true; }
have=$(version "$home/mods/kanso-chrome/version.json")
[ "$have" = "$from" ] || { echo "kansō is already at \${have:-another version}" >&2; exit 4; }
mkdir -p "$stage/src"
curl -fsSL --max-time 120 -o "$stage/release.tar.gz" "$url" || { echo "the download failed" >&2; exit 1; }
tar -xzf "$stage/release.tar.gz" -C "$stage/src" --strip-components=1 || { echo "the download could not be opened" >&2; exit 1; }
rm -f "$stage/release.tar.gz"
src="$stage/src/kanso"
got=$(version "$src/mods/kanso-chrome/version.json")
[ "$got" = "$want" ] || { echo "the v$want release says it is \${got:-no version}" >&2; exit 3; }
say running check
for new in "$src/mods"/*/; do
  name=$(basename "$new")
  out=$("$checker" check "$src/mods/$name" 2>&1 9>&-) || { echo "$name does not load on this Herdr: $(printf '%s\\n' "$out" | tail -n 1)" >&2; exit 1; }
done
if [ -n "$keys" ]; then printf '%s\\n' "$keys" > "$stage/keys.json"; fi
if [ "$layout" = 1 ]; then cp "$src/layouts/kanso.json" "$stage/kanso.json"; fi
mkdir -p "$stage/old/mods" "$stage/old/themes" "$home/mods" "$home/themes" "$home/layouts"
printf '%s\\n' "$stamp" > "$stage/stamp"
st=$stage
entry() { slot "$1"; [ -e "$S" ] || return 0; if [ -e "$L" ]; then echo "1 $1"; else echo "0 $1"; fi; }
{
  entry keys; entry layout; entry picture
  for theme in "$src/themes"/*.json; do entry "themes/\${theme##*/}"; done
  for new in "$src/mods"/*/; do name=$(basename "$new"); case $name in kanso-tabs|kanso-chrome) ;; *) entry "$name" ;; esac; done
  entry kanso-tabs; entry kanso-chrome
} > "$stage/slots.part"
say running swap
mv "$stage/slots.part" "$stage/slots"
forward
: > "$stage/committed"
step
settle
`;

// Recovery on its own, for any copy that starts: under the lock (an install that holds it is alive
// and finishes its own), every stage left by a dead install is finished or undone (JOURNAL).
export const RECOVER = `set -u
${HOLD}
${JOURNAL}
home="$1"; dir="$2"; n=0; stage=
ls -d "$dir"/*/ >/dev/null 2>&1 || exit 0
taken=0; hold "$dir/lock" || taken=$?
[ "$taken" = 0 ] || exit "$taken"
recover
`;

// Starts INSTALL_SCRIPT in its own session, its output to <id>.log, and returns at once with
// its pid in <id>.pid: the follower tells a dead install from a running one by it.
export const LAUNCH = `dir="$1"; id="$2"; body="$3"; shift 3
mkdir -p "$dir"
if command -v setsid >/dev/null 2>&1; then setsid sh -c "$body" sh "$@" </dev/null >"$dir/$id.log" 2>&1 &
else nohup sh -c "$body" sh "$@" </dev/null >"$dir/$id.log" 2>&1 &
fi
echo "$!" > "$dir/$id.pid"
`;

const lastLine = (r, fallback) => (r?.stderr || r?.stdout || "").trim().split("\n").at(-1) || fallback;
const stamp = () => new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 13);
const opId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const fresh = (mark, ms) => Boolean(mark?.at) && Date.now() - mark.at < ms;

export class Updater {
  constructor(source = SOURCE) {
    this.source = source;
    this.installed = null;
    this.working = false;
    this.error = null;
    this.following = {};
    this.pauseS = source.pauseS ?? 2;
  }

  // The tab bar and the footer each hold an Updater: an install either started shows on both.
  get busy() { return this.working || Object.values(this.installs()).some((mark) => fresh(mark, SHOWN_MS)); }

  state() { return shared(STATE) ?? {}; }
  setState(patch) { setShared(STATE, { ...this.state(), ...patch }); }
  // Installs in flight from this window, by id: { version, notes, at }. Kept in shared state, so a
  // copy started by the swap's reload follows them on.
  installs() { return this.state().installs ?? {}; }
  mark(id, patch) { this.setState({ installs: { ...this.installs(), [id]: { ...this.installs()[id], ...patch } } }); }
  unmark(id) { this.setState({ installs: Object.fromEntries(Object.entries(this.installs()).filter(([k]) => k !== id)) }); }
  autoCheckEnabled() { return this.state().autoCheck !== false; }

  available() {
    const { latest } = this.state();
    if (!parseVersion(latest) || !parseVersion(this.installed)) return null;
    return compareVersions(latest, this.installed) > 0 ? latest : null;
  }

  // Not cached: mid-update a copy can start before version.json lands and would re-offer what is installed.
  async readInstalled() {
    try {
      const v = JSON.parse(await readTextFile(`${appHome()}/mods/kanso-chrome/version.json`) ?? "{}").version;
      if (parseVersion(v)) this.installed = v;
    } catch {}
  }

  // One copy polls GitHub (the tab bar, always on screen), and only while automatic checks are
  // on in Kanso's settings; otherwise it only reads what a check asked for found.
  start(cx, { polls = true } = {}) {
    const polling = () => polls && this.autoCheckEnabled();
    cx.spawn(async (cx) => {
      // Before the version is read: a swap a dead install left half done is finished or undone.
      await this.recover();
      await this.readInstalled();
      this.finished();
      // The tab bar copy picks up an install a replaced copy started; it reports the outcome.
      if (polls) Object.keys(this.installs()).forEach((id) => cx.spawn((cx) => this.follow(cx, id)));
      if (polling()) await this.check(cx, true);
      this.fit();
      cx.notify();
    });
    cx.timer.every(TICK, (cx) => cx.spawn(async (cx) => {
      if (polling()) await this.check(cx);
      else if (!this.busy) await this.readInstalled();
      this.fit();
      cx.notify();
    }));
    // A footer row turned on or off in Kanso's settings, or a release the poller found: the footer takes its new height at once.
    cx.timer.every(1500, () => {
      const now = JSON.stringify([shared("kanso.hidden") ?? [], this.state().latest ?? null]);
      if (now !== this.hiddenSeen) { this.hiddenSeen = now; this.fit(); }
    });
  }

  // Resized only when at a size we set, so a footer you sized yourself is left alone.
  fit() {
    const found = tryOr(() => ({ size: findNode(layout()?.root ?? layout(), FOOTER)?.size?.px }));
    if (!found) return;
    const { size } = found;
    const hidden = new Set(tryOr(() => (Array.isArray(shared("kanso.hidden")) ? shared("kanso.hidden") : []), []));
    const want = footerPx(hidden, Boolean(this.available()));
    if (size !== want && OURS(size)) run("layout.resize", { id: FOOTER, px: want });
  }

  // The updater of an older release notes `done` before its swap; the copy that swap starts reports it.
  finished() {
    const { done } = this.state();
    if (!done) return;
    this.setState({ done: null });
    if (done.version !== this.installed) return;
    notify({ title: `kansō updated to ${done.version}`, body: done.notes || undefined, level: "success" });
  }

  async check(cx, force = false, report = false) {
    if (!this.busy) await this.readInstalled();
    const { checked, looking } = this.state();
    if (this.busy || fresh(looking, LOOK_MS) || (!force && checked && Date.now() - checked < EVERY)) return;
    // Marked in the window's shared state, so the other copy does not look at the same time.
    const id = opId();
    this.setState({ looking: { id, at: Date.now() } });
    // The git flags keep a credential prompt or a stalled remote from hanging the check.
    const r = await tryOrAsync(() => exec("git", ["-c", "core.askPass=true", "-c", "credential.interactive=never", "-c", "http.lowSpeedLimit=1000", "-c", "http.lowSpeedTime=20", "ls-remote", "--tags", "--refs", this.source.remote]));
    if (this.state().looking?.id === id) this.setState({ looking: null });
    if (r?.code !== 0) {
      if (report) notify({ title: "kansō could not check for updates", body: "GitHub could not be reached.", level: "warning" });
      return;
    }
    this.setState({ latest: newestTag(r.stdout), checked: Date.now() });
    const v = this.available();
    if (report && !v) notify({ title: "kansō is up to date", body: `You have ${this.installed}, the newest release.`, level: "success" });
    if (report && v && this.state().notified === v) this.setState({ notified: null }); // an explicit check re-notifies for the same version
    if (v && this.state().notified !== v) {
      this.setState({ notified: v });
      notify({
        title: `kansō ${v} is available`,
        body: `You have ${this.installed}. Click to update; Herdr's own updates stay under Settings.`,
        action: { name: "kanso-tabs.update" },
        timeout: 30000,
      });
    }
  }

  // The keys and layout are decided here; the rest is INSTALL_SCRIPT, started detached. This copy
  // then follows it to the end, unless the swap replaces it first: the fresh tab bar copy goes on.
  async install(cx) {
    const v = this.available();
    if (!v || this.working) return;
    if (this.busy) return this.elsewhere();
    const id = opId();
    this.working = true;
    this.error = null;
    this.mark(id, { version: v, notes: "", at: Date.now(), phase: "preparing" });
    cx.notify();
    const home = appHome(), dir = `${home}/${UPDATES}`;
    const started = await tryOrAsync(async () => {
      const plan = await this.plan(v, home);
      this.mark(id, { notes: plan.notes });
      return exec("sh", ["-c", LAUNCH, "sh", dir, id, INSTALL_SCRIPT, this.source.tarball(v), home, dir, id,
        v, this.installed, this.source.checker ?? SOURCE.checker, stamp(), plan.keys, plan.layout ? "1" : ""]);
    });
    this.working = false;
    if (started?.code !== 0) {
      const mark = this.installs()[id];
      this.unmark(id);
      return this.report(cx, "error", lastLine(started, "the update could not start"), mark);
    }
    this.mark(id, { phase: "started", at: Date.now() });
    return this.follow(cx, id);
  }

  async recover() {
    const home = appHome();
    await tryOrAsync(() => exec("sh", ["-c", RECOVER, "sh", home, `${home}/${UPDATES}`]));
  }

  // Reads <id>.status every few seconds until it says how the install ended. While the install is
  // still being prepared (no process yet) it waits; one whose copy went away before starting it is
  // dropped once its mark has expired. A process gone without saying (killed outright) is settled
  // by recovery, and the version then in place says how it ended. The follower that claims the
  // pid file (a rename: one wins) is the one that reports.
  async follow(cx, id) {
    if (this.following[id]) return;
    this.following = { ...this.following, [id]: true };
    const dir = `${appHome()}/${UPDATES}`;
    const read = async () => {
      const [state, why] = String(await readTextFile(`${dir}/${id}.status`) ?? "running").split("\n");
      return { state, why: why ?? "" };
    };
    const pause = () => tryOrAsync(() => exec("sleep", [String(this.pauseS)]));
    const end = async () => {
      for (;;) {
        const mark = this.installs()[id];
        if (!mark) return null;
        if (mark.phase === "preparing") {
          if (!fresh(mark, PREPARE_MS)) { this.unmark(id); return null; }
          await pause();
          continue;
        }
        const now = await read();
        if (now.state !== "running") return now;
        const alive = await tryOrAsync(() => exec("sh", ["-c", 'kill -0 "$(cat "$1")" 2>/dev/null', "sh", `${dir}/${id}.pid`]));
        if (alive?.code !== 0) {
          const last = await read(); // it may have said so just before it ended
          if (last.state !== "running") return last;
          await this.recover();
          await this.readInstalled();
          return this.installed === mark.version ? { state: "ok", why: "" } : { state: "error", why: "the update stopped before it finished; what you had is back" };
        }
        await pause();
      }
    };
    const outcome = await end();
    this.following = Object.fromEntries(Object.entries(this.following).filter(([k]) => k !== id));
    const mark = this.installs()[id];
    if (!outcome || !mark) return;
    const claimed = await tryOrAsync(() => exec("mv", [`${dir}/${id}.pid`, `${dir}/${id}.reported`]));
    if (claimed?.code !== 0) return; // another copy reports it
    this.unmark(id);
    await tryOrAsync(() => exec("rm", ["-f", `${dir}/${id}.status`, `${dir}/${id}.reported`, `${dir}/${id}.log`]));
    return this.report(cx, outcome.state, outcome.why, mark);
  }

  async report(cx, state, why, mark = {}) {
    await this.readInstalled();
    const told = state === "busy" || state === "already" ? this.elsewhere() : undefined;
    if (state === "ok" && mark.version) notify({ title: `kansō updated to ${mark.version}`, body: mark.notes || undefined, level: "success" });
    if (state === "error") {
      this.error = why || "the update failed";
      notify({ title: "kansō was not updated", body: this.error, level: "error" });
    }
    this.fit();
    cx.notify();
    return told;
  }

  elsewhere() {
    notify({ title: "kansō is already being updated", body: "Another window or the other Update button started it; it finishes on its own.", level: "info" });
    return "busy";
  }

  // From the two tags' raw files: what you have against what the release ships. keys is the
  // merged keys.json to write ("" leaves yours), layout whether the release changed the layout.
  async plan(v, home) {
    const shipped = async (version, path) => {
      try {
        const r = await exec("curl", ["-fsSL", "--max-time", "15", this.source.file(version, path)]);
        return r.code === 0 ? r.stdout : null;
      } catch { return null; }
    };
    const [oldKeys, oldLayout, newKeys, newLayout] = await Promise.all([
      shipped(this.installed, "kanso/keys.json"), shipped(this.installed, "kanso/layouts/kanso.json"),
      shipped(v, "kanso/keys.json"), shipped(v, "kanso/layouts/kanso.json"),
    ]);
    const layout = oldLayout !== null && newLayout !== null && !sameJson(oldLayout, newLayout);
    const userKeys = await readTextFile(`${home}/keys.json`);
    const differ = oldKeys !== null && newKeys !== null && userKeys !== null && !sameJson(oldKeys, newKeys);
    const merged = differ ? tryOr(() => mergeKeys(JSON.parse(userKeys), JSON.parse(oldKeys), JSON.parse(newKeys)), "unread") : null;
    const keyNotes = merged === "unread" ? ["Your keys.json could not be read, so kansō's keys were left as they are."]
      : merged ? [...(merged.changed ? ["kansō's keys updated."] : []), ...(merged.kept.length ? [`Kept your own ${merged.kept.join(", ")}.`] : [])]
      : [];
    return {
      keys: merged && merged !== "unread" && merged.changed ? JSON.stringify(merged.keys, null, 2) : "",
      layout,
      notes: [...(layout ? ["New layout; the one you had is in layouts/kanso.json.old-*."] : []), ...keyNotes].join(" "),
    };
  }
}

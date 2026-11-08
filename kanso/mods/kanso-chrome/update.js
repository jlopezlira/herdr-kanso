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

// The whole install, one process: the lock is its own, from before the download to the last
// mod swapped, and its EXIT trap removes its staging on every way out, even once the swap has
// replaced the mod that started it. 75: another install holds the lock; 4: one already put a
// newer version in place; 3: the tag's files say another version.
export const INSTALL_SCRIPT = `set -eu
${HOLD}
url="$1"; home="$2"; stage="$3"; want="$4"; from="$5"; checker="$6"; stamp="$7"; keys="$8"; layout="$9"
taken=0; hold "$home/.kanso-update.lock" || taken=$?
[ "$taken" = 0 ] || { [ "$taken" = 75 ] || echo "the update lock could not be taken" >&2; exit "$taken"; }
trap 'chmod -R u+w "$stage" 2>/dev/null; rm -rf "$stage"' EXIT
trap 'exit 1' HUP INT TERM
version() { sed -n 's/.*"version"[^"]*"\\([^"]*\\)".*/\\1/p' "$1" 2>/dev/null || true; }
have=$(version "$home/mods/kanso-chrome/version.json")
[ "$have" = "$from" ] || { echo "kansō is already at \${have:-another version}" >&2; exit 4; }
# A staging folder lives only while its install holds the lock: any other here is a dead one's.
for left in "$home"/.kanso-update-*; do if [ -d "$left" ] && [ "$left" != "$stage" ]; then chmod -R u+w "$left" 2>/dev/null; rm -rf "$left"; fi; done
mkdir -p "$stage/src"
curl -fsSL --max-time 25 -o "$stage/release.tar.gz" "$url" || { echo "the download failed" >&2; exit 1; }
tar -xzf "$stage/release.tar.gz" -C "$stage/src" --strip-components=1 || { echo "the download could not be opened" >&2; exit 1; }
rm -f "$stage/release.tar.gz"
src="$stage/src/kanso"
got=$(version "$src/mods/kanso-chrome/version.json")
[ "$got" = "$want" ] || { echo "the v$want release says it is \${got:-no version}" >&2; exit 3; }
for dir in "$src/mods"/*/; do
  name=$(basename "$dir")
  out=$("$checker" check "$src/mods/$name" 2>&1 9>&-) || { echo "$name does not load on this Herdr: $(printf '%s\\n' "$out" | tail -n 1)" >&2; exit 1; }
done
if [ -n "$keys" ]; then printf '%s\\n' "$keys" > "$stage/keys.json"; fi
if [ "$layout" = 1 ]; then cp "$src/layouts/kanso.json" "$stage/kanso.json"; fi
mkdir -p "$stage/old" "$home/mods" "$home/themes" "$home/layouts"
if [ -f "$stage/keys.json" ]; then mv "$stage/keys.json" "$home/keys.json"; fi
if [ -f "$stage/kanso.json" ]; then
  if [ -f "$home/layouts/kanso.json" ]; then cp "$home/layouts/kanso.json" "$home/layouts/kanso.json.old-$stamp"; fi
  mv "$stage/kanso.json" "$home/layouts/kanso.json"
fi
cp "$src"/themes/*.json "$home/themes/"
cp "$src/layouts/kanso.png" "$home/layouts/kanso.png"
for dir in "$src/mods"/*/; do
  name=$(basename "$dir")
  if [ -e "$home/mods/$name" ]; then rm -rf "$stage/old/$name"; mv "$home/mods/$name" "$stage/old/$name"; fi
  if ! mv "$src/mods/$name" "$home/mods/$name"; then
    if [ -e "$stage/old/$name" ]; then mv "$stage/old/$name" "$home/mods/$name"; fi
    echo "could not put $name in place" >&2; exit 1
  fi
done
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
  }

  // The tab bar and the footer each hold an Updater: an install either started shows on both.
  get busy() { return this.working || fresh(this.state().installing, SHOWN_MS); }

  state() { return shared(STATE) ?? {}; }
  setState(patch) { setShared(STATE, { ...this.state(), ...patch }); }
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
      await this.readInstalled();
      this.finished();
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

  // The update replaces this mod mid-run, so whichever copy sees `done` first reports it once.
  finished() {
    const { done } = this.state();
    if (!done) return;
    this.setState({ done: null, installing: null });
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

  // The keys and layout are decided here; the rest is INSTALL_SCRIPT, one process under the lock.
  async install(cx) {
    const v = this.available();
    if (!v || this.working) return;
    if (this.busy) return this.elsewhere();
    const id = opId();
    this.working = true;
    this.error = null;
    this.setState({ installing: { id, at: Date.now() } });
    cx.notify();
    const home = appHome();
    try {
      const plan = await this.plan(v, home);
      // Swapping kanso-chrome restarts this mod; the fresh copy reports.
      this.setState({ done: { version: v, notes: plan.notes, id } });
      const r = await exec("sh", ["-c", INSTALL_SCRIPT, "sh", this.source.tarball(v), home, `${home}/.kanso-update-${id}`,
        v, this.installed, this.source.checker ?? SOURCE.checker, stamp(), plan.keys, plan.layout ? "1" : ""]);
      // 75: another install of this version runs, and its swap reloads this window too, so the
      // note stays for the fresh copy to report.
      if (r.code === 75) return this.elsewhere();
      if (this.state().done?.id === id && r.code !== 0) this.setState({ done: null });
      if (r.code === 4) return this.elsewhere();
      if (r.code !== 0) throw new Error(lastLine(r, "the files could not be put in place"));
      this.installed = v;
      this.finished();
    } catch (e) {
      this.error = String(e?.message ?? e);
      notify({ title: "kansō was not updated", body: this.error, level: "error" });
    } finally {
      this.settle(cx, id);
    }
  }

  settle(cx, id) {
    this.working = false;
    if (this.state().installing?.id === id) this.setState({ installing: null });
    this.fit();
    cx.notify();
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

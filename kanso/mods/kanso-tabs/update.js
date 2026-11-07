// Kanso's own updates, by jlopezlira (https://github.com/jlopezlira/herdr-kanso). Apache-2.0.
import { exec, readTextFile, writeTextFile, appHome, shared, setShared, notify, layout, run } from "herdr";
import { tryOr, tryOrAsync } from "./pure.js";

export const SOURCE = {
  remote: "https://github.com/jlopezlira/herdr-kanso.git",
  tarball: (v) => `https://github.com/jlopezlira/herdr-kanso/archive/refs/tags/v${v}.tar.gz`,
  file: (v, path) => `https://raw.githubusercontent.com/jlopezlira/herdr-kanso/v${v}/${path}`,
};

const STATE = "kanso.update";
// ls-remote costs no GitHub API quota; EVERY keeps copies from asking twice.
const TICK = 5 * 60 * 1000;
const EVERY = 4 * 60 * 1000;
// FOOTER_UPDATE_PX is FOOTER_PX plus one 34px row and its gap.
const FOOTER = "sidebar-footer";
const FOOTER_PX = 156, FOOTER_UPDATE_PX = 192;

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

export const STAGE_SCRIPT = `set -eu
rm -rf "$2"; mkdir -p "$2/src"
curl -fsSL --max-time 25 -o "$2/release.tar.gz" "$1"
tar -xzf "$2/release.tar.gz" -C "$2/src" --strip-components=1
rm -f "$2/release.tar.gz"
got=$(sed -n 's/.*"version"[^"]*"\\([^"]*\\)".*/\\1/p' "$2/src/kanso/mods/kanso-chrome/version.json" 2>/dev/null || true)
[ "$got" = "$3" ] || { echo "the v$3 release says it is \${got:-no version}" >&2; exit 3; }
for dir in "$2/src/kanso/mods"/*/; do basename "$dir"; done
`;

export const SWAP_SCRIPT = `set -eu
src="$1/src/kanso"
mkdir -p "$1/old" "$2/mods" "$2/themes" "$2/layouts"
if [ -f "$1/keys.json" ]; then mv "$1/keys.json" "$2/keys.json"; fi
if [ -f "$1/kanso.json" ]; then
  if [ -f "$2/layouts/kanso.json" ]; then cp "$2/layouts/kanso.json" "$2/layouts/kanso.json.old-$3"; fi
  mv "$1/kanso.json" "$2/layouts/kanso.json"
fi
cp "$src"/themes/*.json "$2/themes/"
cp "$src/layouts/kanso.png" "$2/layouts/kanso.png"
for dir in "$src/mods"/*/; do
  name=$(basename "$dir")
  if [ -e "$2/mods/$name" ]; then rm -rf "$1/old/$name"; mv "$2/mods/$name" "$1/old/$name"; fi
  if ! mv "$src/mods/$name" "$2/mods/$name"; then
    if [ -e "$1/old/$name" ]; then mv "$1/old/$name" "$2/mods/$name"; fi
    echo "could not put $name in place" >&2; exit 1
  fi
done
rm -rf "$1"
`;

const lastLine = (r, fallback) => (r?.stderr || r?.stdout || "").trim().split("\n").at(-1) || fallback;
const stamp = () => new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 13);

export class Updater {
  constructor(source = SOURCE) {
    this.source = source;
    this.installed = null;
    this.busy = false;
    this.error = null;
  }

  state() { return shared(STATE) ?? {}; }
  setState(patch) { setShared(STATE, { ...this.state(), ...patch }); }

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

  start(cx) {
    cx.spawn(async (cx) => {
      await this.readInstalled();
      this.finished();
      await this.check(cx, true);
      this.fit();
      cx.notify();
    });
    cx.timer.every(TICK, (cx) => cx.spawn(async (cx) => { await this.check(cx); this.fit(); cx.notify(); }));
  }

  // Resized only when at a size we set, so a footer you sized yourself is left alone.
  fit() {
    const found = tryOr(() => ({ size: findNode(layout()?.root ?? layout(), FOOTER)?.size?.px }));
    if (!found) return;
    const { size } = found;
    const want = this.available() ? FOOTER_UPDATE_PX : FOOTER_PX;
    if (size !== want && (size === FOOTER_PX || size === FOOTER_UPDATE_PX)) run("layout.resize", { id: FOOTER, px: want });
  }

  // The update replaces this mod mid-run, so whichever copy sees `done` first reports it once.
  finished() {
    const { done } = this.state();
    if (!done) return;
    this.setState({ done: null });
    if (done.version !== this.installed) return;
    notify({ title: `kansō updated to ${done.version}`, body: done.notes || undefined, level: "success" });
  }

  async check(cx, force = false, report = false) {
    if (!this.busy) await this.readInstalled();
    const { checked } = this.state();
    if (this.busy || this.checking || (!force && checked && Date.now() - checked < EVERY)) return;
    // The git flags keep a credential prompt or a stalled remote from hanging the check.
    this.checking = true;
    const r = await tryOrAsync(() => exec("git", ["-c", "core.askPass=true", "-c", "credential.interactive=never", "-c", "http.lowSpeedLimit=1000", "-c", "http.lowSpeedTime=20", "ls-remote", "--tags", "--refs", this.source.remote]));
    this.checking = false;
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

  async install(cx) {
    const v = this.available();
    if (!v || this.busy) return;
    this.busy = true;
    this.error = null;
    cx.notify();
    const home = appHome(), stage = `${home}/.kanso-update`, src = `${stage}/src/kanso`;
    try {
      const staged = await exec("sh", ["-c", STAGE_SCRIPT, "sh", this.source.tarball(v), stage, v]);
      if (staged.code !== 0) throw new Error(lastLine(staged, "the download failed"));
      for (const name of staged.stdout.split("\n").map((s) => s.trim()).filter(Boolean)) {
        const c = await exec("herdr-app", ["check", `${src}/mods/${name}`]);
        if (c.code !== 0) throw new Error(`${name} does not load on this Herdr: ${lastLine(c, "check failed")}`);
      }
      const notes = await this.stageKeysAndLayout(v, home, stage, src);
      this.setState({ done: { version: v, notes } });
      // Swapping kanso-chrome restarts this mod; the fresh copy reports.
      const swapped = await exec("sh", ["-c", SWAP_SCRIPT, "sh", stage, home, stamp()]);
      if (swapped.code !== 0) {
        this.setState({ done: null });
        throw new Error(lastLine(swapped, "the files could not be put in place"));
      }
      this.installed = v;
      this.finished();
    } catch (e) {
      this.error = String(e?.message ?? e);
      notify({ title: "kansō was not updated", body: this.error, level: "error" });
      try { await exec("rm", ["-rf", stage]); } catch {}
    } finally {
      this.busy = false;
      this.fit();
      cx.notify();
    }
  }

  async stageKeysAndLayout(v, home, stage, src) {
    const shipped = async (path) => {
      try {
        const r = await exec("curl", ["-fsSL", "--max-time", "15", this.source.file(this.installed, path)]);
        return r.code === 0 ? r.stdout : null;
      } catch { return null; }
    };
    const [oldKeys, oldLayout] = await Promise.all([shipped("kanso/keys.json"), shipped("kanso/layouts/kanso.json")]);
    const newKeys = await readTextFile(`${src}/keys.json`), newLayout = await readTextFile(`${src}/layouts/kanso.json`);
    // The layout first, then the keys (read only after it is staged).
    const layoutNotes = async () => {
      if (oldLayout === null || newLayout === null || sameJson(oldLayout, newLayout)) return [];
      await writeTextFile(`${stage}/kanso.json`, newLayout, null);
      return ["New layout; the one you had is in layouts/kanso.json.old-*."];
    };
    const keyNotes = async () => {
      const userKeys = await readTextFile(`${home}/keys.json`);
      if (oldKeys === null || newKeys === null || userKeys === null || sameJson(oldKeys, newKeys)) return [];
      try {
        const merged = mergeKeys(JSON.parse(userKeys), JSON.parse(oldKeys), JSON.parse(newKeys));
        if (merged.changed) await writeTextFile(`${stage}/keys.json`, `${JSON.stringify(merged.keys, null, 2)}\n`, null);
        return [...(merged.changed ? ["kansō's keys updated."] : []), ...(merged.kept.length ? [`Kept your own ${merged.kept.join(", ")}.`] : [])];
      } catch {
        return ["Your keys.json could not be read, so kansō's keys were left as they are."];
      }
    };
    const notes = [...(await layoutNotes()), ...(await keyNotes())];
    return notes.join(" ");
  }
}

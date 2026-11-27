import { exec } from "herdr";
import { locateOn } from "./conversation-on.js";
import { agentHint } from "./conversation-at.js";
import { paths } from "./platform-paths.js";
import { machineOf } from "./own-tree.js";
import { bounded, LATE } from "./pure.js";

const AWK = "/\"name\":\"(Edit|Write|MultiEdit|NotebookEdit)\"/ { ts = \"\"; if (match($0, /\"timestamp\":\"[^\"]+\"/)) ts = substr($0, RSTART + 13, RLENGTH - 14); s = $0; while (match(s, /\"(file_path|notebook_path)\":\"[^\"]+\"/)) { v = substr(s, RSTART, RLENGTH); sub(/^\"[a-z_]+\":\"/, \"\", v); sub(/\"$/, \"\", v); print ts \"\\t\" v; s = substr(s, RSTART + RLENGTH) } } /\"type\":\"(custom_tool_call|function_call)\"/ { ts = \"\"; if (match($0, /\"timestamp\":\"[^\"]+\"/)) ts = substr($0, RSTART + 13, RLENGTH - 14); s = $0; while (match(s, /\\*\\*\\* (Update|Add|Delete) File: [^\\\\\"]+/)) { v = substr(s, RSTART, RLENGTH); sub(/^\\*\\*\\* (Update|Add|Delete) File: /, \"\", v); print ts \"\\t\" v; s = substr(s, RSTART + RLENGTH) } }";
const EDITED = `f=$1; from=$2; [ -f "$f" ] || exit 0; size=$(wc -c < "$f" | tr -d ' '); echo "$size"; [ "$size" -gt "$from" ] || exit 0; tail -c +$((from + 1)) "$f" | awk '${AWK}'`;
const STEP_MS = 15_000;
const on = (machine) => (machine ? { on: machine } : {});
const same = (a, b) => paths.equal(paths.canonical(a), paths.canonical(b));
const timed = (work, timer) => bounded(work.catch(() => null), timer, STEP_MS).then((r) => (r === LATE ? null : r));

export function changedIn(porcelain) {
  const entries = porcelain.split("\0").filter(Boolean);
  return entries.reduce(({ files, skip }, entry) => (skip ? { files, skip: false }
    : { files: [...files, entry.slice(3)], skip: /^[RC]|^.[RC]/.test(entry) }), { files: [], skip: false }).files;
}

export function editsIn(text, cwd) {
  const [size, ...rows] = String(text ?? "").split("\n");
  const edits = rows.map((row) => row.split("\t")).filter(([, file]) => file)
    .map(([at, file]) => ({ at: Date.parse(at) || 0, file: paths.isAbsolute(file) ? file : paths.join(cwd, file) }));
  return { size: Number(size) || 0, edits };
}

export function overlaps(group, dirty, editedBy, committedAt = {}) {
  const found = {};
  for (const file of dirty) {
    const since = committedAt[file] ?? 0;
    const editors = group.filter((a) => (editedBy[a.address] ?? []).some((e) => same(e.file, file) && e.at > since));
    if (editors.length < 2) continue;
    for (const a of editors) found[a.address] = [...(found[a.address] ?? []), { file, others: editors.filter((b) => b !== a) }];
  }
  return found;
}

export function warningOf(found, nameOf) {
  if (!found?.length) return null;
  const others = [...new Set(found.flatMap((x) => x.others.map(nameOf)))];
  const first = paths.basename(found[0].file);
  return {
    text: `Also changed by ${others.join(", ")}: ${first}${found.length > 1 ? ` and ${found.length - 1} more` : ""}`,
    tip: found.map((x) => `${x.file}: ${x.others.map(nameOf).join(", ")}`).join("\n"),
  };
}

export class SharedEdits {
  constructor(timer) { this.timer = timer; this.roots = new Map(); this.read = new Map(); }

  async rootOf(machine, cwd) {
    const key = `${machine}\0${cwd}`;
    if (!this.roots.has(key)) {
      const r = await timed(exec("git", ["-C", cwd, "rev-parse", "--show-toplevel"], on(machine)), this.timer);
      if (r?.code !== 0) return "";
      this.roots.set(key, r.stdout.trim());
    }
    return this.roots.get(key);
  }

  async editedBy(a, machine, cwd) {
    const where = await timed(locateOn(machine || null, a.address, agentHint(a)), this.timer);
    if (!where?.file) return [];
    const key = `${machine}\0${where.file}`, kept = this.read.get(key) ?? { size: 0, edits: [] };
    const readFrom = (from) => timed(exec("sh", ["-c", EDITED, "sh", where.file, String(from)], on(machine)), this.timer);
    const r = await readFrom(kept.size);
    if (r?.code !== 0) return kept.edits;
    const got = editsIn(r.stdout, cwd);
    const again = got.size < kept.size ? await readFrom(0) : null;
    if (again && again.code !== 0) return [];
    const next = again ? editsIn(again.stdout, cwd) : { size: got.size, edits: [...kept.edits, ...got.edits] };
    this.read.set(key, next);
    return next.edits;
  }

  async committed(machine, root, files) {
    const times = await Promise.all(files.map(async (file) => {
      const r = await timed(exec("git", ["-C", root, "log", "-1", "--format=%cI", "--", file], on(machine)), this.timer);
      return [file, r?.code === 0 ? Date.parse(r.stdout.trim()) || 0 : 0];
    }));
    return Object.fromEntries(times);
  }

  async scan(list, cwdOf, nameOf) {
    const live = list.filter((a) => a.program?.agent && cwdOf(a));
    const rooted = await Promise.all(live.map(async (a) => ({ a, machine: machineOf(a.address), cwd: cwdOf(a), root: await this.rootOf(machineOf(a.address), cwdOf(a)) })));
    const keyOf = (x) => `${x.machine}\0${paths.canonical(x.root)}`;
    const groups = [...new Set(rooted.filter((x) => x.root).map(keyOf))].map((key) => rooted.filter((x) => x.root && keyOf(x) === key)).filter((g) => g.length > 1);
    const warned = await Promise.all(groups.map(async (g) => {
      const { machine, root } = g[0];
      const status = await timed(exec("git", ["-C", root, "status", "--porcelain=v1", "-z", "--untracked-files=all"], on(machine)), this.timer);
      const dirty = status?.code === 0 ? changedIn(String(status.stdout)).map((file) => paths.join(root, file)) : [];
      if (!dirty.length) return {};
      const edited = Object.fromEntries(await Promise.all(g.map(async (x) => [x.a.address, await this.editedBy(x.a, machine, x.cwd)])));
      const touched = dirty.filter((file) => g.filter((x) => edited[x.a.address].some((e) => same(e.file, file))).length > 1);
      if (!touched.length) return {};
      const found = overlaps(g.map((x) => x.a), touched, edited, await this.committed(machine, root, touched));
      return Object.fromEntries(Object.entries(found).map(([address, files]) => [address, warningOf(files, nameOf)]));
    }));
    return Object.assign({}, ...warned);
  }
}

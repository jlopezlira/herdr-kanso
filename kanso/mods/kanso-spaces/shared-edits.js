import { exec } from "herdr";
import { paths } from "./platform-paths.js";
import { machineOf } from "./own-tree.js";
import { bounded, LATE } from "./pure.js";

const AWK = "/\"name\":\"(Edit|Write|MultiEdit|NotebookEdit)\"/ { ts = \"\"; id = \"\"; if (match($0, /\"timestamp\":\"[^\"]+\"/)) ts = substr($0, RSTART + 13, RLENGTH - 14); if (match($0, /\"id\":\"[^\"]+\",\"name\":\"(Edit|Write|MultiEdit|NotebookEdit)\"/)) { id = substr($0, RSTART + 6); sub(/\".*/, \"\", id) } s = $0; while (match(s, /\"(file_path|notebook_path)\":\"[^\"]+\"/)) { v = substr(s, RSTART, RLENGTH); sub(/^\"[a-z_]+\":\"/, \"\", v); sub(/\"$/, \"\", v); print ts \"\\t\" v \"\\t\" id; s = substr(s, RSTART + RLENGTH) } } /\"is_error\":true/ { n = split($0, part, /\"tool_use_id\":\"/); for (i = 2; i <= n; i++) { v = part[i]; sub(/\".*/, \"\", v); if (part[i] ~ /\"is_error\":true/) print \"\\t\\t\" v \"\\terror\" } } /\"type\":\"(custom_tool_call|function_call)\"/ { ts = \"\"; if (match($0, /\"timestamp\":\"[^\"]+\"/)) ts = substr($0, RSTART + 13, RLENGTH - 14); s = $0; while (match(s, /\\*\\*\\* (Update|Add|Delete) File: [^\\\\\"]+/)) { v = substr(s, RSTART, RLENGTH); sub(/^\\*\\*\\* (Update|Add|Delete) File: /, \"\", v); print ts \"\\t\" v; s = substr(s, RSTART + RLENGTH) } }";
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
  const cells = rows.map((row) => row.split("\t"));
  const failed = new Set(cells.filter((c) => c[3] === "error").map((c) => c[2]));
  const edits = cells.filter(([, file, id]) => file && !(id && failed.has(id)))
    .map(([at, file, id]) => ({ at: Date.parse(at) || 0, file: paths.isAbsolute(file) ? file : paths.join(cwd, file), ...(id ? { id } : {}) }));
  return { size: Number(size) || 0, edits, failed: [...failed] };
}

export function overlaps(group, dirty, editedBy, committedAt = {}) {
  const shared = dirty.map((file) => ({ file, editors: group.filter((a) => (editedBy[a.address] ?? []).some((e) => same(e.file, file) && e.at > (committedAt[file] ?? 0))) }))
    .filter(({ editors }) => editors.length > 1);
  return Object.fromEntries(group.map((a) => [a.address, shared.filter(({ editors }) => editors.includes(a)).map(({ file, editors }) => ({ file, others: editors.filter((b) => b !== a) }))])
    .filter(([, files]) => files.length));
}

export function groupsOf(list, cwdOf) {
  const live = list.filter((a) => a.program?.agent && cwdOf(a)).map((a) => ({ a, machine: machineOf(a.address), cwd: cwdOf(a) }));
  return [...new Set(live.map((x) => x.machine))].map((machine) => live.filter((x) => x.machine === machine))
    .filter((agents) => agents.length > 1).map((agents) => ({ key: agents[0].machine, machine: agents[0].machine, agents }));
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

  async editedBy(transcript, machine, cwd) {
    if (!transcript) return [];
    const key = `${machine}\0${transcript}`, kept = this.read.get(key) ?? { size: 0, edits: [] };
    const readFrom = (from) => timed(exec("sh", ["-c", EDITED, "sh", transcript, String(from)], on(machine)), this.timer);
    const r = await readFrom(kept.size);
    if (r?.code !== 0) return kept.edits;
    const got = editsIn(r.stdout, cwd);
    const again = got.size < kept.size ? await readFrom(0) : null;
    if (again && again.code !== 0) return [];
    const failed = new Set(got.failed);
    const next = again ? editsIn(again.stdout, cwd) : { size: got.size, edits: [...kept.edits.filter((e) => !(e.id && failed.has(e.id))), ...got.edits] };
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

  async checkout(machine, agents) {
    const rooted = await Promise.all(agents.map(async (x) => ({ ...x, root: await this.rootOf(machine, x.cwd) })));
    const keyOf = (x) => paths.canonical(x.root);
    return [...new Set(rooted.filter((x) => x.root).map(keyOf))].map((key) => rooted.filter((x) => x.root && keyOf(x) === key)).filter((g) => g.length > 1);
  }

  async scan(groups, fileOf, nameOf) {
    const checkouts = (await Promise.all(groups.map(async ({ machine, agents }) => (await this.checkout(machine, agents)).map((g) => ({ machine, agents: g }))))).flat();
    const warned = await Promise.all(checkouts.map(async ({ machine, agents }) => {
      const root = agents[0].root;
      const status = await timed(exec("git", ["-C", root, "status", "--porcelain=v1", "-z", "--untracked-files=all"], on(machine)), this.timer);
      const dirty = status?.code === 0 ? changedIn(String(status.stdout)).map((file) => paths.join(root, file)) : [];
      if (!dirty.length) return {};
      const edited = Object.fromEntries(await Promise.all(agents.map(async (x) => [x.a.address, await this.editedBy(fileOf(x.a), machine, x.cwd)])));
      const touched = dirty.filter((file) => agents.filter((x) => edited[x.a.address].some((e) => same(e.file, file))).length > 1);
      if (!touched.length) return {};
      const found = overlaps(agents.map((x) => x.a), touched, edited, await this.committed(machine, root, touched));
      return Object.fromEntries(Object.entries(found).map(([address, files]) => [address, warningOf(files, nameOf)]));
    }));
    return Object.assign({}, ...warned);
  }
}

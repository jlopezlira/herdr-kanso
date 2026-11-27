import { exec } from "herdr";
import { locateOn } from "./conversation-on.js";
import { agentHint } from "./conversation-at.js";
import { paths } from "./platform-paths.js";

const EDITED = "f=$1; [ -f \"$f\" ] || exit 0; { grep -o -E '\"name\":\"(Edit|Write|MultiEdit|NotebookEdit)\",\"input\":\\{\"(file_path|notebook_path)\":\"[^\"]+\"' \"$f\" | sed -E 's/.*_path\":\"//; s/\"$//'; grep -o -E '\\*\\*\\* (Update|Add|Delete) File: [^\\\\\"]+' \"$f\" | sed -E 's/^\\*\\*\\* (Update|Add|Delete) File: //'; } | sort -u";
const machineOf = (address) => (String(address ?? "").includes("/") ? String(address).split("/")[0] : "");
const on = (machine) => (machine ? { on: machine } : {});
const linesOf = (r) => (r?.code === 0 ? String(r.stdout ?? "").split("\n").map((l) => l.trim()).filter(Boolean) : []);

export function overlaps(group, dirty, editedBy) {
  const found = {};
  for (const file of dirty) {
    const editors = group.filter((a) => (editedBy[a.address] ?? []).some((f) => paths.equal(f, file)));
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
  constructor() { this.roots = new Map(); }

  async rootOf(machine, cwd) {
    const key = `${machine}\0${cwd}`;
    if (!this.roots.has(key)) {
      const r = await exec("git", ["-C", cwd, "rev-parse", "--show-toplevel"], on(machine)).catch(() => null);
      this.roots.set(key, r?.code === 0 ? r.stdout.trim() : "");
    }
    return this.roots.get(key);
  }

  async editedBy(a, machine, cwd) {
    const where = await locateOn(machine || null, a.address, agentHint(a)).catch(() => null);
    if (!where?.file) return [];
    const r = await exec("sh", ["-c", EDITED, "sh", where.file], on(machine)).catch(() => null);
    return linesOf(r).map((f) => (paths.isAbsolute(f) ? f : paths.join(cwd, f)));
  }

  async scan(list, cwdOf, nameOf) {
    const live = list.filter((a) => a.program?.agent && cwdOf(a));
    const rooted = await Promise.all(live.map(async (a) => ({ a, machine: machineOf(a.address), cwd: cwdOf(a), root: await this.rootOf(machineOf(a.address), cwdOf(a)) })));
    const groups = [...new Set(rooted.filter((x) => x.root).map((x) => `${x.machine}\0${x.root}`))]
      .map((key) => rooted.filter((x) => `${x.machine}\0${x.root}` === key)).filter((g) => g.length > 1);
    const warned = await Promise.all(groups.map(async (g) => {
      const { machine, root } = g[0];
      const status = await exec("git", ["-C", root, "status", "--porcelain=v1", "-z", "--untracked-files=all"], on(machine)).catch(() => null);
      const dirty = status?.code === 0 ? String(status.stdout).split("\0").filter(Boolean).map((e) => paths.join(root, e.slice(3))) : [];
      if (!dirty.length) return {};
      const edited = Object.fromEntries(await Promise.all(g.map(async (x) => [x.a.address, await this.editedBy(x.a, machine, x.cwd)])));
      const found = overlaps(g.map((x) => x.a), dirty, edited);
      return Object.fromEntries(Object.entries(found).map(([address, list]) => [address, warningOf(list, nameOf)]));
    }));
    return Object.assign({}, ...warned);
  }
}

// What the sidebar may paint, and the pull a press runs. Drawing stays next door.
export const ASLEEP_ROW = 32;

export const showPlus = (active, hovered) => Boolean(active || hovered);
export const showDots = (hovered) => Boolean(hovered);

export function projectControls({ active, hovered, place }) {
  return { plus: Boolean(place) && showPlus(active, hovered), dots: showDots(hovered) };
}

export const pullKey = (folder, on) => `pull:${on ?? ""}:${folder ?? ""}`;

export function pullLabel(n) {
  const count = Number(n) || 0;
  return count > 0 ? `\u2193${count}` : null;
}

export function pullCommand(folder, on) {
  if (!folder) return null;
  return { command: "git", args: ["-C", folder, "pull", "--ff-only"], on: on ?? null };
}

export function refusalLine(result) {
  if (!result || result.code === 0) return null;
  const line = (value) => String(value ?? "").split("\n").map((item) => item.trim()).find(Boolean) ?? null;
  return line(result.stderr) ?? line(result.stdout);
}

export function aheadOpen(count, place) {
  const n = Number(count) || 0;
  if (n <= 0 || !place?.folder) return null;
  return { panel: "pr", select: place.active ? null : place.id ?? null };
}

export function gitControls(git, { folder, on, id, active, pulling } = {}) {
  if (!git || !folder) return [];
  const open = Number(git.ahead) > 0 ? aheadOpen(git.ahead, { folder, on, id, active }) : null;
  const behindLabel = pullLabel(git.behind);
  const ahead = open ? { kind: "ahead", label: `\u2191${git.ahead}`, open, tip: aheadTip(git.ahead) } : null;
  const behind = behindLabel ? { kind: "behind", label: behindLabel, pulling: Boolean(pulling), command: pulling ? null : pullCommand(folder, on), tip: behindTip(git.behind, git.upstream, pulling) } : null;
  return [ahead, behind].filter(Boolean);
}

export async function runPull(exec, notify, place) {
  const command = pullCommand(place?.folder, place?.on);
  if (!command) return null;
  const result = await exec(command.command, command.args, { on: command.on });
  const line = refusalLine(result);
  if (line) notify({ title: "Pull refused", body: line, level: "error" });
  return result;
}

export function activityTone(status) {
  if (status === "blocked") return "foreground";
  if (status === "working") return "muted";
  if (status === "done" || status === "idle") return "dim";
  return "muted";
}

// A state on the row is a word: the blocked colour is only for an edge and a mark.
export const machineWordTone = () => "dim";

export const canWake = (row) => Boolean(row?.asleep);

export function enterOpens(row) {
  if (row?.asleep) return { wake: row.asleep };
  if (row?.pane) return { focus: row.pane };
  if (row?.address) return { peek: row.address };
  return null;
}

export const asleepControls = (row) => (canWake(row) ? [{ id: "wake", label: "Wake" }] : []);

// The project row's task: its repository when the name differs, the branch, or a detached commit's short id.
export function gitTask(g, name, tree) {
  if (!g) return { repo: "", branch: "", commit: "" };
  const same = String(g.name ?? "").toLowerCase() === String(name ?? "").toLowerCase();
  const detached = !g.branch || g.branch === "(detached)";
  return {
    repo: tree || same ? "" : g.name,
    branch: tree || detached ? "" : g.branch,
    commit: !tree && detached && g.oid ? String(g.oid).slice(0, 7) : "",
  };
}

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function behindTip(n, upstream, pulling = false) {
  const from = upstream ? ` from ${upstream}` : "";
  return `${pulling ? "Pulling" : "Pull"} ${n}${from}`;
}

// The tab's own name, as kanso-tabs draws it.
const PR_TAB = "PR";
export const aheadTip = (n) => `${plural(Number(n) || 0, "commit")} not on GitHub · ${PR_TAB} panel`;

// Open, a group draws nothing of its own; folded, its most urgent mark (never idle) and how many.
export function foldTail(open, statuses) {
  if (open) return null;
  const rank = { blocked: 4, done: 3, working: 2 };
  const mark = statuses.reduce((m, s) => ((rank[s] ?? 0) > (rank[m] ?? 0) ? s : m), null);
  return { mark, count: statuses.length };
}

// A section head: only Needs you carries a mark; the count shows once it is folded.
export const sectionMarkOf = (id) => (id === "blocked" ? "blocked" : null);
export const sectionCount = (open, count) => (open ? null : count);

// The project after a session's name, and its computer when it is not this one.
export function rowDirectory(project, machine) {
  return [project, machine].filter(Boolean).join(" · ") || null;
}

// The time follows what the session is on; with nothing on the second line it keeps its place at the end.
export const timePlace = (activity, time) => (!time ? null : activity ? "line" : "end");

const hm = (ms) => { const d = new Date(ms); return `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`; };
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Snoozed until: the hour today, else the day and the hour.
export function untilWord(until, now) {
  const at = new Date(until);
  return at.toDateString() === new Date(now).toDateString() ? hm(until) : `${DAYS[at.getDay()]} ${hm(until)}`;
}

export const readWord = (at) => (at ? `Read ${hm(at)}` : null);

// The word a thread row carries instead of a line.
export function threadWord({ unreadable = false, snoozedUntil = 0, woke = false, now = Date.now() }) {
  if (unreadable) return "Can't read";
  if (snoozedUntil > now) return untilWord(snoozedUntil, now);
  if (woke) return "Woke";
  return null;
}

// Under the pointer: Settle, or Bring back once settled; a session at work or pinned has neither.
export function threadActions({ settled, status, pinned }) {
  if (settled) return [{ id: "unsettle", icon: "undo", tip: "Bring back" }];
  if (status === "working" || status === "blocked" || pinned) return [];
  return [{ id: "settle", icon: "check", tip: "Settle" }];
}

// A kept project with nothing open: + and the menu under the pointer; a missing folder offers Locate instead of +.
export function closedControls({ hovered, missing }) {
  return { plus: Boolean(hovered) && !missing, dots: Boolean(hovered), locate: Boolean(missing) };
}

export const signInCommand = (name) => ({ argv: ["hc", "machine", "login", name], place: "right" });

export const noProjectsOn = (title) => `No projects on ${title} yet`;

// The sort of the view on show; `plain` is its default, drawn quieter but never hidden.
export function sortOf(view, { order, statusOrder, threadOrder }, { ORDERS, STATUS_ORDERS, THREAD_ORDERS, DEFAULT_ORDER }) {
  if (view === "agents") return { orders: STATUS_ORDERS, current: statusOrder, key: "statusOrder", head: "In each section, by", plain: statusOrder === Object.keys(STATUS_ORDERS)[0] };
  if (view === "threads") return { orders: THREAD_ORDERS, current: threadOrder, key: "threadOrder", head: "Threads, pinned first, then by", plain: threadOrder === Object.keys(THREAD_ORDERS)[0] };
  return { orders: ORDERS, current: order, key: "order", head: "Agents, pinned first, then by", plain: order === DEFAULT_ORDER };
}

// The view switch's keys, as keys.json binds them (keys.windows.json on Windows).
const VIEW_CHORDS = {
  windows: { spaces: "ctrl-shift-r", agents: "ctrl-shift-s", threads: "ctrl-shift-h" },
  other: { spaces: "ctrl-alt-p", agents: "ctrl-alt-s", threads: "ctrl-alt-t" },
};
export const viewChord = (view, platform) => (VIEW_CHORDS[platform === "windows" ? "windows" : "other"][view] ?? null);

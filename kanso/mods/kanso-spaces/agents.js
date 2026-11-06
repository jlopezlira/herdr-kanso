// Added by José Gutiérrez (minimalistic): agents nested under their space. Pure drawing helpers; the
// fold state lives in main.js.
import { div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { run, openOverlay } from "herdr";
import { stateMark, programIcon, NAME_LABEL, onBattery } from "./marks.js";

export { NAME_LABEL };

const AGENT_PAD = 34; // under the space name: 8px row padding, a 22px avatar, the gap

// Motion, all of it native (GPUI animates; no script runs per frame): a
// group of rows folds and unfolds by height, and a selection is one pill
// that glides to the chosen row, at the same pace, so a fold and the pill
// riding on it move together.
export const FOLD = { duration: 220, easing: "ease-out" };
export const FOLD_MS = FOLD.duration + 40; // rows stay drawn this long after a fold, so the close is seen

// The pill under a chosen row: absolute in a `relative()` list, drawn before
// the rows, `top` and `height` easing to wherever the row is now. `inset`:
// the list's side padding, so the pill spans the rows.
export function pill(id, y, h, color, inset = 8) {
  return div().id(id).absolute().left(inset).right(inset).top(y).h(h).rounded(8).bg(color)
    .transition("top", FOLD).transition("height", FOLD);
}

// A row's height, before it is drawn: the lists add their rows' heights up
// to know where a pill goes (agentRow draws with the same number).
export function agentRowH(a, more = {}) {
  const two = Boolean(more.activity) || Boolean(more.project) || Boolean(more.steady);
  return two ? (more.roomy ? ROOMY : TWO) : a.sub ? ROW - 4 : ROW;
}

// Where segment `i` of `n` equal ones sits inside a switch `width` wide with
// `pad` around them and `gap` between: the sliding thumb's left and width.
export function segmentAt(width, i, n, pad = 3, gap = 2) {
  const w = (width - 2 * pad - gap * (n - 1)) / n;
  return { left: pad + i * (w + gap), width: w };
}
// A row flush with the list's 10px inset (the Status and Threads views).
export const FLUSH = 10 - AGENT_PAD;
const RANK = { blocked: 4, done: 3, working: 2, idle: 1 };

const clean = (s) => (s ?? "").replace(/^[^\p{L}\p{N}]+/u, "").trim();

// What you told Kanso about a terminal lives as labels on the terminal
// itself, in herdr-core, so it survives a restart and every Kanso mod reads
// the same: `kanso.name` (marks.js) is the name you gave it (double-click
// its row or its pane header), `kanso.pin` its place among the pinned
// sessions (the pin on its row). By address.
export const PIN_LABEL = "kanso.pin";
// A conversation's place in the Threads view, as T3 Code keeps its threads:
// `kanso.settled` "<ms>:<turn>" (put away when its turn was that one),
// `kanso.snooze` "<ms>" (out of sight until then), `kanso.unread` "1"
// (marked unread), `kanso.thread` (a title you gave it over its own).
export const SETTLED_LABEL = "kanso.settled";
export const SNOOZE_LABEL = "kanso.snooze";
export const UNREAD_LABEL = "kanso.unread";
export const THREAD_LABEL = "kanso.thread";

// ---- Order ----------------------------------------------------------------------

// How a space's sessions are listed, as T3 Code lists its threads: the
// pinned ones first, in the order you drag them, then the rest by the order
// you chose. `seq` is Herdr's "changed more recently" counter.
export const ORDERS = {
  updated: "Last update",
  attention: "Needs you first",
  type: "By kind",
  screen: "As on screen",
  custom: "Your order (drag)",
};
export const DEFAULT_ORDER = "updated";
const KIND = (a) => (a.program?.agent || a.app ? 0 : a.program?.shell ? 1 : 2);
const kindName = (a) => (a.app || a.program?.name || "").toLowerCase();

// `list` comes in screen order (the stable tiebreak); `custom` is the
// addresses in the order you dragged them, for the custom order.
export function orderSessions(list, mode, custom = []) {
  const by = (cmp) => list.map((a, i) => [a, i]).sort((x, y) => cmp(x[0], y[0]) || x[1] - y[1]).map(([a]) => a);
  const fresh = (x, y) => (y.seq ?? 0) - (x.seq ?? 0);
  const rest = mode === "attention" ? by((x, y) => (RANK[y.status] ?? 0) - (RANK[x.status] ?? 0) || fresh(x, y))
    : mode === "type" ? by((x, y) => KIND(x) - KIND(y) || kindName(x).localeCompare(kindName(y)) || fresh(x, y))
    : mode === "screen" ? list
    : mode === "custom" ? by((x, y) => { const i = custom.indexOf(x.address), j = custom.indexOf(y.address); return (i < 0 ? 1e9 : i) - (j < 0 ? 1e9 : j) || fresh(x, y); })
    : by(fresh);
  const pinned = rest.filter((a) => a.pin != null).sort((x, y) => x.pin - y.pin);
  return [...pinned, ...rest.filter((a) => a.pin == null)];
}

// A list with `address` moved before or after `target` (both in it).
export function moved(order, address, target, side) {
  const out = order.filter((x) => x !== address);
  const at = out.indexOf(target);
  out.splice(side === "after" ? at + 1 : at, 0, address);
  return out;
}

// Renaming a terminal: the same dialog Herdr opens to rename a space or a
// tab (`kanso-prompt`, a copy of Herdr's prompt that writes the label). It
// opens with the name the terminal shows now; Enter saves, Esc leaves it,
// and an empty name brings the automatic one back.
export const PROMPT_W = 420;
export function renameTerminal(terminal, shown, thread = false) {
  openOverlay({ mod: "kanso-prompt", kind: "dialog", width: PROMPT_W, props: {
    title: thread ? "Rename thread" : "Rename terminal", value: shown ?? "",
    hint: thread ? "Empty: the title its agent gives it" : "Empty: the name the program gives it",
    label: { terminal, key: thread ? THREAD_LABEL : NAME_LABEL } } });
}

// The name you gave the terminal; else the agent's own title ("Subida de
// inventarios…"), unless it is only a path, a user@host prompt or the
// program's name: then the tab's name.
export function agentLabel(a) {
  if (a.name) return a.name;
  const live = liveTitle(a);
  if (live) return live;
  // A shell says nothing about itself: name it after its folder.
  const dir = a.program?.shell && a.cwd ? a.cwd.replace(/\/+$/, "").split("/").pop() : null;
  if (dir) return dir;
  return /^\d+$/.test(a.tab_name ?? "") ? a.program?.name || a.tab_name : a.tab_name || a.program?.name || a.address;
}

// The title the program set, when it tells something: not a path, a
// user@host prompt or the program's own name. Null otherwise.
export function liveTitle(a) {
  const live = clean(a.title), raw = (a.title ?? "").trim();
  const telling = live && !/^[~/]|^[A-Za-z]:\\/.test(raw) && !/^[~/]|^[A-Za-z]:\\/.test(live) && !live.includes("@")
    && live.toLowerCase() !== a.program?.key && live !== a.program?.name;
  return telling ? live : null;
}

// ---- Activity ---------------------------------------------------------------------

// What each agent is up to, from what Herdr already knows: the state it
// reports, how long it has been in it, its own title and what it left in its
// folder (the digest the pane header shows). Nothing is asked of the agent.

export function duration(ms) {
  const m = Math.floor(ms / 60000);
  if (m < 1) return "<1m";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
}

// Done and idle are one phase: looking at a finished agent turns done into
// idle, and looking isn't the agent doing anything, so it still finished
// when it did.
const phase = (s) => (s === "done" || s === "idle" ? "rest" : s);

// When each agent entered its state: `since` maps address -> { s, at }.
// Returns the new map, or null when nothing changed. An agent seen for the
// first time (after a start) takes its tab's times: since when it has been
// working, else when the tab last changed; else no time at all, rather than
// a made-up "<1m". Records of agents gone a month go.
export function track(since, list, now, tabOf = () => null) {
  let next = null;
  for (const a of list) {
    if (!a.status) continue;
    const s = phase(a.status), was = since[a.address];
    if (was?.s === s) continue;
    const tab = was ? null : tabOf(a.tab);
    const at = was ? now : (s === "working" ? tab?.working_since : tab?.changed_at) ?? null;
    next ??= { ...since };
    next[a.address] = { s, at };
  }
  const listed = new Set(list.map((a) => a.address));
  for (const [k, v] of Object.entries(since)) {
    if (listed.has(k) || (v?.at && now - v.at < 30 * 86400000)) continue;
    next ??= { ...since };
    delete next[k];
  }
  return next;
}

// The time beside a row: how long it has worked, waited on you, or since it
// finished. Idle (seen) and no status: none.
export function elapsed(a, since, now) {
  if (!["working", "blocked", "done"].includes(a.status)) return null;
  const at = since?.[a.address]?.at;
  return at == null ? null : duration(Math.max(0, now - at));
}

// The digest in a few words: "+12 −3 · 1 commit · PR #41".
export function digestLine(d) {
  if (!d) return null;
  const parts = [];
  if (d.files) parts.push(d.add || d.del ? `+${d.add ?? 0} −${d.del ?? 0}` : `${d.files} ${d.files === 1 ? "file" : "files"}`);
  if (d.ahead) parts.push(`${d.ahead} ${d.ahead === 1 ? "commit" : "commits"}`);
  if (d.pr?.number) parts.push(`PR #${d.pr.number}${d.pr.checks === "failing" ? " failing" : ""}`);
  return parts.length ? parts.join(" · ") : null;
}

// What the agent says it is on: the message it reports with its state
// (OSC 7501 `msg`: Claude Code sends the step it is on while it works and
// its last words when it finishes), its first line.
export function said(a) {
  const line = String(a.msg ?? "").split(/\r?\n/).find((l) => l.trim()) ?? "";
  return line.replace(/\s+/g, " ").trim() || null;
}

// The line under a row's name, or null for one line. What the agent says
// it is on, or said last. Without that, working or waiting on you: its own
// title, when the row shows a name you gave it (else the title already is
// the name); just finished: what it left in its folder.
export function activityOf(a, digest) {
  const msg = said(a);
  if (msg) return msg;
  if (a.status === "working" || a.status === "blocked") {
    // Its title only when it says more than the name: "fury" under "Fury"
    // says nothing.
    const live = a.name ? liveTitle(a) : null;
    const same = (x, y) => x.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "") === y.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
    return live && !same(live, a.name) ? live : null;
  }
  if (a.status === "done") return digestLine(digest);
  return null;
}

// How long each agent has been on the same step: `steps` maps address ->
// { msg, at }, stamped when what it says changes, or when first seen (the
// record's `status_ms` is not the step's time). Returns the new map, or
// null when nothing changed.
export function trackSteps(steps, list, now) {
  let next = null;
  const listed = new Set();
  for (const a of list) {
    if (!a.status) continue;
    listed.add(a.address);
    const msg = said(a), was = steps[a.address];
    if (was && was.msg === msg) continue;
    next ??= { ...steps };
    next[a.address] = { msg, at: now };
  }
  for (const k of Object.keys(steps)) if (!listed.has(k)) { next ??= { ...steps }; delete next[k]; }
  return next;
}

// A step that is taking long: a working agent on the same one for three
// minutes (a CI run, a deploy, a tool that doesn't answer) shows its time;
// past fifteen it is marked. { time, stuck } or null.
export const LONG_STEP = 3 * 60000, STUCK = 15 * 60000;
export function stepOf(a, steps, now) {
  if (a.status !== "working") return null;
  const s = steps?.[a.address];
  if (!s?.msg || s.at == null) return null;
  const ms = now - s.at;
  return ms >= LONG_STEP ? { time: duration(ms), stuck: ms >= STUCK } : null;
}

// What runs under an agent, from `ps -axo pid=,ppid=,etime=,command=`: its
// direct children less its own helpers (MCP servers, caffeinate), each
// { pid, ms (running for), command (as typed) }. `pid` is the agent's
// process (the terminal's foreground); without one (`fg` false) it is the
// terminal's shell, whose one child is the agent.
const HELPER = /\bmcp\b|^caffeinate\b/i;
export function tasksOf(text, pid, fg = true) {
  const rows = [];
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/);
    if (m) rows.push({ pid: +m[1], ppid: +m[2], etime: m[3], command: m[4] });
  }
  let root = pid;
  if (!fg) { const kid = rows.find((r) => r.ppid === pid); if (!kid) return []; root = kid.pid; }
  return rows.filter((r) => r.ppid === root && !HELPER.test(r.command))
    .map((r) => ({ pid: r.pid, ms: etimeMs(r.etime), command: unwrap(r.command) }));
}

// ps's elapsed time, "[[dd-]hh:]mm:ss", in ms.
export function etimeMs(s) {
  const [d, rest] = s.includes("-") ? s.split("-") : ["0", s];
  const parts = rest.split(":").map(Number);
  while (parts.length < 3) parts.unshift(0);
  return ((Number(d) * 24 + parts[0]) * 3600 + parts[1] * 60 + parts[2]) * 1000;
}

// The command as typed: Claude Code runs each one as `zsh -c source
// <snapshot> … && eval '<command>' < /dev/null …`; a plain `sh -c` loses
// its shell.
export function unwrap(command) {
  const ev = command.match(/\beval '((?:[^']|'\\'')*)'/);
  const inner = ev ? ev[1].replace(/'\\''/g, "'") : command.replace(/^(?:\/\S*\/)?(?:zsh|bash|sh)\s+-l?c\s+/, "");
  return inner.replace(/\s+/g, " ").trim();
}

// A sub-agent's state: a sub-agent without a pane isn't in agents(), so
// its raw word, error counting as blocked. Never done: it reports to its
// parent, and the parent's done is the news.
export const subStatus = (s) => (s === "error" ? "blocked" : s === "done" ? "idle" : ["working", "blocked", "idle"].includes(s) ? s : null);

// Rows with their sub-agents (`hc run` from an agent) right under them,
// depth first, each with the tree lines in front of it: [{ a, lines }].
// `rows` are listed terminals (with `parent` when one started them); `all`
// is terminals(). A sub-agent that has a pane is already a row and moves
// under its parent; one without joins from terminals(), live ones only.
export function nest(rows, all = []) {
  const listed = new Set(rows.map((a) => a.address));
  const out = [], seen = new Set();
  const sub = (k) => ({ address: k.address, pane: null, tab: null, sub: true, status: subStatus(k.status),
    program: k.program, title: k.name || k.template || k.program?.name || k.address, name: k.labels?.[NAME_LABEL] || undefined, seq: 0 });
  // Each parent's children once: its rows first, then its live terminals without a pane.
  const children = new Map();
  const under = (addr) => { let list = children.get(addr); if (!list) children.set(addr, list = []); return list; };
  for (const a of rows) if (a.parent) under(a.parent).push(a);
  for (const k of all) if (k.parent && k.state === "live" && !listed.has(k.address)) under(k.parent).push(sub(k));
  const walk = (addr, lead) => {
    const kids = (children.get(addr) ?? []).filter((k) => !seen.has(k.address));
    kids.forEach((k, i) => {
      const last = i === kids.length - 1;
      seen.add(k.address);
      out.push({ a: k, lines: [...lead, last ? "└" : "├"] });
      walk(k.address, [...lead, last ? "" : "│"]);
    });
  };
  for (const a of rows) {
    if ((a.parent && listed.has(a.parent)) || seen.has(a.address)) continue;
    seen.add(a.address);
    out.push({ a, lines: [] });
    walk(a.address, []);
  }
  return out;
}

// The Agents view: every agent in every space, by what it needs from you.
// A parent with its sub-agents goes where its most urgent one would. A
// done agent you are looking at stays in Done until you leave it (`held`),
// rather than drop away under you. In a section, the latest change first.
export const SECTIONS = [
  { id: "blocked", label: "Needs you" },
  { id: "working", label: "Working" },
  { id: "done", label: "Done" },
  { id: "idle", label: "Idle" },
  { id: "other", label: "Terminals" },
];
export function bySection(entries, since = {}, held = null, order = "latest") {
  const blocks = [];
  for (const e of entries) {
    if (!e.lines.length) blocks.push([e]);
    else blocks.at(-1)?.push(e);
  }
  const rankOf = (a) => (a.address === held && a.status === "idle" ? RANK.done : RANK[a.status] ?? 0);
  const at = (a) => since[a.address]?.at ?? 0;
  const out = SECTIONS.map((s) => ({ ...s, blocks: [] }));
  for (const b of blocks) {
    const top = Math.max(...b.map((e) => rankOf(e.a)));
    const id = top ? Object.keys(RANK).find((k) => RANK[k] === top) : "other";
    out.find((s) => s.id === id).blocks.push(b);
  }
  const cmp = order === "longest" ? (x, y) => (at(x[0].a) || Infinity) - (at(y[0].a) || Infinity)
    : order === "project" ? (x, y) => String(x[0].a.space_name ?? "").localeCompare(String(y[0].a.space_name ?? "")) || at(y[0].a) - at(x[0].a)
    : (x, y) => at(y[0].a) - at(x[0].a);
  for (const s of out) s.blocks.sort((x, y) => cmp(x, y) || (y[0].a.seq ?? 0) - (x[0].a.seq ?? 0));
  return out.filter((s) => s.blocks.length).map((s) => ({ id: s.id, label: s.label, entries: s.blocks.flat() }));
}

// ---- Threads: pin, settle, snooze, unread, as T3 Code ------------------------------

export const settledOf = (labels) => {
  const [at, turn] = String(labels?.[SETTLED_LABEL] ?? "").split(":").map(Number);
  return at ? { at, turn: turn || 0 } : null;
};
export const snoozedUntil = (labels) => Number(labels?.[SNOOZE_LABEL]) || 0;
export const isUnread = (labels) => labels?.[UNREAD_LABEL] === "1";
const busy = (a) => a.status === "working" || a.status === "blocked";
// New work since it was settled: it is working or waiting on you, or a turn ran.
export const backFromSettled = (a) => { const s = settledOf(a.labels); return Boolean(s) && (busy(a) || (a.turn ?? 0) > s.turn); };
// Its snooze ran out and you haven't looked at it since.
export const woke = (a, now) => { const u = snoozedUntil(a.labels); return u > 0 && u <= now; };

// Where a thread sits: pinned ones up top whatever their state; snoozed
// until their time (one waiting on you wakes at once); settled until new
// work comes; the rest active.
export function shelfOf(a, now) {
  if (a.pin != null) return "pinned";
  if (snoozedUntil(a.labels) > now && a.status !== "blocked") return "snoozed";
  if (settledOf(a.labels) && !backFromSettled(a)) return "settled";
  return "active";
}

export const THREAD_ORDERS = { said: "Your last message", started: "When it started" };
export const STATUS_ORDERS = { latest: "Latest change first", longest: "Longest in its state", project: "Project" };

// The Threads view's sections: [{ id, label, rows, folds }], rows being
// { a, th } (th: threads.js's reading, or null). Active goes by `order`:
// your last message (else its last record) or when it started, woken ones
// first; grouped, it is one section per project, the most recent first.
// Pinned go by their pin, Snoozed by when they wake, Settled by when they
// were settled, the latest first.
export function threadSections(rows, { order = "said", group = false, now = Date.now(), since = {} } = {}) {
  const key = (r) => (order === "started" ? r.th?.began : r.th?.said ?? r.th?.at) ?? since[r.a.address]?.at ?? 0;
  const by = (f) => (x, y) => f(y) - f(x) || (y.a.seq ?? 0) - (x.a.seq ?? 0);
  const shelf = { pinned: [], active: [], snoozed: [], settled: [] };
  for (const r of rows) shelf[shelfOf(r.a, now)].push(r);
  shelf.pinned.sort((x, y) => x.a.pin - y.a.pin);
  shelf.active.sort((x, y) => Number(woke(y.a, now)) - Number(woke(x.a, now)) || by(key)(x, y));
  shelf.snoozed.sort((x, y) => snoozedUntil(x.a.labels) - snoozedUntil(y.a.labels));
  shelf.settled.sort(by((r) => settledOf(r.a.labels)?.at ?? 0));
  const out = [];
  if (shelf.pinned.length) out.push({ id: "pinned", label: "Pinned", rows: shelf.pinned });
  if (group) {
    const groups = new Map();
    for (const r of shelf.active) { if (!groups.has(r.a.space)) groups.set(r.a.space, []); groups.get(r.a.space).push(r); }
    for (const [space, list] of groups) out.push({ id: `project-${space}`, project: space, rows: list });
  } else if (shelf.active.length) out.push({ id: "active", label: null, rows: shelf.active });
  if (shelf.snoozed.length) out.push({ id: "snoozed", label: "Snoozed", rows: shelf.snoozed, folds: true });
  if (shelf.settled.length) out.push({ id: "settled", label: "Settled", rows: shelf.settled, folds: true });
  return out;
}

// T3 Code's snooze choices, from `now`: in an hour, in three, this evening
// at 18:00 (while it is still ahead), tomorrow and next Monday at 9:00.
export function snoozePresets(now) {
  const d = new Date(now);
  const at = (days, h) => { const x = new Date(d); x.setDate(x.getDate() + days); x.setHours(h, 0, 0, 0); return x.getTime(); };
  const hhmm = (ms) => new Date(ms).toTimeString().slice(0, 5);
  const out = [
    { id: "1h", label: "In 1 hour", until: now + 3600000 },
    { id: "3h", label: "In 3 hours", until: now + 3 * 3600000 },
  ];
  if (at(0, 18) > now + 3600000) out.push({ id: "evening", label: "This evening", until: at(0, 18) });
  out.push({ id: "tomorrow", label: "Tomorrow", until: at(1, 9) });
  const toMonday = ((8 - d.getDay()) % 7) || 7;
  out.push({ id: "monday", label: "Monday", until: at(toMonday, 9) });
  return out.map((p) => ({ ...p, when: p.id.endsWith("h") ? hhmm(p.until) : `${new Date(p.until).toDateString().slice(0, 3)} ${hhmm(p.until)}` }));
}

// An agent's state in the sidebar: the mark Kanso draws everywhere
// (marks.js), 15px, the idle ring included; with no status, a blank of the
// same width so the rows line up. Needs you is the disc: a header says
// "Needs you" in words where it has room.
const ENSO = 15;
export function statusMark(t, status) {
  return stateMark(t, status, ENSO, { idle: true }) ?? div().size(ENSO).flex_none();
}

// Herdr's agents() lists only programs that report a status. Every other
// terminal (an agent that doesn't report, such as Codex or a model's own CLI,
// a shell, a server) joins the list in the same shape, with no status, so the
// sidebar shows every session in the space.
export function withTerminals(list, ps, ss) {
  const known = new Set(list.map((a) => a.pane));
  const where = {};
  for (const s of ss) (s.tabs ?? []).forEach((tb, i) => { where[tb.id] = { space: s.id, space_name: s.name, tab_index: i, tab_name: tb.name }; });
  const rest = ps.filter((p) => p.terminal && !known.has(p.pane) && where[p.tab])
    .map((p) => ({ address: p.terminal, pane: p.pane, tab: p.tab, ...where[p.tab], status: null, app: null, program: p.program, title: p.title, cwd: p.cwd, seq: 0, focused: p.focused }));
  return rest.length ? [...list, ...rest] : list;
}

// The most urgent state among agents: blocked > done > working > idle.
export const mostUrgent = (list) => list.reduce((m, a) => ((RANK[a.status] ?? 0) > (RANK[m] ?? 0) ? a.status : m), null);

// The fold toggle at the end of a space row. Folded, it tells how many agents and
// the most urgent state among them, so a blocked agent is never hidden.
export function agentFold(id, mine, open, onToggle, t) {
  const top = mostUrgent(mine);
  return h_flex().id(`agents-fold-${id}`).flex_none().h(20).px(3).gap(4).items_center().rounded(6)
    .text_size(11).text_color(t.dim).cursor_pointer()
    .hover((s) => s.bg(t.input).text_color(t.foreground))
    // The row selects on mouse up and drags on mouse down: keep both to the toggle.
    .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
    .on_mouse_up("left", (_e, cx) => { cx.stop_propagation(); onToggle(cx); })
    .when(!open, (el) => el
      .when(Boolean(top) && top !== "idle", (el) => el.child(statusMark(t, top)))
      .child(div().child(String(mine.length))))
    .child(svg(`mods/kanso-chrome/icons/chevron-${open ? "down" : "right"}.svg`).size(12).flex_none());
}

// A sub-agent's tree lines: one column per level, as wide as an icon (the
// row's 10px gap follows), so a sub-agent's icon sits under its parent's
// name; the line under the parent's icon centre, an elbow into the row.
const GUIDE_W = 15, GUIDE_X = 7;
function guide(l, h, t) {
  const col = div().relative().w(GUIDE_W).h(h).flex_none();
  if (!l) return col;
  const down = l === "└" ? h / 2 + 4 : h + 4;
  return col.child(div().absolute().left(GUIDE_X).top(-4).w(1).h(down).bg(t.input))
    .when(l !== "│", (el) => el.child(div().absolute().left(GUIDE_X).top(h / 2).w(GUIDE_W - GUIDE_X + 7).h(1).bg(t.input)));
}

// A working agent's title shimmers, as Claude Code's own "Boogieing..":
// the letters light up as a glint passes over them, and three dots count
// after it. The title is drawn in `muted`; over it, the same text in
// `foreground` shows only through a moving window, three windows of
// falling width and rising strength, so the light has soft edges. Each
// window slides one way while its copy of the text slides the other, by
// the same native `.loop`, so the lit letters stay in place. Nothing is
// laid out again: the row never moves. Each title has its own pace, so
// several at work never shine in step. It keeps shining behind other
// windows, like every mark (marks.js).
const GLINT = [[44, 0.35], [26, 0.6], [12, 1]];
const REACH = 240; // past the longest title the row can show
function shimmer(text, t, address) {
  // On battery the title holds still and only the dots count (marks.js).
  if (onBattery()) return h_flex().flex_1().min_w(0).items_center()
    .child(div().min_w(0).flex_shrink(1).truncate().text_color(t.foreground).child(text))
    .child(div().w(16).flex_none().text_color(t.muted).frames(["", ".", "..", "..."], 380));
  const pace = 2200 + ([...address].reduce((n, c) => n + c.charCodeAt(0), 0) % 7) * 160;
  const lit = ([w, strength]) => div().absolute().top(0).bottom(0).w(w).overflow_hidden().opacity(strength)
    .loop("left", { from: -w, to: REACH, period: pace, easing: "linear" })
    .child(div().absolute().top(0).whitespace_nowrap().text_color(t.foreground).child(text)
      .loop("left", { from: w, to: -REACH, period: pace, easing: "linear" }));
  return h_flex().flex_1().min_w(0).items_center()
    .child(div().relative().min_w(0).flex_shrink(1).overflow_hidden()
      .child(div().truncate().text_color(t.muted).child(text))
      .children(GLINT.map(lit)))
    .child(div().w(16).flex_none().text_color(t.muted).frames(["", ".", "..", "..."], 380));
}

// One agent or terminal: icon, name, machine (remote), pin, time, state,
// and under the name what it is on (`more.activity`), when there is
// something to say. Ink follows what matters: an agent at work or waiting
// on you is in full ink and medium weight, a resting one muted; the one
// waiting on you also sits on a wash of its color, the focused one on a
// wash of the text color. Clicking goes to its pane (a sub-agent without
// one opens in a peek); a double-click renames it.
// `row`: { kbd (the keyboard's ring is on it), drag: { target, down, up } | null (the row can be dragged to
// reorder its section), hovered, hover(h, cx), pin(cx) (toggles the pin) }.
// `row` may also carry `actions` ([{ id, icon, tip, act(cx) }], shown on
// hover in the time's place) and `menu(cx)` (a right-click).
// `more`: { lines (a sub-agent's tree lines), time, activity, steady (an
// agent's row keeps its second line even when there is nothing to say, so
// the list never jumps), faint (the line in `dim`: what a resting agent
// said last), step ({ time, stuck }: the time on a long step after the
// line, marked when stuck), tasks ([{ command, time }]: what still runs
// under an agent that isn't working, a count before its mark, the
// commands in its tooltip), badge (a word in a pill, "Woke"), strong (full
// ink: unread), project ({ name, fill }: in the Status and Threads views,
// which mix projects, the project's own avatar leads the row and its name
// in its color opens the second line), label (the Threads view's own
// name; a double-click renames the thread, over its own title, instead of
// the terminal) }.
// Each event has one handler: a second one would replace the first.
const ROW = 32, TWO = 50, ROOMY = 64;
export function agentRow(a, indent, t, row, more = {}) {
  const project = more.project ?? null;
  const pic = project ? null : programIcon(a.program, a.sub ? 13 : 15, t.foreground);
  // Asleep (or on its way): in its place, by its name, with the moon; it has
  // no pane, so a click opens its menu (Wake) instead of a pane.
  const zz = Boolean(a.asleep) || Boolean(a.dozing);
  const live = !zz && (a.status === "working" || a.status === "blocked" || more.strong);
  const ink = zz ? t.dim : a.focused || live ? t.foreground : a.sub ? t.dim : t.muted;
  const machine = a.address.includes("/") ? a.address.split("/")[0] : null;
  const pinned = a.pin != null, drag = row?.drag;
  const lines = more.lines ?? [];
  const two = Boolean(more.activity) || Boolean(project) || Boolean(more.steady);
  const tasks = a.status === "working" ? [] : more.tasks ?? [];
  // Threads read as conversations and get more room (`more.roomy`).
  const h = agentRowH(a, more);
  const showPin = Boolean(row?.pin) && (pinned || row.hovered);
  // Hovered, a row may offer its quick actions (Threads: Settle, Pin) in the time's place.
  const actions = row?.hovered ? row.actions ?? [] : [];
  const lead = project
    ? h_flex().size(20).flex_none().rounded(6).bg(project.fill + "2e").items_center().justify_center()
      .text_size(11).font_semibold().text_color(project.fill).child(project.name[0]?.toUpperCase() ?? "?")
    : pic?.opacity(zz ? 0.45 : a.focused || live ? 1 : 0.75);
  const top = h_flex().h(two ? 22 : h).gap(10).items_center()
    // One weight always: a weight that changed with the state would reflow
    // the name and make the row jump. Ink alone says what matters.
    .child(a.status === "working" && !zz
      ? shimmer(more.label ?? agentLabel(a), t, a.address).text_size(13.5).font_medium()
      : div().flex_1().min_w(0).truncate().text_size(13.5).font_medium().text_color(ink).child(more.label ?? agentLabel(a)))
    .when(Boolean(machine), (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child(machine)))
    // The pin: always shown on a pinned row, on hover on the rest (in the
    // time's place); a click pins or unpins (the row's own click stays a focus).
    .when(showPin, (el) => el.child(div().id(`pin-${a.address}`).size(20).flex_none().rounded(6)
      .flex().items_center().justify_center().text_color(pinned ? t.foreground : t.dim).tooltip(pinned ? "Unpin" : "Pin to the top")
      .hover((s) => s.bg(t.input).text_color(t.foreground))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => { cx.stop_propagation(); row.pin(cx); })
      .child(svg("mods/kanso-chrome/icons/pin.svg").size(12))))
    .when(Boolean(more.badge) && !actions.length, (el) => el.child(div().flex_none().px(6).h(18).rounded_full().bg(t.accent + "26")
      .flex().items_center().text_size(11).font_semibold().text_color(t.accent).child(more.badge)))
    .children(actions.map((x) => div().id(`act-${x.id}-${a.address}`).size(22).flex_none().rounded(6)
      .flex().items_center().justify_center().text_color(t.muted).tooltip(x.tip)
      .hover((s) => s.bg(t.input).text_color(t.foreground))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => { cx.stop_propagation(); x.act(cx); })
      .child(svg(`mods/kanso-chrome/icons/${x.icon}.svg`).size(13))))
    .when(Boolean(more.time) && !actions.length && !(row?.hovered && row?.pin && !pinned), (el) => el.child(div().flex_none().text_size(11.5).text_color(a.status === "blocked" ? t.blocked : t.dim).child(more.time)))
    // Something still runs under an agent that isn't working: how many,
    // the commands and their times on hover.
    .when(tasks.length > 0, (el) => el.child(div().id(`tasks-${a.address}`).flex_none().h(18).px(6).rounded_full().bg(t.foreground + "12")
      .flex().items_center().text_size(11).text_color(t.muted).tooltip(tasks.map((x) => `${x.command.length > 90 ? x.command.slice(0, 89) + "\u2026" : x.command} \u00b7 ${x.time}`).join("\n"))
      .child(String(tasks.length))))
    // The ⋮ button on hover: the row's right-click menu.
    .when(Boolean(row?.menu) && Boolean(row?.hovered), (el) => el.child(div().id(`dots-${a.address}`).size(20).flex_none().rounded(6)
      .flex().items_center().justify_center().text_color(t.dim).tooltip("More")
      .hover((s) => s.bg(t.input).text_color(t.foreground))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => { cx.stop_propagation(); row.menu(cx); })
      .child(svg("mods/kanso-chrome/icons/more-vertical.svg").size(13))))
    .child(zz ? h_flex().size(15).flex_none().items_center().justify_center().child(svg("mods/kanso-chrome/icons/moon.svg").size(13).text_color(t.muted))
      : statusMark(t, a.status));
  const second = h_flex().h(18).mt(more.roomy ? 5 : 2).min_w(0).items_center().text_size(12)
    .when(Boolean(project), (el) => el.child(div().flex_none().max_w(110).truncate().font_medium().text_color(project.fill).child(project.name)))
    .when(Boolean(project) && Boolean(more.activity), (el) => el.child(div().flex_none().px(5).text_color(t.dim).child("\u00b7")))
    .when(Boolean(more.activity), (el) => el.child(div().flex_1().min_w(0).truncate().text_color(more.faint ? t.dim : t.muted).child(more.activity)))
    // On the same step for a while: its time after the line, marked when stuck.
    .when(Boolean(more.step), (el) => el.child(div().flex_none().pl(5).text_color(more.step.stuck ? t.blocked : t.dim).child(more.step.time)));
  const body = two ? v_flex().flex_1().min_w(0).justify_center().child(top).child(second) : div().flex_1().min_w(0).child(top);
  return h_flex().id(`space-agent-${a.address}`).h(h).flex_none().pl(AGENT_PAD + indent).pr(12).gap(12)
    .items_center().rounded(8).cursor_pointer()
    // The focused row's wash is the list's pill (main.js), which glides here.
    .when(a.status === "blocked" && !a.focused, (el) => el.bg(t.blocked + "14"))
    // The keyboard's ring, when the list is driven by keys (main.js navRow).
    .when(Boolean(row?.kbd), (el) => el.border_1().border_color(t.accent))
    .hover((s) => s.bg(t.foreground + "0c"))
    .on_click((_e, cx) => (a.asleep ? row?.menu?.(cx) : a.pane ? run("pane.focus", { pane: a.pane }) : run("terminal.peek", { terminal: a.address })))
    .on_mouse_down("left", (e) => { if (e.click_count === 2 && !a.asleep) renameTerminal(a.address, more.label ?? agentLabel(a)); else drag?.down(); })
    .when(Boolean(drag), (el) => el.on_mouse_up("left", (_e, cx) => drag.up(cx)))
    .when(Boolean(row?.hover), (el) => el.on_hover((h, cx) => row.hover(h, cx)))
    .when(Boolean(row?.menu), (el) => el.on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); row.menu(cx); }))
    // Dropping: a line on the side the row will land on.
    .when(drag?.target === "before", (el) => el.border_t(2).border_color(t.accent))
    .when(drag?.target === "after", (el) => el.border_b(2).border_color(t.accent))
    .children(lines.map((l) => guide(l, h, t)))
    .when(Boolean(lead), (el) => el.child(two ? v_flex().h(h).pt(Math.round((h - 45) / 2) + (project ? 1 : 3)).flex_none().child(lead) : lead))
    .child(body);
}

import { paths } from "./platform-paths.js";
// Added by José Gutiérrez (minimalistic): agents nested under their space. Pure drawing helpers; the
// fold state lives in main.js.
import { div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { run, openOverlay } from "herdr";
import { stateMark, programIcon, NAME_LABEL, onBattery } from "./marks.js";
import { parseProcesses, etimeMs } from "./procs.js";
import { oneLine } from "./since-left-model.js";
import { activityTone, foldTail, timePlace } from "./sidebar-rows.js";

export { NAME_LABEL };

export const AGENT_PAD = 34; // under the space name: 8px row padding, a 22px avatar, the gap

// Native GPUI motion, no per-frame script; fold and pill share the pace so they move together.
export const FOLD = { duration: 220, easing: "ease-out" };
export const FOLD_MS = FOLD.duration + 40; // rows stay drawn this long after a fold, so the close is seen

// Drawn before the rows so they sit on top; `inset` is the list's side padding.
export function pill(id, y, h, color, inset = 8) {
  return div().id(id).absolute().left(inset).right(inset).top(y).h(h).rounded(8).bg(color)
    .transition("top", FOLD).transition("height", FOLD);
}

// Must equal the height agentRow draws: lists sum these to place the pill.
// `more.oneLine`: a narrow sidebar keeps the first line only. A second line only when there is something to say.
const twoLines = (more) => !more.oneLine && Boolean(more.activity);
export function agentRowH(a, more = {}) {
  const two = twoLines(more);
  return two ? TWO : a.sub ? ROW - 4 : ROW;
}

// A row flush with the list's 10px inset (the Status and Threads views).
export const FLUSH = 10 - AGENT_PAD;
// A row nested under its project's name: the Threads view's conversations, indented as a Projects view's agents are.
export const NESTED = FLUSH + 28;
// Asleep is one more status: its own section, after the awake ones.
const RANK = { blocked: 4, done: 3, working: 2, idle: 1, asleep: 0.5 };

const clean = (s) => (s ?? "").replace(/^[^\p{L}\p{N}]+/u, "").trim();

// Kanso's per-terminal data lives as herdr-core labels: survives restarts, shared by every mod.
export const PIN_LABEL = "kanso.pin";
// Values: settled "<ms>:<turn>", snooze "<ms>", unread "1", thread a title.
export const SETTLED_LABEL = "kanso.settled";
export const SNOOZE_LABEL = "kanso.snooze";
export const UNREAD_LABEL = "kanso.unread";
export const THREAD_LABEL = "kanso.thread";

// `seq` is Herdr's "changed more recently" counter.
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

// `list` arrives in screen order; its index is the stable tiebreak.
export function orderSessions(list, mode, custom = []) {
  const by = (cmp) => list.map((a, i) => [a, i]).toSorted((x, y) => cmp(x[0], y[0]) || x[1] - y[1]).map(([a]) => a);
  const fresh = (x, y) => (y.seq ?? 0) - (x.seq ?? 0);
  const rest = mode === "attention" ? by((x, y) => (RANK[y.status] ?? 0) - (RANK[x.status] ?? 0) || fresh(x, y))
    : mode === "type" ? by((x, y) => KIND(x) - KIND(y) || kindName(x).localeCompare(kindName(y)) || fresh(x, y))
    : mode === "screen" ? list
    : mode === "custom" ? by((x, y) => { const i = custom.indexOf(x.address), j = custom.indexOf(y.address); return (i < 0 ? 1e9 : i) - (j < 0 ? 1e9 : j) || fresh(x, y); })
    : by(fresh);
  const pinned = rest.filter((a) => a.pin != null).toSorted((x, y) => x.pin - y.pin);
  return [...pinned, ...rest.filter((a) => a.pin == null)];
}

export function moved(order, address, target, side) {
  const out = order.filter((x) => x !== address);
  const at = out.indexOf(target);
  return out.toSpliced(side === "after" ? at + 1 : at, 0, address);
}

export const PROMPT_W = 420;
export function renameTerminal(terminal, shown, thread = false) {
  openOverlay({ mod: "kanso-prompt", kind: "dialog", width: PROMPT_W, props: {
    title: thread ? "Rename thread" : "Rename terminal", value: shown ?? "",
    hint: thread ? "Empty: the title its agent gives it" : "Empty: the name the program gives it",
    label: { terminal, key: thread ? THREAD_LABEL : NAME_LABEL } } });
}

export function agentLabel(a) {
  if (a.name) return a.name;
  const live = liveTitle(a);
  if (live) return live;
  // A shell says nothing about itself: name it after its folder.
  const dir = a.program?.shell && a.cwd ? paths.basename(a.cwd) : null;
  if (dir) return dir;
  return /^\d+$/.test(a.tab_name ?? "") ? a.program?.name || a.tab_name : a.tab_name || a.program?.name || a.address;
}

// A title that is just a path, a user@host prompt or the program's name tells nothing.
export function liveTitle(a) {
  const live = clean(a.title), raw = (a.title ?? "").trim();
  const telling = live && !/^[~/]|^[A-Za-z]:\\/.test(raw) && !/^[~/]|^[A-Za-z]:\\/.test(live) && !live.includes("@")
    && live.toLowerCase() !== a.program?.key && live !== a.program?.name;
  return telling ? live : null;
}

export function duration(ms) {
  const m = Math.floor(ms / 60000);
  if (m < 1) return "<1m";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
}

// Done and idle are one phase: viewing turns done into idle, but it still finished when it did.
const phase = (s) => (s === "done" || s === "idle" ? "rest" : s);

// An agent seen for the first time takes its tab's times, not now, rather than show a made-up "<1m".
export function track(since, list, now, tabOf = () => null) {
  const changed = list.flatMap((a) => {
    if (!a.status) return [];
    const s = phase(a.status), was = since[a.address];
    if (was?.s === s) return [];
    const tab = was ? null : tabOf(a.tab);
    const at = was ? now : (s === "working" ? tab?.working_since : tab?.changed_at) ?? null;
    return [[a.address, { s, at }]];
  });
  const listed = new Set(list.map((a) => a.address));
  const gone = new Set(Object.entries(since).filter(([k, v]) => !(listed.has(k) || (v?.at && now - v.at < 30 * 86400000))).map(([k]) => k));
  if (!changed.length && !gone.size) return null;
  const next = { ...since, ...Object.fromEntries(changed) };
  return gone.size ? Object.fromEntries(Object.entries(next).filter(([k]) => !gone.has(k))) : next;
}

export function elapsed(a, since, now) {
  if (!["working", "blocked", "done"].includes(a.status)) return null;
  const at = since?.[a.address]?.at;
  return at == null ? null : duration(Math.max(0, now - at));
}

// `msg` is OSC 7501: Claude Code sends the step it is on while it works, its last words when it finishes.
export const said = (a) => oneLine(a.msg);

export function activityOf(a) {
  const msg = said(a);
  if (msg) return msg;
  if (a.status === "working" || a.status === "blocked") {
    // The title only when it says more than the name: "fury" under "Fury" says nothing.
    const live = a.name ? liveTitle(a) : null;
    const same = (x, y) => x.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "") === y.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
    return live && !same(live, a.name) ? live : null;
  }
  return null;
}

// The record's `status_ms` is not the step's time, so steps are stamped here when `msg` changes.
export function trackSteps(steps, list, now) {
  const live = list.filter((a) => a.status);
  const listed = new Set(live.map((a) => a.address));
  const changed = live.flatMap((a) => {
    const msg = said(a), was = steps[a.address];
    return was && was.msg === msg ? [] : [[a.address, { msg, at: now }]];
  });
  const gone = Object.keys(steps).some((k) => !listed.has(k));
  if (!changed.length && !gone) return null;
  const next = { ...steps, ...Object.fromEntries(changed) };
  return gone ? Object.fromEntries(Object.entries(next).filter(([k]) => listed.has(k))) : next;
}

export const LONG_STEP = 3 * 60000, STUCK = 15 * 60000;
export function stepOf(a, steps, now) {
  if (a.status !== "working") return null;
  const s = steps?.[a.address];
  if (!s?.msg || s.at == null) return null;
  const ms = now - s.at;
  return ms >= LONG_STEP ? { time: duration(ms), stuck: ms >= STUCK } : null;
}

// With `fg` false, `pid` is the terminal's shell and the agent is its one child.
// `table`: procs.js parseProcesses' index, read once for every terminal (the text itself is read on the spot).
const HELPER = /\bmcp\b|^caffeinate\b/i;
export function tasksOf(table, pid, fg = true) {
  const { byParent } = typeof table === "string" ? parseProcesses(table) : table;
  const kid = fg ? null : byParent.get(pid)?.[0];
  if (!fg && !kid) return [];
  return (byParent.get(fg ? pid : kid.pid) ?? []).filter((r) => !HELPER.test(r.command))
    .map((r) => ({ pid: r.pid, ms: etimeMs(r.etime), command: unwrap(r.command) }));
}

// Claude Code runs each command as `zsh -c … eval '<command>' …`; this recovers what was typed.
export function unwrap(command) {
  const ev = command.match(/\beval '((?:[^']|'\\'')*)'/);
  const inner = ev ? ev[1].replace(/'\\''/g, "'") : command.replace(/^(?:\/\S*\/)?(?:zsh|bash|sh)\s+-l?c\s+/, "");
  return inner.replace(/\s+/g, " ").trim();
}

// Never done: a sub-agent reports to its parent, and the parent's done is the news.
export const subStatus = (s) => (s === "error" ? "blocked" : s === "done" ? "idle" : ["working", "blocked", "idle"].includes(s) ? s : null);

export function nest(rows, all = []) {
  const listed = new Set(rows.map((a) => a.address));
  const sub = (k) => ({ address: k.address, pane: null, tab: null, sub: true, status: subStatus(k.status),
    program: k.program, title: k.name || k.template || k.program?.name || k.address, name: k.labels?.[NAME_LABEL] || undefined, seq: 0 });
  const pairs = [
    ...rows.filter((a) => a.parent).map((a) => [a.parent, a]),
    ...all.filter((k) => k.parent && k.state === "live" && !listed.has(k.address)).map((k) => [k.parent, sub(k)]),
  ];
  const children = new Map([...Map.groupBy(pairs, ([p]) => p)].map(([p, list]) => [p, list.map(([, k]) => k)]));
  // `path` cuts parent loops; should an address still show twice, only its first place stays.
  const tree = (a, lines, lead, path) => {
    const kids = (children.get(a.address) ?? []).filter((k) => !path.has(k.address));
    const below = new Set([...path, a.address]);
    return [{ a, lines }, ...kids.flatMap((k, i) => {
      const last = i === kids.length - 1;
      return tree(k, [...lead, last ? "└" : "├"], [...lead, last ? "" : "│"], below);
    })];
  };
  const placed = rows.filter((a) => !(a.parent && listed.has(a.parent))).flatMap((a) => tree(a, [], [], new Set()));
  const first = new Map(placed.map((x, i) => [x.a.address, i]).toReversed());
  return placed.filter((x, i) => first.get(x.a.address) === i);
}

// `held`: a done agent you are looking at stays in Done until you leave it, rather than drop away under you.
export const SECTIONS = [
  { id: "blocked", label: "Needs you" },
  { id: "working", label: "Working" },
  { id: "done", label: "Done" },
  { id: "idle", label: "Idle" },
  { id: "asleep", label: "Asleep" },
  { id: "other", label: "Terminals" },
];
export function bySection(entries, since = {}, held = null, order = "latest") {
  // A row and the sub-agents under it are one block; lines before the first row belong to none.
  const starts = entries.flatMap((e, i) => (e.lines.length ? [] : [i]));
  const blocks = starts.map((i, k) => entries.slice(i, starts[k + 1] ?? entries.length));
  const rankOf = (a) => (a.address === held && a.status === "idle" ? RANK.done : RANK[a.status] ?? 0);
  const at = (a) => since[a.address]?.at ?? 0;
  const sectionOf = (b) => {
    const top = Math.max(...b.map((e) => rankOf(e.a)));
    return top ? Object.keys(RANK).find((k) => RANK[k] === top) : "other";
  };
  const ids = blocks.map(sectionOf);
  const cmp = order === "longest" ? (x, y) => (at(x[0].a) || Infinity) - (at(y[0].a) || Infinity)
    : order === "project" ? (x, y) => String(x[0].a.space_name ?? "").localeCompare(String(y[0].a.space_name ?? "")) || at(y[0].a) - at(x[0].a)
    : (x, y) => at(y[0].a) - at(x[0].a);
  return SECTIONS.map((s) => ({ ...s, blocks: blocks.filter((_, i) => ids[i] === s.id).toSorted((x, y) => cmp(x, y) || (y[0].a.seq ?? 0) - (x[0].a.seq ?? 0)) }))
    .filter((s) => s.blocks.length).map((s) => ({ id: s.id, label: s.label, entries: s.blocks.flat() }));
}

export const settledOf = (labels) => {
  const [at, turn] = String(labels?.[SETTLED_LABEL] ?? "").split(":").map(Number);
  return at ? { at, turn: turn || 0 } : null;
};
export const snoozedUntil = (labels) => Number(labels?.[SNOOZE_LABEL]) || 0;
export const isUnread = (labels) => labels?.[UNREAD_LABEL] === "1";
const busy = (a) => a.status === "working" || a.status === "blocked";
export const backFromSettled = (a) => { const s = settledOf(a.labels); return Boolean(s) && (busy(a) || (a.turn ?? 0) > s.turn); };
export const woke = (a, now) => { const u = snoozedUntil(a.labels); return u > 0 && u <= now; };

export function shelfOf(a, now) {
  if (a.pin != null) return "pinned";
  if (snoozedUntil(a.labels) > now && a.status !== "blocked") return "snoozed";
  if (settledOf(a.labels) && !backFromSettled(a)) return "settled";
  return "active";
}

export const THREAD_ORDERS = { said: "Your last message", started: "When it started" };
export const STATUS_ORDERS = { latest: "Latest change first", longest: "Longest in its state", project: "Project" };

export function threadSections(rows, { order = "said", group = false, now = Date.now(), since = {} } = {}) {
  const key = (r) => (order === "started" ? r.th?.began : r.th?.said ?? r.th?.at) ?? since[r.a.address]?.at ?? 0;
  const by = (f) => (x, y) => f(y) - f(x) || (y.a.seq ?? 0) - (x.a.seq ?? 0);
  const shelves = rows.map((r) => shelfOf(r.a, now));
  const on = (name) => rows.filter((_, i) => shelves[i] === name);
  const pinned = on("pinned").toSorted((x, y) => x.a.pin - y.a.pin);
  const active = on("active").toSorted((x, y) => Number(woke(y.a, now)) - Number(woke(x.a, now)) || by(key)(x, y));
  const snoozed = on("snoozed").toSorted((x, y) => snoozedUntil(x.a.labels) - snoozedUntil(y.a.labels));
  const settled = on("settled").toSorted(by((r) => settledOf(r.a.labels)?.at ?? 0));
  const projects = () => [...new Set(active.map((r) => r.a.space))].map((space) => ({ id: `project-${space}`, project: space, rows: active.filter((r) => r.a.space === space) }));
  return [
    ...(pinned.length ? [{ id: "pinned", label: "Pinned", rows: pinned }] : []),
    ...(group ? projects() : active.length ? [{ id: "active", label: null, rows: active }] : []),
    ...(snoozed.length ? [{ id: "snoozed", label: "Snoozed", rows: snoozed, folds: true }] : []),
    ...(settled.length ? [{ id: "settled", label: "Settled", rows: settled, folds: true }] : []),
  ];
}

export function snoozePresets(now) {
  const d = new Date(now);
  const at = (days, h) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + days, h, 0, 0, 0).getTime();
  const hhmm = (ms) => new Date(ms).toTimeString().slice(0, 5);
  const toMonday = ((8 - d.getDay()) % 7) || 7;
  const out = [
    { id: "1h", label: "In 1 hour", until: now + 3600000 },
    { id: "3h", label: "In 3 hours", until: now + 3 * 3600000 },
    ...(at(0, 18) > now + 3600000 ? [{ id: "evening", label: "This evening", until: at(0, 18) }] : []),
    { id: "tomorrow", label: "Tomorrow", until: at(1, 9) },
    { id: "monday", label: "Monday", until: at(toMonday, 9) },
  ];
  return out.map((p) => ({ ...p, when: p.id.endsWith("h") ? hhmm(p.until) : `${new Date(p.until).toDateString().slice(0, 3)} ${hhmm(p.until)}` }));
}

// With no status, a blank of the same width so the rows line up.
const ENSO = 15;
export function statusMark(t, status) {
  return stateMark(t, status, ENSO, { idle: true }) ?? div().size(ENSO).flex_none();
}

// Herdr's agents() lists only programs that report a status; this adds every other terminal.
export function withTerminals(list, ps, ss) {
  const known = new Set(list.map((a) => a.pane));
  const where = Object.fromEntries(ss.flatMap((s) => (s.tabs ?? []).map((tb, i) => [tb.id, { space: s.id, space_name: s.name, tab_index: i, tab_name: tb.name }])));
  const rest = ps.filter((p) => p.terminal && !known.has(p.pane) && where[p.tab])
    .map((p) => ({ address: p.terminal, pane: p.pane, tab: p.tab, ...where[p.tab], status: null, app: null, program: p.program, title: p.title, cwd: p.cwd, seq: 0, focused: p.focused }));
  return rest.length ? [...list, ...rest] : list;
}

export const mostUrgent = (list) => list.reduce((m, a) => ((RANK[a.status] ?? 0) > (RANK[m] ?? 0) ? a.status : m), null);

// Open, nothing: the row itself folds. Folded, the most urgent mark and how many; a click unfolds.
export function agentFold(id, mine, open, onToggle, t) {
  const tail = foldTail(open, mine.map((a) => a.status));
  if (!tail) return null;
  return h_flex().id(`agents-fold-${id}`).flex_none().h(20).px(3).gap(4).items_center().rounded(6)
    .text_size(11.5).text_color(t.dim).cursor_pointer()
    .hover((s) => s.bg(t.input).text_color(t.foreground))
    // The row selects on mouse up and drags on mouse down: keep both to the toggle.
    .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
    .on_mouse_up("left", (_e, cx) => { cx.stop_propagation(); onToggle(cx); })
    .when(Boolean(tail.mark), (el) => el.child(stateMark(t, tail.mark, 12)))
    .child(div().child(String(tail.count)));
}

// One column per level, icon-wide, so a sub-agent's icon sits under its parent's name.
const GUIDE_W = 15, GUIDE_X = 7;
function guide(l, h, t) {
  const col = div().relative().w(GUIDE_W).h(h).flex_none();
  if (!l) return col;
  const down = l === "└" ? h / 2 + 4 : h + 4;
  return col.child(div().absolute().left(GUIDE_X).top(-4).w(1).h(down).bg(t.input))
    .when(l !== "│", (el) => el.child(div().absolute().left(GUIDE_X).top(h / 2).w(GUIDE_W - GUIDE_X + 7).h(1).bg(t.input)));
}

// Each glint window slides one way while its copy of the text slides the other, so the lit letters stay in place.
const GLINT = [[44, 0.35], [26, 0.6], [12, 1]];
const REACH = 240; // past the longest title the row can show
function shimmer(text, t, address) {
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

// `more.steady` keeps the second line even with nothing to say, so the list never jumps.
// Each event has one handler: a second one would replace the first.
const ROW = 32, TWO = 50, G_HAIR = 2;
export function agentRow(a, indent, t, row, more = {}) {
  const pic = programIcon(a.program, a.sub ? 13 : 15, t.foreground);
  const zz = Boolean(a.dozing);
  const live = !zz && (a.status === "working" || a.status === "blocked" || more.strong);
  const ink = more.quiet ? t.muted : zz ? t.dim : a.focused || live ? t.foreground : a.sub ? t.dim : t.muted;
  const machine = a.address.includes("/") ? a.address.split("/")[0] : null;
  const pinned = a.pin != null, drag = row?.drag;
  const lines = more.lines ?? [];
  const two = twoLines(more);
  const tasks = a.status === "working" ? [] : more.tasks ?? [];
  const h = agentRowH(a, more);
  const hovered = Boolean(row?.hovered);
  const actions = hovered ? row.actions ?? [] : [];
  // Under the pointer, pin and the menu take the time's place; a pin already set stays before the mark.
  const tools = hovered && (Boolean(row?.menu) || Boolean(row?.pin) || actions.length > 0);
  const place = timePlace(two ? more.activity : null, more.time);
  const word = more.directory ?? null;
  // The program's icon leads; a terminal or an unknown program takes the terminal's.
  const lead = (pic ?? svg("mods/kanso-chrome/icons/terminal.svg").size(a.sub ? 13 : 15).flex_none().text_color(t.muted))
    .opacity(zz ? 0.45 : a.focused || live ? 1 : 0.75);
  const iconTool = (id, icon, tip, act, size = 12) => div().id(id).size(20).flex_none().rounded(6)
    .flex().items_center().justify_center().text_color(t.muted).tooltip(tip)
    .hover((s) => s.bg(t.input).text_color(t.foreground))
    .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
    .on_click((_e, cx) => { cx.stop_propagation(); act(cx); })
    .child(svg(`mods/kanso-chrome/icons/${icon}.svg`).size(size));
  const top = h_flex().h(two ? 22 : h).gap(8).items_center()
    // One weight always: a changed weight would reflow the name and make the row jump.
    .child(a.status === "working" && !zz
      ? shimmer(more.label ?? agentLabel(a), t, a.address).text_size(13.5).font_medium()
      : div().flex_1().min_w(0).truncate().text_size(13.5).font_medium().text_color(ink).child(more.label ?? agentLabel(a)))
    .when(Boolean(machine) && !word && !more.noMachine, (el) => el.child(div().flex_none().text_size(11.5).text_color(t.dim).child(machine)))
    .when(Boolean(word), (el) => el.child(div().flex_none().truncate().text_size(11.5).text_color(t.dim)
      .when(Boolean(more.wordTip), (d) => d.tooltip(more.wordTip)).child(word)))
    .when(Boolean(more.refresh), (el) => el.child(iconTool(`refresh-${a.address}`, "refresh", "Refresh", more.refresh)))
    .when(pinned && !hovered, (el) => el.child(svg("mods/kanso-chrome/icons/pin.svg").size(12).flex_none().text_color(t.dim)))
    .when(hovered && Boolean(row?.pin), (el) => el.child(iconTool(`pin-${a.address}`, "pin", pinned ? "Unpin" : "Pin to the top", (cx) => row.pin(cx))))
    .children(actions.map((x) => iconTool(`act-${x.id}-${a.address}`, x.icon, x.tip, x.act)))
    .when(place === "end" && !tools, (el) => el.child(div().flex_none().text_size(11.5).text_color(a.status === "blocked" ? t.blocked : t.dim).child(more.time)))
    .when(tasks.length > 0, (el) => el.child(div().id(`tasks-${a.address}`).flex_none().h(18).px(6).rounded_full().bg(t.foreground + "12")
      .flex().items_center().text_size(11).text_color(t.muted).tooltip(tasks.map((x) => `${x.command.length > 90 ? x.command.slice(0, 89) + "\u2026" : x.command} \u00b7 ${x.time}`).join("\n"))
      .child(String(tasks.length))))
    .when(hovered && Boolean(row?.menu), (el) => el.child(iconTool(`dots-${a.address}`, "ellipsis", "More", (cx) => row.menu(cx), 14)))
    .child(statusMark(t, zz ? "asleep" : a.status));
  const second = h_flex().h(20).mt(G_HAIR).min_w(0).items_center().text_size(11.5)
    .when(Boolean(more.activity), (el) => el.child(div().flex_shrink(1).min_w(0).truncate().text_color(t[activityTone(a.status)]).child(more.activity)))
    .when(place === "line" && !tools, (el) => el.child(div().flex_none().pl(4).text_color(t.dim).child(`\u00b7 ${more.time}`)))
    .when(Boolean(more.step), (el) => el.child(div().flex_none().pl(5).text_color(more.step.stuck ? t.blocked : t.dim).child(more.step.time)));
  const body = two ? v_flex().flex_1().min_w(0).justify_center().child(top).child(second) : div().flex_1().min_w(0).child(top);
  return h_flex().id(`space-agent-${a.address}`).h(h).flex_none().pl(AGENT_PAD + indent).pr(12).gap(12)
    .items_center().rounded(8).cursor_pointer()
    // The focused row's wash is the list's pill (main.js), which glides here.
    .when(a.status === "blocked" && !a.focused, (el) => el.bg(t.blocked + "14"))
    .when(Boolean(row?.kbd), (el) => el.border_1().border_color(t.accent))
    .hover((s) => s.bg(t.foreground + "0c"))
    .on_click((_e, cx) => { if (a.pane) run("pane.focus", { pane: a.pane }); else run("terminal.peek", { terminal: a.address }); })
    .on_mouse_down("left", (e) => { if (e.click_count === 2) renameTerminal(a.address, more.label ?? agentLabel(a)); else drag?.down(); })
    .when(Boolean(drag), (el) => el.on_mouse_up("left", (_e, cx) => drag.up(cx)))
    .when(Boolean(row?.hover), (el) => el.on_hover((h, cx) => row.hover(h, cx)))
    .when(Boolean(row?.menu), (el) => el.on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); row.menu(cx); }))
    .when(drag?.target === "before", (el) => el.border_t(2).border_color(t.accent))
    .when(drag?.target === "after", (el) => el.border_b(2).border_color(t.accent))
    .children(lines.map((l) => guide(l, h, t)))
    .child(two ? v_flex().h(h).pt(Math.round((h - 45) / 2) + 3).flex_none().child(lead) : lead)
    .child(body);
}

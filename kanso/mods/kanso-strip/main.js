// Kanso strip, by jlopezlira (https://github.com/jlopezlira/herdr-kanso). Apache-2.0.
// Herdr can't clip a terminal, so the view shows only whole, live panes and slides a column at a time.
// Herdr rules that shape the tree: a layout nests at most 16 levels (columns sit directly in work-body), and Herdr folds empty and single-child containers.
// State per tab in shared "strip.state": { cols: [{ panes, w, pin, hs }], vx, n }; w is a column's share of the view, vx its left edge in view widths, always a column's start.
// The mod's copies (header, edge, ruler, drop card) talk to the controller through shared "strip.req", "strip.intent", "strip.drag" and "strip.drop".

import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex, HoverCard, Popover } from "gpui-base";
import { spaces, panes, agents, machines, focused, layout, run, hc, shared, setShared, theme, nextCommand, props, openOverlay, home, exec, notify, window } from "herdr";
import { programIcon, givenNames, nameOf, NAME_LABEL } from "./marks.js";
import { STRIP_INTENT, isKansoTree, walkLayout, paintLayout, changeLayout, commitLayout } from "./layout.js";
import { tryOr, readCommands, pad2 } from "./pure.js";
import { shortFolder } from "./folder.js";
import { openArrange } from "./open.js";
import { openWithPopup } from "./popup.js";
import { openSend, openSleep } from "./launch.js";
import { FIND } from "./find-key.js";
import { rollupState, headerHold, prFacts, prLine } from "./ghchecks.js";
import { pieces, shown, runs, setPiece, STORE } from "./pieces.js";
import { G, R, T, W, FOCUS, ICON, ICON_CHROME, OPACITY, TINT, CLEAR, DRAG_START, CHROME_SQUARE, PANE, alpha, glyphOf, mix, tokens, washes } from "./ui.js";
import { mark } from "./ui-mark.js";
import { iconButton, Armed } from "./ui-button.js";
import { menu } from "./ui-menu.js";
import { field, TextField } from "./ui-field.js";
import { pendingDot, PENDING } from "./ui-state.js";
import { button, failureLine, stepper } from "./kit.js";
import { layoutPaused, statusBar } from "./status-bar.js";
import { COLUMN } from "./ui-status.js";
import { boundChord } from "./ui-tooltip.js";
import { headerSegment } from "./ui-header.js";
import { pieceLines } from "./piece-lines.js";
import { paged } from "./strip-model.js";
import { localService } from "./platform-host.js";
import { openApi } from "./platform-open.js";
import { NAME_LIMIT, ENTRIES, DIGEST_PIECES, PIECE_GROUP, shownAt, foldFor, headerWidths, headerTools, hoverTools, menuEntries, placeOf, paneLabel, headerMark, prTitle } from "./header-model.js";

const N_MAX = 8;
const openUrl = (url) => localService(openApi).open(url).catch(() => { });
const DEFAULT_N = 4;
const MIN_W = 0.08; // narrowest a column can be dragged, as a share of the view
const W_STEPS = [1 / 4, 1 / 3, 1 / 2, 2 / 3, 1];
// The minimap's slot is 180px and its stepper takes about 60: the pills shrink to the rest, and past a mark's least width they are cut in their own box, so the stepper always shows.
export function pillWidths(cols, budget = PANE.pills) {
  const raw = cols.map((c) => 6 + (Number(c.w) || 0) * 18);
  const room = budget - cols.length * 2 * COLUMN.side - Math.max(0, cols.length - 1) * COLUMN.gap;
  const total = raw.reduce((a, b) => a + b, 0);
  const scale = total > room ? Math.max(0, room) / total : 1;
  return raw.map((w) => Math.max(3, scale < 1 ? Math.floor(w * scale) : Math.round(w)));
}
const EPS = 1e-3;
const KEY = "strip.state";
const WHEEL_PX = 600; // trackpad/wheel pixels that slide the view one full width
const WHEEL_STEP = 0.25; // of a view width of wheel travel moves one column
const MIN_VIEW = 0.2; // pinned columns always leave this much of the view to slide
// Layout writes are throttled: a burst writes its first step at once, then its latest state every WRITE_MS.
const WRITE_MS = 100;
const SETTLE = 250; // ms without the dragged sizes changing before the strip adopts them

const TAB_BLOCK = {
  id: "main", type: "block", background: "chrome",
  content: { tab: "active", pane: {
    header: { content: { mod: "kanso-strip" }, reveal: "always", height: CHROME_SQUARE, position: "top" },
    background: "background", border: { width: 0, color: "border" }, focus: { width: 0, color: "border" },
    radius: R.card, gap: PANE.gap, lone: false } },
};

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const step = (list, v) => list[(list.findIndex((s) => Math.abs(s - v) < EPS) + 1) % list.length];
const nonce = () => Date.now() + Math.random();

// Wheel or swipe travel in px along the strip: a sideways swipe wins over a vertical one, a mouse notch is 40px.
// Wheel events arrive faster than the controller renders and each carries only its own delta, so postScroll sums the ones not yet applied.
function wheelDelta(e) {
  const lines = e.delta_lines?.y ?? 0;
  return lines ? -lines * 40 : (Math.abs(e.delta.x) > Math.abs(e.delta.y) ? -e.delta.x : -e.delta.y);
}

function postScroll(d) {
  const prev = shared("strip.req");
  const open = prev && prev.op === "scroll" && prev.n !== shared("strip.ack");
  setShared("strip.req", { op: "scroll", d: (open ? prev.d : 0) + d, n: nonce() });
}

function showsTerminal(node, id) {
  if (!node || !id) return false;
  if (node.content?.terminal === id) return true;
  for (const child of node.children ?? []) if (showsTerminal(child, id)) return true;
  return false;
}

const nodeId = (c) => (c.panes.length === 1 ? `strip-${c.panes[0]}` : `strip-col-${c.panes[0]}`);

// Ruler measurements in logical px, in shared "strip.px": each pane's width by id.
// Each copy of this mod runs on its own, so they meet in shared state.
const PX = "strip.px";
const DRAG_MAX = 12000; // ms a held pane stays held with nobody dropping it (let go over a gutter)

const iconOf = (prog, size, color) => programIcon(prog, size, color) ?? div().size(size);
// A pane beyond the edge shows its agent's mark only while it has something to say.
const EDGE_MARKS = ["working", "blocked", "done"];
const EDGE_CARD_MS = { open: 350, close: 250 };
const zoneOf = (e, fallback = "below") => {
  const w = e.bounds?.width, h = e.bounds?.height, at = e.local_position;
  if (!w || !h || !at) return fallback;
  return at.x < w / 4 ? "before" : at.x > w * 3 / 4 ? "after" : at.y < h / 2 ? "above" : "below";
};
const endDrag = () => { setShared("strip.drop", null); setShared("strip.drag", null); };

// Let go on a landing place: the held pane moves there. The ruler's foot ends the drag even with nothing held, as it always has.
const dropMove = (to, side, end = true) => {
  const d = shared("strip.drag");
  if (!d) {
    if (end) endDrag();
    return;
  }
  if (d.pane !== to) setShared("strip.req", { op: "move", pane: d.pane, to, side, n: nonce() });
  endDrag();
};

// When an agent stops working: what is in its folder, read from git and gh (never from the conversation).
// Shared by pane, so every header copy agrees.
const DIGEST = "kanso.digest";

export function parseShortstat(text) {
  const n = (re) => Number(re.exec(text ?? "")?.[1] ?? 0);
  return { add: n(/(\d+) insertions?\(\+\)/), del: n(/(\d+) deletions?\(-\)/) };
}

// gh's statusCheckRollup, read as the pull request panel reads it (ghchecks.js), in the header's words.
const CHECKS = { fail: "failing", pending: "running", unknown: "unknown", pass: "passing" };
export const checksOf = (rollup) => CHECKS[rollupState(rollup)] ?? null;
const PR_FIELDS = "number,state,isDraft,mergeable,mergeStateStatus,reviewDecision,baseRefName,statusCheckRollup";

// Open pull request for the header. `hold` is why it cannot merge. Permission is not a header fact.
export function digestPr(view) {
  if (!view?.number || view.state !== "OPEN") return null;
  const facts = prFacts(view);
  return facts ? { ...facts, checks: checksOf(view.statusCheckRollup), hold: headerHold(view) } : null;
}

// gh says this when the branch has no pull request: an answer, not a failure.
const NO_PR = /no pull requests found/i;
const stdout = (r) => (r?.code === 0 ? r.stdout : null);
const ghWords = (r) => String(r?.stderr ?? "").trim().split("\n")[0] || `gh exited with ${r?.code}`;

// `run(cmd, args, cwd)` resolves with { code, stdout, stderr }. `failure` is gh's words when it could not answer.
export async function readDigest(cwd, run, want = {}) {
  const gitOn = want.git !== false, prOn = want.pr !== false;
  if (!gitOn && !prOn) return null;
  const pull = async () => {
    const r = await run("gh", ["pr", "view", "--json", PR_FIELDS], cwd);
    const out = stdout(r);
    if (out != null) return { pr: tryOr(() => digestPr(JSON.parse(out))), failure: null };
    return { pr: null, failure: NO_PR.test(r?.stderr ?? "") ? null : ghWords(r) };
  };
  if (!gitOn) {
    const read = await pull();
    return read.pr || read.failure ? { files: 0, add: 0, del: 0, ahead: 0, pushed: false, ...read } : null;
  }
  const git = (...args) => run("git", ["-C", cwd, ...args]).then(stdout);
  if ((await git("rev-parse", "--is-inside-work-tree"))?.trim() !== "true") return null;
  const [status, stat, upstream, branch] = await Promise.all([
    git("status", "--porcelain"), git("diff", "--shortstat", "HEAD"),
    git("rev-list", "--count", "@{upstream}..HEAD"), git("symbolic-ref", "--quiet", "--short", "HEAD")]);
  const files = (status ?? "").split("\n").filter((l) => l.trim()).length;
  const pushed = upstream != null;
  // Without an upstream, ahead of the default branch.
  const aheadOfBase = async () => { const base = await git("rev-list", "--count", "origin/HEAD..HEAD"); return base == null ? 0 : Number(base.trim()) || 0; };
  const ahead = pushed ? Number(upstream.trim()) || 0 : await aheadOfBase();
  const read = prOn && branch?.trim() ? await pull() : { pr: null, failure: null };
  return { files, ...parseShortstat(stat), ahead, pushed, ...read };
}

/** A read GitHub did not answer keeps the pull request it last named, with gh's words; with none named, there is nothing to say. */
export function settleDigest(was, read) {
  if (!read) return null;
  return read.failure && was?.pr ? { ...read, pr: was.pr } : { ...read, failure: null };
}

const words = (n, one, many) => `${n} ${n === 1 ? one : many}`;

export function readClock(at) {
  if (at == null || !Number.isFinite(Number(at))) return null;
  const date = new Date(at);
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

const readNote = (working, at) => {
  const clock = working ? readClock(at) : null;
  return clock ? ` · read ${clock}` : "";
};

export function digestSegments(d, { working = false, map = null } = {}) {
  if (!d) return [];
  const read = readNote(working, d.at);
  const tone = working ? "dim" : "muted";
  const openPr = d.pr?.number && String(d.pr.state ?? "OPEN").toUpperCase() === "OPEN" ? d.pr : null;
  const line = openPr ? prLine(d) : null;
  const filesOn = shown("header.digest", d.files > 0 || d.ahead > 0, map);
  const prOn = shown("header.pr", Boolean(openPr), map);
  const files = filesOn && d.files > 0 ? {
    kind: "files", count: words(d.files, "file", "files"), tone,
    diff: d.add > 0 || d.del > 0 ? `+${d.add ?? 0} −${d.del ?? 0}` : null, diffTone: "dim",
    tip: `Open the diff${read}`, open: { panel: "files", changed: true },
  } : null;
  const commits = filesOn && d.ahead > 0 ? {
    kind: "commits", count: words(d.ahead, "commit", "commits"), tone,
    tip: `${words(d.ahead, "commit", "commits")} not on GitHub${read}`, open: { panel: "pr", section: "push" },
  } : null;
  const pr = prOn && openPr ? {
    kind: "pr", number: `#${openPr.number}`, numberTone: "muted", url: openPr.url ?? null,
    verdict: line?.text ?? null, verdictTone: line?.tone ?? null, tone: line?.tone ?? null,
    tip: line?.text ?? `Pull request #${openPr.number}`,
    open: { panel: "pr", section: line?.section ?? null, check: line?.check ?? null },
  } : null;
  // GitHub not answering is the failure line in the pull request's place, until a refresh is in flight.
  const failed = pr && d.failure && !d.reading ? { kind: "failure", text: `Can't read #${openPr.number}`, tip: d.failure } : null;
  return [files, commits, failed ?? pr].filter((part) => part);
}

export function digestOpen(segment, cwd) {
  const open = segment?.open;
  if (!open?.panel) return null;
  if (open.panel === "files") return { panel: "files", changed: true, cwd: cwd ?? null };
  return { panel: "pr", section: open.section ?? null, check: open.check ?? null };
}

export default class Strip extends View {
  init(_props, cx) {
    const p = props() ?? {};
    this.kind = p.edge ? "edge" : p.ruler ? "ruler" : p.drop ? "drop" : p.pane ? "head" : "controller";
    if (this.kind === "head") {
      this.hovered = false;
      this.moreOpen = false;
      this.segmentMenu = null; // the header fact whose right-click Menu is open
      this.renaming = null; // the inline name field while renaming
      this.press = null; // where a press that may become a drag started
      this.width = null;
      this.armed = new Armed();
    }
    if (this.kind !== "controller") return;
    // Panes per view shows its − and + while the keyboard is on one of its Buttons, so each keeps a handle.
    this.stepperFocus = { minus: cx.focus_handle(), plus: cx.focus_handle(), value: cx.focus_handle() };

    this.state = JSON.parse(JSON.stringify(shared(KEY) ?? {}));
    this.saved = JSON.stringify(this.state);
    this.lastReq = shared("strip.req")?.n ?? null;
    this.usedIntent = shared("strip.intent")?.at ?? null;
    this.pendingFocus = null;
    this.sets = [];
    this.seq = 0; // bumped by whatever changes the model outside render (see render's key)
    cx.timer.every(WRITE_MS / 2, (cx) => { if (this.dirty) { this.dirty = false; this.seq += 1; cx.notify(); } });
    cx.timer.every(150, (cx) => this.pollAdopt(cx));
    this.lastStatus = new Map();
    this.digesting = new Set();
    cx.timer.every(1500, (cx) => this.watchDigests(cx));
    readCommands(cx, () => nextCommand(), (c, cx) => {
      this.command(String(c).replace(/^kanso-strip\./, ""));
      this.seq += 1;
      cx.notify();
    });
  }

  renderEdge() {
    const t = theme(), p = props(), w = washes(t);
    const byId = new Map(panes().map((q) => [q.pane, q]));
    const ids = (p.panes ?? [p.edge]).filter((id) => byId.has(id));
    const left = p.side === "left";
    const chevron = left ? "\u2039" : "\u203a";
    const show = (id) => setShared("strip.req", { op: "focus", pane: id, n: nonce() });
    const given = givenNames();
    const drag = shared("strip.drag");
    const takes = Boolean(drag) && drag.pane !== p.edge; // a held pane can land beyond this edge
    const c = tokens(t);
    const paneItem = (id) => {
      const info = byId.get(id);
      return { id, info, name: nameOf(info, given), mark: EDGE_MARKS.includes(info?.status) ? info.status : null, show: (cx) => { cx.stop_propagation(); show(id); } };
    };
    const MAX_TILES = 8;
    const tile = ({ id, info, name, mark: status, show: showPane }) => {
      const d = status ? mark(c, { status, size: "sm" }) : null;
      const face = div().id(`edge-tile-face-${id}`).relative().size(20).flex_none().rounded(R.control).bg(w?.w7 ?? t.hover)
        .border_1().border_color(CLEAR).flex().items_center().justify_center()
        .hover((h) => h.bg(c.selected).border_color(c.border))
        .child(iconOf(info?.program, 12, t.muted))
        .when(Boolean(d), (el) => el.child(d.absolute().top(-G.hair).right(-G.hair).rounded_full().border_1().border_color(c.chrome)));
      return button({ label: name, kind: "quiet", content: [face] })(`edge-tile-${id}`, c, { onClick: showPane }).m(-FOCUS);
    };
    const items = ids.map(paneItem);
    const stack = v_flex().id("edge-stack").items_center().gap(G.hair).py(6).px(4)
      .child(div().h(16).text_size(T.card).text_color(takes ? t.foreground : t.muted).child(chevron))
      .children(items.slice(0, MAX_TILES).map(tile))
      .when(ids.length > MAX_TILES, (el) => el.child(div().text_size(T.micro).text_color(t.dim).child(`+${ids.length - MAX_TILES}`)));
    const item = ({ info, name, mark: status, show: showPane }) => {
      const prog = info?.program;
      return { ...(prog?.icon ? { [prog.tint ? "icon" : "picture"]: prog.icon } : {}), label: name, mark: status, onClick: showPane };
    };
    const beyond = `${ids.length === 1 ? "One pane" : `${ids.length} panes`} beyond the ${left ? "left" : "right"} edge`;
    const card = menu("edge-menu", { title: beyond, items: items.map(item) }, c);
    const hoverCard = HoverCard.new(`edge-card-${p.side}`).anchor(left ? "left_center" : "right_center").open_delay(EDGE_CARD_MS.open).close_delay(EDGE_CARD_MS.close)
      .trigger(stack)
      .content(card);
    return button({ label: beyond, kind: "quiet", content: [hoverCard] })("edge", c, { onClick: () => show(p.edge) })
      .flex().flex_col().size_full().rounded(0).bg(t.chrome)
      .hover((h) => h.bg(takes ? alpha(t.accent, TINT.strong) : t.hover))
      .when(takes, (el) => el.bg(alpha(t.accent, TINT.strong)).cursor_grabbing())
      .on_mouse_up("left", () => dropMove(p.edge, left ? "after" : "before", false))
      .on_scroll_wheel((e) => { const d = wheelDelta(e); if (d) postScroll(d / WHEEL_PX); });
  }

  renderRuler() {
    const what = props().ruler;
    const t = theme();
    // The ruler is a pane's foot, part of its drop card: landing below the pane lights it too.
    const drag = shared("strip.drag");
    const takes = Boolean(drag) && drag.pane !== what;
    const drop = takes ? shared("strip.drop") : null;
    // A shared write redraws every mod, so write the last measurement only once the size has rested 120 ms.
    return div().size_full().rounded_b(R.card).bg(t.background).on_size_change((sz, cx) => {
      const v = Math.round(sz.width);
      if (!v) return;
      this.measured = v;
      if (this.measuring) return;
      this.measuring = cx.timer.after(120, () => {
        this.measuring = null;
        const px = shared(PX) ?? {};
        if (px[what] !== this.measured) setShared(PX, { ...px, [what]: this.measured });
      });
    })
      .when(takes, (el) => el.cursor_grabbing()
        .on_mouse_move(() => { const d = shared("strip.drop"); if (d?.to !== what || d.side !== "below") setShared("strip.drop", { to: what, side: "below" }); })
        .on_mouse_up("left", () => dropMove(what, "below")))
      .when(drop?.to === what && drop.side === "below", (el) => el.child(div().size_full().rounded_b(R.card).bg(alpha(t.accent, TINT.strong))));
  }

  // The drop card stands in for a pane's terminal, which lives on: the whole pane takes the drop, not just its header.
  renderDrop() {
    const t = theme(), id = props().drop;
    const all = panes(), given = givenNames();
    const me = all.find((q) => q.pane === id);
    const drag = shared("strip.drag");
    const held = drag ? all.find((q) => q.pane === drag.pane) : null;
    const mine = drag?.pane === id;
    const drop = !mine ? shared("strip.drop") : null;
    const side = drop?.to === id ? drop.side : null;
    const label = (info, strong) => v_flex().flex_1().size_full().min_w(0).min_h(0).items_center().justify_center().gap(G.sm)
      .child(iconOf(info?.program, ICON_CHROME, strong ? t.foreground : t.muted))
      .child(div().w_full().px(G.md).truncate().text_center().text_size(T.card).when(strong, (el) => el.font_medium())
        .text_color(strong ? t.foreground : t.muted).child(nameOf(info, given)));
    const across = side === "before" || side === "after";
    const first = side === "before" || side === "above";
    const ghost = () => label(held, true).bg(alpha(t.accent, TINT.strong));
    return div().id(`drop-${id}`).size_full().relative().cursor_grabbing()
      .when(mine, (el) => el.opacity(OPACITY.held))
      .when(!mine, (el) => el
        .on_mouse_move((e) => {
          const s = zoneOf(e), d = shared("strip.drop");
          if (d?.to !== id || d.side !== s) setShared("strip.drop", { to: id, side: s });
        })
        .on_hover((over) => { if (!over && shared("strip.drop")?.to === id) setShared("strip.drop", null); }))
      .on_mouse_up("left", (e) => {
        const d = shared("strip.drag");
        if (!d) return;
        if (!mine) setShared("strip.req", { op: "move", pane: d.pane, to: id, side: zoneOf(e, side ?? "below"), n: nonce() });
        endDrag();
      })
      .child(!side ? div().absolute().inset_0().flex().child(label(me, false))
        : (across ? h_flex() : v_flex()).absolute().inset_0()
          .children(first ? [ghost(), label(me, false)] : [label(me, false), ghost()]));
  }

  // Derived from the `pane` mod shipped with Herdr (Apache-2.0), by way of
  // 0OZ's and José Gutiérrez's quiet headers.
  me(all) {
    return all.find((p) => p.pane === props()?.pane);
  }

  // Double-click renames in place; Enter or leaving the field keeps the name, Escape drops it, empty gives the program's name back.
  startRename(p, shown, cx) {
    const text = new TextField({ value: shown }, { limit: NAME_LIMIT });
    text.set_selected_range({ start: 0, end: shown.length });
    text.on("submit", (_e, cx) => this.endRename(p, shown, cx, true));
    text.on("blur", (_e, cx) => this.endRename(p, shown, cx, true));
    this.renaming = text;
    text.focus();
    cx.timer.after(0, () => this.renaming?.focus());
    cx.notify();
  }

  endRename(p, shown, cx, keep) {
    const text = this.renaming;
    if (!text) return;
    this.renaming = null;
    const name = text.value().trim();
    if (keep && name !== shown) hc(["label", p.terminal, `${NAME_LABEL}=${name}`]).catch(() => {});
    text.release();
    cx.notify();
  }

  // In the strip a split records where the new pane goes.
  act(command, args) {
    if (props()?.strip && command === "pane.split") setShared("strip.intent", { dir: args.direction, from: props()?.pane, at: Date.now() });
    run(command, args);
  }

  wheelReq(e) {
    const d = wheelDelta(e);
    if (d) postScroll(d / WHEEL_PX);
  }

  // The header is the handle: a press held and moved a few pixels picks the pane up.
  pressMove(e, pane) {
    const from = this.press;
    if (!from || shared("strip.drag")) return;
    if (Math.hypot(e.position.x - from.x, e.position.y - from.y) < DRAG_START) return;
    this.press = null;
    setShared("strip.drag", { pane, at: Date.now() });
  }

  // The header is the top of the drop card: the middle means "above" here, the card below has the zone for "below".
  dragMove(e, pane) {
    const width = e.bounds?.width || this.width || 0;
    const d = shared("strip.drag");
    if (!d || d.pane === pane || !width) return;
    const x = e.local_position.x;
    const side = x < width / 4 ? "before" : x > width * 3 / 4 ? "after" : "above";
    const cur = shared("strip.drop");
    if (cur?.to !== pane || cur.side !== side) setShared("strip.drop", { to: pane, side });
  }

  // What each tool and ⋯ entry does; close asks twice while an agent is in the pane.
  actions(p, { name, agent }) {
    const pane = p.pane;
    const close = (cx) => (agent ? this.armed.press("close", cx, () => run("pane.close", { pane })) : run("pane.close", { pane }));
    const pieceState = (state) => () => setShared(STORE, DIGEST_PIECES.reduce((map, id) => setPiece(map, id, state), pieces(shared)));
    const pin = () => setShared("strip.req", { op: "pin", pane, n: nonce() });
    const zoom = () => run("pane.zoom", { pane });
    return {
      pin,
      unpin: pin,
      sleep: () => openSleep(p),
      send: () => openSend(p),
      "open-with": () => openWithPopup(p),
      "split-right": () => this.act("pane.split", { direction: "right", pane }),
      "split-down": () => this.act("pane.split", { direction: "down", pane }),
      width: () => setShared("strip.req", { op: "width", pane, n: nonce() }),
      zoom,
      unzoom: zoom,
      close,
      needed: pieceState("needed"),
      hide: pieceState("hide"),
      settings: () => openOverlay({ mod: "kanso-settings", kind: "dialog", width: 860, height: 680, props: { page: "pieces", find: PIECE_GROUP } }),
      refresh: () => setShared(DIGEST, { ...(shared(DIGEST) ?? {}), [pane]: { ...shared(DIGEST)?.[pane], reading: true } }),
      rename: (cx) => this.startRename(p, name, cx),
    };
  }

  tool(c, pane, key, does, { armed = false, verb = null } = {}) {
    const [icon, label] = ENTRIES[key];
    return iconButton(`ph-${key}-${pane}`, icon, label, (cx) => { cx.stop_propagation(); does[key](cx); }, c, { armed, verb });
  }

  // ⋯ opens its Menu under itself, right-aligned to it; while it is open the tools stay out.
  more(c, pane, { name, entries, does }) {
    const trigger = iconButton(`ph-more-${pane}`, "ellipsis", "More", null, c, { active: this.moreOpen });
    const close = (cx) => { this.moreOpen = false; cx.notify(); };
    const item = (key) => (key === "separator" ? { separator: true } : {
      icon: ENTRIES[key][0], label: ENTRIES[key][1],
      armed: key === "close" && this.armed.is("close"), verb: key === "close" ? `close ${name}` : null,
      onClick: (cx) => { does[key](cx); if (key !== "close" || !this.armed.is("close")) close(cx); },
    });
    const pop = Popover.new(`ph-menu-${pane}`).trigger(trigger).anchor("top_right").open(this.moreOpen)
      .on_open_change((open, cx) => { this.moreOpen = open; cx.notify(); });
    return this.moreOpen ? pop.content(menu(`ph-menu-list-${pane}`, { title: name, items: entries.map(item) }, c)) : pop;
  }

  // Sleep and Send when they rest out; under the pointer the tools this fold keeps, then ⋯.
  tools(c, p, { name, out, hover, entries, fold, strip, does }) {
    const pane = p.pane;
    const armed = this.armed.is("close");
    return h_flex().id(`ph-tools-${pane}`).flex_none().items_center().gap(G.hair)
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .children(out.map((key) => this.tool(c, pane, key, does)))
      .when(hover, (el) => el
        .children(hoverTools({ fold, strip }).map((key) => this.tool(c, pane, key, does, key === "close" ? { armed, verb: `close ${name}` } : {})))
        .child(this.more(c, pane, { name, entries, does })));
  }

  // Folder and branch share one Menu: copy either, or open the folder with an editor.
  placeMenu(p, f) {
    return { title: "Folder and branch", piece: "header.place", actions: [
      ...(p.cwd ? [{ icon: "copy", label: "Copy path", act: (cx) => cx.write_to_clipboard?.(p.cwd) }] : []),
      ...(f.where.branch ? [{ icon: "copy", label: "Copy branch name", act: (cx) => cx.write_to_clipboard?.(f.where.branch) }] : []),
      ...(p.cwd ? [{ icon: "external-link", label: "Open with\u2026", act: () => openWithPopup(p) }] : []),
    ] };
  }

  // A right-click on a header fact opens its Menu in place: what it does, then the piece lines.
  factMenu(c, id, fact, { title, actions, piece }) {
    const shut = (cx) => { this.segmentMenu = null; cx.notify(); };
    const trigger = fact.on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); this.segmentMenu = id; cx.notify(); });
    if (this.segmentMenu !== id) return trigger;
    const items = [...actions.map((a) => ({ ...a, onClick: (cx) => { a.act(cx); shut(cx); } })), ...pieceLines(piece, { done: shut })];
    return Popover.new(`fact-menu-${id}`).trigger(trigger).open(true).anchor("top_left").on_open_change((open, cx) => { if (!open) shut(cx); })
      .content(menu(`fact-menu-list-${id}`, { title, items }, c));
  }

  // The digest: files, commits not on GitHub, then the pull request, or the failure line in its place; a refresh in flight is pending.
  digestBar(c, p, segments, { fold, working, reading, strip, does }) {
    const pane = p.pane;
    const open = (seg) => () => {
      const to = digestOpen(seg, p.cwd);
      if (!to) return;
      run("pane.focus", strip && p.terminal ? { terminal: p.terminal } : { pane });
      commitLayout({ panel: { id: to.panel, type: "block", content: { mod: "kanso-panel", props: { ...to, at: Date.now() } } } });
    };
    const tone = working ? "dim" : null;
    const digest = segments.filter((seg) => seg.kind === "files" || seg.kind === "commits")
      .map((seg) => (seg.kind === "files" ? { icon: "file", label: "Open the diff", act: open(seg) } : { icon: "git-pull-request", label: `Push ${seg.count}\u2026`, act: open(seg) }));
    const piece = (seg) => {
      if (seg.kind === "failure") return failureLine({ text: seg.text, fix: "Refresh", detail: seg.tip })(`digest-failure-${pane}`, c, { onClick: does.refresh });
      if (seg.kind === "pr") return shownAt(fold, "PR") ? this.factMenu(c, `pr-${pane}`, headerSegment(`digest-pr-${pane}`, { act: open(seg), title: prTitle(segments, fold),
        parts: [{ text: seg.number, tone: "muted" }, shownAt(fold, "verdict word") && seg.verdict ? { text: `· ${seg.verdict}`, tone: seg.verdictTone } : null] }, c),
        { title: `Pull request \u00b7 ${seg.number}`, piece: "header.pr", actions: [
          ...(seg.url ? [{ icon: "copy", label: "Copy link", act: (cx) => cx.write_to_clipboard?.(seg.url) }] : []),
          { icon: "git-pull-request", label: "Open the pull request", act: open(seg) },
          ...(seg.url ? [{ icon: "external-link", label: "Open on GitHub", act: () => openUrl(seg.url) }] : [])] }) : null;
      const step = seg.kind === "files" ? "files" : "commits";
      return shownAt(fold, step) ? this.factMenu(c, `${seg.kind}-${pane}`, headerSegment(`digest-${seg.kind}-${pane}`, { act: open(seg), tone, title: seg.tip,
        parts: [{ text: seg.count }, seg.diff ? { text: seg.diff, tone: seg.diffTone } : null] }, c),
        { title: "Files and commits", piece: "header.digest", actions: digest }) : null;
    };
    return h_flex().id(`digest-${pane}`).flex_shrink(1).min_w(0).overflow_hidden().gap(G.sm).items_center().text_size(T.body).text_color(c.muted)
      .when(reading, (el) => el.opacity(PENDING))
      .children(segments.map(piece).filter(Boolean))
      .when(reading, (el) => el.child(pendingDot(`digest-pending-${pane}`, c)));
  }

  // In the strip the selected pane is the one the strip remembers, so it stays marked while a side panel has the keyboard.
  isSelected(p, strip) {
    const remembered = strip ? shared(KEY)?.[p.tab]?.focus : null;
    return remembered ? remembered === p.pane : p.focused || (strip && p.terminal && focused()?.terminal === p.terminal);
  }

  // Folder and branch where they differ from the project, and whether its computer is out of reach.
  placeFacts(p, map) {
    const space = spaces().find((s) => s.tabs.some((x) => x.id === p.tab));
    return {
      where: shown("header.place", true, map) ? placeOf(p, space, home()) : {},
      away: Boolean(space?.machine) && machines().some((m) => m.name === space.machine && m.layout === "unavailable"),
    };
  }

  // Where Sleep and Send go: out, into ⋯, or nowhere.
  toolPlaces(p, all, on) {
    const canSend = Boolean(p.terminal) && all.some((q) => q.pane !== p.pane && q.terminal && (q.program?.agent || q.status));
    const canSleep = Boolean(p.terminal && p.tab && agents().some((x) => x.address === p.terminal));
    return headerTools({ focused: on, status: p.status, canSend, canSleep });
  }

  // What the header shows now: who it is, its states, what folds and what ⋯ holds.
  headFacts(p, all) {
    const pane = p.pane, st = p.status;
    const given = givenNames();
    const agent = Boolean(p.program?.agent || st);
    const name = paneLabel({ agent, cwd: p.cwd, given: given.get(p.terminal), name: nameOf(p, given) });
    const strip = Boolean(props()?.strip);
    const on = this.isSelected(p, strip);
    const drag = strip ? shared("strip.drag") : null;
    const drop = drag && drag.pane !== pane ? shared("strip.drop") : null;
    const pinned = Boolean((strip ? shared(KEY)?.[p.tab]?.cols ?? [] : []).find((k) => k.panes?.includes(pane))?.pin);
    const map = pieces(shared);
    const record = shared(DIGEST)?.[pane];
    const segments = agent ? digestSegments(record, { working: st === "working", map }) : [];
    const { where, away } = this.placeFacts(p, map);
    const placed = this.toolPlaces(p, all, on);
    const out = ["sleep", "send"].filter((key) => placed[key] === "out");
    const hover = (this.hovered || this.moreOpen) && !drag;
    const status = headerMark(st, away);
    const sized = headerWidths({ name, place: where, digest: segments, pinned, out: out.length, hover, mark: Boolean(status) });
    const fold = foldFor(this.width ?? Infinity, sized.base, sized.widths);
    return {
      name, agent, strip, on, drag, pinned, record, segments, where, away, out, hover, status, fold,
      side: drop?.to === pane ? drop.side : null,
      entries: menuEntries({ strip, pinned, zoomed: p.zoomed, tools: placed, fold, canOpen: Boolean(p.cwd) }),
      keyboard: on && strip && shared("strip.keys") === pane,
    };
  }

  // Where a held pane would land on this header: its left or right half, or both for "above".
  dropZones(t, side) {
    const zone = (lit) => div().flex_1().h_full().when(lit, (d) => d.bg(alpha(t.accent, TINT.strong)));
    return h_flex().absolute().inset_0().rounded_t(R.card).overflow_hidden()
      .child(zone(side === "before" || side === "above"))
      .child(zone(side === "after" || side === "above"));
  }

  // Hover, size, rename keys, the press that may become a drag, the drop, the wheel and the click that focuses.
  headEvents(el, p, { name, strip, pinned, side }, does) {
    const pane = p.pane, movable = strip && !pinned;
    return el
      .on_hover((hovered, cx) => {
        this.hovered = hovered;
        // No button state reaches a move, so a press that leaves the header is dropped: its release may land elsewhere.
        if (!hovered) this.press = null;
        if (!hovered && shared("strip.drop")?.to === pane && shared("strip.drop")?.side !== "below") setShared("strip.drop", null);
        cx.notify();
      })
      .on_size_change((sz, cx) => {
        const width = Math.round(sz.width);
        if (width === this.width) return;
        this.width = width;
        cx.notify();
      })
      .on_key_down((e, cx) => { if (this.renaming && e.key === "escape") { this.endRename(p, name, cx, false); cx.stop_propagation(); } })
      .on_mouse_down("left", (e, cx) => {
        if (shared("strip.keys")) setShared("strip.keys", null);
        if (e.click_count === 2 && p.terminal) { this.press = null; does.rename(cx); return; }
        if (shared("strip.drag")) endDrag();
        else if (movable) this.press = e.position;
      })
      .when(strip, (el) => el
        .on_scroll_wheel((e) => this.wheelReq(e))
        .on_mouse_move((e) => { this.pressMove(e, pane); this.dragMove(e, pane); })
        .on_mouse_up("left", () => {
          this.press = null;
          dropMove(pane, side ?? "above", false);
        }))
      .on_click(() => { if (!this.renaming) run("pane.focus", strip && p.terminal ? { terminal: p.terminal } : { pane }); });
  }

  // The name, or the field that renames it in place.
  headName(c, pane, name) {
    return this.renaming
      ? div().id(`ph-rename-${pane}`).flex_shrink(1).min_w(0).on_mouse_down("left", (_e, cx) => cx.stop_propagation()).on_click((_e, cx) => cx.stop_propagation())
        .child(field(`ph-name-${pane}`, this.renaming, c, { inline: true, spoken: "Name" }))
      : div().flex_shrink(1).min_w(0).max_w(W.paneName).truncate().font_medium().child(name);
  }

  renderHead() {
    const t = theme(), c = tokens(t);
    const all = panes(); // read once: each read copies every pane
    const p = this.me(all);
    if (!p) return div();
    const pane = p.pane;
    const f = this.headFacts(p, all);
    const does = this.actions(p, f);
    const blocked = p.status === "blocked";
    const row = h_flex().id(`pane-head-${pane}`).size_full().pl(G.md).pr(G.sm).gap(G.sm).items_center().text_size(T.value).text_color(c.text).relative()
      .rounded_t(R.card).border_2().border_color(f.keyboard ? c.accent : CLEAR)
      .when(f.on && !blocked, (el) => el.bg(c.selected))
      .when(blocked, (el) => el.bg(mix(c.blocked, c.background, OPACITY.blockedWash)))
      .when(f.away, (el) => el.opacity(OPACITY.away))
      .when(f.drag?.pane === pane, (el) => el.opacity(OPACITY.held))
      .when(f.strip && !f.pinned, (el) => el.cursor_grab())
      .when(Boolean(f.drag), (el) => el.cursor_grabbing())
      .when(Boolean(f.side), (el) => el.child(this.dropZones(t, f.side)));
    return this.headEvents(row, p, f, does)
      .child(programIcon(p.program, ICON, c.muted) ?? svg(glyphOf("terminal")).size(ICON).flex_none().text_color(c.muted))
      .child(this.headName(c, pane, f.name))
      .when(Boolean(f.where.folder) && shownAt(f.fold, "folder"), (el) => el.child(this.factMenu(c, `folder-${pane}`, headerSegment(`ph-folder-${pane}`, { icon: "folder", parts: [{ text: shortFolder(f.where.folder) }] }, c), this.placeMenu(p, f))))
      .when(Boolean(f.where.branch) && shownAt(f.fold, "branch"), (el) => el.child(this.factMenu(c, `branch-${pane}`, headerSegment(`ph-branch-${pane}`, { icon: "git-branch", parts: [{ text: f.where.branch }] }, c), this.placeMenu(p, f))))
      .when(f.segments.length > 0, (el) => el.child(this.digestBar(c, p, f.segments, { fold: f.fold, working: p.status === "working", reading: Boolean(f.record?.reading), strip: f.strip, does })))
      .when(f.pinned, (el) => el.child(headerSegment(`ph-pinned-${pane}`, { icon: "pin", tone: "dim", title: "Pinned" }, c)))
      .child(div().flex_1())
      .child(this.tools(c, p, { ...f, does }))
      .when(Boolean(f.status), (el) => el.child(mark(c, { status: f.status })));
  }

  tab() {
    const space = spaces().find((s) => s.active);
    return space?.tabs?.find((t) => t.active)?.id ?? null;
  }

  focusPane(ps) {
    const f = focused();
    if (!f) return null;
    if (f.pane && ps.some((p) => p.pane === f.pane)) return f.pane;
    return ps.find((p) => p.terminal && p.terminal === f.terminal)?.pane ?? null;
  }

  where(st, id) {
    const ci = st.cols.findIndex((c) => c.panes.includes(id));
    return ci < 0 ? null : { ci, ri: st.cols[ci].panes.indexOf(id) };
  }

  // Positions on the sliding row count only unpinned columns: the view is what the pinned ones leave.
  start(st, ci) { return st.cols.slice(0, ci).reduce((s, c) => s + (c.pin ? 0 : c.w), 0); }
  total(st) { return st.cols.reduce((s, c) => s + (c.pin ? 0 : c.w), 0); }
  // `commit` is the one place a tab's state is kept; the headers read it from shared "strip.state", where save puts it.
  commit(tab, st) {
    this.state = { ...this.state, [tab]: st };
    return st;
  }

  // `st` is the state the minimap was drawn from, for a tab no longer kept.
  edit(tab, st, fn) {
    const now = this.state[tab];
    const next = fn(now ?? st);
    if (now) this.commit(tab, next);
  }

  // Columns are kept in screen order: pinned left, the sliding row, pinned right.
  order(st) {
    const rank = (c) => (c.pin === "left" ? 0 : c.pin === "right" ? 2 : 1);
    return { ...st, cols: st.cols.map((c, i) => [c, i]).toSorted((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map(([c]) => c) };
  }
  // Gathered in runs of 64, so a long row is not copied once per column.
  row(st) {
    const RUN = 64;
    const done = Array.from({ length: Math.ceil(st.cols.length / RUN) }, (_, r) => r).reduce((acc, r) => {
      const run = st.cols.slice(r * RUN, (r + 1) * RUN).reduce((inner, c, k) => (c.pin
        ? inner
        : { x: inner.x + c.w, out: [...inner.out, { ci: r * RUN + k, s: inner.x, e: inner.x + c.w }] }),
        { x: acc.x, out: [] });
      return { x: run.x, runs: [...acc.runs, run.out] };
    }, { x: 0, runs: [] });
    return done.runs.flat();
  }
  pinnedW(st) { return st.cols.reduce((s, c) => s + (c.pin ? c.w : 0), 0); }
  viewW(st) { return Math.max(MIN_VIEW, 1 - this.pinnedW(st)); }

  sync(tab, ps) {
    const was = this.state[tab] ?? { cols: [], vx: 0, n: shared("strip.n") ?? DEFAULT_N };
    const withVx = was.vx === undefined ? { ...was, vx: 0 } : was;
    const withN = !withVx.n ? { ...withVx, n: shared("strip.n") ?? DEFAULT_N } : withVx;
    const ids = new Set(ps.map((p) => p.pane));
    const st = { ...withN, cols: withN.cols.map((c) => {
      const kept = c.panes.filter((id) => ids.has(id));
      return c.hs ? { ...c, panes: kept, hs: Object.fromEntries(kept.filter((id) => id in c.hs).map((id) => [id, c.hs[id]])) } : { ...c, panes: kept };
    }).filter((c) => c.panes.length) };
    const known = new Set(st.cols.flatMap((c) => c.panes));
    const fresh = ps.filter((p) => !known.has(p.pane));
    const placed = fresh.length && !st.cols.length
      ? this.repage({ ...st, cols: [...st.cols, ...fresh.map((p) => ({ panes: [p.pane], w: 1 }))] }, this.focusPane(ps))
      : fresh.reduce((s, p) => {
        const chosen = { ...this.place(s, p.pane), focus: p.pane };
        this.pendingFocus = p.terminal;
        return this.reveal(chosen, p.pane);
      }, st);
    return this.order(placed);
  }

  place(st, id) {
    const intent = shared("strip.intent");
    const usable = intent && intent.at !== this.usedIntent && Date.now() - intent.at < 5000;
    if (usable) this.usedIntent = intent.at;
    const dir = usable ? intent.dir : "right";
    const at = this.where(st, usable ? intent.from : st.focus) ?? { ci: st.cols.length - 1, ri: 0 };
    if (dir === "down" || dir === "up") {
      const col = st.cols[at.ci];
      return { ...st, cols: st.cols.with(at.ci, { ...col, panes: col.panes.toSpliced(dir === "down" ? at.ri + 1 : at.ri, 0, id) }) };
    }
    return this.repage(this.order({ ...st, cols: st.cols.toSpliced(dir === "left" ? at.ci : at.ci + 1, 0, { panes: [id], w: 1 }) }), id, true);
  }

  repage(st, id, opened = false) {
    const at = this.where(st, id)?.ci ?? null;
    const { cols, page } = paged(st.cols, { n: st.n, view: this.viewW(st), at, opened });
    const started = page ? { ...st, cols, vx: this.start({ ...st, cols }, page[0]) } : { ...st, cols };
    if (started.vx !== st.vx) this.dirty = true;
    const shown = this.clampView(started);
    return id ? this.reveal(shown, id) : shown;
  }

  // `tx` is kept by older builds' state; it goes here.
  clampView(st) {
    const most = Math.min(st.vx ?? 0, this.lastStart(st)) + EPS;
    const { tx: _tx, ...rest } = st;
    return { ...rest, vx: this.row(st).findLast((r) => r.s <= most)?.s ?? 0 };
  }
  lastStart(st) {
    const row = this.row(st), vw = this.viewW(st), total = this.total(st);
    return (row.find((r) => total - r.s <= vw + EPS) ?? row.at(-1))?.s ?? 0;
  }


  // Slides the view the least that shows a pane whole (niri's "never center").
  reveal(st, id) {
    const at = this.where(st, id);
    if (!at || st.cols[at.ci].pin) return st; // a pinned pane is always in view
    const row = this.row(st), vw = this.viewW(st);
    const me = row.find((r) => r.ci === at.ci);
    if (!me) return st;
    const vx = me.s < st.vx - EPS ? me.s
      : me.e > st.vx + vw + EPS ? (row.find((r) => me.e - r.s <= vw + EPS) ?? me).s : st.vx;
    if (vx !== st.vx) this.dirty = true;
    return this.clampView(vx === st.vx ? st : { ...st, vx });
  }

  widen(st, ci) {
    return { ...st, cols: st.cols.with(ci, { ...st.cols[ci], w: step(W_STEPS, st.cols[ci].w) }) };
  }


  // A digest is read once when an agent stops working, and stays until the pane closes.
  watchDigests(cx) {
    const store = shared(DIGEST) ?? {};
    const all = panes();
    for (const p of all) {
      if (!p.terminal || !p.cwd || !p.status) continue;
      const was = this.lastStatus.get(p.pane);
      this.lastStatus.set(p.pane, p.status);
      const stopped = p.status !== "working" && (was === "working" || (was === undefined && !(p.pane in store)));
      // A header's Refresh marks its record reading; the read starts here.
      if ((stopped || store[p.pane]?.reading) && !this.digesting.has(p.pane)) this.digest(p, cx);
    }
    const live = new Set(all.map((p) => p.pane));
    const gone = new Set(Object.keys(store).filter((id) => !live.has(id)));
    for (const id of [...this.lastStatus.keys()]) if (!live.has(id)) this.lastStatus.delete(id);
    if (gone.size) setShared(DIGEST, Object.fromEntries(Object.entries(store).filter(([id]) => !gone.has(id))));
  }

  digest(p, cx) {
    const map = pieces(shared);
    const want = { git: runs("header.digest", map), pr: runs("header.pr", map) };
    if (!want.git && !want.pr) return;
    this.digesting.add(p.pane);
    const on = spaces().find((s) => s.tabs.some((x) => x.id === p.tab))?.machine ?? null;
    const run = (cmd, args, cwd) => exec(cmd, args, { cwd, on }).catch((e) => ({ code: -1, stdout: "", stderr: String(e?.message ?? e) }));
    cx.spawn(async () => {
      try {
        const d = await readDigest(p.cwd, run, want);
        const live = panes().find((q) => q.pane === p.pane);
        const was = shared(DIGEST)?.[p.pane];
        // It went back to work meanwhile: what it left is no longer the news, unless someone asked for this read.
        if (!live || (live.status === "working" && !was?.reading)) return;
        const settled = settleDigest(was, d);
        setShared(DIGEST, { ...(shared(DIGEST) ?? {}), [p.pane]: settled ? { ...settled, at: Date.now() } : null });
      } finally { this.digesting.delete(p.pane); }
    });
  }

  openFind() {
    const term = focused()?.terminal;
    if (!term || String(term).includes("/")) { run("terminal.search"); return; }
    const live = shared(FIND);
    if (live?.terminal === term) { setShared(FIND, { ...live, select: (live.select ?? 0) + 1 }); return; }
    // A window keeps Escape and stays the size of the bar. A dialog is centered and dims the whole window.
    openOverlay({ mod: "kanso-panel", kind: "window", frame: "none", width: 540, key: "kanso-find", props: { panel: "find", terminal: term } });
  }

  focusedPane() {
    const f = focused();
    const all = panes();
    return (f?.pane && all.find((p) => p.pane === f.pane)) || (f?.terminal && all.find((p) => p.terminal === f.terminal)) || null;
  }

  command(name) {
    // Vim's keys (⌘⌥h/j/k/l, with ⇧ to move) are the arrows' moves.
    const vim = /^vim-(move-)?(left|right|up|down)$/.exec(name);
    if (vim) name = `${vim[1] ? "move" : "go"}-${vim[2]}`;
    // While the sidebar's list has the keyboard ("kanso.list"), go-* drive the list; right goes back to the pane it came from.
    const list = shared("kanso.list");
    if (list && (name === "go-right" || name === "go-left" || name === "go-up" || name === "go-down")) {
      if (name === "go-right") { setShared("kanso.list", null); if (list.from) run("pane.focus", { pane: list.from }); }
      else if (name === "go-left") run("kanso-spaces.list");
      // A stale flag costs nothing: an item that isn't on the list any more sends the keys back here.
      else run(`kanso-spaces.list-${name === "go-up" ? "up" : "down"}`);
      return;
    }
    if (name === "next-needs-you") { run("kanso-spaces.needs-you.next"); return; }
    if (name === "send") { const p = this.focusedPane(); if (p?.terminal) openSend(p); return; }
    if (name === "arrange") { openArrange(); return; }
    if (name === "find") { this.openFind(); return; }
    const tab = this.tab();
    const st = tab && this.state[tab];
    if (!st) return;
    const next = this.commandOn(st, name, panes().filter((p) => p.tab === tab));
    if (next === st) return;
    this.commit(tab, next);
    // Focus the keyboard moved draws the accent ring around its header, until a header is pressed.
    if (next.focus !== st.focus) setShared("strip.keys", next.focus ?? null);
  }

  commandOn(st, name, ps) {
    const id = this.focusPane(ps) ?? (ps.some((p) => p.pane === st.focus) ? st.focus : null) ?? st.cols[0]?.panes[0] ?? null;
    const at = id && this.where(st, id);
    const go = (ci, ri) => {
      const col = st.cols[ci];
      return col ? this.focusOn(st, col.panes[clamp(ri ?? 0, 0, col.panes.length - 1)], ps) : st;
    };
    const split = (dir) => {
      if (id) {
        setShared("strip.intent", { dir, from: id, at: Date.now() });
        run("pane.split", { pane: id, direction: dir === "down" || dir === "up" ? "down" : "right" });
      }
      return st;
    };
    switch (name) {
      // Left of the first column is the sidebar's list, as in vim.
      case "go-left":
        if (at && at.ci > 0) return go(at.ci - 1, at.ri);
        if (at) run("kanso-spaces.list");
        return st;
      case "go-right": return at ? go(at.ci + 1, at.ri) : st;
      case "go-up": return at && at.ri > 0 ? go(at.ci, at.ri - 1) : st;
      case "go-down": return at && at.ri < st.cols[at.ci].panes.length - 1 ? go(at.ci, at.ri + 1) : st;
      case "new-down": return split("down");
      case "new-up": return split("up");
      case "move-left": case "move-right": {
        const to = at ? at.ci + (name === "move-left" ? -1 : 1) : -1;
        if (!at || !(to >= 0 && to < st.cols.length && !st.cols[at.ci].pin && !st.cols[to].pin)) return st;
        return this.reveal({ ...st, cols: st.cols.with(at.ci, st.cols[to]).with(to, st.cols[at.ci]) }, id);
      }
      case "move-up": case "move-down": {
        const col = at ? st.cols[at.ci] : null, to = at ? at.ri + (name === "move-up" ? -1 : 1) : -1;
        if (!at || !(to >= 0 && to < col.panes.length)) return st;
        const swapped = col.panes.with(at.ri, col.panes[to]).with(to, col.panes[at.ri]);
        return this.reveal({ ...st, cols: st.cols.with(at.ci, { ...col, panes: swapped }) }, id);
      }
      case "new-right": return split("right");
      case "new-left": return split("left");
      case "close": if (id) run("pane.close", { pane: id }); return st;
      case "width": return at ? this.reveal(this.widen(st, at.ci), id) : st;
      case "scroll-left": return this.step(st, -1);
      case "scroll-right": return this.step(st, 1);
      case "center": return id ? this.reveal(st, id) : st;
      case "pin": return id ? this.pin(st, id) : st;
      case "fit": return this.fit(st, id);
      case "more": return this.setN(st, (st.n ?? DEFAULT_N) + 1, id);
      case "fewer": return this.setN(st, (st.n ?? DEFAULT_N) - 1, id);
      case "first": return go(0);
      case "last": return go(st.cols.length - 1);
      default: {
        const n = /^col-(\d)$/.exec(name);
        const went = n ? go(Number(n[1]) - 1) : st;
        const per = /^per-(\d)$/.exec(name);
        return per ? this.setN(went, Number(per[1]), id) : went;
      }
    }
  }

  setN(st, n, keep) {
    const per = clamp(Math.round(n), 1, N_MAX);
    setShared("strip.n", per);
    return this.repage({ ...st, n: per, cols: st.cols.map(({ hs: _hs, ...c }) => c) }, keep);
  }

  fit(st, keep) { return this.setN(st, st.n ?? DEFAULT_N, keep); }

  // A divider drag leaves px sizes on the nodes it moved; once they stay put for SETTLE ms they are read back as shares, so the next tree the strip writes keeps what was dragged.
  sizesOf(nodes) {
    return Object.fromEntries(nodes.filter((n) => this.isCol(n)).flatMap((n) => [
      [n.id, n.size ?? null],
      ...(String(n.id).startsWith("strip-col-") ? (n.children ?? []).map((c) => [c.id, c.size ?? null]) : []),
    ]));
  }
  isCol(n) { const id = String(n.id); return id.startsWith("strip-") && !id.startsWith("strip-edge"); }

  pollAdopt(cx) {
    const now = Date.now(), held = shared("strip.drag");
    if (held && now - held.at > DRAG_MAX) endDrag();
    if (!held && now - (this.adoptedAt ?? -Infinity) < 1000) return;
    this.adoptedAt = now;
    if (this.adopt()) { this.seq += 1; cx.notify(); }
  }

  adopt() {
    const tab = this.tab(), st = tab && this.state[tab];
    if (!st || !this.appliedSizes) return false;
    // A divider is dragged with the window in front; behind other windows the tree is left alone.
    if (window()?.active === false) return false;
    const body = walkLayout(layout(), "work-body");
    if (!body?.children) return false;
    const text = JSON.stringify(this.sizesOf(body.children));
    if (text === this.appliedSizes) { this.drift = null; return false; }
    const now = Date.now();
    if (this.drift?.text !== text) { this.drift = { text, at: now }; return false; }
    if (now - this.drift.at < SETTLE) return false;
    const colNodes = body.children.filter((n) => this.isCol(n));
    const inTree = st.cols.filter((c) => colNodes.some((n) => n.id === nodeId(c)));
    const px = shared(PX) ?? {};
    const width = (c) => px[c.panes[0]] ?? 0;
    if (inTree.some((c) => !width(c))) return false;
    const span = inTree.reduce((s, c) => s + width(c), 0) || 1;
    const sumW = inTree.reduce((s, c) => s + c.w, 0);
    const fit = (c) => {
      const n = colNodes.find((k) => k.id === nodeId(c));
      const w = clamp(width(c) / span * sumW, MIN_W, 1);
      const wider = Math.abs(w - c.w) > EPS;
      const sized = wider ? { ...c, w } : c;
      // A stack's weights are its shares; px heights are left as they were.
      if (!(c.panes.length > 1 && n.children) || n.children.some((k) => k.size?.px !== undefined)) return { col: sized, moved: wider };
      const weightOf = (id) => { const k = n.children.find((x) => x.id === `strip-${id}`); return k ? k.size?.weight ?? 1 : 0; };
      const tot = c.panes.reduce((s, id) => s + weightOf(id), 0) || 1;
      const next = Object.fromEntries(c.panes.map((id) => [id, weightOf(id) / tot]));
      const taller = JSON.stringify(next) !== JSON.stringify(c.hs ?? null);
      return { col: taller ? { ...sized, hs: next } : sized, moved: wider || taller };
    };
    const dragged = new Set(inTree);
    const fitted = st.cols.map((c) => (dragged.has(c) ? fit(c) : { col: c, moved: false }));
    this.drift = null;
    if (fitted.some((f) => f.moved)) this.commit(tab, this.clampView({ ...st, cols: fitted.map((f) => f.col) }));
    // Write the tree again either way: weights replace the px the drag left, so the row keeps filling the view when the window changes.
    this.applied = null;
    return true;
  }

  slide(st, d) {
    const summed = { ...st, acc: (st.acc ?? 0) + d };
    if (Math.abs(summed.acc) < WHEEL_STEP) return summed;
    const dir = summed.acc > 0 ? 1 : -1;
    return this.step({ ...summed, acc: 0 }, dir);
  }

  // The focus follows to the nearest pane still in view if its pane left the view.
  step(st, dir) {
    const row = this.row(st);
    if (!row.length) return st;
    const k = clamp(Math.max(0, row.findIndex((r) => Math.abs(r.s - st.vx) < EPS)) + dir, 0, row.length - 1);
    const to = Math.min(row[k].s, this.lastStart(st));
    if (Math.abs(to - st.vx) < EPS) return st;
    const moved = { ...st, vx: to };
    this.dirty = true;
    this.slidAt = Date.now();
    const shown = new Set(this.shownCols(moved));
    const at = this.where(moved, moved.focus);
    if (at && (moved.cols[at.ci].pin || shown.has(at.ci))) return moved;
    const best = [...shown].reduce((b, ci) => (b === null || Math.abs(ci - (at?.ci ?? 0)) < Math.abs(b - (at?.ci ?? 0)) ? ci : b), null);
    if (best === null) return moved;
    const id = moved.cols[best].panes[0];
    const p = panes().find((q) => q.pane === id);
    if (p?.terminal) this.pendingFocus = p.terminal;
    return { ...moved, focus: id, lastSeen: id };
  }

  // As many columns as fit whole from vx, and always the first.
  shownCols(st) {
    const row = this.row(st), vw = this.viewW(st);
    const k = Math.max(0, row.findIndex((r) => Math.abs(r.s - st.vx) < EPS));
    return row.slice(k).reduce((acc, r) => {
      const c = st.cols[r.ci];
      if (acc.full || (acc.out.length && acc.used + c.w > vw + EPS)) return { ...acc, full: true };
      return { out: [...acc.out, r.ci], used: acc.used + c.w, full: false };
    }, { out: [], used: 0, full: false }).out;
  }

  // Herdr focuses a tab's pane even when it is not on screen, so the strip hands the keyboard to a block itself.
  keepKeyboard(tab, st, ps) {
    const entered = tab !== this.lastTab;
    this.lastTab = tab;
    const f = focused();
    const p = f?.pane && ps.find((q) => q.pane === f.pane);
    if (!p?.terminal) return st;
    // Only a moved pane focus or coming to the tab follows; a side panel you click keeps the keyboard.
    const moved = st.model != null && f.pane !== st.model;
    const noted = { ...st, model: f.pane };
    if (!entered && !moved) return noted;
    const id = !moved && ps.some((q) => q.pane === noted.focus) ? noted.focus : f.pane;
    return this.focusOn({ ...noted, lastSeen: id }, id, ps); // not a new choice: nothing to slide for
  }

  pin(st, id) {
    const at = this.where(st, id);
    if (!at) return st;
    const c = st.cols[at.ci];
    if (c.pin) {
      const { pin: _pin, ...free } = c;
      const freed = this.reveal({ ...st, cols: st.cols.with(at.ci, free) }, id);
      this.dirty = true;
      return freed;
    }
    if (1 - this.pinnedW(st) - c.w < MIN_VIEW) return st;
    const left = this.start(st, at.ci) + c.w / 2 - st.vx < this.viewW(st) / 2;
    const pinned = this.clampView(this.order({ ...st, cols: st.cols.with(at.ci, { ...c, pin: left ? "left" : "right" }) }));
    this.dirty = true;
    return pinned;
  }

  focusOn(st, id, ps) {
    const p = ps.find((q) => q.pane === id);
    if (!p) return st;
    const shown = this.reveal({ ...st, focus: id }, id);
    this.pendingFocus = p.terminal;
    return shown;
  }

  request(st, ps) {
    const req = shared("strip.req");
    if (!req || req.n === this.lastReq) return st;
    this.lastReq = req.n;
    if (shared("strip.ack") !== req.n) setShared("strip.ack", req.n);
    if (req.op === "scroll") return this.slide(st, req.d);
    if (req.op === "focus") return this.focusOn(st, req.pane, ps);
    if (req.op === "width") {
      const at = this.where(st, req.pane);
      return at ? this.reveal(this.widen(st, at.ci), req.pane) : st;
    }
    if (req.op === "per") return this.setN(st, req.n, st.focus);
    // "widths" comes from an arrangement just opened (kanso-arrange).
    if (req.op === "widths") {
      const per = req.per ? { ...st, n: clamp(req.per, 1, N_MAX) } : st;
      const sized = (req.cols ?? []).reduce((s, c) => {
        const at = this.where(s, c.pane);
        return at && c.w > 0 ? { ...s, cols: s.cols.with(at.ci, { ...s.cols[at.ci], w: clamp(c.w, MIN_W, 1) }) } : s;
      }, per);
      return this.clampView(sized);
    }
    if (req.op === "pin") return this.pin(st, req.pane);
    if (req.op === "move") return this.focusOn(this.move(st, req.pane, req.to, req.side), req.pane, ps);
    return st;
  }

  // side "before"/"after": a column of its own beside the target's; "above"/"below": stacked in the target's column.
  // Panes never move vertically: one dragged out of a stack leaves it.
  move(st, id, to, side) {
    const from = this.where(st, id), target = this.where(st, to);
    if (!from || !target || id === to) return st;
    const into = side === "above" || side === "below";
    if (!into && from.ci === target.ci && st.cols[from.ci].panes.length === 1) return st;
    // Pinned panes never change place and nothing lands among the pinned; stacking under one is fine.
    if (st.cols[from.ci].pin || (st.cols[target.ci].pin && !into)) return st;
    const col = st.cols[from.ci];
    const after = side ? side === "after" : from.ci < target.ci;
    const left = col.panes.toSpliced(from.ri, 1);
    const out = { ...st, cols: left.length ? st.cols.with(from.ci, { ...col, panes: left }) : st.cols.toSpliced(from.ci, 1) };
    const t = this.where(out, to);
    const stack = (c) => {
      const { hs: _hs, ...even } = c; // stacked anew: the panes share the height evenly
      return { ...(c.hs ? even : c), panes: c.panes.toSpliced(side === "above" ? t.ri : t.ri + 1, 0, id) };
    };
    const landed = into ? { ...out, cols: out.cols.with(t.ci, stack(out.cols[t.ci])) }
      : { ...out, cols: out.cols.toSpliced(after ? t.ci + 1 : t.ci, 0, { panes: [id], w: col.w }) };
    return this.clampView(this.order(landed));
  }

  // `sorting`: a pane is held, so each pane's terminal gives its place to a drop card (the terminal stays alive).
  build(st, ps, sorting = false) {
    const byId = new Map(ps.map((p) => [p.pane, p]));
    const weight = (f) => Math.max(1, Math.round(f * 1000));
    const header = (id) => ({ id: `head-${id}`, type: "block", size: { px: CHROME_SQUARE }, content: { mod: "kanso-strip", props: { pane: id, terminal: byId.get(id).terminal, strip: true } } });
    const body = (id) => ({ id: `term-${id}`, type: "block", content: sorting ? { mod: "kanso-strip", props: { drop: id } } : { terminal: byId.get(id).terminal } });
    // A terminal paints square corners, so the ruler doubles as an R.card-tall foot drawing the slab's rounded bottom.
    const ruler = (what) => ({ id: `strip-ruler-${what}`, type: "block", size: { px: R.card }, min: R.card, max: R.card, background: "chrome",
      content: { mod: "kanso-strip", props: { ruler: what } } });
    // Every pane keeps a 1px border, clear except the selected one's accent, so moving the selection never shifts a terminal.
    const t = theme();
    const sel = ps.length > 1 && !sorting ? st.focus : null;
    const edgeOf = (id) => ({ width: 1, color: id === sel ? alpha(t.accent, TINT.line) : CLEAR });
    const live = (id, size, min) => ({ id: `strip-${id}`, type: "column", size, min, background: "background", radius: R.card,
      border: edgeOf(id), children: [header(id), body(id), ruler(id)] });
    const share = (c, id) => (c.hs?.[id] ?? 1) / c.panes.reduce((s, k) => s + (c.hs?.[k] ?? 1), 0);
    const whole = (c) => c.panes.length === 1 ? live(c.panes[0], { weight: weight(c.w) }, PANE.minW)
      : { id: `strip-col-${c.panes[0]}`, type: "column", gap: PANE.gap, background: "chrome", min: PANE.minW, size: { weight: weight(c.w) },
        children: c.panes.map((id) => live(id, { weight: weight(share(c, id)) }, PANE.minH)) };
    const edge = (ci, side, beyond) => ({ id: `strip-edge-${side}`, type: "block", size: { px: PANE.edge }, min: PANE.edge, max: PANE.edge,
      content: { mod: "kanso-strip", props: { edge: st.cols[ci].panes[0], side, count: beyond.length, panes: beyond.flatMap((r) => st.cols[r.ci].panes) } } });
    const row = this.row(st), shown = this.shownCols(st);
    this.shown = new Set(shown);
    const k = row.findIndex((r) => r.ci === shown[0]);
    const after = k + shown.length;
    const out = [
      ...(k > 0 ? [edge(row[k - 1].ci, "left", row.slice(0, k))] : []),
      ...shown.map((ci) => whole(st.cols[ci])),
      ...(after < row.length ? [edge(row[after].ci, "right", row.slice(after))] : []),
    ];
    const pinned = (side) => st.cols.filter((c) => c.pin === side).map(whole);
    // Nothing before the first pane: Herdr's divider there would move nothing.
    return [...pinned("left"), ...out, ...pinned("right")];
  }


  apply(nodes) {
    const text = JSON.stringify(nodes);
    if (text === this.applied || this.writing) return false;
    const now = Date.now();
    // Coalesce before reading anything: a write skipped here costs no tree read; the timer sends the latest state.
    const tabBlock = nodes.length === 1 && nodes[0] === TAB_BLOCK;
    if (!tabBlock && now - (this.sets.at(-1) ?? 0) < WRITE_MS) { this.dirty = true; return false; }
    const tree = layout();
    const body = walkLayout(tree, "work-body");
    if (!body?.children || !isKansoTree(tree)) return false;
    const mine = (n) => n.id === "main" || String(n.id).startsWith("strip-");
    if (tabBlock && body.children.filter(mine).length === 1 && body.children.find(mine)?.content?.tab) {
      this.applied = text;
      setShared(STRIP_INTENT, { nodes, sizesBefore: this.sizesOf(body.children) });
      return false;
    }
    if (tabBlock && now - (this.sets.at(-1) ?? 0) < WRITE_MS) { this.dirty = true; return false; }
    this.sets = this.sets.filter((t) => now - t < 3000);
    // More writes than the coalescing allows means something is rewriting the tree in a loop.
    if (this.sets.length > 3000 / WRITE_MS) { this.halted = now; return false; }
    this.sets = [...this.sets, now];
    this.writing = true;
    try {
      this.applied = text;
      this.appliedSizes = JSON.stringify(this.sizesOf(nodes));
      // The host copies what it is given, so the same nodes go once to the intent and once in the tree.
      setShared(STRIP_INTENT, { nodes, sizesBefore: this.sizesOf(body.children) });
      const at = Math.max(0, body.children.findIndex(mine));
      const rest = body.children.filter((n) => !mine(n));
      const placed = changeLayout(tree, "work-body", (b) => ({ ...b, children: [...rest.slice(0, at), ...nodes, ...rest.slice(at)] }));
      run("layout.set", { layout: paintLayout(placed, { nodes: false }) }); // the columns are in place: the panel and the rail
    } catch { this.halted = now; this.applied = null; return false; }
    finally { this.writing = false; }
    return true;
  }

  save() {
    const tabs = new Set(spaces().flatMap((s) => (s.tabs ?? []).map((t) => t.id)));
    if (!Object.keys(this.state).every((id) => tabs.has(id))) this.state = Object.fromEntries(Object.entries(this.state).filter(([id]) => tabs.has(id)));
    const text = JSON.stringify(this.state);
    if (text !== this.saved) { this.saved = text; setShared(KEY, JSON.parse(text)); }
    const px = shared(PX);
    if (px && Date.now() - (this.prunedAt ?? 0) > 10000) {
      this.prunedAt = Date.now();
      const live = new Set(panes().map((p) => p.pane));
      const kept = Object.fromEntries(Object.entries(px).filter(([k]) => live.has(k)));
      if (Object.keys(kept).length !== Object.keys(px).length) setShared(PX, kept);
    }
  }

  wheel(ev, tab, st) {
    this.edit(tab, st, (now) => this.slide(now, wheelDelta(ev) / WHEEL_PX));
  }

  refresh(tab, ps, key, drag) {
    this.lastKey = key;
    const asked = this.request(this.sync(tab, ps), ps);
    const kept = this.keepKeyboard(tab, asked, ps);
    const now = this.focusPane(ps);
    // A focus change right after a slide is the slide's own doing: don't slide back to it.
    const seen = now && now !== kept.lastSeen ? { ...kept, lastSeen: now } : kept;
    const followed = seen !== kept && Date.now() - (this.slidAt ?? 0) > 600 ? this.reveal({ ...seen, focus: now }, now) : seen;
    const clamped = this.clampView(followed);
    // When a sort ends, the keyboard goes back to the pane that had it (its terminal was away).
    const sorting = Boolean(drag) && ps.some((p) => p.pane === drag.pane);
    const ended = this.sorting && !sorting;
    if (ended && shared("strip.drop")) setShared("strip.drop", null);
    const st = this.commit(tab, ended ? this.focusOn(clamped, clamped.focus, ps) : clamped);
    this.sorting = sorting;
    this.apply(this.build(st, ps, sorting));
    this.save();

    if (this.pendingFocus) {
      if (showsTerminal(walkLayout(layout(), "work-body"), this.pendingFocus)) {
        run("pane.focus", { terminal: this.pendingFocus });
        this.pendingFocus = null;
      }
    }
    return st;
  }

  // A failed layout write stops the strip; it writes again on its own after 10 s, or at once on Resume.
  resume() { this.halted = 0; this.sets = []; this.applied = null; }

  render() {
    if (this.kind === "edge") return this.renderEdge();
    if (this.kind === "ruler") return this.renderRuler();
    if (this.kind === "drop") return this.renderDrop();
    if (this.kind === "head") return this.renderHead();
    const t = theme();
    if (this.halted && Date.now() - this.halted > 10000) this.resume();
    if (this.halted) return statusBar({ middle: layoutPaused() })("strip-map", tokens(t), { presses: { Resume: () => { this.resume(); this.dirty = true; } } });

    const tab = this.tab();
    const ps = tab ? panes().filter((p) => p.tab === tab) : [];
    const usable = ps.length > 0 && ps.every((p) => p.terminal);
    if (!usable) { this.apply([TAB_BLOCK]); this.save(); return div(); }

    // Every shared write anywhere redraws this view, so the model only moves when this key (or `seq`) changes.
    const f = focused(), drag = shared("strip.drag");
    const key = [tab, ps.map((p) => `${p.pane}:${p.terminal}`).join(","), f?.pane ?? "", f?.terminal ?? "", drag?.pane ?? "",
      shared("strip.req")?.n ?? "", shared("strip.intent")?.at ?? "", this.seq].join("|");
    const st = key !== this.lastKey || this.pendingFocus || !this.state[tab] ? this.refresh(tab, ps, key, drag) : this.state[tab];

    const at = this.where(st, st.focus);
    // The minimap can be turned off in Kanso settings; the model above still runs.
    if (!shown("strip.minimap", true, pieces(shared))) return div();
    const widths = pillWidths(st.cols);
    const tone = (ci, ri, pin) => (at?.ci === ci && at?.ri === ri ? "current" : at?.ci === ci || pin || this.shown?.has(ci) ? "seen" : "away");
    const columns = st.cols.map((col, i) => ({ width: widths[i], panes: col.panes.map((_id, r) => tone(i, r, col.pin)) }));
    const n = st.n ?? DEFAULT_N;
    const act = (change) => () => { this.edit(tab, st, change); this.dirty = true; };
    const chords = { fewer: boundChord("kanso-strip.fewer"), more: boundChord("kanso-strip.more"), fit: boundChord("kanso-strip.fit") };
    const hover = Boolean(this.overStepper) || Object.values(this.stepperFocus).some((handle) => handle.is_focused());
    // Past what fits, the extra marks are cut in their own box, never the stepper.
    return statusBar({ middle: stepper({ value: n, hover, columns, chords }) })("strip-map", tokens(t), {
      presses: { minus: act((now) => this.setN(now, n - 1, now.focus)), plus: act((now) => this.setN(now, n + 1, now.focus)) },
      focuses: this.stepperFocus,
      onClick: act((now) => this.fit(now, now.focus)),
      onChange: (i) => act((now) => this.focusOn(now, st.cols[i].panes[0], ps))(),
      onHover: (over, cx) => { if (this.overStepper !== over) { this.overStepper = over; cx.notify(); } },
      onWheel: (ev) => this.wheel(ev, tab, st),
      onRelease: () => { if (shared("strip.drag")) endDrag(); },
    });
  }
}

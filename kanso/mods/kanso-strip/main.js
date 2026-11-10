// Kanso strip, by jlopezlira (https://github.com/jlopezlira/herdr-kanso). Apache-2.0.
// Herdr can't clip a terminal, so the view shows only whole, live panes and slides a column at a time.
// Herdr rules that shape the tree: a layout nests at most 16 levels (columns sit directly in work-body), and Herdr folds empty and single-child containers.
// State per tab in shared "strip.state": { cols: [{ panes, w, pin, hs }], vx, n }; w is a column's share of the view, vx its left edge in view widths, always a column's start.
// The mod's copies (header, edge, ruler, drop card) talk to the controller through shared "strip.req", "strip.intent", "strip.drag" and "strip.drop".

import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex, HoverCard } from "gpui-base";
import { spaces, panes, agents, focused, layout, run, shared, setShared, theme, nextCommand, props, openOverlay, home, exec, notify, window } from "herdr";
import { stateMark, programIcon, givenNames, nameOf, NAME_LABEL, onBattery } from "./marks.js";
import { STRIP_INTENT, isKansoTree, walkLayout, paintLayout, changeLayout } from "./layout.js";
import { tryOr, tryOrAsync } from "./pure.js";
import { rollupState, mergeReadiness, checkSummary, onePerJob, checkState } from "./ghchecks.js";

// Panes the view holds at once (st.n, 1 to 8): a new column takes 1/n of the view.
const N_MAX = 8;
const DEFAULT_N = 2;
const MIN_W = 0.08; // narrowest a column can be dragged, as a share of the view
const W_STEPS = [1 / 4, 1 / 3, 1 / 2, 2 / 3, 1];
const newW = (st) => 1 / (st.n ?? DEFAULT_N);
// The minimap's slot is 180px and its stepper takes about 60: the pills shrink to the rest, and past a mark's least width they are cut in their own box, so the stepper always shows.
const PILLS_PX = 110;
export function pillWidths(cols, budget = PILLS_PX) {
  const raw = cols.map((c) => 6 + (Number(c.w) || 0) * 18);
  const room = budget - cols.length * 2 - Math.max(0, cols.length - 1) * 3;
  const total = raw.reduce((a, b) => a + b, 0);
  const scale = total > room ? Math.max(0, room) / total : 1;
  return raw.map((w) => Math.max(3, scale < 1 ? Math.floor(w * scale) : Math.round(w)));
}
const EPS = 1e-3;
const KEY = "strip.state";
const HEADER_H = 34;
const WHEEL_PX = 600; // trackpad/wheel pixels that slide the view one full width
const EDGE_W = 28; // the tab at an edge that stands for the panes beyond it
const WHEEL_STEP = 0.25; // of a view width of wheel travel moves one column
const MIN_VIEW = 0.2; // pinned columns always leave this much of the view to slide
const COL_MIN = 140; // px: a column can't be dragged narrower
const ROW_MIN = 90; // px: a stacked pane can't be dragged shorter
// Layout writes are throttled: a burst writes its first step at once, then its latest state every WRITE_MS.
const WRITE_MS = 100;
const SETTLE = 250; // ms without the dragged sizes changing before the strip adopts them

const GAP = 6; // the soft gutter between panes, in the frame's tone: no lines
const RADIUS = 8;
// TOOL: a 15px glyph in 5px of padding on each side.
const TOOL = 25;
const TOOL_GAP = 10;
const TOOLS_EASE = { duration: 160, easing: "ease-out" };
const TAB_BLOCK = {
  id: "main", type: "block", background: "chrome",
  content: { tab: "active", pane: {
    header: { content: { mod: "kanso-strip" }, reveal: "always", height: HEADER_H, position: "top" },
    background: "background", border: { width: 0, color: "border" }, focus: { width: 0, color: "border" },
    radius: RADIUS, gap: GAP, lone: false } },
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

// Ruler measurements in logical px, in shared "strip.px": each pane's width by id, the strip's height as "h".
// Each copy of this mod runs on its own, so they meet in shared state.
const PX = "strip.px";
const DRAG_MAX = 12000; // ms a held pane stays held with nobody dropping it (let go over a gutter)

const iconOf = (prog, size, color) => programIcon(prog, size, color) ?? div().size(size);
const zoneOf = (e, fallback = "below") => {
  const w = e.bounds?.width, h = e.bounds?.height, at = e.local_position;
  if (!w || !h || !at) return fallback;
  return at.x < w / 4 ? "before" : at.x > w * 3 / 4 ? "after" : at.y < h / 2 ? "above" : "below";
};
const endDrag = () => { setShared("strip.drop", null); setShared("strip.drag", null); };

const PROMPT_W = 420;
const BADGE_MAX_W = 220;
const folder = (cwd) => {
  if (!cwd) return "";
  const h = home();
  return cwd === h ? "~" : cwd.startsWith(h + "/") ? "~" + cwd.slice(h.length) : cwd;
};

// Blocked on a question before done; from the focused agent, the next in Herdr's order, wrapping round.
// The focused one is never its own next, so pressing again moves on.
export function nextNeedsYou(list, current) {
  const rank = (a) => (a.status === "blocked" ? 0 : a.status === "done" ? 1 : 2);
  const others = list.filter((a) => a.address !== current && rank(a) < 2);
  if (!others.length) return null;
  const best = Math.min(...others.map(rank));
  const pool = others.filter((a) => rank(a) === best);
  const at = list.findIndex((a) => a.address === current);
  return pool.find((a) => list.indexOf(a) > at) ?? pool[0];
}

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

// Open pull request for the header. `hold` is why GitHub would not call it ready; a clean one has none.
export function digestPr(view) {
  if (!view?.number || view.state !== "OPEN") return null;
  const checks = checkSummary(onePerJob(view.statusCheckRollup).map(checkState));
  const gate = mergeReadiness(view, { permission: "WRITE", checks });
  return { number: view.number, state: view.state, checks: checksOf(view.statusCheckRollup), hold: gate.text === "Ready to merge" ? null : gate.text };
}

// `run(cmd, args)` resolves with stdout, or null when the command fails.
export async function readDigest(cwd, run) {
  const git = (...args) => run("git", ["-C", cwd, ...args]);
  if ((await git("rev-parse", "--is-inside-work-tree"))?.trim() !== "true") return null;
  const [status, stat, upstream, branch] = await Promise.all([
    git("status", "--porcelain"), git("diff", "--shortstat", "HEAD"),
    git("rev-list", "--count", "@{upstream}..HEAD"), git("symbolic-ref", "--quiet", "--short", "HEAD")]);
  const files = (status ?? "").split("\n").filter((l) => l.trim()).length;
  const pushed = upstream != null;
  // Without an upstream, ahead of the default branch.
  const aheadOfBase = async () => { const base = await git("rev-list", "--count", "origin/HEAD..HEAD"); return base == null ? 0 : Number(base.trim()) || 0; };
  const ahead = pushed ? Number(upstream.trim()) || 0 : await aheadOfBase();
  const prOf = async () => {
    if (!branch?.trim()) return null;
    const out = await run("gh", ["pr", "view", "--json", PR_FIELDS], cwd);
    return tryOr(() => digestPr(out ? JSON.parse(out) : null));
  };
  const pr = await prOf();
  return { files, ...parseShortstat(stat), ahead, pushed, pr };
}

export function digestTip(d) {
  if (!d) return "";
  const n = (k, one, many) => `${d[k]} ${d[k] === 1 ? one : many}`;
  const parts = [
    d.files ? `${n("files", "changed file", "changed files")} (+${d.add} −${d.del})` : null,
    d.ahead ? `${n("ahead", "commit", "commits")} ${d.pushed ? "not pushed" : "not on the default branch"}` : null,
    d.pr ? `pull request #${d.pr.number}${d.pr.hold ? `, ${d.pr.hold[0].toLowerCase()}${d.pr.hold.slice(1)}` : d.pr.checks ? `, checks ${d.pr.checks}` : ""}` : null,
  ].filter((x) => x !== null);
  return parts.length ? `In its folder now: ${parts.join("; ")}.` : "";
}

const openSend = (p) => openOverlay({ mod: "kanso-send", kind: "dialog", width: 520, props: { pane: p.pane } });
const openArrange = () => openOverlay({ mod: "kanso-arrange", kind: "dialog", width: 480 });
const openSleep = (p) => {
  const space = spaces().find((s) => s.tabs.some((t) => t.id === p.tab));
  if (space) openOverlay({ mod: "kanso-sleep", kind: "dialog", width: 520, props: { sleep: { scope: "agent", space: space.id, tab: p.tab, pane: p.pane } } });
};

export default class Strip extends View {
  init(_props, cx) {
    const p = props() ?? {};
    this.kind = p.edge ? "edge" : p.ruler ? "ruler" : p.drop ? "drop" : p.pane ? "head" : "controller";
    if (this.kind === "head") this.hovered = false;
    if (this.kind !== "controller") return;

    this.state = JSON.parse(JSON.stringify(shared(KEY) ?? {}));
    this.saved = JSON.stringify(this.state);
    this.lastReq = shared("strip.req")?.n ?? null;
    this.usedIntent = shared("strip.intent")?.at ?? null;
    this.pendingFocus = null;
    this.sets = [];
    this.seq = 0; // bumped by whatever changes the model outside render (see render's key)
    cx.timer.every(WRITE_MS / 2, (cx) => { if (this.dirty) { this.dirty = false; this.seq += 1; cx.notify(); } });
    // A drag on one of Herdr's dividers changes the tree without telling us.
    cx.timer.every(150, (cx) => {
      // A pane let go over a gutter is held until the next press or move over a pane; failing those, it ends here.
      const held = shared("strip.drag");
      if (held && Date.now() - held.at > DRAG_MAX) endDrag();
      if (this.adopt()) { this.seq += 1; cx.notify(); }
    });
    this.lastStatus = new Map();
    this.digesting = new Set();
    cx.timer.every(1500, (cx) => this.watchDigests(cx));
    cx.spawn(async (cx) => {
      for (;;) {
        const next = await tryOrAsync(async () => { const c = await nextCommand(); cx.notify(); return { c }; });
        if (!next) break; // a replaced build (hot reload, update) stops here, before acting
        this.command(String(next.c).replace(/^kanso-strip\./, ""));
        this.seq += 1;
        cx.notify();
      }
    });
  }

  renderEdge() {
    const t = theme(), p = props();
    const byId = new Map(panes().map((q) => [q.pane, q]));
    const ids = (p.panes ?? [p.edge]).filter((id) => byId.has(id));
    const left = p.side === "left";
    const chevron = left ? "\u2039" : "\u203a";
    const show = (id) => setShared("strip.req", { op: "focus", pane: id, n: nonce() });
    const given = givenNames();
    const drag = shared("strip.drag");
    const takes = Boolean(drag) && drag.pane !== p.edge; // a held pane can land beyond this edge
    const calm = onBattery(); // on battery the dots hold still (marks.js)
    const dot = (st, size) => st === "working" ? div().size(size).rounded_full().bg(t.working).when(!calm, (d) => d.loop("opacity", { from: 0.35, to: 1, period: 1800 }))
      : st === "blocked" ? div().size(size).rounded_full().bg(t.blocked).when(!calm, (d) => d.loop("opacity", { from: 0.45, to: 1, period: 1600 }))
      : st === "done" ? div().size(size).rounded_full().bg(t.done) : null;
    const MAX_TILES = 8;
    const tile = (id) => {
      const info = byId.get(id), d = dot(info?.status, 7);
      return div().id(`edge-tile-${id}`).relative().size(20).flex_none().rounded(6).bg(t.input)
        .flex().items_center().justify_center()
        .hover((h) => h.bg(t.selected))
        .on_click((_e, cx) => { cx.stop_propagation(); show(id); })
        .child(iconOf(info?.program, 12, t.muted))
        .when(Boolean(d), (el) => el.child(d.absolute().top(-2).right(-2).border(1).border_color(t.chrome)));
    };
    const stack = v_flex().id("edge-stack").items_center().gap(5).py(6).px(4)
      .child(div().h(16).text_size(14).text_color(takes ? t.foreground : t.muted).child(chevron))
      .children(ids.slice(0, MAX_TILES).map(tile))
      .when(ids.length > MAX_TILES, (el) => el.child(div().text_size(10).text_color(t.dim).child(`+${ids.length - MAX_TILES}`)));
    const rowOf = (id) => {
      const info = byId.get(id), d = dot(info?.status, 6);
      return h_flex().id(`edge-row-${id}`).h(26).px(8).gap(8).items_center().rounded(6).cursor_pointer()
        .hover((h) => h.bg(t.hover))
        .on_click((_e, cx) => { cx.stop_propagation(); show(id); })
        .child(iconOf(info?.program, 13, t.muted))
        .child(div().flex_1().min_w(0).truncate().text_size(12.5).text_color(t.foreground).child(nameOf(info, given)))
        .when(Boolean(d), (el) => el.child(d));
    };
    const card = v_flex().w(220).p(6).gap(1).rounded(8).bg(t.chrome).shadow_md()
      .child(div().h(22).px(8).flex().items_center().text_size(11).text_color(t.dim)
        .child(`${ids.length === 1 ? "One pane" : `${ids.length} panes`} beyond the ${left ? "left" : "right"} edge`))
      .children(ids.map(rowOf));
    return v_flex().id("edge").size_full().items_center().justify_center().bg(t.chrome).cursor_pointer()
      .hover((h) => h.bg(takes ? t.accent + "40" : t.hover))
      .when(takes, (el) => el.bg(t.accent + "24").cursor_grabbing())
      .on_mouse_up("left", () => {
        const d = shared("strip.drag");
        if (!d) return;
        if (d.pane !== p.edge) setShared("strip.req", { op: "move", pane: d.pane, to: p.edge, side: left ? "after" : "before", n: nonce() });
        endDrag();
      })
      .on_click(() => show(p.edge))
      .on_scroll_wheel((e) => { const d = wheelDelta(e); if (d) postScroll(d / WHEEL_PX); })
      .child(HoverCard.new(`edge-card-${p.side}`).anchor(left ? "left_center" : "right_center").open_delay(350).close_delay(250)
        .trigger(stack)
        .content(card));
  }

  renderRuler() {
    const what = props().ruler;
    const t = theme();
    // The ruler is a pane's foot, part of its drop card: landing below the pane lights it too.
    const drag = what !== "h" ? shared("strip.drag") : null;
    const takes = Boolean(drag) && drag.pane !== what;
    const drop = takes ? shared("strip.drop") : null;
    // A shared write redraws every mod, so write the last measurement only once the size has rested 120 ms.
    return div().size_full().when(what !== "h", (el) => el.rounded_b(RADIUS).bg(t.background)).on_size_change((sz, cx) => {
      const v = Math.round(what === "h" ? sz.height : sz.width);
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
        .on_mouse_up("left", () => {
          const d = shared("strip.drag");
          if (d && d.pane !== what) setShared("strip.req", { op: "move", pane: d.pane, to: what, side: "below", n: nonce() });
          endDrag();
        }))
      .when(drop?.to === what && drop.side === "below", (el) => el.child(div().size_full().rounded_b(RADIUS).bg(t.accent + "40")));
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
    const label = (info, strong) => v_flex().flex_1().size_full().min_w(0).min_h(0).items_center().justify_center().gap(8)
      .child(iconOf(info?.program, 22, strong ? t.foreground : t.muted))
      .child(div().w_full().px(12).truncate().text_center().text_size(13).when(strong, (el) => el.font_medium())
        .text_color(strong ? t.foreground : t.muted).child(nameOf(info, given)));
    const across = side === "before" || side === "after";
    const first = side === "before" || side === "above";
    const ghost = () => label(held, true).bg(t.accent + "40");
    return div().id(`drop-${id}`).size_full().relative().cursor_grabbing()
      .when(mine, (el) => el.opacity(0.4))
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

  rename(p, shown) {
    openOverlay({ mod: "kanso-prompt", kind: "dialog", width: PROMPT_W, props: {
      title: "Rename terminal", value: shown, hint: "Empty: the name the program gives it",
      label: { terminal: p.terminal, key: NAME_LABEL } } });
  }

  badge(t, text, iconPath, on) {
    return h_flex().flex_shrink(1).min_w(0).max_w(BADGE_MAX_W).gap(4).items_center().text_size(11.5).text_color(on ? t.muted : t.dim)
      .when(Boolean(iconPath), (el) => el.child(svg(iconPath).size(12).flex_none()))
      .child(div().min_w(0).truncate().child(text));
  }

  // In the strip a split records where the new pane goes, and zoom cycles the column's width.
  act(command, args) {
    const pane = props()?.pane;
    if (props()?.strip && command === "pane.split") setShared("strip.intent", { dir: args.direction, from: pane, at: Date.now() });
    if (props()?.strip && command === "pane.zoom") { setShared("strip.req", { op: "width", pane, n: nonce() }); return; }
    run(command, args);
  }

  wheelReq(e) {
    const d = wheelDelta(e);
    if (d) postScroll(d / WHEEL_PX);
  }

  // Opens on the machine the pane's space lives on.
  openWith(p) {
    const space = spaces().find((s) => s.tabs.some((x) => x.id === p.tab));
    openOverlay({ mod: "open-with", kind: "popup", width: 340, props: { folder: p.cwd, machine: space?.machine ?? null } });
  }

  grip(t, pane) {
    const held = shared("strip.drag")?.pane === pane;
    return div().id(`grip-${pane}`).w(18).h_full().flex_none().flex().items_center().justify_center().cursor_grab()
      .tooltip("Hold and drag onto another pane to move this one there")
      .text_color(held ? t.foreground : t.dim)
      .hover((h) => h.text_color(t.foreground))
      .on_mouse_down("left", (e, cx) => { cx.stop_propagation(); setShared("strip.drag", { pane, at: Date.now() }); })
      // A press elsewhere while this pane is still held: it was let go where nothing took it.
      .on_mouse_down_out(() => { const d = shared("strip.drag"); if (d?.pane === pane && Date.now() - d.at > 300) endDrag(); })
      .child(svg("mods/kanso-chrome/icons/grip-vertical.svg").size(14));
  }

  // The header is the top of the drop card: the middle means "above" here, the card below has the zone for "below".
  dragMove(e, pane) {
    const width = e.bounds?.width || this.width || 0;
    if (width) this.width = width;
    const d = shared("strip.drag");
    if (!d || d.pane === pane || !width) return;
    const x = e.local_position.x;
    const side = x < width / 4 ? "before" : x > width * 3 / 4 ? "after" : "above";
    const cur = shared("strip.drop");
    if (cur?.to !== pane || cur.side !== side) setShared("strip.drop", { to: pane, side });
  }

  button(t, id, icon, command, args) {
    return div().id(id).p(5).rounded(6).text_color(t.muted)
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_click((_e, cx) => {
        cx.stop_propagation();
        if (typeof command === "function") command();
        else this.act(command, args);
      })
      .child(svg(`mods/kanso-chrome/icons/${icon}.svg`).size(15));
  }

  digestBadge(t, pane, d, on) {
    const tone = on ? t.muted : t.dim;
    const held = d.pr?.hold, bad = held && /failing|Conflicts|Changes requested/.test(held);
    const ci = held ? (bad ? t.blocked : t.working) : { failing: t.blocked, running: t.working, passing: t.done }[d.pr?.checks] ?? null;
    return h_flex().id(`digest-${pane}`).flex_shrink(1).min_w(0).gap(8).items_center().text_size(11.5).text_color(tone).tooltip(digestTip(d))
      .when(d.files > 0, (el) => el.child(h_flex().flex_none().gap(4)
        .child(`${d.files} ${d.files === 1 ? "file" : "files"}`)
        .when(d.add > 0 || d.del > 0, (el) => el.child(div().text_color(t.dim).child(`+${d.add} −${d.del}`)))))
      .when(d.ahead > 0, (el) => el.child(div().flex_none().child(`${d.ahead} ${d.ahead === 1 ? "commit" : "commits"}`)))
      .when(d.pr?.state === "OPEN", (el) => el.child(h_flex().flex_none().gap(4).items_center()
        .when(Boolean(ci), (el) => el.child(div().size(6).rounded_full().bg(ci)))
        .child(`#${d.pr.number}`)));
  }

  renderHead() {
    const t = theme();
    const all = panes(); // read once: each read copies every pane
    const p = this.me(all);
    if (!p) return div();
    const name = nameOf(p, givenNames());
    const pic = programIcon(p.program, 15, t.muted);
    const st = p.status;
    const pane = p.pane;
    // In the strip the selected pane is the one the strip remembers, so it stays marked while a side panel has the keyboard.
    const strip = Boolean(props()?.strip);
    const remembered = strip ? shared(KEY)?.[p.tab]?.focus : null;
    const on = remembered ? remembered === pane : p.focused || (strip && p.terminal && focused()?.terminal === p.terminal);
    const drag = strip ? shared("strip.drag") : null;
    const drop = drag && drag.pane !== pane ? shared("strip.drop") : null;
    const side = drop?.to === pane ? drop.side : null;
    const ink = on || st === "blocked";
    const cols = strip ? shared(KEY)?.[p.tab]?.cols ?? [] : [];
    const col = cols.findIndex((c) => c.panes?.includes(pane));
    const pinned = Boolean(cols[col]?.pin);
    const pin = () => setShared("strip.req", { op: "pin", pane, n: nonce() });
    const d = st !== "working" ? shared(DIGEST)?.[pane] : null;
    const digest = d && (d.files > 0 || d.ahead > 0 || d.pr?.state === "OPEN") ? d : null;
    const canSend = Boolean(p.terminal) && all.some((q) => q.pane !== pane && q.terminal && (q.program?.agent || q.status));
    return h_flex().id(`pane-head-${pane}`).size_full().pl(14).pr(6).gap(10).items_center().text_size(12.5).relative()
      .rounded_t(RADIUS)
      .when(pinned && st !== "blocked", (el) => el.bg(t.accent + (on ? "40" : "24")))
      .when(st === "blocked", (el) => el.bg(t.blocked + "66")
        .child(div().absolute().left_0().bottom_0().w_full().h(2).bg(t.blocked).when(!onBattery(), (d) => d.loop("opacity", { from: 0.45, to: 1, period: 1600 }))))
      .when(on && !pinned && st !== "blocked", (el) => el.bg(t.selected))
      .when(Boolean(side), (el) => el.child(h_flex().absolute().inset_0().rounded_t(RADIUS)
        .child(div().flex_1().h_full().when(side === "before" || side === "above", (d) => d.bg(t.accent + "40").rounded_tl(RADIUS).when(side === "above", (d) => d.rounded_tr(RADIUS))))
        .child(div().flex_1().h_full().when(side === "after" || side === "above", (d) => d.bg(t.accent + "40").rounded_tr(RADIUS)))))
      .when(Boolean(drag) && drag.pane === pane, (el) => el.opacity(0.4))
      .when(Boolean(drag), (el) => el.cursor_grabbing())
      .on_hover((hovered, cx) => {
        this.hovered = hovered;
        if (!hovered && shared("strip.drop")?.to === pane && shared("strip.drop")?.side !== "below") setShared("strip.drop", null);
        cx.notify();
      })
      .on_size_change((sz) => { this.width = sz.width; })
      .on_mouse_down("left", (e) => {
        if (e.click_count === 2 && p.terminal) { this.rename(p, name); return; }
        if (!strip) return;
        if (e.modifiers.control && !pinned) setShared("strip.drag", { pane, at: Date.now() });
        else if (shared("strip.drag")) endDrag();
      })
      .when(strip, (el) => el
        .on_scroll_wheel((e) => this.wheelReq(e))
        .on_mouse_move((e) => this.dragMove(e, pane))
        .on_mouse_up("left", () => {
          const d = shared("strip.drag");
          if (!d) return;
          if (d.pane !== pane) setShared("strip.req", { op: "move", pane: d.pane, to: pane, side: side ?? "above", n: nonce() });
          endDrag();
        }))
      .on_click(() => run("pane.focus", strip && p.terminal ? { terminal: p.terminal } : { pane }))
      .when(Boolean(pic), (el) => el.child(pic.opacity(ink ? 1 : 0.75)))
      .child(div().flex_none().truncate().max_w(260).text_size(12.5).when(ink, (el) => el.font_medium()).text_color(ink ? t.foreground : t.muted).child(name))
      .when(Boolean(p.cwd), (el) => el.child(this.badge(t, folder(p.cwd), null, ink)))
      .when(Boolean(p.branch), (el) => el.child(this.badge(t, p.branch, "mods/kanso-chrome/icons/branch.svg", ink)))
      .when(Boolean(digest), (el) => el.child(this.digestBadge(t, pane, digest, ink)))
      .when(pinned && !this.hovered, (el) => el.child(svg("mods/kanso-chrome/icons/pin.svg").size(12).flex_none().text_color(t.dim)))
      .child(div().flex_1())
      .child(this.tools(t, p, { strip, pinned, canSend, pin, shown: this.hovered && !drag }))
      .when(st === "working", (el) => el.child(stateMark(t, "working")))
      .when(st === "blocked", (el) => el.child(h_flex().flex_none().gap(6).items_center().text_size(11.5).font_medium().text_color(t.foreground)
        .child(stateMark(t, "blocked")).child("Needs you")))
      .when(st === "done", (el) => el.child(stateMark(t, "done")))
      .when(strip && !pinned, (el) => el.child(this.grip(t, pane)));
  }

  // The tools group is always in the row, 0 wide and clear until hovered, so it eases open natively and the state mark never moves.
  tools(t, p, { strip, pinned, canSend, pin, shown }) {
    const pane = p.pane;
    const list = [
      strip ? this.button(t, `ph-p-${pane}`, "pin", pin).when(pinned, (b) => b.text_color(t.foreground)) : null,
      p.terminal && p.tab && agents().some((x) => x.address === p.terminal) ? this.button(t, `ph-zz-${pane}`, "moon", () => openSleep(p)).tooltip("Sleep this agent") : null,
      canSend ? this.button(t, `ph-s-${pane}`, "send", () => openSend(p)).tooltip("Send to another agent") : null,
      p.cwd ? this.button(t, `ph-o-${pane}`, "open-with", () => this.openWith(p)) : null,
      this.button(t, `ph-r-${pane}`, "split-right", "pane.split", { direction: "right", pane }),
      this.button(t, `ph-d-${pane}`, "split-down", "pane.split", { direction: "down", pane }),
      this.button(t, `ph-z-${pane}`, p.zoomed ? "unzoom" : "zoom", "pane.zoom", { pane }),
      this.button(t, `ph-x-${pane}`, "close", "pane.close", { pane }),
    ].filter(Boolean);
    const wide = list.length * TOOL + (list.length - 1) * TOOL_GAP;
    return h_flex().id(`ph-tools-${pane}`).flex_none().h_full().items_center().gap(TOOL_GAP).overflow_hidden()
      .w(shown ? wide : 0).opacity(shown ? 1 : 0)
      .transition("width", TOOLS_EASE).transition("opacity", TOOLS_EASE)
      // The row puts its gap on both sides of the group; closed, one of them is taken back.
      .ml(-TOOL_GAP)
      .children(list);
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
      ? { ...st, cols: [...st.cols, ...fresh.map((p) => ({ panes: [p.pane], w: fresh.length === 1 ? 1 : newW(st) }))] }
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
    return { ...st, cols: st.cols.toSpliced(dir === "left" ? at.ci : at.ci + 1, 0, { panes: [id], w: newW(st) }) };
  }

  // `tx` is kept by older builds' state; it goes here.
  clampView(st) {
    const most = Math.min(st.vx ?? 0, this.lastStart(st)) + EPS;
    const { tx: _tx, ...rest } = st;
    return { ...rest, vx: this.row(st).findLast((r) => r.s <= most)?.s ?? 0 };
  }
  lastStart(st) {
    const row = this.row(st), vw = this.viewW(st), total = this.total(st);
    return row.find((r) => total - r.s <= vw + EPS)?.s ?? 0;
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


  // A digest is read once when an agent stops working, and goes when it starts again or its pane does.
  watchDigests(cx) {
    const store = shared(DIGEST) ?? {};
    const all = panes();
    const working = all.filter((p) => p.terminal && p.cwd && p.status).flatMap((p) => {
      const was = this.lastStatus.get(p.pane);
      this.lastStatus.set(p.pane, p.status);
      if (p.status === "working") return p.pane in store ? [p.pane] : [];
      if ((was === "working" || (was === undefined && !(p.pane in store))) && !this.digesting.has(p.pane)) this.digest(p, cx);
      return [];
    });
    const live = new Set(all.map((p) => p.pane));
    const gone = new Set([...working, ...Object.keys(store).filter((id) => !live.has(id))]);
    for (const id of [...this.lastStatus.keys()]) if (!live.has(id)) this.lastStatus.delete(id);
    if (gone.size) setShared(DIGEST, Object.fromEntries(Object.entries(store).filter(([id]) => !gone.has(id))));
  }

  digest(p, cx) {
    this.digesting.add(p.pane);
    const on = spaces().find((s) => s.tabs.some((x) => x.id === p.tab))?.machine ?? null;
    const run = (cmd, args, cwd) => exec(cmd, args, { cwd, on }).then((r) => (r.code === 0 ? r.stdout : null)).catch(() => null);
    cx.spawn(async () => {
      try {
        const d = await readDigest(p.cwd, run);
        // It went back to work meanwhile: what it left is no longer the news.
        if (panes().find((q) => q.pane === p.pane)?.status === "working") return;
        setShared(DIGEST, { ...(shared(DIGEST) ?? {}), [p.pane]: d ? { ...d, at: Date.now() } : null });
      } finally { this.digesting.delete(p.pane); }
    });
  }

  // agent.focus brings the agent's space, tab and pane in; the strip then slides to it.
  goNeedsYou() {
    const list = agents();
    const current = list.find((a) => a.focused)?.address ?? focused()?.agent ?? focused()?.terminal ?? null;
    const a = nextNeedsYou(list, current);
    if (a) run("agent.focus", { terminal: a.address });
    else notify({ title: "No agent needs you", level: "info", timeout: 1800 });
  }

  openFind() {
    const term = focused()?.terminal;
    if (!term || String(term).includes("/")) { run("terminal.search"); return; }
    openOverlay({ mod: "kanso-panel", kind: "dialog", modal: true, width: 760, props: { panel: "find", terminal: term } });
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
    if (name === "next-needs-you") { this.goNeedsYou(); return; }
    if (name === "send") { const p = this.focusedPane(); if (p?.terminal) openSend(p); return; }
    if (name === "arrange") { openArrange(); return; }
    if (name === "find") { this.openFind(); return; }
    const tab = this.tab();
    const st = tab && this.state[tab];
    if (!st) return;
    const next = this.commandOn(st, name, panes().filter((p) => p.tab === tab));
    if (next !== st) this.commit(tab, next);
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
    const cols = st.cols.map(({ hs: _hs, ...c }) => (c.pin ? c : { ...c, w: 1 / per }));
    const even = this.clampView({ ...st, n: per, cols });
    return keep ? this.reveal(even, keep) : even;
  }

  fit(st, keep) { return this.setN(st, st.n ?? DEFAULT_N, keep); }

  // A divider drag leaves px sizes on the nodes it moved; once they stay put for SETTLE ms they are read back as shares, so the next tree the strip writes keeps what was dragged.
  sizesOf(nodes) {
    return Object.fromEntries(nodes.filter((n) => this.isCol(n)).flatMap((n) => [
      [n.id, n.size ?? null],
      ...(String(n.id).startsWith("strip-col-") ? (n.children ?? []).map((c) => [c.id, c.size ?? null]) : []),
    ]));
  }
  isCol(n) { const id = String(n.id); return id.startsWith("strip-") && !id.startsWith("strip-edge") && !id.startsWith("strip-ruler"); }

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
    const H = px.h;
    if (!H || inTree.some((c) => !width(c))) return false;
    const span = inTree.reduce((s, c) => s + width(c), 0) || 1;
    const sumW = inTree.reduce((s, c) => s + c.w, 0);
    const pxOf = (nodes, total, gap) => {
      const fixed = nodes.reduce((s, n) => s + (n.size?.px ?? 0), 0) + gap * (nodes.length - 1);
      const wsum = nodes.reduce((s, n) => s + (n.size?.px ? 0 : (n.size?.weight ?? 1)), 0) || 1;
      const free = Math.max(0, total - fixed);
      return new Map(nodes.map((n) => [n.id, n.size?.px ?? free * (n.size?.weight ?? 1) / wsum]));
    };
    const fit = (c) => {
      const n = colNodes.find((k) => k.id === nodeId(c));
      const w = clamp(width(c) / span * sumW, MIN_W, 1);
      const wider = Math.abs(w - c.w) > EPS;
      const sized = wider ? { ...c, w } : c;
      if (!(c.panes.length > 1 && n.children)) return { col: sized, moved: wider };
      const hs = pxOf(n.children, H, GAP);
      const tot = c.panes.reduce((s, id) => s + (hs.get(`strip-${id}`) ?? 0), 0) || 1;
      const next = Object.fromEntries(c.panes.map((id) => [id, (hs.get(`strip-${id}`) ?? 0) / tot]));
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
    const header = (id) => ({ id: `head-${id}`, type: "block", size: { px: HEADER_H }, content: { mod: "kanso-strip", props: { pane: id, terminal: byId.get(id).terminal, strip: true } } });
    const body = (id) => ({ id: `term-${id}`, type: "block", content: sorting ? { mod: "kanso-strip", props: { drop: id } } : { terminal: byId.get(id).terminal } });
    // A terminal paints square corners, so the ruler doubles as a RADIUS-tall foot drawing the slab's rounded bottom.
    const ruler = (what) => { const px = what === "h" ? 1 : RADIUS; return { id: `strip-ruler-${what}`, type: "block", size: { px }, min: px, max: px, background: "chrome",
      content: { mod: "kanso-strip", props: { ruler: what } } }; };
    // Every pane keeps a 1px border, clear except the selected one's accent, so moving the selection never shifts a terminal.
    const t = theme();
    const sel = ps.length > 1 && !sorting ? st.focus : null;
    const edgeOf = (id) => ({ width: 1, color: id === sel ? t.accent + "8c" : t.background + "00" });
    const live = (id, size, min) => ({ id: `strip-${id}`, type: "column", size, min, background: "background", radius: RADIUS,
      border: edgeOf(id), children: [header(id), body(id), ruler(id)] });
    const share = (c, id) => (c.hs?.[id] ?? 1) / c.panes.reduce((s, k) => s + (c.hs?.[k] ?? 1), 0);
    const whole = (c) => c.panes.length === 1 ? live(c.panes[0], { weight: weight(c.w) }, COL_MIN)
      : { id: `strip-col-${c.panes[0]}`, type: "column", gap: GAP, background: "chrome", min: COL_MIN, size: { weight: weight(c.w) },
        children: c.panes.map((id) => live(id, { weight: weight(share(c, id)) }, ROW_MIN)) };
    const edge = (ci, side, beyond) => ({ id: `strip-edge-${side}`, type: "block", size: { px: EDGE_W }, min: EDGE_W, max: EDGE_W,
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
    // The height ruler stands at the start: at the end, Herdr's divider pinned the side panel's border (it cannot move a fixed node).
    return [ruler("h"), ...pinned("left"), ...out, ...pinned("right")];
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
      const kept = Object.fromEntries(Object.entries(px).filter(([k]) => k === "h" || live.has(k)));
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

  render() {
    if (this.kind === "edge") return this.renderEdge();
    if (this.kind === "ruler") return this.renderRuler();
    if (this.kind === "drop") return this.renderDrop();
    if (this.kind === "head") return this.renderHead();
    const t = theme();
    if (this.halted && Date.now() - this.halted > 10000) { this.halted = 0; this.sets = []; this.applied = null; }
    if (this.halted) return h_flex().size_full().justify_center().items_center().text_size(11).text_color(t.blocked).child("Strip paused");

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
    const widths = pillWidths(st.cols);
    const pills = st.cols.map((c, i) => {
      const tone = at?.ci === i ? t.foreground : c.pin || this.shown?.has(i) ? t.muted : t.input;
      const w = widths[i], k = c.panes.length;
      return v_flex().id(`strip-mark-${i}`).h(14).px(1).gap(1).flex_none().justify_center().cursor_pointer()
        .on_click(() => { this.edit(tab, st, (now) => this.focusOn(now, c.panes[0], ps)); this.dirty = true; })
        .children(c.panes.map((id, r) => div().id(`strip-cell-${id}`).w(w).h(k > 1 ? 2 : 4).rounded_full()
          .bg(at?.ci === i && at?.ri !== r ? t.muted : tone)));
    });
    // The minimap can be turned off in Kanso settings; the model above still runs.
    if ((shared("kanso.hidden") ?? []).includes?.("strip.minimap")) return div();
    const n = st.n ?? DEFAULT_N;
    const tiny = (id, label, tip, action) => div().id(id).size(16).flex_none().flex().items_center().justify_center().rounded(6)
      .text_size(11).text_color(t.dim).cursor_pointer().tooltip(tip)
      .hover((h) => h.bg(t.foreground + "12").text_color(t.foreground))
      .on_click(() => { action(); this.dirty = true; })
      .child(label);
    return h_flex().id("strip-map").size_full().gap(3).justify_center().items_center()
      .on_mouse_up("left", () => { if (shared("strip.drag")) endDrag(); })
      .on_scroll_wheel((ev) => this.wheel(ev, tab, st))
      // Past what fits, the extra marks are cut here, never the stepper.
      .child(h_flex().id("strip-pills").flex_shrink(1).min_w(0).max_w(PILLS_PX).overflow_hidden().gap(3).items_center().children(pills))
      .child(div().w(8).flex_none())
      .child(tiny("strip-fewer", "\u2212", "Fewer panes per view", () => this.edit(tab, st, (now) => this.setN(now, n - 1, now.focus))))
      .child(div().id("strip-n").flex_none().text_size(11).text_color(t.muted).tooltip(`${n} per view · click to even out`).cursor_pointer()
        .on_click(() => { this.edit(tab, st, (now) => this.fit(now, now.focus)); this.dirty = true; }).child(String(n)))
      .child(tiny("strip-more", "+", "More panes per view", () => this.edit(tab, st, (now) => this.setN(now, n + 1, now.focus))));
  }
}

import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { run, theme, focused, agents, terminals, panes, spaces, window, shared, setShared } from "herdr";
import { G, T, PR, tokens } from "./ui.js";
import { iconButton } from "./ui-button.js";
import { row } from "./ui-row.js";
import { section } from "./ui-section.js";
import { markdown } from "./ui-markdown.js";
import { stateBlock } from "./ui-state.js";
import { emptyState } from "./kit.js";
import { scrollPage, pageHeader, refreshTool, listBones, backRow } from "./ui-page.js";
import { serviceOn, REMOTE_TIMEOUT } from "./platform-host.js";
import { stateWithin, LATE } from "./panel-state.js";
import { transcriptApi } from "./platform-transcripts.js";
import { machineOf } from "./remote-file.js";
import { ticking } from "./pure.js";
import { shownName } from "./marks.js";
import { parseSlice, SLICE_BUDGET, LINE_MAX } from "./find.js";
import { kindOf, agentHint } from "./conversation-at.js";
import { locateOn } from "./conversation-on.js";
import { freshTimeline, applyTimeline, factsOf, detailOf, firstSentence, oneLine, shortPath } from "./timeline-model.js";

const TICK_MS = 1000;
const WORKING_MS = { here: 3000, away: 6000 };
const PASSES = 64;
const KEPT = "kanso.timeline";
const NONE = Object.freeze({ kind: null, file: null });
const LOST = Object.freeze({ kind: null, file: null, lost: true });
const DOT = " \u{b7} ";

const agentOf = (address) => (address ? agents().find((a) => a.address === address) ?? null : null);
const pulse = (address) => { const a = agentOf(address); return a ? `${a.status}:${a.seq}` : ""; };
const readable = (address) => Boolean(kindOf(agentOf(address)?.program?.key ?? "", agentHint(agentOf(address))));

async function sliceOf(on, file, from) {
  const api = await serviceOn(transcriptApi, on);
  const r = await Promise.resolve(api.slice(file, from, SLICE_BUDGET, LINE_MAX)).catch(() => null);
  if (r?.code === 2) return { missing: true };
  return r?.code === 0 && typeof r.stdout === "string" ? parseSlice(r.stdout) : null;
}

const locate = (address) => locateOn(machineOf(address), address, agentHint(agentOf(address)));

export class Timeline {
  constructor(db) { this.db = db; }

  init(cx) {
    this.pinned = agentOf(shared(KEPT)?.pinned) ? shared(KEPT).pinned : null;
    this.follow = null;
    this.gen = 0;
    this.reading = null;
    this.reset();
    this.handle = cx.focus_handle();
    ticking(cx, TICK_MS, (cx) => this.tick(cx));
  }

  reset() {
    this.where = NONE;
    this.state = freshTimeline();
    this.located = false;
    this.failed = false;
    this.beat = "";
    this.readAt = 0;
    this.open = null;
    this.at = 0;
    this.keyed = false;
    this.again = false;
  }

  keep() { setShared(KEPT, { pinned: this.pinned }); }

  target() {
    if (this.pinned) return this.pinned;
    const at = focused();
    const now = [at?.terminal, at?.agent].find((address) => agentOf(address)) ?? null;
    if (now) return now;
    if (at?.terminal) return null;
    if (agentOf(this.follow)) return this.follow;
    const tab = at?.tab ?? spaces().find((s) => s.active)?.tabs?.find((t) => t.active)?.id;
    return agents().find((a) => a.focused)?.address ?? agents().find((a) => a.tab === tab)?.address ?? null;
  }

  tick(cx) {
    if (this.pinned && !agentOf(this.pinned)) { this.pinned = null; this.keep(); }
    const next = this.target();
    if (next !== this.follow) { this.switchTo(next, cx); return; }
    if (!next || window()?.active === false) return;
    if (this.again && this.reading == null) { this.again = false; this.grow(cx); return; }
    const beat = pulse(next);
    if (beat !== this.beat) { this.beat = beat; this.relocate(cx); return; }
    if (!this.working()) return;
    const every = machineOf(next) ? WORKING_MS.away : WORKING_MS.here;
    if (Date.now() - this.readAt >= every) this.grow(cx);
    cx.notify();
  }

  switchTo(address, cx) {
    this.gen += 1;
    this.follow = address;
    this.reset();
    this.beat = pulse(address);
    cx.notify();
    if (address) this.relocate(cx);
  }

  relocate(cx) {
    const gen = this.gen, address = this.follow;
    if (!address || !readable(address)) { this.located = true; cx.notify(); return; }
    cx.spawn(async (cx) => {
      const got = await stateWithin(locate(address).catch(() => LOST), cx.timer, REMOTE_TIMEOUT);
      const where = got === LATE ? LOST : got;
      if (gen !== this.gen) return;
      if (where.file !== this.where.file) { this.restart(); this.at = 0; }
      this.where = where;
      this.located = true;
      cx.notify();
      if (where.file) await this.catchUp(cx);
    });
  }

  working() {
    const last = this.state.prompts.at(-1);
    return agentOf(this.follow)?.status === "working" && Boolean(last) && last.end == null;
  }

  async step(gen) {
    const slice = await sliceOf(machineOf(this.follow), this.where.file, this.state.from);
    if (gen !== this.gen) return "moved";
    this.readAt = Date.now();
    if (!slice) { this.failed = this.state.prompts.length === 0; return "failed"; }
    if (slice.missing) { this.failed = false; return "done"; }
    const applied = applyTimeline(this.state, slice);
    this.state = applied.state;
    this.failed = false;
    if (applied.reset) return "more";
    return slice.end >= slice.size || slice.body === "" ? "done" : "more";
  }

  async catchUp(cx) {
    const gen = this.gen;
    if (!this.where.file) return;
    if (this.reading === gen) { this.again = true; return; }
    this.reading = gen;
    try {
      const pass = async (left) => {
        if (left <= 0 || gen !== this.gen) return;
        if (window()?.active === false && this.state.size > 0) { this.again = true; return; }
        const got = await this.step(gen);
        cx.notify();
        if (got === "more") await pass(left - 1);
      };
      await pass(PASSES);
    } finally {
      if (this.reading === gen) this.reading = null;
      cx.notify();
    }
    if (this.again && gen === this.gen && window()?.active !== false) { this.again = false; await this.catchUp(cx); }
  }

  grow(cx) {
    if (!this.where.file) return;
    if (this.reading === this.gen) { this.again = true; return; }
    cx.spawn(async (cx) => this.catchUp(cx));
  }

  restart() {
    this.gen += 1;
    this.state = freshTimeline();
    this.open = null;
  }

  refresh(cx) {
    this.restart();
    this.failed = false;
    this.relocate(cx);
  }

  pin(cx) {
    this.pinned = this.pinned ? null : this.follow;
    this.keep();
    cx.notify();
  }

  list() { return this.state.prompts.toReversed(); }

  choose(i, cx) {
    this.at = i;
    this.open = this.list()[i]?.n ?? null;
    this.handle.focus();
    cx.notify();
  }

  key(e, cx) {
    const n = this.list().length;
    const k = e?.key;
    if (this.open != null) {
      if (k !== "escape") return;
      this.open = null;
    } else if (k === "down" && n) this.at = Math.min(n - 1, this.at + 1);
    else if (k === "up" && n) this.at = Math.max(0, this.at - 1);
    else if (k === "enter" && n) this.open = this.list()[this.at]?.n ?? null;
    else return;
    this.keyed = true;
    cx.stop_propagation();
    cx.notify();
  }

  folder() { return terminals().find((t) => t.address === this.follow)?.cwd ?? ""; }

  promptRow(p, i, c, now) {
    const working = i === 0 && this.working();
    const facts = factsOf(p, { working, now });
    const reply = firstSentence(p.reply);
    const told = working ? facts : facts.slice(1);
    return row(`timeline-${p.n}`, c, {
      name: oneLine(p.text), meta: working ? null : facts[0], mark: working ? "working" : "none",
      second: reply ? [reply, ...told] : told, selected: this.keyed && i === this.at,
      onClick: (cx) => this.choose(i, cx),
    });
  }

  opened(p, c) {
    const folder = this.folder();
    const back = (cx) => { this.open = null; this.handle.focus(); cx.notify(); };
    return v_flex().w_full().gap(G.lg)
      .child(backRow("timeline-back", c, detailOf(p), back))
      .child(markdown(`timeline-prompt-${p.n}`, c, { source: p.text }))
      .when(p.also.length > 0, (el) => el.child(v_flex().w_full().gap(G.sm).child(section(c, "While it worked", String(p.also.length)))
        .children(p.also.map((m, i) => markdown(`timeline-also-${p.n}-${i}`, c, { source: m.text })))))
      .when(Boolean(p.reply), (el) => el.child(v_flex().w_full().gap(G.sm).child(section(c, "Reply")).child(markdown(`timeline-reply-${p.n}`, c, { source: p.reply }))))
      .when(p.files.length > 0, (el) => el.child(v_flex().w_full().child(section(c, "Files changed", String(p.files.length)))
        .children(p.files.map((f, i) => row(`timeline-file-${p.n}-${i}`, c, { icon: "file", name: shortPath(f, folder) })))));
  }

  body(c, now) {
    if (!this.follow) return emptyState({ text: "No conversation in this pane", action: "New conversation" })("timeline-none", c, { onClick: () => run("kanso-spaces.start") });
    if (!readable(this.follow)) return emptyState({ text: "Timeline reads Claude Code and Codex conversations" })("timeline-unread", c);
    if (!this.located || (this.where.file && this.reading != null && !this.state.prompts.length)) return this.skeleton(c);
    if (this.where.unavailable) return stateBlock("timeline-unavailable", c, { text: "Can't find this conversation on this computer", source: String(this.where.unavailable) });
    if (this.failed || this.where.lost) return stateBlock("timeline-failed", c, { text: "Can't read this conversation", fix: "Refresh", onClick: (cx) => this.refresh(cx) });
    const list = this.list();
    if (!list.length) return emptyState({ text: "Nothing asked in this conversation yet" })("timeline-empty", c);
    const open = this.open == null ? null : list.find((p) => p.n === this.open);
    if (open) return this.opened(open, c);
    return v_flex().w_full().children(list.map((p, i) => this.promptRow(p, i, c, now)));
  }

  skeleton(c) { return listBones(c); }

  render(cx) {
    const c = tokens(theme());
    const a = agentOf(this.follow);
    const named = a ? shownName(this.follow, panes().find((p) => p.terminal === this.follow)) : "";
    const count = this.state.count;
    const meta = [named, machineOf(this.follow), count ? `${count} ${count === 1 ? "prompt" : "prompts"}` : null].filter(Boolean).join(DOT);
    const title = h_flex().min_w(0).gap(G.sm).items_center()
      .child(div().flex_none().text_size(PR.title).text_color(c.text).child("Timeline"))
      .child(div().min_w(0).truncate().text_size(T.body).text_color(c.dim).child(meta));
    const tools = [
      this.follow ? iconButton("timeline-pin", "pin", this.pinned ? "Follow the pane in focus" : "Stay on this agent", (cx) => this.pin(cx), c, { active: Boolean(this.pinned) }) : null,
      refreshTool("timeline-refresh", c, { busy: this.reading != null, enabled: Boolean(this.follow), working: "Reading the conversation" }, (cx) => this.refresh(cx)),
    ];
    return scrollPage.call(this, "kanso-timeline", c, true, (column) => column
      .child(pageHeader(title, tools))
      .child(v_flex().w_full().track_focus(this.handle).on_key_down((e, cx) => this.key(e, cx)).child(this.body(c, Date.now()))));
  }
}

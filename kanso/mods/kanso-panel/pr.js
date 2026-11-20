import { location, key, tilde, said } from "./lib.js";
import { pageSize, pageBones, listBones } from "./ui-page.js";
import { drawHero, drawEmpty, footOf, listedRow, prRow, heroPieces } from "./pr-view.js";
import { localService } from "./platform-host.js";
import { openApi } from "./platform-open.js";
// Kanso's pull request panel, by jlopezlira (https://github.com/jlopezlira/herdr-kanso). Apache-2.0.
// One of the kanso-panel mod's panels: it exists only while shown.
import { div, svg } from "gpui-kit";
import { v_flex, h_flex, Popover, TextView, ScrollHandle } from "gpui-base";
import { run, theme, setShared, shared, window, layout, focused, panes, terminals, machines, props } from "herdr";
import { walkLayout } from "./layout.js";
import { R, G, T, PR, TINT, alpha, tokens } from "./ui.js";
import { Armed, button, quietLink, iconButton } from "./ui-button.js";
import { TextField } from "./ui-field.js";
import { menu } from "./ui-menu.js";
import { failureBlock, skeletonOf, diffText, facts, code, tooltip, row as kitRow } from "./kit.js";
import { dot } from "./ui-dot.js";
import { caption } from "./ui-caption.js";
import { section } from "./ui-section.js";
import { segmented } from "./ui-tab.js";
import { aliasText, machineTitle, tryOrAsync } from "./pure.js";
import { STATES, checkState, onePerJob, checkSummary, runIdOf, listHold, mergeReadiness } from "./ghchecks.js";
import { deliver, classify, reachable } from "./deliver.js";
import { nameOf, givenNames } from "./marks.js";
import { verdictOf, failedLog, sendText, sendStep } from "./pr-verdict.js";
import { readyProviders } from "./pr-providers.js";
import { inboxLabel, isNew, limitLine, recordPrFacts } from "./pr-inbox.js";
import { blockFacts, boardOf, failingMeta, isOpen, scopeLine, toggled } from "./pr-board.js";
import { prMemory } from "./panel-state.js";
import { TICK_MS, ageOf, authFresh, pollFacing, pollTick, readDue } from "./pr-poll.js";
import { FolderSession, DONE_LIMIT, keepsFacts, repoOf } from "./pr-session.js";

const ICON = "mods/kanso-chrome/icons/";
const INBOX_TONES = { Draft: "dim", "Changes requested": "blocked", "Review required": "working", Approved: "done" };
const MAX_DIFF = 400;
const FILE_ROWS = 8;

// A pull request's body as Markdown to show: no template comments, no Windows line ends.
export function cleanBody(text) {
  return String(text ?? "").replace(/\r\n?/g, "\n").replace(/<!-{2}[\s\S]*?(-{2}>|$)/g, "").replace(/\n{3,}/g, "\n\n").trim();
}
export const longBody = (text) => text.split("\n").length > 6 || text.length > 480;

const ago = (iso) => ageOf(iso, Date.now());
const labelColor = (hex) => { const h = String(hex ?? "").replace(/^#/, ""); return /^[0-9a-fA-F]{6}$/.test(h) ? `#${h}` : null; };
// A picker shows this many people or labels, then scrolls; while it reads, four loading items.
const PICKER_ROWS = 7;
const PICKER_BONES = Object.freeze(Array.from({ length: 4 }, () => ({ loading: true })));
const openUrl = (url) => localService(openApi).open(url).catch(() => { });

// One check to show, as either kind GitHub reports: a check run or a commit status.
// Its state, counts and what they say together come from ghchecks.js, which the pane strip reads too.
function checkOf(c) {
  const state = checkState(c);
  const workflowName = c.workflowName || "";
  const status = c.__typename === "StatusContext";
  return {
    name: status ? c.context : c.name,
    url: status ? c.targetUrl : c.detailsUrl,
    state,
    workflow: !status && workflowName && workflowName !== c.name ? workflowName : "",
    runId: status ? null : runIdOf(c),
    startedAt: c.startedAt ?? null,
    completedAt: c.completedAt ?? null,
    workflowName,
  };
}
const checksIn = (rollup) => onePerJob(rollup).map(checkOf);
const summaryOf = (checks) => checkSummary(checks.map((x) => x.state));
// Each state in the panel's words: a row's label and color, and the verb its count takes.
const CHECK_WORDS = {
  fail: { label: "failed", color: "red", verb: "failing" },
  pending: { label: "running", color: "yellow", verb: "running" },
  unknown: { label: "unknown", color: "yellow", verb: "unknown" },
  skipped: { label: "skipped", color: "dim", verb: "passed" },
  pass: { label: "passed", color: "dim", verb: "passed" },
};
// The counts by verb, worst first: "1 failing · 3 passed" (skipped ones count as passed).
const checksNote = (sum) => [...new Set(STATES.map((s) => CHECK_WORDS[s].verb))]
  .map((verb) => ({ verb, n: STATES.filter((s) => CHECK_WORDS[s].verb === verb).reduce((k, s) => k + sum[s], 0) }))
  .filter(({ n }) => n > 0).map(({ verb, n }) => `${n} ${verb}`).join(" · ");

const PLACED = { draft: "hero", behind: "hero", conflicts: "hero", review: "people", threads: "threads", checks: "checks" };

export function sectionIndex(section, ids) {
  const id = PLACED[section];
  if (!id) return null;
  const at = (ids ?? []).indexOf(id);
  return at < 0 ? null : at;
}

export function checksFirst(checks, name) {
  if (!name) return checks;
  const named = checks.filter((c) => c.name === name);
  return named.length ? [...named, ...checks.filter((c) => c.name !== name)] : checks;
}

export class PullRequest {
  constructor(db) { this.armed = new Armed(); this.db = db; this.session = new FolderSession(this); }

  init(cx, props = {}) {
    this.width = 368;
    this.query = "";
    this.search = new TextField({ placeholder: "Search" });
    this.search.on("change", (_e, cx) => { this.query = this.search.value(); cx.notify(); });
    this.section = props.section ?? null;
    this.check = props.check ?? null;
    this.asked = props.at ?? null;
    this.placed = null;
    this.landed = null;
    this.scroll = ScrollHandle.new();
    this.jumpUrl = props.section === "push" ? null : (props.url ?? null);
    if (props.section) this.keptUrl = null;
    this.refresh(cx);
    cx.timer.every(TICK_MS, (cx) => this.onPoll(cx));
  }

  pollNow(due) {
    return pollTick({
      shown: pollFacing(window()?.active, walkLayout(layout(), "panel-body")?.hidden),
      away: Boolean(this.away), picker: Boolean(this.session.picker), due,
    });
  }

  onPoll(cx) {
    const next = this.pollNow(readDue(this.session.loadedAt, Date.now(), this.checks().some((ch) => ch.state === "pending")));
    this.away = next.away;
    if (next.read) this.refresh(cx);
  }

  readWanted() { return Boolean(this.session.asking) || this.session.queued || this.pollNow(false).read || key() !== this.session.context; }

  showFolder() {
    const context = key();
    if (context === this.session.context) return;
    const { cwd, on } = location();
    const push = this.section === "push";
    this.armed.clear();
    this.session = new FolderSession(this, {
      context, cwd: cwd ?? null, on: on ?? null, expanded: this.session.expanded, queued: true,
      selected: this.jumpUrl ?? (push ? null : this.keptUrl) ?? null,
      remembered: !this.jumpUrl && !push && Boolean(this.keptUrl),
      inboxOpen: this.jumpUrl ? false : null,
    });
    this.jumpUrl = null;
  }

  readSoon(cx) {
    this.showFolder();
    if (this.waking || !this.readWanted()) return;
    this.waking = true;
    const wake = (wakeCx) => {
      this.waking = false;
      const ask = this.session.asking;
      this.session.asking = false;
      if (this.session.queued || ask || this.pollNow(false).read || key() !== this.session.context) this.refresh(wakeCx);
    };
    if (cx.timer?.after) cx.timer.after(0, wake);
    else wake(cx);
  }

  // Cached per reading: a draw asks several times, on every shared write anywhere.
  checks() {
    const pr = this.session.pr;
    if (this.checked?.pr !== pr) this.checked = { pr, list: checksIn(pr?.statusCheckRollup) };
    return this.checked.list;
  }

  saveState() { return this.session.selected ? { url: this.session.selected } : null; }

  restoreState(state) {
    const kept = prMemory(state, () => "open");
    if (!kept) return false;
    this.keptUrl = kept.url;
    return true;
  }

  again(cx) {
    this.session.loadedAt = 0; this.session.inboxForce = true;
    this.session.forgetLog();
    this.refresh(cx);
  }
  repo() { return repoOf(this.session.pr?.url); }
  local(url) {
    if (url && url === this.session.branchUrl) return true; // the branch's own, even from a fork's checkout
    const m = /github\.com\/([^/]+\/[^/]+)\/pull\//.exec(url ?? "");
    return Boolean(m && this.session.home && m[1].toLowerCase() === this.session.home.toLowerCase());
  }

  refresh(cx) {
    this.showFolder();
    if (this.session.loading) return;
    this.away = false;
    if (this.session.read(cx, location())) this.keptUrl = null;
  }

  async account(now, run) {
    if (authFresh(this.auth, now)) return this.auth.ready;
    const ready = await readyProviders(run).catch(() => null);
    if (ready == null) return null;
    this.auth = { at: now, ready };
    return ready;
  }

  async inboxStore() {
    if (!this.inboxDb) { await this.db.open(); this.inboxDb = this.db; }
    return this.inboxDb;
  }

  async keepPrFacts(items) {
    if (!keepsFacts()) return;
    return tryOrAsync(() => recordPrFacts(this.inboxDb ??= this.db, items));
  }

  learnViewer(login, from) { if (login && from === this.session) this.viewer = login; }

  facing() {
    return pollFacing(window()?.active, walkLayout(layout(), "panel-body")?.hidden);
  }

  readLog(cx) { this.session.readLog(cx); }

  paintInbox(model, decide) { this.session.paintInbox(model, decide); }

  noteSeen(url) { return this.session.noteSeen(url); }

  showTab(tab, cx) {
    this.session.tab = tab;
    if (tab === "closed" && this.session.closedPrs === null && !this.session.wait) this.session.loadClosed(cx);
    cx.notify();
  }

  choose(p, cx) {
    this.session.listing = false;
    if (this.session.pr?.url === p.url) { cx.notify(); return; }
    this.session.selected = p.url === this.session.branchUrl ? null : p.url; this.session.pr = null; this.session.threads = []; this.session.diffs = null; this.session.openFile = null;
    this.session.none = false; this.session.error = null; this.session.note = null; this.armed.clear(); this.session.picker = null;
    this.session.loadedAt = 0; this.refresh(cx); cx.notify();
  }

  mergeNow(cx) { this.session.mergeNow(cx); }

  createPr(cx) { this.session.createPr(cx); }

  // terminal.open cannot name a machine; the pane opens in the space already on screen.
  signIn() {
    run("terminal.open", { argv: ["gh", "auth", "login"], folder: this.session.root || this.session.cwd, place: "right" });
  }

  openPicker(kind, open, cx) {
    this.session.picker = open ? kind : null;
    this.query = ""; this.search.set_value("");
    this.session.candidates = null; this.session.pickerError = null; this.session.truncated = false;
    if (open) {
      this.search.focus();
      this.session.readPicker(kind, cx);
    }
    cx.notify();
  }

  applied(kind) {
    const pr = this.session.pr;
    if (kind === "labels") return new Set((pr.labels ?? []).map((l) => l.name));
    if (kind === "assignees") return new Set((pr.assignees ?? []).map((a) => a.login));
    return new Set((pr.reviewRequests ?? []).map((r) => r.login).filter(Boolean));
  }

  toggle(kind, name, on, cx) { this.session.toggle(kind, name, on, cx); }

  pickerFor(kind, c) {
    const id = `pr-pick-${kind}`;
    const label = { labels: "Change labels", assignees: "Assign people", reviewers: "Request a review" }[kind];
    const trigger = button(`${id}-trigger`, label, null, c, { kind: "icon", icon: "plus" });
    const popover = Popover.new(id).trigger(trigger).anchor("top_right")
      .open(this.session.picker === kind)
      .on_open_change((open, cx) => this.openPicker(kind, open, cx));
    if (this.session.picker !== kind) return popover;
    const applied = this.applied(kind), q = this.query.toLowerCase();
    const author = this.session.pr.author?.login;
    const all = (this.session.candidates ?? []).filter((x) => kind !== "reviewers" || x.login !== author);
    const shown = all.filter((x) => !q || [x.name, x.login, x.description].some((v) => String(v ?? "").toLowerCase().includes(q)));
    const empty = { labels: "This repository has no labels.", assignees: "Nobody has access to this repository.", reviewers: "Nobody else has access to this repository." }[kind];
    const noMatch = kind === "labels" ? "No label matches that." : "Nobody with access matches that.";
    const read = { labels: "The labels", assignees: "The people with access", reviewers: "The people with access" }[kind];
    const more = kind === "labels" ? "This repository has more labels than are listed here. Apply the rest on GitHub." : "This repository has more people with access than are listed here. Ask for the rest on GitHub.";
    const item = (x) => {
      const name = kind === "labels" ? x.name : x.login, on = applied.has(name);
      return {
        dot: kind === "labels" ? labelColor(x.color) ?? "dim" : null, label: name,
        second: kind === "labels" ? x.description || null : x.name && x.name !== x.login ? x.name : null,
        checked: on, hint: this.session.pending === name ? "\u2026" : null, onClick: (cx) => this.toggle(kind, name, on, cx),
      };
    };
    const state = !this.session.candidates && !this.session.pickerError ? PICKER_BONES
      : this.session.pickerError ? [{ failure: { text: `${read} could not be read`, source: this.session.pickerError } }]
      : this.session.candidates && !shown.length ? [{ heading: q ? noMatch : empty }]
      : [];
    return popover.content(menu(id, { items: [{ field: "Search", text: this.search }, ...state, { scroll: shown.map(item), rows: PICKER_ROWS },
      ...(this.session.truncated ? [{ heading: more }] : [])] }, c));
  }

  openList() {
    const me = this.viewer;
    return (this.session.openPrs ?? []).toSorted((a, b) => Number(b.author?.login === me) - Number(a.author?.login === me));
  }

  rowPermission(p) {
    const m = /github\.com\/([^/]+)\/([^/]+)\/pull\//.exec(p?.url ?? "");
    return m && this.session.permissionRepo === `${m[1]}/${m[2]}` ? this.session.permission : null;
  }

  rowState(p) {
    const sum = summaryOf(checksIn(p.statusCheckRollup));
    const gate = p.mergeStateStatus || p.mergeable === "CONFLICTING" || p.isDraft
      ? mergeReadiness(p, { permission: this.rowPermission(p), checks: sum }) : null;
    const shown = gate && !gate.awaitingPermission ? gate : listHold(p, sum);
    return { text: shown.text, tone: shown.tone };
  }

  canSwitch() {
    return Boolean(this.session.root) && !this.session.outside && !this.session.missing;
  }

  isBase() { return Boolean(this.session.branch) && this.session.branch === this.session.base; }
  canCreate() { return Boolean(this.session.branch) && this.session.pushed && !this.isBase(); }

  switchPill(c) {
    const back = this.session.listing && this.session.pr;
    const counted = this.session.listed ? `${this.session.openPrs.length} open` : "Open";
    const label = this.session.listing ? (back ? `Back to #${this.session.pr.number}` : "Back") : counted;
    const spoken = this.session.listing ? label : (this.session.listed ? `${this.session.openPrs.length} open pull requests` : "Open pull requests");
    return button("pr-switch", label, (cx) => {
      this.session.listing = !this.session.listing;
      if (!this.session.listing) { cx.notify(); return; }
      if (this.session.loading) this.session.openedList = true;
      else this.refresh(cx);
      cx.notify();
    }, c, { kind: "tonal", small: true, active: this.session.listing, spoken })
      .tooltip(tooltip({ label: this.session.listing ? "Back to the one shown" : "Every open pull request, and the closed ones" }))
      .when(!this.session.listing, (el) => el.child(svg(`${ICON}chevron-right.svg`).size(12).text_color(c.muted)));
  }

  tabs(c) {
    const closed = this.session.closedPrs === null ? "Closed" : `Closed ${this.session.closedPrs.length >= DONE_LIMIT ? `${DONE_LIMIT}+` : this.session.closedPrs.length}`;
    const open = this.session.listed ? `Open ${this.session.openPrs.length}` : "Open";
    return segmented("pr-tab", [{ key: "open", label: open }, { key: "closed", label: closed }], this.session.tab, (id, cx) => this.showTab(id, cx), c);
  }

  listPage(c) {
    const held = this.session.wait ? div().text_size(T.body).text_color(c.dim).child(this.session.wait) : null;
    const beside = (rows) => held ? v_flex().w_full().gap(G.lg).child(held).child(rows) : rows;
    const closed = this.session.closedPrs === null
      ? (this.session.flying("closed") ? this.rowBones(c) : div().text_size(T.body).text_color(c.dim).child(this.session.wait || "GitHub could not be read."))
      : !this.session.closedPrs.length ? beside(div().text_size(T.body).text_color(c.dim).child("Nothing closed yet."))
        : beside(this.openPage(c, this.session.closedPrs));
    const open = !this.session.openPrs.length
      ? div().text_size(T.body).text_color(c.dim).child(this.session.wait || "Nothing open.")
      : beside(this.openPage(c));
    return v_flex().w_full().gap(G.lg).child(this.tabs(c)).child(this.session.tab === "closed" ? closed : open);
  }

  openPage(c, rows = null) {
    const finished = rows !== null;
    const list = finished ? rows : this.openList(), me = this.viewer;
    const here = (p) => p.url === this.session.branchUrl || p.headRefName === this.session.branch;
    const mine = (p) => Boolean(me) && p.author?.login === me;
    const groups = [
      ["This branch", list.filter(here)],
      ["Yours", list.filter((p) => !here(p) && mine(p))],
      [me ? "Others" : "Open", list.filter((p) => !here(p) && !mine(p))],
    ].filter(([, rows]) => rows.length);
    const create = !finished && this.session.none && Boolean(this.session.branch) && !this.isBase();
    // Rows are numbered down the page, across the groups.
    const firsts = groups.map((_, g) => groups.slice(0, g).reduce((n, [, rows]) => n + rows.length, 0));
    return this.withNote(v_flex().w_full().gap(G.xl)
      .children(groups.map(([title, rows], g) => v_flex().w_full().gap(G.hair)
        .child(section(c, title, String(rows.length)))
        .children(rows.map((p, k) => listedRow(this, c, p, firsts[g] + k, { finished })))))
      .when(create && this.canCreate(), (el) => el.child(h_flex().child(quietLink("pr-create-list", this.session.busy === "Create" ? "Opening GitHub…" : "Create on GitHub", (cx) => this.createPr(cx), c, { color: c.text, disabled: Boolean(this.session.busy) })))), c);
  }

  // The last write's failure, under the page.
  withNote(page, c) { return page.when(Boolean(this.session.note), (el) => el.child(failureBlock(this.session.note)("pr-note", c))); }

  reviewCount() { return this.session.inbox?.needs?.length ?? 0; }

  reviewPill(c) {
    const back = this.session.inboxOn && this.session.inboxOpen && this.session.pr;
    const label = this.session.inboxOn && this.session.inboxOpen ? (back ? `Back to #${this.session.pr.number}` : "This pane") : `${this.reviewCount()} to review`;
    return button("pr-reviews", label, (cx) => {
      this.session.inboxOpen = !this.session.inboxOpen;
      if (!this.session.inboxOpen) this.noteSeen(this.session.pr?.url);
      cx.notify();
    }, c, { kind: "tonal", small: true, active: this.session.inboxOpen })
      .tooltip(tooltip({ label: this.session.inboxOpen ? "Back to this pane" : "Reviews and your open pull requests" }));
  }

  readNote() { return footOf(this).text; }

  header(c, narrow) {
    const pr = this.session.pr, here = this.session.inboxOn && this.session.inboxOpen, pill = (this.session.listing || this.canSwitch()) && !here;
    const limited = this.session.inbox?.limitedUntil;
    const refreshed = this.readNote() ?? (limited ? `limited until ${limitLine(limited).match(/\d{2}:\d{2}/)?.[0]}` : null);
    return h_flex().w_full().items_center().justify_between().gap(G.md)
      .child(div().truncate().text_size(narrow ? PR.title : T.page).text_color(c.text).child(this.session.inboxOn || this.session.listing ? "Pull requests" : "Pull request"))
      .child(h_flex().gap(G.xs).items_center().flex_none()
        .when(this.session.inboxOn, (el) => el.child(this.reviewPill(c)))
        .when(pill, (el) => el.child(this.switchPill(c)))
        .child(iconButton("pr-refresh", "refresh-cw", refreshed ? `Refresh · ${refreshed}` : "Refresh", (cx) => this.again(cx), c, { spin: this.session.loading }))
        .when(Boolean(pr?.url) && !this.session.listing && !here, (el) => el.child(iconButton("pr-copy", this.copied === pr.url ? "check" : "copy", this.copied === pr.url ? "Copied" : "Copy link", (cx) => this.copyUrl(pr.url, cx), c)))
        .when(Boolean(pr?.url) && !here, (el) => el.child(iconButton("pr-web", "external-link", "Open on GitHub", () => openUrl(pr.url), c))));
  }

  copyUrl(url, cx) {
    cx.write_to_clipboard(url);
    this.copied = url; cx.notify();
    const at = this.copiedAt = Date.now();
    cx.timer.after(1500, (cx) => { if (this.copiedAt === at) { this.copied = null; cx.notify(); } });
  }

  rowBones(c) { return skeletonOf({ shape: "line", count: 3 })("kanso-skeleton", c); }

  diffBones(c) { return skeletonOf({ shape: "line", count: 4 })("kanso-skeleton", c); }

  bones(c, narrow = true) {
    return pageBones(c, narrow, { body: listBones(c), background: c.background, gap: G.lg });
  }

  waiting(c, title, detail, action) {
    return v_flex().w_full().gap(G.sm)
      .child(div().text_size(T.card).text_color(c.muted).child(title))
      .when(Boolean(detail), (el) => el.child(div().text_size(T.body).text_color(c.dim).child(detail)))
      .when(Boolean(action), (el) => el.child(h_flex().pt(G.xs).child(action)));
  }

  place() {
    return tilde(this.session.cwd) || "~";
  }

  parsedLog() {
    if (this.session.logParsedFor === this.session.failedLog) return this.session.logParsed ?? null;
    this.session.logParsedFor = this.session.failedLog ?? null;
    this.session.logParsed = this.session.failedLog ? failedLog(this.session.failedLog) : null;
    return this.session.logParsed;
  }

  frontAgent() {
    const address = focused()?.terminal;
    if (!address) return null;
    const term = terminals().find((item) => item.address === address) ?? null;
    const pane = panes().find((item) => item.terminal === address) ?? null;
    const info = pane || term || { terminal: address };
    const kind = classify([term, pane], { reachable: reachable(address, machines()) });
    return { isAgent: kind === "ready" || kind === "waiting" || kind === "unreachable", name: nameOf(info, givenNames()), address, blocked: kind === "waiting", kind };
  }

  sceneKind() {
    if (this.session.pr) return "pr";
    if (this.session.outside) return "outside";
    if (this.session.error?.cli) return "absent";
    if (this.session.missing) return String(this.session.missing.title ?? "").startsWith("Not signed in") ? "auth" : "missing";
    if (this.session.error) return "error";
    if (this.session.wait) return "wait";
    if (this.session.none && !this.session.branch) return "detached";
    if (this.session.none && this.isBase()) return "base";
    if (this.session.none && this.session.behind) return "behind";
    if (this.session.none && !this.session.pushed) return "unpushed";
    if (this.session.none) return "none";
    if (this.session.loading || this.session.queued || !this.session.context) return "loading";
    return "folder";
  }

  scene() {
    const named = aliasText(shared("kanso.alias"), this.session.on || "");
    return {
      kind: this.sceneKind(), pr: this.session.pr, checks: this.session.pr ? this.checks() : [], threads: this.session.threads ?? [],
      permission: this.session.permission ?? null, agent: this.frontAgent(), stale: Boolean(this.session.stale), baseBehind: this.session.baseBehind ?? null,
      log: this.parsedLog(), now: Date.now(), branch: this.session.branch, place: this.session.pr ? "" : this.place(), computer: named ? machineTitle(this.session.on || "", "", named) : (this.session.on || ""),
      title: this.session.missing?.title, canCreate: this.canCreate(), ahead: this.session.aheadCount ?? 0, behindCount: this.session.behindCount ?? 0, subjects: this.session.subjects ?? [],
    };
  }

  view() { return verdictOf(this.scene()); }

  openLink(url) { openUrl(url); }

  hero(c) { return drawHero(this, c); }

  send(cx) {
    const scene = this.scene(), verdict = verdictOf(scene), text = sendText(scene, verdict);
    const step = sendStep(Boolean(this.session.sendShown) && this.session.sendFor === text, text);
    if (step.show) { this.session.sendShown = true; this.session.sendFor = text; cx.notify(); return; }
    if (!step.deliver) return;
    const agent = this.frontAgent(), address = agent?.kind === "ready" ? agent.address : null;
    if (agent?.blocked) return;
    if (agent?.kind === "unreachable") { this.session.note = said(`Not sent: ${agent.name} is unreachable`); cx.notify(); return; }
    if (!address) { this.session.note = said("Not sent: no agent in front"); cx.notify(); return; }
    if (this.session.deliverTo(cx, (task) => deliver(task.timer, address, text, "you"))) this.session.sendShown = false;
  }

  openChecks(cx) { this.session.expanded = { ...this.session.expanded, checks: true }; this.setDetails(cx, true); }

  showOthers(cx) { this.session.listing = true; if (this.session.loading) this.session.openedList = true; else this.refresh(cx); cx.notify(); }

  runWrite(action, cx) {
    const url = this.session.pr?.url, folder = this.session;
    const git = (task, args) => folder.git(task, args);
    if (action.target === "merge") return this.mergeNow(cx);
    if (action.target === "push") return folder.act("Push", ["push", "-u", "origin", "HEAD"], cx, git);
    if (action.target === "pull") return folder.act("Pull", ["pull", "--ff-only"], cx, git);
    if (action.target === "update") {
      const place = this.repo();
      if (!place || !this.session.pr) return;
      return folder.act("Update", ["api", "-X", "PUT", `repos/${place.o}/${place.r}/pulls/${this.session.pr.number}/update-branch`], cx);
    }
    if (action.target === "create") return this.createPr(cx);
    if (action.target === "ready") return folder.act("Ready", ["pr", "ready", url], cx);
    if (action.target === "draft") return folder.act("Draft", ["pr", "ready", url, "--undo"], cx);
    if (action.target === "close") return folder.act("Close", ["pr", "close", url], cx);
    if (action.target === "reopen") return folder.act("Reopen", ["pr", "reopen", url], cx);
  }

  detailsKey() { return this.session.root || this.session.cwd || ""; }

  detailsOn() {
    const all = shared("kanso.pr.details");
    return Boolean(all && all[this.detailsKey()]);
  }

  setDetails(cx, open) {
    const all = shared("kanso.pr.details") ?? {};
    const id = this.detailsKey();
    const on = open ?? !all[id];
    if (Boolean(all[id]) !== on) setShared("kanso.pr.details", { ...all, [id]: on });
    if (on) this.session.loadOthers(cx);
    cx.notify();
  }

  description(c) {
    const text = cleanBody(this.session.pr.body), long = longBody(text), open = this.session.expanded.body;
    const toggle = (cx) => { this.session.expanded = { ...this.session.expanded, body: !open }; cx.notify(); };
    return v_flex().w_full()
      .child(section(c, "Description"))
      .child(text
        ? div().id("pr-body").w_full().text_size(T.card).line_height(1.5).text_color(c.text)
          .when(long && !open, (el) => el.max_h(PR.fold).overflow_hidden())
          .child(TextView.markdown("pr-body-md", text).selectable(true).on_link_click((url) => openUrl(url)))
        : div().text_size(T.value).text_color(c.dim).child("No description."))
      .when(Boolean(text) && long, (el) => el.child(h_flex().pt(G.sm).child(quietLink("pr-body-more", open ? "Show less" : "Show all", toggle, c))));
  }

  people(c) {
    const pr = this.session.pr, open = pr.state === "OPEN";
    const metaRow = (label, values, picker, extra) => h_flex().w_full().min_h(28).gap(G.md).items_center()
      .child(div().w(76).flex_none().text_size(T.body).text_color(c.dim).child(label))
      .child(h_flex().flex_1().min_w(0).flex_wrap().gap(6).items_center()
        .children(values.length ? values : [div().text_size(T.value).text_color(c.dim).child("None")])
        .when(Boolean(extra), (el) => el.child(extra)))
      .when(Boolean(picker), (el) => el.child(picker));
    const person = (login, sub, color) => h_flex().gap(G.xs).items_center()
      .when(Boolean(color), (el) => el.child(dot(c, color)))
      .child(div().text_size(T.card).text_color(c.text).child(login))
      .when(Boolean(sub), (el) => el.child(caption(c, sub)));
    const assignees = (pr.assignees ?? []).map((a) => person(a.login));
    const mine = this.viewer && (pr.assignees ?? []).some((a) => a.login === this.viewer);
    const outcome = { APPROVED: ["approved", c.green], CHANGES_REQUESTED: ["changes", c.red], COMMENTED: ["commented", null], DISMISSED: ["dismissed", null] };
    const reviewed = (pr.latestReviews ?? []).filter((r) => r.author?.login).map((r) => person(r.author.login, outcome[r.state]?.[0] ?? String(r.state).toLowerCase(), outcome[r.state]?.[1]));
    const asked = (pr.reviewRequests ?? []).map((r) => person(r.login ?? r.name ?? r.slug, r.login ? "requested" : "team · requested", c.yellow));
    const labels = (pr.labels ?? []).map((l) => {
      const color = labelColor(l.color) ?? c.dim;
      return h_flex().h(22).px(G.sm).gap(5).items_center().rounded(R.control).bg(alpha(color, TINT.soft))
        .child(dot(c, color))
        .child(div().max_w(160).truncate().text_size(T.body).text_color(c.text).child(l.name));
    });
    const decision = { APPROVED: "Approved", CHANGES_REQUESTED: "Changes requested", REVIEW_REQUIRED: "Review required" }[pr.reviewDecision] ?? "";
    return v_flex().w_full()
      .child(section(c, "People and labels", decision))
      .child(v_flex().w_full().gap(G.xs)
        .child(metaRow("Assignees", assignees, open ? this.pickerFor("assignees", c) : null,
          open && this.viewer && !mine ? quietLink("pr-assign-me", "Assign to me", (cx) => this.toggle("assignees", this.viewer, false, cx), c, { disabled: Boolean(this.session.pending) }) : null))
        .child(metaRow("Reviewers", [...reviewed, ...asked], open ? this.pickerFor("reviewers", c) : null))
        .child(metaRow("Labels", labels, open ? this.pickerFor("labels", c) : null)));
  }

  checksList(c) {
    const checks = this.checks();
    const sorted = checksFirst(checks.toSorted((a, b) => STATES.indexOf(a.state) - STATES.indexOf(b.state)), this.check);
    const open = this.session.expanded.checks, shown = open ? sorted : sorted.slice(0, 5);
    const note = checksNote(summaryOf(checks));
    return v_flex().w_full()
      .child(section(c, "Checks", note))
      .children(shown.map((ch, i) => kitRow({ name: ch.name, second: ch.workflow || null, meta: { text: CHECK_WORDS[ch.state].label, tone: CHECK_WORDS[ch.state].color } })(`pr-check-${i}`, c, {
        onClick: () => { if (ch.url) openUrl(ch.url); },
      })))
      .when(sorted.length > 5, (el) => el.child(h_flex().pt(G.sm).child(quietLink("pr-checks-more", open ? "Show fewer" : `Show ${sorted.length - 5} more`, (cx) => { this.session.expanded = { ...this.session.expanded, checks: !open }; cx.notify(); }, c))));
  }

  discussion(c) {
    return v_flex().w_full()
      .child(section(c, "Unresolved threads", String(this.session.threads.length)))
      .children(this.session.threads.map((th, i) => {
        const body = th.body.length > 240 ? th.body.slice(0, 240) + "…" : th.body;
        const second = [`${th.path}${th.line ? `:${th.line}` : ""}`, th.author, th.replies > 0 ? `${th.replies} repl${th.replies > 1 ? "ies" : "y"}` : null, th.outdated ? "outdated" : null];
        // The thread's first 240 characters, wrapped over its lines.
        return kitRow({ name: body, second, wrap: true })(`pr-thread-${i}`, c, { onClick: () => { if (th.url) openUrl(th.url); } });
      }));
  }

  // A line is cut at MAX_DIFF characters too: a minified file's one line stays cheap to draw.
  fileDiff(c, path) {
    if (this.session.flying("diff") && !this.session.diffs) return this.diffBones(c);
    const lines = this.session.diffs?.[path];
    const note = (text) => div().py(G.xs).text_size(T.body).text_color(c.dim).child(text);
    if (!lines?.length) return note(this.session.diffs ? "No text diff for this file." : "");
    return v_flex().w_full().mb(G.sm)
      .child(code({ text: lines.slice(0, MAX_DIFF).map((line) => line.slice(0, MAX_DIFF)).join("\n"), kind: "diff" })("pr-diff", c))
      .when(lines.length > MAX_DIFF, (el) => el.child(note(`The first ${MAX_DIFF} lines; the rest is on GitHub.`).px(G.lg)));
  }

  pickFile(path, cx) {
    this.session.openFile = this.session.openFile === path ? null : path;
    if (this.session.openFile && !this.session.diffs) this.session.readDiff(cx);
    cx.notify();
  }

  files(c) {
    const pr = this.session.pr, files = pr.files ?? [], open = this.session.expanded.files;
    const shown = open ? files : files.slice(0, FILE_ROWS);
    return v_flex().w_full()
      .child(section(c, "Files", facts(String(pr.changedFiles), diffText({ add: pr.additions, del: pr.deletions }))))
      .children(shown.map((f, i) => {
        const all = f.path.split("/"), parts = all.slice(0, -1), name = all.at(-1), on = this.session.openFile === f.path;
        const mark = { ADDED: "added", DELETED: "deleted", RENAMED: "renamed" }[f.changeType] ?? "";
        return v_flex().w_full().when(i > 0, (el) => el.border_t(1).border_color(c.border))
          .child(kitRow({ name, second: [parts.join("/"), mark].filter(Boolean).join(" · ") || null, meta: diffText({ add: f.additions, del: f.deletions }), current: on })(`pr-file-${i}`, c, {
            onClick: (cx) => this.pickFile(f.path, cx),
          }))
          .when(on, (el) => el.child(this.fileDiff(c, f.path)));
      }))
      .when(files.length > FILE_ROWS, (el) => el.child(h_flex().pt(G.sm).child(quietLink("pr-files-more", open ? "Show fewer" : `Show ${files.length - FILE_ROWS} more`, (cx) => { this.session.expanded = { ...this.session.expanded, files: !open }; cx.notify(); }, c))))
      .when(files.length < pr.changedFiles, (el) => el.child(div().pt(G.sm).text_size(T.micro).text_color(c.dim).child(`GitHub lists the first ${files.length} of ${pr.changedFiles} files.`)));
  }

  inboxState(item) {
    const text = inboxLabel(item);
    return { text, tone: INBOX_TONES[text] ?? "dim" };
  }

  openInboxItem(item, cx) {
    this.session.inboxOpen = false;
    this.choose(item, cx);
  }

  inboxPage(c) {
    const scope = this.session.scope;
    const blocks = boardOf(this.session.inbox, scope);
    const mine = new Set((this.session.inbox?.logins ?? [this.session.inbox?.login]).filter(Boolean).map((name) => name.toLowerCase()));
    const itemRow = (id, item) => {
      const meta = [`#${item.number}`, item.author && mine.has(String(item.author).toLowerCase()) ? "you" : item.author, item.updatedAt ? ago(item.updatedAt) : "", isNew(item) ? "new" : ""].filter(Boolean).join(" · ");
      return prRow(id, c, item, { meta, state: this.inboxState(item), onClick: (cx) => this.openInboxItem(item, cx) });
    };
    const pulls = (id, title, items) => (items.length ? v_flex().w_full().gap(G.hair)
      .child(section(c, title, String(items.length)))
      .children(items.map((item, k) => itemRow(`${id}-${k}`, item))) : null);
    const block = (item, b) => {
      const open = isOpen(this.session.boardOpen, item.key, blocks, scope);
      const head = kitRow({ level: 0, open, name: item.title, second: blockFacts(item, item.oldest ? ago(item.oldest) : null), meta: failingMeta(item) })(`pr-block-${b}`, c, {
        onClick: (cx) => { this.session.boardOpen = toggled(this.session.boardOpen, item.key, blocks, scope); cx.notify(); },
      });
      return v_flex().w_full().gap(G.sm).child(head)
        .when(open, (el) => el.children([pulls(`pr-in-${b}-n`, "Needs you", item.needs), pulls(`pr-in-${b}-y`, "Yours", item.yours)].filter(Boolean)));
    };
    const where = scopeLine(scope);
    return this.withNote(v_flex().w_full().gap(G.lg)
      .when(Boolean(where), (el) => el.child(div().text_size(T.body).text_color(c.dim).child(where)))
      .child(!blocks.length
        ? div().text_size(T.body).text_color(c.dim).child("Nothing waiting on you.")
        : v_flex().w_full().gap(G.xs).children(blocks.flatMap((item, b) => [
          b > 0 && blocks[b - 1].here && !item.here ? section(c, "Elsewhere", String(blocks.length - b)).mt(G.md) : null,
          block(item, b),
        ].filter(Boolean))))
      .when(Boolean(this.session.wait || this.session.inbox?.limitedUntil), (el) => el.child(div().text_size(T.body).text_color(c.dim).child(this.session.wait || limitLine(this.session.inbox.limitedUntil)))), c);
  }

  body(c, narrow) {
    if (this.session.inboxOn && (this.session.inboxOpen || this.session.outside)) return this.inboxPage(c);
    if (this.session.listing) return this.listPage(c);
    const kind = this.sceneKind();
    if (kind === "pr") return this.hero(c);
    if (kind === "loading") return listBones(c);
    if (kind === "wait") return this.waiting(c, this.session.wait);
    if (kind === "error") return failureBlock({ text: this.session.error.title, source: this.session.error.detail, fix: "Refresh" })("pr-failed", c, { onClick: (cx) => this.again(cx) });
    return drawEmpty(this, c);
  }

  nodes(c, narrow) {
    const header = ["header", this.header(c, narrow).id("header")];
    if ((this.session.inboxOn && this.session.inboxOpen) || this.session.listing || this.sceneKind() !== "pr") return [header, ["body", this.body(c, narrow)]];
    return [header, ...heroPieces(this, c)];
  }

  noteAsk(cx) {
    const given = props() ?? {};
    if (given.at == null || given.at === this.asked) return;
    this.asked = given.at;
    this.section = given.section ?? null;
    this.check = given.check ?? null;
    this.landed = null;
    this.placed = null;
    if (given.section !== "push") return;
    this.session.selected = null;
    this.jumpUrl = null;
    this.keptUrl = null;
    this.session.asking = true;
  }

  // The named check sits inside Details, so the fold is open before this render builds it.
  openAsked(cx) {
    const section = this.section;
    const needs = section === "checks" || section === "review" || section === "threads";
    const id = this.detailsKey();
    if (!needs || !id) return;
    const mark = `${this.asked ?? ""}:${section}:${id}`;
    if (this.placed === mark) return;
    this.placed = mark;
    if (section === "checks") this.session.expanded = { ...this.session.expanded, checks: true };
    if (this.detailsOn()) return;
    const all = shared("kanso.pr.details") ?? {};
    setShared("kanso.pr.details", { ...all, [id]: true });
    const folder = this.session;
    if (cx.timer?.after) cx.timer.after(0, (next) => folder.loadOthers(next));
    else folder.loadOthers(cx);
  }

  land(ids) {
    if (!this.session.pr) return;
    const mark = `${this.session.pr.number}:${this.section ?? ""}:${this.check ?? ""}`;
    if (this.landed === mark) return;
    const at = sectionIndex(this.section, ids);
    if (at == null) {
      if (!this.session.loading) this.landed = mark;
      return;
    }
    this.landed = mark;
    this.scroll.scroll_to_item(at);
  }

  render(cx) {
    this.noteAsk(cx);
    this.readSoon(cx);
    this.openAsked(cx);
    const c = tokens(theme());
    const narrow = (this.width || 368) < 560;
    const nodes = this.nodes(c, narrow);
    if (this.session.pr && !(this.session.inboxOn && this.session.inboxOpen) && !this.session.listing && this.sceneKind() === "pr") this.land(nodes.map(([id]) => id));
    const padX = narrow ? G.lg : 32;
    const padY = narrow ? G.lg : 28;
    return v_flex().id("kanso-pr").size_full().min_h(0).bg(c.background).text_color(c.text).overflow_y_scrollbar()
      .on_size_change(pageSize.call(this))
      .pt(padY).pb(padY).gap(G.lg).track_scroll(this.scroll)
      .children(nodes.map(([, el]) => h_flex().flex_none().w_full().justify_center().px(padX)
        .child(v_flex().w_full().max_w(1080).child(el))));
  }
}


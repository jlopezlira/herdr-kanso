import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { exec, run, theme, spaces, home, openOverlay, shared, checking } from "herdr";
import { G, T, PR, DIALOG, tokens } from "./ui.js";
import { iconButton, quietLink } from "./ui-button.js";
import { row } from "./ui-row.js";
import { segmented } from "./ui-tab.js";
import { section } from "./ui-section.js";
import { markdown } from "./ui-markdown.js";
import { stateBlock } from "./ui-state.js";
import { emptyState, skeletonOf } from "./kit.js";
import { scrollPage, pageHeader, refreshTool } from "./ui-page.js";
import { openApi } from "./platform-open.js";
import { localService } from "./platform-host.js";
import { localSecrets } from "./platform-secrets.js";
import { projectKey } from "./kdb.js";
import { tryOrAsync, plural } from "./pure.js";
import { FILTERS, FILTER_WORDS, EVERY_MS, OPEN, ACCOUNTS, SOURCE_WORDS, matches, sectionsOf, isFolded, foldKey, projectsInOrder, stale, ageOf, sendText, listOf, kindOf, linkWords } from "./issues-model.js";
import { readIssues, linkSql } from "./issues-store.js";
import { issuesGithub, repoText } from "./issues-github.js";
import { LINKED, linkedOf, syncLinkedBoard, syncLinkedDetail } from "./issues-linked.js";

const PROJECTS = "SELECT id, name, folder, machine FROM projects WHERE removed IS NULL;";
const SIGNED_OUT = { kind: "signed out", text: "Sign in to GitHub to see your issues" };
const NO_REMOTE = { kind: "no remote", text: "No GitHub remote" };
const UNREACHED = (detail) => ({ kind: "offline", text: "GitHub can't be reached", source: detail ?? "" });
const SIGNED_OUT_STATES = new Set(["logged_out", "no_cli"]);
const NO_STORE = { kind: "no store", text: "This computer has no secret store, so Jira and Linear can't sign in here. GitHub keeps working." };

const runOn = (machine) => (cmd, args) => exec(cmd, args, { on: machine || null }).catch((e) => ({ code: -1, stdout: "", stderr: String(e?.message ?? e) }));
const openUrl = (url) => localService(openApi).open(url).catch(() => {});
const clock = (at) => (at ? new Date(at).toTimeString().slice(0, 5) : "");
const accounts = () => {
  const kept = shared(ACCOUNTS);
  return kept && typeof kept === "object" ? kept : {};
};
const placeKey = (project, source) => `${project}\u0000${source}`;
const refOf = (source) => source.slice(kindOf(source).length + 1);

export class Issues {
  constructor(db) { this.db = db; }

  saveState() { return { filters: this.filters, folds: this.folds }; }

  restoreState(state) {
    if (!state || typeof state !== "object") return false;
    this.filters = state.filters && typeof state.filters === "object" ? state.filters : {};
    this.folds = state.folds && typeof state.folds === "object" ? state.folds : {};
    return true;
  }

  init(cx) {
    this.filters ??= {};
    this.folds ??= {};
    this.projects = null;
    this.rows = [];
    this.boards = [];
    this.links = [];
    this.logins = {};
    this.places = {};
    this.reading = new Set();
    this.open = null;
    this.front = null;
    this.linking = null;
    this.secrets = localSecrets();
    this.store = null;
    if (!checking()) cx.spawn(async (cx) => { this.store = await this.secrets.available(); cx.notify(); });
    this.load(cx, true);
    cx.timer.every(EVERY_MS, (next) => this.refresh(next));
  }

  filterOf(project) { return FILTERS.includes(this.filters[project]) ? this.filters[project] : "assigned"; }

  frontProject() {
    const key = projectKey(spaces().find((s) => s.active), home());
    return (this.projects ?? []).find((p) => `${p.machine ?? ""}:${p.folder}` === key)?.id ?? null;
  }

  load(cx, refresh = false) {
    cx.spawn(async (cx) => {
      this.projects ??= (await tryOrAsync(() => this.db.read(PROJECTS))) ?? [];
      await this.reload();
      cx.notify();
      if (refresh) this.refresh(cx);
    });
  }

  async reload() {
    const read = await tryOrAsync(() => readIssues(this.db, this.projects.map((p) => p.id)));
    if (read) { this.rows = read.rows; this.boards = read.boards; this.links = read.links; }
  }

  sourcesOf(project) {
    return ["github", ...this.links.filter((l) => l.project === project).map((l) => `${l.source}:${l.ref}`)];
  }

  boardOf(project, source) { return this.boards.find((b) => b.project === project && b.source === source) ?? null; }

  linkedFor(kind) {
    const provider = linkedOf(kind), account = provider?.account(accounts());
    return account && this.store !== false ? { provider, account, client: provider.client(this.secrets, account) } : null;
  }

  whoFor(project, source) {
    const provider = linkedOf(kindOf(source));
    if (provider) { const account = provider.account(accounts()); return account ? provider.who(account) : null; }
    const machine = (this.projects ?? []).find((p) => p.id === project)?.machine ?? "";
    return this.logins[`${machine}:github`]?.login ?? this.boardOf(project, "github")?.who ?? null;
  }

  refresh(cx, force = false) {
    const now = Date.now();
    for (const project of this.projects ?? []) {
      for (const source of this.sourcesOf(project.id)) {
        const board = this.boardOf(project.id, source);
        const due = force || stale(board?.read_at, now) || board?.filter !== this.filterOf(project.id);
        const waiting = !force && board?.retry_at && board.retry_at > now;
        const key = placeKey(project.id, source);
        if (due && !waiting && !this.reading.has(key)) this.readBoard(project, source, cx);
      }
    }
    cx.notify();
  }

  async loginOn(machine) {
    const key = `${machine ?? ""}:github`;
    if (this.logins[key]?.status === "ok") return this.logins[key];
    const session = await issuesGithub.probe(runOn(machine));
    if (session?.status === "ok") this.logins = { ...this.logins, [key]: session };
    return session;
  }

  place(project, source, value) { this.places = { ...this.places, [placeKey(project, source)]: value }; }

  async readGithub(project, filter, now) {
    const run = runOn(project.machine);
    const session = await this.loginOn(project.machine);
    const repo = await issuesGithub.repoOf(run, project.folder, session?.hosts?.length ? session.hosts : ["github.com"]);
    if (!repo) { this.place(project.id, "github", NO_REMOTE); return; }
    if (session?.status !== "ok") { this.place(project.id, "github", SIGNED_OUT_STATES.has(session?.status) ? SIGNED_OUT : UNREACHED(session?.detail)); return; }
    this.place(project.id, "github", { repo });
    await issuesGithub.syncBoard(this.db, run, { repo, project: project.id, filter, login: session.login, kept: this.rows, now });
  }

  async readLinked(project, source, filter, now) {
    const kind = kindOf(source), ref = refOf(source);
    if (this.store === false) { this.place(project.id, source, NO_STORE); return; }
    const linked = this.linkedFor(kind);
    if (!linked) { this.place(project.id, source, { kind: "signed out", text: `Sign in to ${SOURCE_WORDS[kind]} in Settings to see these tickets` }); return; }
    if (!linked.provider.owns(ref, linked.account)) { this.place(project.id, source, { kind: "signed out", text: linked.provider.other(ref) }); return; }
    this.place(project.id, source, { ref });
    await syncLinkedBoard(this.db, linked.provider, linked.client, { kind, ref, project: project.id, filter, who: linked.provider.who(linked.account), kept: this.rows, now });
  }

  readBoard(project, source, cx) {
    const key = placeKey(project.id, source);
    this.reading.add(key);
    cx.spawn(async (cx) => {
      try {
        const filter = this.filterOf(project.id), now = Date.now();
        if (source === "github") await this.readGithub(project, filter, now);
        else await this.readLinked(project, source, filter, now);
        await this.reload();
      } catch (e) {
        this.place(project.id, source, { kind: "error", text: "Issues could not be read", source: String(e?.message ?? e) });
      } finally {
        this.reading.delete(key);
        cx.notify();
      }
    });
  }

  choose(project, filter, cx) {
    this.filters = { ...this.filters, [project]: filter };
    this.refresh(cx);
  }

  toggle(project, status, cx) {
    const key = foldKey(project, status);
    this.folds = { ...this.folds, [key]: !isFolded(this.folds, project, status) };
    cx.notify();
  }

  async detailOf(issue) {
    if (linkedOf(kindOf(issue.source))) {
      const linked = this.linkedFor(kindOf(issue.source));
      return linked?.provider.owns(refOf(issue.source), linked.account) ? syncLinkedDetail(this.db, linked.provider, linked.client, issue) : null;
    }
    const project = (this.projects ?? []).find((p) => p.id === issue.project);
    const repo = this.places[placeKey(issue.project, "github")]?.repo ?? repoText(this.boardOf(issue.project, "github")?.repo);
    return project && repo ? issuesGithub.syncDetail(this.db, runOn(project.machine), { repo, project: issue.project, url: issue.url, number: issue.number }) : null;
  }

  show(issue, cx) {
    this.open = { project: issue.project, url: issue.url };
    cx.notify();
    cx.spawn(async (cx) => {
      const detail = await tryOrAsync(() => this.detailOf(issue));
      if (detail) await this.reload();
      cx.notify();
    });
  }

  sendToAgent(issue) {
    openOverlay({ mod: "kanso-send", kind: "dialog", width: DIALOG.wide, props: { text: sendText(issue), whenWaiting: true } });
  }

  signIn(project) {
    run("terminal.open", { argv: ["gh", "auth", "login"], folder: project.folder, place: "right" });
  }

  openLinking(project, kind, cx) {
    if (this.linking?.project === project && this.linking.kind === kind) { this.linking = null; cx.notify(); return; }
    this.linking = { project, kind, list: null, failure: null };
    cx.notify();
    cx.spawn(async (cx) => {
      const found = await tryOrAsync(() => this.linkedFor(kind)?.client.projects());
      if (this.linking?.project !== project || this.linking.kind !== kind) return;
      this.linking = { ...this.linking, list: found?.list ?? [], failure: found?.failure ?? (found ? null : { text: `${SOURCE_WORDS[kind]} could not be read` }) };
      cx.notify();
    });
  }

  link(project, kind, item, on, cx) {
    cx.spawn(async (cx) => {
      await tryOrAsync(() => this.db.run(linkSql({ project, source: kind, ref: item.ref, name: item.name }, on)));
      await this.reload();
      this.refresh(cx);
    });
  }

  failureOf(project, source) {
    const place = this.places[placeKey(project.id, source)];
    if (place?.kind) return place;
    const failed = this.boardOf(project.id, source)?.failure;
    return failed ? JSON.parse(failed) : null;
  }

  stateOf(project, source, c) {
    const failure = this.failureOf(project, source);
    if (!failure) return null;
    const read = this.boardOf(project.id, source)?.read_at;
    const copy = read && failure.kind !== "no remote" && failure.kind !== "signed out" ? `Showing the copy read at ${clock(read)}` : "";
    const until = failure.retryAt ? ` until ${clock(failure.retryAt)}` : "";
    const again = { onClick: (cx) => this.refresh(cx, true) };
    const fix = failure.kind === "no remote" || failure.kind === "no store" ? {}
      : source !== "github" ? { fix: "Reconnect", ...(failure.kind === "signed out" ? { onClick: () => this.openSettings() } : again) }
        : failure.kind === "signed out" ? { fix: "Sign in", onClick: () => this.signIn(project) } : { fix: "Refresh", ...again };
    return stateBlock(`issues-state-${project.id}-${source}`, c, { text: `${failure.text}${until}`, source: [failure.source, copy].filter(Boolean).join(" · "), ...fix });
  }

  openSettings() {
    openOverlay({ mod: "kanso-settings", kind: "dialog", width: DIALOG.settingsW, height: DIALOG.settingsH, props: { page: "accounts" } });
  }

  ticketRow(issue, c, now, marked) {
    const labels = listOf(issue.labels);
    const meta = [marked ? SOURCE_WORDS[kindOf(issue.source)] : null, issue.status || OPEN, issue.priority, ageOf(issue.updated_at ?? issue.created_at, now)];
    return row(`issue-${issue.url}`, c, {
      name: issue.title, start: [div().flex_none().text_size(T.body).text_color(c.dim).child(issue.ticket)],
      detail: labels.length ? labels.join(", ") : null, meta: meta.filter(Boolean).join(" · "),
      current: this.open?.url === issue.url && this.open.project === issue.project, onClick: (cx) => this.show(issue, cx),
    });
  }

  linkingRows(project, c) {
    const l = this.linking;
    if (l?.project !== project.id) return [];
    if (!l.list && !l.failure) return [skeletonOf({ shape: "two lines", count: 2 })(`issues-link-bones-${project.id}`, c)];
    if (l.failure) return [stateBlock(`issues-link-failure-${project.id}`, c, { text: l.failure.text, source: l.failure.source ?? "", fix: "Reconnect", onClick: () => this.openSettings() })];
    const linked = new Set(this.links.filter((x) => x.project === project.id && x.source === l.kind).map((x) => x.ref));
    return l.list.map((item) => row(`issues-link-${project.id}-${item.ref}`, c, { name: item.name, icon: linked.has(item.ref) ? "check" : null,
      onClick: (cx) => this.link(project.id, l.kind, item, !linked.has(item.ref), cx) }));
  }

  boardBlock(project, source, c, now, marked) {
    const filter = this.filterOf(project.id), who = this.whoFor(project.id, source);
    const rows = this.rows.filter((r) => r.project === project.id && r.source === source && matches(r, filter, who));
    const board = this.boardOf(project.id, source);
    const state = this.stateOf(project, source, c);
    const loading = !board && this.reading.has(placeKey(project.id, source));
    const name = this.links.find((l) => `${l.source}:${l.ref}` === source && l.project === project.id)?.name;
    const folds = `${project.id}\u0000${source}`;
    return [
      ...(marked && source !== "github" ? [section(c, `${SOURCE_WORDS[kindOf(source)]} · ${name ?? source}`, String(rows.length))] : []),
      ...(state ? [state] : []),
      ...(loading ? [skeletonOf({ shape: "two lines", count: 3 })(`issues-bones-${project.id}-${source}`, c)] : []),
      ...(Number(board?.total) > rows.length && board?.filter === filter ? [div().text_size(T.body).text_color(c.dim).child(`Showing the newest ${rows.length} of ${board.total}`)] : []),
      ...sectionsOf(rows, listOf(board?.columns)).flatMap(({ status, rows: listed }) => {
        const folded = isFolded(this.folds, folds, status);
        return [
          row(`issues-section-${project.id}-${source}-${status}`, c, { name: status, level: 0, open: !folded, chip: String(listed.length), onClick: (cx) => this.toggle(folds, status, cx) }),
          ...(folded ? [] : listed.map((issue) => this.ticketRow(issue, c, now, marked))),
        ];
      }),
    ];
  }

  projectBlock(project, c, now) {
    const filter = this.filterOf(project.id), kept = accounts();
    const sources = this.sourcesOf(project.id);
    const marked = sources.length > 1;
    const any = this.rows.some((r) => r.project === project.id && matches(r, filter, this.whoFor(project.id, r.source)));
    const busy = sources.some((s) => this.reading.has(placeKey(project.id, s)));
    const failing = sources.some((s) => this.failureOf(project, s));
    return v_flex().w_full().gap(G.sm)
      .child(row(`issues-project-${project.id}`, c, { name: project.name, heading: true, meta: busy ? "Reading…" : null }))
      .child(segmented(`issues-filter-${project.id}`, FILTERS.map((f) => ({ key: f, label: FILTER_WORDS[f] })), filter, (value, cx) => this.choose(project.id, value, cx), c, { size: "sm" }))
      .children(sources.flatMap((source) => this.boardBlock(project, source, c, now, marked)))
      .when(!any && !busy && !failing, (el) => el.child(emptyState({ text: `No open issues ${filter === "all" ? "" : FILTER_WORDS[filter].toLowerCase()}`.trim() })(`issues-empty-${project.id}`, c)))
      .child(h_flex().gap(G.md).children(Object.entries(LINKED).filter(([, provider]) => this.store !== false && provider.account(kept))
        .map(([kind, provider]) => quietLink(`issues-link-${kind}-${project.id}`, `Link ${SOURCE_WORDS[kind]} ${provider.things}…`, (cx) => this.openLinking(project.id, kind, cx), c))))
      .children(this.linkingRows(project, c));
  }

  detail(issue, c, now) {
    const project = (this.projects ?? []).find((p) => p.id === issue.project);
    const comments = listOf(issue.comments), prs = listOf(issue.prs);
    return v_flex().w_full().gap(G.lg)
      .child(h_flex().w_full().gap(G.sm).items_center()
        .child(iconButton("issues-back", "chevron-left", "Back", (cx) => { this.open = null; cx.notify(); }, c))
        .child(div().flex_1().min_w(0).truncate().text_size(T.card).text_color(c.dim).child(`${issue.ticket} · ${project?.name ?? issue.repo ?? ""}`)))
      .child(div().w_full().text_size(T.title).text_color(c.text).child(issue.title))
      .child(div().text_size(T.body).text_color(c.dim).child([issue.status, issue.priority, listOf(issue.labels).join(", "), ageOf(issue.created_at, now)].filter(Boolean).join(" · ")))
      .child(h_flex().gap(G.md)
        .child(quietLink("issues-send", "Send to agent", () => this.sendToAgent(issue), c, { color: c.text }))
        .child(quietLink("issues-open", linkWords(issue.source), () => openUrl(issue.url), c)))
      .when(Boolean(issue.body), (el) => el.child(markdown("issues-body", c, { source: issue.body })))
      .when(comments.length > 0, (el) => el.child(section(c, "Comments", String(comments.length)))
        .children(comments.map((m, i) => v_flex().w_full().gap(G.xs)
          .child(div().text_size(T.body).text_color(c.dim).child(`${m.author} · ${ageOf(m.at, now)}`))
          .child(markdown(`issues-comment-${i}`, c, { source: m.body })))))
      .when(prs.length > 0, (el) => el.child(section(c, "Linked pull requests", String(prs.length)))
        .children(prs.map((p) => row(`issues-pr-${p.number}`, c, { name: p.title, start: [div().flex_none().text_size(T.body).text_color(c.dim).child(`#${p.number}`)], meta: String(p.state ?? "").toLowerCase(),
          onClick: () => openUrl(p.url) }))));
  }

  skeleton(c) { return skeletonOf({ shape: "two lines", count: 4 })("kanso-skeleton", c); }

  render(cx) {
    const c = tokens(theme()), now = Date.now();
    const front = this.frontProject();
    if (front !== this.front) { this.front = front; if (this.projects) this.refresh(cx); }
    const open = this.open ? this.rows.find((r) => r.url === this.open.url && r.project === this.open.project) : null;
    const busy = this.reading.size > 0;
    const projects = projectsInOrder(this.projects ?? [], front);
    const body = open ? this.detail(open, c, now)
      : !this.projects ? this.skeleton(c)
        : !projects.length ? emptyState({ text: "Add a project to see its issues" })("issues-none", c)
          : v_flex().w_full().gap(G.xl).children(projects.map((p) => this.projectBlock(p, c, now)));
    return scrollPage("kanso-issues", c, true, (column) => column
      .child(pageHeader(div().text_size(PR.title).text_color(c.text).child("Issues"),
        [refreshTool("issues-refresh", c, { busy, working: `Reading ${plural(this.reading.size, "board", "boards")}` }, (cx) => this.refresh(cx, true))]))
      .child(body));
  }
}

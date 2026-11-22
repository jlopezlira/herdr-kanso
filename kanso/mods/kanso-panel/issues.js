import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { exec, run, theme, spaces, home, openOverlay } from "herdr";
import { G, T, tokens } from "./ui.js";
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
import { projectKey } from "./kdb.js";
import { tryOrAsync, plural } from "./pure.js";
import { FILTERS, FILTER_WORDS, EVERY_MS, matches, sectionsOf, isFolded, foldKey, projectsInOrder, stale, ageOf, sendText, listOf } from "./issues-model.js";
import { readIssues, storeSql, detailSql } from "./issues-store.js";
import { issuesGithub } from "./issues-github.js";

const PROVIDERS = [issuesGithub];
const PROJECTS = "SELECT id, name, folder, machine FROM projects WHERE removed IS NULL;";
const SIGNED_OUT = { kind: "signed out", text: "Sign in to GitHub to see your issues" };
const NO_REMOTE = { kind: "no remote", text: "No GitHub remote" };

const runOn = (machine) => (cmd, args) => exec(cmd, args, { on: machine || null }).catch((e) => ({ code: -1, stdout: "", stderr: String(e?.message ?? e) }));
const openUrl = (url) => localService(openApi).open(url).catch(() => {});
const clock = (at) => (at ? new Date(at).toTimeString().slice(0, 5) : "");

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
    this.logins = {};
    this.places = {};
    this.reading = new Set();
    this.open = null;
    this.front = null;
    this.load(cx, true);
    cx.timer.every(EVERY_MS, (next) => this.refresh(next, true));
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
    if (read) { this.rows = read.rows; this.boards = read.boards; }
  }

  boardOf(project, source = "github") { return this.boards.find((b) => b.project === project && b.source === source) ?? null; }

  refresh(cx, force = false) {
    const now = Date.now();
    for (const project of this.projects ?? []) {
      const board = this.boardOf(project.id);
      const due = force || stale(board?.read_at, now) || board?.filter !== this.filterOf(project.id);
      const waiting = board?.retry_at && board.retry_at > now;
      if (due && !waiting && !this.reading.has(project.id)) this.readProject(project, cx);
    }
    cx.notify();
  }

  async loginOn(machine, provider) {
    const key = `${machine ?? ""}:${provider.id}`;
    if (!(key in this.logins)) this.logins = { ...this.logins, [key]: await provider.probe(runOn(machine)) };
    return this.logins[key];
  }

  readProject(project, cx) {
    this.reading.add(project.id);
    cx.spawn(async (cx) => {
      try {
        const run = runOn(project.machine);
        const provider = PROVIDERS[0];
        const repo = await provider.repoOf(run, project.folder);
        if (!repo) { this.places = { ...this.places, [project.id]: NO_REMOTE }; return; }
        const session = await this.loginOn(project.machine, provider);
        if (session?.status !== "ok") { this.places = { ...this.places, [project.id]: SIGNED_OUT }; return; }
        this.places = { ...this.places, [project.id]: { repo } };
        const filter = this.filterOf(project.id), now = Date.now();
        const board = await provider.readBoard(run, { repo, project: project.id, filter, login: session.login, now });
        await this.db.run(storeSql({ project: project.id, source: provider.id, filter, login: session.login, ...board, kept: this.rows, now }));
        await this.reload();
      } catch (e) {
        this.places = { ...this.places, [project.id]: { kind: "error", text: "Issues could not be read", source: String(e?.message ?? e) } };
      } finally {
        this.reading.delete(project.id);
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

  show(issue, cx) {
    this.open = issue.url;
    cx.notify();
    const project = (this.projects ?? []).find((p) => p.id === issue.project);
    const repo = this.places[issue.project]?.repo;
    if (!project || !repo) return;
    cx.spawn(async (cx) => {
      const detail = await tryOrAsync(() => issuesGithub.readDetail(runOn(project.machine), { repo, number: issue.number }));
      if (detail) { await tryOrAsync(() => this.db.run(detailSql(issue.url, detail))); await this.reload(); }
      cx.notify();
    });
  }

  sendToAgent(issue) {
    openOverlay({ mod: "kanso-send", kind: "dialog", width: 480, props: { text: sendText(issue) } });
  }

  signIn(project) {
    run("terminal.open", { argv: ["gh", "auth", "login"], folder: project.folder, place: "right" });
  }

  failureOf(project) {
    const place = this.places[project.id];
    if (place?.kind) return place;
    const failed = this.boardOf(project.id)?.failure;
    return failed ? JSON.parse(failed) : null;
  }

  stateOf(project, c) {
    const failure = this.failureOf(project);
    if (!failure) return null;
    const read = this.boardOf(project.id)?.read_at;
    const copy = read && failure.kind !== "no remote" && failure.kind !== "signed out" ? `Showing the copy read at ${clock(read)}` : "";
    const until = failure.retryAt ? ` until ${clock(failure.retryAt)}` : "";
    const fix = failure.kind === "signed out" ? { fix: "Sign in", onClick: () => this.signIn(project) }
      : failure.kind === "no remote" ? {} : { fix: "Refresh", onClick: (cx) => this.refresh(cx, true) };
    return stateBlock(`issues-state-${project.id}`, c, { text: `${failure.text}${until}`, source: [failure.source, copy].filter(Boolean).join(" · "), ...fix });
  }

  ticketRow(issue, c, now) {
    const labels = listOf(issue.labels);
    return row(`issue-${issue.url}`, c, {
      name: issue.title, start: [div().flex_none().text_size(T.body).text_color(c.dim).child(issue.ticket)],
      detail: labels.length ? labels.join(", ") : null, meta: [issue.status, ageOf(issue.updated_at ?? issue.created_at, now)].filter(Boolean).join(" · "),
      current: this.open === issue.url, onClick: (cx) => this.show(issue, cx),
    });
  }

  projectBlock(project, c, now) {
    const filter = this.filterOf(project.id), login = this.loginFor(project);
    const rows = this.rows.filter((r) => r.project === project.id && matches(r, filter, login));
    const board = this.boardOf(project.id);
    const sections = sectionsOf(rows, listOf(board?.columns));
    const loading = !board && this.reading.has(project.id);
    const state = this.stateOf(project, c);
    return v_flex().w_full().gap(G.sm)
      .child(row(`issues-project-${project.id}`, c, { name: project.name, heading: true, meta: this.reading.has(project.id) ? "Reading…" : null }))
      .child(segmented(`issues-filter-${project.id}`, FILTERS.map((f) => ({ key: f, label: FILTER_WORDS[f] })), filter, (value, cx) => this.choose(project.id, value, cx), c, { size: "sm" }))
      .when(Boolean(state), (el) => el.child(state))
      .when(loading, (el) => el.child(skeletonOf({ shape: "two lines", count: 3 })(`issues-bones-${project.id}`, c)))
      .when(!loading && !rows.length && !state, (el) => el.child(emptyState({ text: `No open issues ${filter === "all" ? "" : FILTER_WORDS[filter].toLowerCase()}`.trim() })(`issues-empty-${project.id}`, c)))
      .children(sections.flatMap(({ status, rows: listed }) => {
        const folded = isFolded(this.folds, project.id, status);
        return [
          row(`issues-section-${project.id}-${status}`, c, { name: status, level: 0, open: !folded, chip: String(listed.length), onClick: (cx) => this.toggle(project.id, status, cx) }),
          ...(folded ? [] : listed.map((issue) => this.ticketRow(issue, c, now))),
        ];
      }));
  }

  loginFor(project) {
    return this.logins[`${project.machine ?? ""}:github`]?.login ?? null;
  }

  detail(issue, c, now) {
    const project = (this.projects ?? []).find((p) => p.id === issue.project);
    const comments = listOf(issue.comments), prs = listOf(issue.prs);
    return v_flex().w_full().gap(G.lg)
      .child(h_flex().w_full().gap(G.sm).items_center()
        .child(iconButton("issues-back", "chevron-left", "Back", (cx) => { this.open = null; cx.notify(); }, c))
        .child(div().flex_1().min_w(0).truncate().text_size(T.card).text_color(c.dim).child(`${issue.ticket} · ${project?.name ?? issue.repo ?? ""}`)))
      .child(div().w_full().text_size(T.title).text_color(c.text).child(issue.title))
      .child(div().text_size(T.body).text_color(c.dim).child([issue.status, listOf(issue.labels).join(", "), ageOf(issue.created_at, now)].filter(Boolean).join(" · ")))
      .child(h_flex().gap(G.md)
        .child(quietLink("issues-send", "Send to agent", () => this.sendToAgent(issue), c, { color: c.text }))
        .child(quietLink("issues-github", "Open on GitHub", () => openUrl(issue.url), c)))
      .when(Boolean(issue.body), (el) => el.child(markdown("issues-body", c, { source: issue.body })))
      .when(comments.length > 0, (el) => el.child(section(c, "Comments", String(comments.length)))
        .children(comments.map((m, i) => v_flex().w_full().gap(G.xs)
          .child(div().text_size(T.body).text_color(c.dim).child(`${m.author} · ${ageOf(m.at, now)}`))
          .child(markdown(`issues-comment-${i}`, c, { source: m.body })))))
      .when(prs.length > 0, (el) => el.child(section(c, "Pull requests", String(prs.length)))
        .children(prs.map((p) => row(`issues-pr-${p.number}`, c, { name: p.title, start: [div().flex_none().text_size(T.body).text_color(c.dim).child(`#${p.number}`)], meta: String(p.state ?? "").toLowerCase(),
          onClick: () => openUrl(p.url) }))));
  }

  skeleton(c) { return skeletonOf({ shape: "two lines", count: 4 })("kanso-skeleton", c); }

  render(cx) {
    const c = tokens(theme()), now = Date.now();
    const front = this.frontProject();
    if (front !== this.front) { this.front = front; if (this.projects) this.refresh(cx); }
    const open = this.open ? this.rows.find((r) => r.url === this.open) : null;
    const busy = this.reading.size > 0;
    const projects = projectsInOrder(this.projects ?? [], front);
    const body = open ? this.detail(open, c, now)
      : !this.projects ? this.skeleton(c)
        : !projects.length ? emptyState({ text: "Add a project to see its issues" })("issues-none", c)
          : v_flex().w_full().gap(G.xl).children(projects.map((p) => this.projectBlock(p, c, now)));
    return scrollPage("kanso-issues", c, true, (column) => column
      .child(pageHeader(div().text_size(17).text_color(c.text).child("Issues"),
        refreshTool("issues-refresh", c, { busy, working: `Reading ${plural(this.reading.size, "project", "projects")}` }, (cx) => this.refresh(cx, true))))
      .child(body));
  }
}

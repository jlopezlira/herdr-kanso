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
import { CLI_URL } from "./pr-verdict.js";
import { localService } from "./platform-host.js";
import { localSecrets } from "./platform-secrets.js";
import { projectKey } from "./kdb.js";
import { tryOrAsync, plural } from "./pure.js";
import { FILTERS, FILTER_WORDS, EVERY_MS, OPEN, ACCOUNTS, SOURCE_WORDS, matches, withSpaces, placeOf, sectionsOf, isFolded, foldKey, projectsInOrder, stale, ageOf, sendText, listOf, kindOf, linkWords } from "./issues-model.js";
import { readIssues, linkSql } from "./issues-store.js";
import { issuesGithub, repoText } from "./issues-github.js";
import { LINKED, linkedOf, syncLinkedBoard, syncLinkedDetail } from "./issues-linked.js";

const PROJECTS = "SELECT id, name, folder, machine FROM projects WHERE removed IS NULL;";
const REGISTRY = "kanso.registry";
const registered = () => { const rows = shared(REGISTRY); return [...(Array.isArray(rows) ? rows.map((p) => p.id) : []), ...spaces().map((s) => projectKey(s, home()))].join(); };
const GITHUB_BOARD = { ref: "issues", name: "GitHub issues" };
const sourceKey = (l) => (l.source === "github" ? "github" : `${l.source}:${l.ref}`);
const SIGNED_OUT = { kind: "signed out", text: "Sign in to GitHub to see your issues" };
const NO_REMOTE = { kind: "no remote", text: "No GitHub remote" };
const NO_CLI = { kind: "no cli", text: "GitHub CLI not installed" };
const GIT_FAILED = (detail) => ({ kind: "offline", text: "Git could not read this project", source: detail });
const UNREACHED = (detail) => ({ kind: "offline", text: "GitHub can't be reached", source: detail ?? "" });
const SIGNED_OUT_STATES = new Set(["logged_out"]);
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
    this.registered = registered();
    this.linking = null;
    this.adding = null;
    this.signedIn = JSON.stringify(accounts());
    this.secrets = localSecrets();
    this.store = null;
    if (!checking()) cx.spawn(async (cx) => { this.store = await this.secrets.available(); cx.notify(); });
    this.load(cx, true);
    cx.timer.every(EVERY_MS, (next) => this.refresh(next));
  }

  filterOf(project) { return FILTERS.includes(this.filters[project]) ? this.filters[project] : "assigned"; }

  frontProject() {
    const active = spaces().find((s) => s.active);
    const key = placeOf(active?.machine, active?.folder || home());
    return (this.projects ?? []).find((p) => placeOf(p.machine, p.folder) === key)?.id ?? null;
  }

  load(cx, refresh = false) {
    cx.spawn(async (cx) => {
      this.projects = withSpaces((await tryOrAsync(() => this.db.read(PROJECTS))) ?? this.projects ?? [], spaces(), home());
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
    return this.links.filter((l) => l.project === project).map(sourceKey);
  }

  followed() {
    return projectsInOrder(this.projects ?? [], this.front).filter((p) => this.links.some((l) => l.project === p.id));
  }

  startAdding(cx) {
    this.adding = { project: null };
    this.linking = null;
    cx.notify();
  }

  stopAdding(cx) {
    this.adding = null;
    this.linking = null;
    cx.notify();
  }

  chooseProject(project, cx) {
    this.adding = { project };
    cx.notify();
  }

  addSource(project, kind, cx) {
    if (kind === "github") {
      this.adding = null;
      this.link(project, "github", GITHUB_BOARD, true, cx);
      return;
    }
    if (!this.linkedFor(kind)) { this.openSettings(); return; }
    this.openLinking(project, kind, cx);
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

  refresh(cx, force = false, only = null) {
    const now = Date.now();
    for (const project of this.projects ?? []) {
      for (const source of this.sourcesOf(project.id)) {
        const board = this.boardOf(project.id, source);
        const due = force || stale(board?.read_at, now) || board?.filter !== this.filterOf(project.id);
        const chosen = only?.project === project.id && only.source === source;
        if (only && !chosen) continue;
        const waiting = !chosen && board?.retry_at && board.retry_at > now;
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
    const { repo, failed } = await issuesGithub.repoOf(run, project.folder, session?.hosts?.length ? session.hosts : ["github.com"]);
    if (failed) { this.place(project.id, "github", GIT_FAILED(failed)); return; }
    if (!repo) { this.place(project.id, "github", NO_REMOTE); return; }
    if (session?.status === "no_cli") { this.place(project.id, "github", NO_CLI); return; }
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
    const argv = ["gh", "auth", "login"], place = placeOf(project.machine, project.folder);
    const open = spaces().filter((s) => placeOf(s.machine, s.folder || home()) === place);
    if (open.some((s) => s.active)) run("terminal.open", { argv, folder: project.folder, place: "right" });
    else if (open.length) run("tab.new", { space: open[0].id, name: "GitHub sign in", folder: project.folder, argv });
    else run("space.new", { name: project.name, folder: project.folder, machine: project.machine ?? "", argv });
  }

  openLinking(project, kind, cx) {
    if (this.linking?.project === project && this.linking.kind === kind) { this.linking = null; cx.notify(); return; }
    this.linking = { project, kind, list: null, failure: null };
    this.loadLinking(project, kind, null, cx);
  }

  loadLinking(project, kind, start, cx) {
    const earlier = start ? this.linking?.list ?? [] : [];
    const asked = {};
    this.linking = { project, kind, list: start ? earlier : null, failure: null, more: Boolean(start), next: start, asked };
    cx.notify();
    cx.spawn(async (cx) => {
      const found = await tryOrAsync(() => this.linkedFor(kind)?.client.projects(start));
      if (this.linking?.asked !== asked) return;
      const failure = found?.failure ?? (found ? null : { text: `${SOURCE_WORDS[kind]} could not be read` });
      this.linking = { project, kind, list: [...earlier, ...(found?.list ?? [])], complete: !failure && found?.complete !== false,
        next: found?.next ?? (failure ? start : null), more: false, failure, asked };
      cx.notify();
    });
  }

  async ownId(id) {
    const project = (this.projects ?? []).find((p) => p.id === id);
    if (!project?.auto) return id;
    const { row } = await this.db.addProject({ name: project.name, folder: project.folder, machine: project.machine ?? "" });
    return row.id;
  }

  link(project, kind, item, on, cx) {
    cx.spawn(async (cx) => {
      const id = await tryOrAsync(() => this.ownId(project));
      if (!id) return;
      await tryOrAsync(() => this.db.run(linkSql({ project: id, source: kind, ref: item.ref, name: item.name }, on)));
      if (id !== project) {
        this.linking = this.linking && { ...this.linking, project: id };
        this.adding = this.adding && { project: id };
      }
      this.load(cx, true);
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
    const copy = read && !["no remote", "no cli", "signed out"].includes(failure.kind) ? `Showing the copy read at ${clock(read)}` : "";
    const until = failure.retryAt ? ` until ${clock(failure.retryAt)}` : "";
    const again = { onClick: (cx) => this.refresh(cx, true, source === "github" ? null : { project: project.id, source }) };
    const fix = failure.kind === "no store" ? {}
      : failure.kind === "no remote" ? this.otherSources()
        : failure.kind === "no cli" ? { fix: "Get the GitHub CLI", onClick: () => openUrl(CLI_URL) }
          : source !== "github" ? { fix: "Reconnect", ...(failure.kind === "signed out" ? { onClick: () => this.openSettings() } : again) }
        : failure.kind === "signed out" ? { fix: "Sign in", onClick: () => this.signIn(project) } : { fix: "Refresh", ...again };
    return stateBlock(`issues-state-${project.id}-${source}`, c, { text: `${failure.text}${until}`, source: [failure.source, copy].filter(Boolean).join(" · "), ...fix });
  }

  otherSources() {
    return this.store === true && !Object.keys(LINKED).some((kind) => this.linkedFor(kind)) ? { fix: "Sign in to Jira or Linear", onClick: () => this.openSettings() } : {};
  }

  newProject() {
    openOverlay({ mod: "kanso-spaces", kind: "dialog", width: DIALOG.sidebar, props: { newProject: { start: false } } });
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
    const things = linkedOf(l.kind).things;
    if (l.failure) {
      const fix = l.failure.kind === "signed out" ? { fix: "Reconnect", onClick: () => this.openSettings() } : { fix: "Refresh", onClick: (cx) => this.loadLinking(project.id, l.kind, l.next, cx) };
      return [stateBlock(`issues-link-failure-${project.id}`, c, { text: l.failure.text, source: l.failure.source ?? "", ...fix })];
    }
    if (!l.list.length) return [emptyState({ text: `No ${things} visible to this account`, action: "Open Accounts" })(`issues-link-none-${project.id}`, c, { onClick: () => this.openSettings() })];
    const linked = new Set(this.links.filter((x) => x.project === project.id && x.source === l.kind).map((x) => x.ref));
    const more = l.complete ? [] : [h_flex().w_full().gap(G.sm).items_center()
      .child(div().flex_1().text_size(T.body).text_color(c.dim).child(`Showing the first ${l.list.length} ${things}`))
      .child(quietLink(`issues-link-more-${project.id}`, "Load more", (cx) => this.loadLinking(project.id, l.kind, l.next, cx), c, { disabled: l.more }))];
    return [...l.list.map((item) => row(`issues-link-${project.id}-${item.ref}`, c, { name: item.name, icon: linked.has(item.ref) ? "check" : null,
      onClick: (cx) => this.link(project.id, l.kind, item, !linked.has(item.ref), cx) })), ...more];
  }

  boardBlock(project, source, c, now, marked) {
    const filter = this.filterOf(project.id), who = this.whoFor(project.id, source);
    const rows = this.rows.filter((r) => r.project === project.id && r.source === source && matches(r, filter, who));
    const board = this.boardOf(project.id, source);
    const state = this.stateOf(project, source, c);
    const loading = !board && this.reading.has(placeKey(project.id, source));
    const link = this.links.find((l) => sourceKey(l) === source && l.project === project.id);
    const folds = `${project.id}\u0000${source}`;
    const title = source === "github" ? GITHUB_BOARD.name : `${SOURCE_WORDS[kindOf(source)]} · ${link?.name ?? source}`;
    return [
      h_flex().w_full().gap(G.sm).items_center()
        .child(div().flex_1().min_w(0).child(section(c, title, String(rows.length))))
        .child(quietLink(`issues-remove-${project.id}-${source}`, "Remove", (cx) => this.link(project.id, link?.source ?? "github", { ref: link?.ref ?? GITHUB_BOARD.ref, name: link?.name ?? title }, false, cx), c)),
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

  addingBlock(c) {
    const chosen = this.adding.project;
    const all = projectsInOrder(this.projects ?? [], this.front);
    const heading = (words) => h_flex().w_full().gap(G.sm).items_center()
      .child(div().flex_1().min_w(0).child(section(c, words)))
      .child(quietLink("issues-add-close", "Close", (cx) => this.stopAdding(cx), c));
    if (!chosen) {
      const listed = all.length
        ? all.map((p) => row(`issues-add-project-${p.id}`, c, { name: p.name, meta: p.machine ?? null, onClick: (cx) => this.chooseProject(p.id, cx) }))
        : [emptyState({ text: "Add a project first", action: "New project" })("issues-add-none", c, { onClick: () => this.newProject() })];
      return v_flex().w_full().gap(G.sm).child(heading("Add a board: choose a project")).children(listed);
    }
    const project = all.find((p) => p.id === chosen);
    const has = new Set(this.sourcesOf(chosen));
    const others = this.store === false ? [] : Object.entries(LINKED).map(([kind, provider]) => ({
      kind, name: this.linkedFor(kind) ? `${SOURCE_WORDS[kind]} ${provider.things}…` : `Sign in to ${SOURCE_WORDS[kind]}…`,
    }));
    const kinds = [{ kind: "github", name: GITHUB_BOARD.name, done: has.has("github") }, ...others];
    return v_flex().w_full().gap(G.sm).child(heading(`Add a board to ${project?.name ?? ""}`))
      .children(kinds.map((k) => row(`issues-add-${k.kind}`, c, { name: k.name, icon: k.done ? "check" : null,
        ...(k.done ? {} : { onClick: (cx) => this.addSource(chosen, k.kind, cx) }) })))
      .children(project ? this.linkingRows(project, c) : []);
  }

  skeleton(c) { return skeletonOf({ shape: "two lines", count: 4 })("kanso-skeleton", c); }

  noStore(c) {
    return this.store === false && !this.links.length ? [stateBlock("issues-no-store", c, { text: NO_STORE.text })] : [];
  }

  render(cx) {
    const c = tokens(theme()), now = Date.now();
    const known = registered();
    if (known !== this.registered) { this.registered = known; if (this.projects) this.load(cx, true); }
    const signedIn = JSON.stringify(accounts());
    if (signedIn !== this.signedIn) {
      this.signedIn = signedIn;
      const l = this.linking;
      if (l?.failure) cx.timer.after(0, (next) => this.loadLinking(l.project, l.kind, l.next, next));
    }
    const front = this.frontProject();
    if (front !== this.front) { this.front = front; if (this.projects) cx.timer.after(0, (next) => this.refresh(next)); }
    const open = this.open ? this.rows.find((r) => r.url === this.open.url && r.project === this.open.project) : null;
    const busy = this.reading.size > 0;
    const followed = this.followed();
    const adding = this.adding ? [this.addingBlock(c)] : [];
    const body = open ? this.detail(open, c, now)
      : !this.projects ? this.skeleton(c)
        : !followed.length && !this.adding ? emptyState({ text: "Follow only the GitHub issues, Jira projects and Linear teams you choose", action: "Add a board" })("issues-none", c, { onClick: (cx) => this.startAdding(cx) })
          : v_flex().w_full().gap(G.xl).children([...adding, ...this.noStore(c), ...followed.map((p) => this.projectBlock(p, c, now))]);
    return scrollPage("kanso-issues", c, true, (column) => column
      .child(pageHeader(div().text_size(PR.title).text_color(c.text).child("Tasks"),
        [iconButton("issues-add", "plus", "Add a board", (cx) => this.startAdding(cx), c), refreshTool("issues-refresh", c, { busy, working: `Reading ${plural(this.reading.size, "board", "boards")}` }, (cx) => this.refresh(cx, true))]))
      .child(body));
  }
}

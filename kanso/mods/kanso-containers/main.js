import { localService } from "./platform-host.js";
import { paths } from "./platform-paths.js";
import { processApi } from "./platform-processes.js";
import { fileApi } from "./platform-files.js";
import { systemApi } from "./platform-system.js";
// Containers, by jlopezlira (https://github.com/jlopezlira/herdr-kanso). Apache-2.0.
// Docker, simply: what runs and for which project, and everything you'd open Docker Desktop for.
import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { exec, run, spaces, panes, home, theme, shared, setShared, readTextFile } from "herdr";
import { T, G, tokens } from "./ui.js";
import { Armed, quietLink, iconButton } from "./ui-button.js";
import { field, TextField } from "./ui-field.js";
import { row } from "./ui-row.js";
import { metric, skeletonOf, failureBlock } from "./kit.js";
import { afterMount, parseOr, bounded } from "./pure.js";
import { pageFrame } from "./page.js";
import { Front } from "./front.js";
import {
  PS_FORMAT, IMAGES_FORMAT, STATS_FORMAT, INSPECT_FORMAT, CONTEXT_FORMAT, VOLUMES_FORMAT, COMPOSE_FILES, OTHER,
  parseContainers, contextOf, vmPids, lookIn, isWeb, urlOf, since, size, failed, okRead, failedRead, readOf, settle, panelOf,
} from "./model.js";

// Read while the panel is open; a closed panel is unmounted, so nothing runs behind it.
const EVERY_MS = 5000;
const HEALTH_TONES = { running: "done", busy: "working", failed: "blocked" };
// `docker stats` takes a second or two: every third read. Compose files, images and volumes once a minute.
const STATS_EVERY = 3, FILES_EVERY = 12;
// A pull runs in a tab the panel cannot follow: images are read each time until they change, for 10 minutes at most.
const PULL_READS = 120;
export function readPlan(reads) {
  const stats = reads % STATS_EVERY === 1;
  return { stats, files: reads === 1 || (reads % FILES_EVERY === 2 && !stats), stored: reads % FILES_EVERY === 1 };
}
// Which containers there are and in what state: details change only when this does.
export const containerKey = (list) => list.map((c) => `${c.id}:${c.state}`).toSorted().join(",");
export const idKey = (list) => list.map((c) => c.id).toSorted().join(",");
// `docker context use` writes it here: a changed name means another engine, read without a process.
const currentContext = () => readTextFile(paths.join(home(), ".docker", "config.json")).then((t) => String(parseOr(t ?? "", null)?.currentContext ?? "")).catch(() => null);
// Compose project names and files seen per folder, kept across panels and restarts.
// Kept per Docker context: another engine's projects are not this one's.
const namesKey = (context) => `kanso.containers.names.${context?.name ?? "default"}`;
const savedNames = (key) => { const v = shared(key); return new Map(v && typeof v === "object" && !Array.isArray(v) ? Object.entries(v).filter(([, l]) => Array.isArray(l)) : []); };

const CALL_MS = 15_000, ACT_MS = 60_000, PROCESS_GRACE_MS = 1_000;
const limitOf = (ms) => ms - PROCESS_GRACE_MS;
const docker = (args, ms = CALL_MS) => exec("docker", args, { timeout: limitOf(ms) });
const timedRun = (run, ms) => (command, args, options = {}) => run(command, args, { ...options, timeout: Math.min(options.timeout ?? Infinity, limitOf(ms)) });
const wholeRun = (run) => (command, args, options) => run(command, args, options).then((r) => (r.code === 0 ? r : Promise.reject(new Error(firstLine(r)))));
const timed = (factory, ms = CALL_MS) => localService((platform, run, write) => factory(platform, timedRun(run, ms), write));
const strict = (factory) => localService((platform, run, write) => factory(platform, wholeRun(timedRun(run, CALL_MS)), write));
const lookFiles = (plan, again) => plan.files || again;
const UNATTRIBUTED = "Docker VM memory attribution requires a Herdr API on Windows.";
const fail = (e) => ({ code: 1, stdout: "", stderr: String(e?.message ?? e) });
const firstLine = (r) => (r.stderr || r.stdout || "").trim().split("\n")[0];
const DOCKER = "docker";
const said = (r) => `Docker said: ${firstLine(r)}`;
const within = (timer, promise, ms = CALL_MS) => bounded(promise.catch(fail), timer, ms);
const unread = (e) => ({ state: "error", values: [], reason: String(e?.message ?? e) });
// Long work (pulls, builds, compose) runs in a tab of its own, so you see its progress and it is never cut at 30 s.
const inTab = (name, argv, folder) => run("terminal.open", { argv, name, place: "tab", ...(folder ? { folder } : {}) });

// Each Kanso space's folders: where its panes work, and its own folder unless it is home.
function kansoProjects() {
  const homeDir = home(), tabsOf = new Map(spaces().flatMap((w) => (w.tabs ?? []).map((t) => [t.id, w])));
  const cwds = panes().flatMap((p) => { const w = tabsOf.get(p.tab); return w && !w.machine && p.cwd && p.cwd !== homeDir ? [[w.id, p.cwd]] : []; });
  return spaces().filter((w) => !w.machine).map((w) => ({
    name: w.name,
    folders: [...new Set([...(w.folder && w.folder !== homeDir ? [w.folder] : []), ...cwds.filter(([id]) => id === w.id).map(([, f]) => f)])],
  })).filter((p) => p.folders.length);
}

export default class Containers extends View {
  init(_props, cx) {
    this.snapshot = null;
    this.panel = panelOf(null);
    this.projects = [];
    this.note = null;
    this.error = null;        // what the last action could not do, until the next action
    this.busy = new Set();    // container ids being changed
    this.reading = false;
    this.queued = null;
    this.show = { images: false, volumes: false };
    this.opened = new Set();  // containers showing their details
    this.armed = new Armed();
    this.width = 368;
    this.pulling = null;      // a pull in a tab: images read each time until they change
    this.reads = 0;
    this.front = new Front();
    this.pull = new TextField({ placeholder: "postgres:17, redis, nginx:alpine…" });
    this.pull.on("change", (_e, cx) => cx.notify());
    this.pull.on("submit", () => this.pullImage());
    this.runFor = null;       // the image whose Run form is open, with its fields
    afterMount(cx, (cx) => this.refresh(cx));
    this.armTicker(cx);
  }

  armTicker(cx) {
    if (this.ticker || this.front.behind()) return;
    this.ticker = cx.timer.every(EVERY_MS, (tick) => this.refresh(tick));
  }

  close() {
    try { this.ticker?.cancel(); this.pull.release(); } catch { /* already gone */ }
    this.closeRun();
  }

  // `now`: after an action, a read that overtakes any still going; the timer's waits its turn.
  // `all` (Read again, coming forward): everything, the memory limit and context too.
  refresh(cx, soon = false, again = false) {
    if (this.front.behind()) {
      this.front.rest();
      try { this.ticker?.cancel(); } catch { /* already gone */ }
      this.ticker = null;
      return;
    }
    const back = this.front.woke();
    const ask = { now: soon || back, all: again || back, again };
    this.armTicker(cx);
    if (!this.reading) { this.read(cx, ask); return; }
    if (ask.now) this.queued = { now: true, all: ask.all || Boolean(this.queued?.all), again: ask.again || Boolean(this.queued?.again) };
  }

  retry(cx) {
    if (!this.reading) this.refresh(cx, true, true);
  }

  get state() { return this.panel.state; }
  get groups() { return this.panel.groups; }
  get volumes() { return this.panel.volumes ?? []; }
  get images() { return this.panel.images ?? []; }
  get context() { return this.panel.context; }
  get limit() { return this.panel.limit; }
  get details() { return this.panel.details; }
  failure() { return this.panel.message; }

  read(cx, { now, all, again }) {
    this.reading = true;
    cx.notify();
    const n = (this.snapshot?.n ?? 0) + 1, before = this.snapshot?.reads ?? {};
    this.got = {}; this.thrown = null;
    const take = (reads) => { this.got = { ...this.got, ...reads }; };
    cx.spawn(async (cx) => {
      const ask = (args) => within(cx.timer, docker(args));
      try {
        const sameContext = before.context?.state === "ok" && !all;
        const [ps, ctx] = await Promise.all([within(cx.timer, docker(["ps", "-a", "--format", PS_FORMAT])),
          sameContext ? null : ask(["context", "inspect", "--format", CONTEXT_FORMAT])]);
        take({ containers: readOf(ps, said), context: readOf(ctx, said) });
        if (ps.code !== 0) return;
        const found = parseContainers(ps.stdout), earlier = before.containers?.data == null ? null : parseContainers(before.containers.data);
        this.projects = kansoProjects();
        this.reads = this.reads + 1;
        const plan = readPlan(this.reads);
        const whole = all || !earlier;
        const set = containerKey(found), ids = idKey(found);
        const inspected = before.details?.state === "ok" ? before.details.data : null;
        const covered = inspected?.set === set;
        const config = whole || plan.stored ? await bounded(currentContext(), cx.timer, CALL_MS).then((v) => (v?.late ? null : v)) : null;
        const moved = config !== null && before.config?.data != null && config !== before.config.data;
        const fixed = whole || moved || before.limit?.state !== "ok";
        const stored = whole || now || ids !== idKey(earlier) || plan.stored || Boolean(this.pulling);
        const usage = whole || plan.stats;
        const { deep, shallow } = lookIn(this.projects.flatMap((p) => p.folders).slice(0, 24), home());
        const named = (depth, list) => within(cx.timer, strict(fileApi).walk(list, { depth: Number(depth), names: COMPOSE_FILES }).then((paths) => ({ code: 0, stdout: paths.join("\n") })));
        const [im, info, ps2, ins, ctx2, vols, df, files] = await Promise.all([
          stored ? ask(["images", "--no-trunc", "--format", IMAGES_FORMAT]) : null,
          fixed ? ask(["info", "--format", "{{.MemTotal}}"]) : null,
          usage ? within(cx.timer, timed(processApi).memory()) : null,
          !found.length ? { code: 0, stdout: "" } : covered && !whole ? null : ask(["inspect", "--format", INSPECT_FORMAT, ...found.map((c) => c.id)]),
          moved && !ctx ? ask(["context", "inspect", "--format", CONTEXT_FORMAT]) : null,
          stored ? ask(["volume", "ls", "--format", VOLUMES_FORMAT]) : null,
          stored ? ask(["system", "df", "--format", "{{json .}}"]) : null,
          lookFiles(plan, again) && deep.length ? Promise.all([named("2", deep), shallow.length ? named("1", shallow) : { code: 0, stdout: "" }])
            .then((both) => both.find(failed) ?? { code: 0, stdout: both.map((r) => r.stdout ?? "").join("\n") }) : null]);
        take({
          config: config === null ? null : okRead(config), images: readOf(im, said), limit: readOf(info, said), memory: readOf(ps2, firstLine),
          details: ins && (ins.code === 0 ? okRead({ set, text: ins.stdout }) : failedRead(said(ins))),
          context: this.got.context ?? readOf(ctx2, said), volumes: readOf(vols, said), disk: readOf(df, said), files: readOf(files, firstLine),
        });
        if (im?.code === 0 && this.pulling) this.pulling = im.stdout === this.pulling.seen && this.pulling.left > 1 ? { ...this.pulling, left: this.pulling.left - 1 } : null;
        const openFiles = ps2?.code === 0 ? await bounded(timed(processApi).openFiles(vmPids(ps2.stdout)).catch(unread), cx.timer, CALL_MS)
          .then((r) => (r?.late ? unread(firstLine(r)) : r)) : null;
        take({ attribution: openFiles && (openFiles.state === "error" ? failedRead(openFiles.reason) : okRead(openFiles)) });
        take({ stats: usage ? readOf(await ask(["stats", "--no-stream", "--format", STATS_FORMAT]), said) : null });
      } catch (e) {
        this.thrown = String(e?.message ?? e);
      } finally {
        this.snapshot = settle(this.snapshot, { n, reads: this.got, thrown: this.thrown });
        this.panel = this.derive();
        this.reading = false;
        const next = this.queued;
        this.queued = null;
        if (next) this.read(cx, next); else cx.notify();
      }
    });
  }

  derive() {
    const reads = this.snapshot?.reads ?? {};
    const key = namesKey(reads.context?.state === "ok" ? contextOf(reads.context.data) : null);
    const names = savedNames(key);
    const found = reads.containers?.data == null ? [] : parseContainers(reads.containers.data);
    const fresh = [...new Set(found.filter((c) => c.dir && c.compose).map((c) => c.dir))].map((d) => {
      const now = found.filter((c) => c.dir === d && c.compose).map((c) => ({ name: c.compose, files: c.files ?? [] }));
      const merged = [...(names.get(d) ?? []).filter((k) => !now.some((x) => x.name === k.name)), ...now];
      return [d, merged.filter((k, i) => merged.findIndex((x) => x.name === k.name) === i)];
    });
    const all = new Map([...names, ...fresh]);
    if (fresh.length && JSON.stringify(Object.fromEntries(all)) !== JSON.stringify(shared(key) ?? {})) setShared(key, Object.fromEntries(all));
    return panelOf(this.snapshot, { projects: this.projects, names: all });
  }

  // Short `docker` commands; `ids` are rows to dim until Docker has made the change.
  hold(ids, cx, work) {
    if (ids.some((id) => this.busy.has(id))) return;
    this.busy = new Set([...this.busy, ...ids]);
    cx.notify();
    cx.spawn(async (cx) => {
      try { await work(cx); } finally {
        this.busy = new Set([...this.busy].filter((id) => !ids.includes(id)));
        this.refresh(cx, true);
      }
    });
  }

  act(args, cx, { ids = [], what = args[0] } = {}) {
    this.hold(ids, cx, async (cx) => {
      const r = await within(cx.timer, docker(args, ACT_MS), ACT_MS);
      this.error = r.code === 0 ? null : `${what} failed: ${firstLine(r)}`;
    });
  }

  containers(verb, list, cx) {
    const free = list.filter((c) => !this.busy.has(c.id));
    if (free.length) this.act([verb, ...free.map((c) => c.id)], cx, { ids: free.map((c) => c.id) });
  }

  pullImage() {
    const name = this.pull.value().trim();
    // A name, never an option: docker would take "-…" as one.
    if (!name || /\s/.test(name) || name.startsWith("-")) return;
    inTab(`pull ${name}`, ["docker", "pull", name]);
    this.pulling = { seen: this.panel.imagesText, left: PULL_READS };
    this.pull.set_value("");
  }

  closeRun() {
    try { this.runFor?.name.release(); this.runFor?.port.release(); } catch { /* already gone */ }
    this.runFor = null;
  }

  openRun(image, cx) {
    const same = this.runFor?.id === image.id;
    this.closeRun();
    if (same) { cx.notify(); return; }
    const base = (image.tags[0] ?? "").split(":")[0].split("/").at(-1) || "app";
    const name = new TextField({ placeholder: `name (${base})` }), port = new TextField({ placeholder: "port, e.g. 8080:80" });
    name.on("submit", (_e, cx) => this.runImage(cx));
    port.on("submit", (_e, cx) => this.runImage(cx));
    this.runFor = { id: image.id, target: image.tags[0] ?? image.id, name, port };
    name.focus();
    cx.notify();
  }

  runImage(cx) {
    const f = this.runFor;
    if (!f) return;
    const name = f.name.value().trim(), port = f.port.value().trim();
    if (port && !/^\d+(:\d+)?$/.test(port)) { this.error = "Port: a number, or host:container like 8080:80."; cx.notify(); return; }
    if (name && !/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(name)) { this.error = "Name: letters, digits, _ . or -, starting with a letter or digit."; cx.notify(); return; }
    const args = ["run", "-d", ...(name ? ["--name", name] : []), ...(port ? ["-p", port.includes(":") ? port : `${port}:${port}`] : []), f.target];
    this.closeRun();
    this.act(args, cx, { what: "run" });
  }

  // In the stack's folder with no -f, so Compose reads its file and override as it would itself;
  // under the project name a running stack has, so Down and Up reach the same containers.
  stack(s, verb) {
    const args = { up: ["up", "-d"], down: ["down"], rebuild: ["up", "-d", "--build"] }[verb];
    inTab(`${s.name} ${verb}`, ["docker", "compose", ...(s.compose ? ["-p", s.compose] : []), ...(s.files ?? []).flatMap((f) => ["-f", f]), ...args], s.dir);
  }

  // Docker Desktop's own command, else asked to quit like any app: the VM ends and its memory comes back.
  quitDocker(cx) {
    this.hold([DOCKER], cx, async (cx) => {
      const r = await within(cx.timer, docker(["desktop", "stop"], ACT_MS), ACT_MS);
      const q = r.code === 0 ? r : await within(cx.timer, timed(systemApi, ACT_MS).stopDocker(), ACT_MS);
      this.error = q.code === 0 ? null : `Docker did not quit: ${firstLine(q)}`;
    });
  }

  openDocker(cx) {
    this.hold([DOCKER], cx, async (cx) => {
      const r = await within(cx.timer, timed(systemApi, ACT_MS).startDocker(), ACT_MS);
      this.note = r.code === 0 ? "Starting Docker…" : null;
      this.error = r.code === 0 ? null : "Docker could not be opened from here: open it yourself.";
    });
  }

  detailsView(k, c) {
    const d = this.details.get(k.id.slice(0, 12));
    if (!d) return div().pl(15).text_size(T.body).text_color(c.dim).child("No details from Docker.");
    const line = (label, text) => h_flex().w_full().gap(G.sm).items_start()
      .child(div().w(64).flex_none().text_size(T.micro).text_color(c.dim).child(label))
      .child(div().flex_1().min_w(0).text_size(T.body).text_color(c.muted).child(text));
    const mounts = d.mounts.map((m) => `${m.type === "volume" ? m.name?.slice(0, 24) : m.source} → ${m.dest}`);
    return v_flex().w_full().pl(15).pt(G.xs).gap(3)
      .when(k.ports.length > 0, (el) => el.child(line("Ports", k.ports.map((p) => `${p.port} → ${p.inside}/${p.proto}`).join(", "))))
      .when(mounts.length > 0, (el) => el.child(line("Mounts", mounts.join("\n"))))
      .when(d.networks.length > 0, (el) => el.child(line("Networks", d.networks.join(", "))))
      .when(d.env.length > 0, (el) => el.child(line("Env", d.env.join(", "))))
      .child(line("Restarts", d.restart ?? "never on its own"))
      .when(Boolean(k.compose), (el) => el.child(line("Compose", `${k.compose} · ${k.service}`)))
      .child(line("Id", k.id.slice(0, 12)));
  }

  // On another machine's Docker, localhost is not where the ports are: shown, not copied.
  portVerbs(k) {
    if (this.context?.remote) return [];
    return k.ports.slice(0, 3).map((p) => ({ label: `:${p.port}`, spoken: `Copy localhost:${p.port}`, onClick: (cx) => cx.write_to_clipboard?.(`localhost:${p.port}`) }));
  }

  row(k, c) {
    const busy = this.busy.has(k.id), on = k.health === "running" || k.health === "busy";
    const open = this.opened.has(k.id);
    const mem = this.panel.mem.get(k.id.slice(0, 12));
    const remote = Boolean(this.context?.remote);
    const web = !remote && on ? k.ports.find(isWeb) : null;
    const tone = HEALTH_TONES[k.health];
    const act = (verb) => (cx) => { if (!busy) this.containers(verb, [k], cx); };
    const verbs = [
      ...this.portVerbs(k),
      { label: busy ? "Working…" : on ? "Stop" : "Start", onClick: act(on ? "stop" : "start"), color: c.text, disabled: busy },
      on ? { label: "Restart", onClick: act("restart"), disabled: busy } : null,
      web ? { label: "Open", onClick: (cx) => cx.open_url(urlOf(web)) } : null,
      k.health === "running" ? { label: "Shell", onClick: () => inTab(`shell ${k.service ?? k.name}`, localService(systemApi).containerShell(k.name, this.details.get(k.id.slice(0, 12))?.platform)) } : null,
      { label: "Logs", onClick: () => inTab(`logs ${k.service ?? k.name}`, ["docker", "logs", "-f", "--tail", "200", k.name]) },
      { label: open ? "Less" : "Details", onClick: (cx) => { this.opened = open ? new Set([...this.opened].filter((x) => x !== k.id)) : new Set([...this.opened, k.id]); cx.notify(); } },
      on ? null : this.armed.verb("Remove", "remove", `rm:${k.id}`, (cx) => this.containers("rm", [k], cx), { disabled: busy }),
    ].filter(Boolean);
    return v_flex().w_full()
      .child(row(`ct-${k.id}`, c, {
        name: k.service ?? k.name,
        detail: tone ? { text: since(k), tone } : since(k),
        meta: typeof mem === "number" && k.health === "running" ? size(mem) : null,
        second: [k.image, k.service ? k.name : null, ...(remote ? k.ports.slice(0, 3).map((p) => `:${p.port}`) : [])],
        verbs,
        pending: busy,
      }))
      .when(open, (el) => el.child(this.detailsView(k, c)));
  }

  stackRow(s, c) {
    const state = s.total === 0 ? "not started" : `${s.running} of ${s.total} running`;
    const id = `${s.dir}:${s.compose ?? ""}`;
    return row(`ct-stack-${id}`, c, {
      name: s.compose && s.compose !== s.name ? s.compose : s.name,
      detail: [{ text: "compose", tip: s.file }, state],
      verbs: [
        { label: s.running ? "Up again" : "Up", onClick: () => this.stack(s, "up"), color: c.text },
        { label: "Rebuild", onClick: () => this.stack(s, "rebuild") },
        s.total > 0 ? this.armed.verb("Down", "take it down", `down:${id}`, () => this.stack(s, "down")) : null,
      ].filter(Boolean),
    });
  }

  group(g, c) {
    const stopped = g.containers.filter((k) => k.health !== "running" && k.health !== "busy");
    const running = g.containers.filter((k) => k.health === "running" || k.health === "busy");
    return v_flex().w_full().gap(G.xs)
      .child(h_flex().w_full().flex_wrap().items_end().justify_between().gap_x(G.md).gap_y(G.xs).pb(G.xs)
        .child(div().min_w(0).flex_shrink(1).truncate().text_size(T.title).text_color(g.project === OTHER ? c.muted : c.text).child(g.project))
        .child(h_flex().flex_none().gap(G.md).items_center()
          .when(g.containers.length > 0, (el) => el.child(div().text_size(T.body).text_color(c.dim).child(`${g.running} of ${g.containers.length} running`)))
          .when(stopped.length > 1, (el) => el.child(quietLink(`ct-start-all-${g.project}`, "Start all", (cx) => this.containers("start", stopped, cx), c)))
          .when(running.length > 1, (el) => el.child(quietLink(`ct-stop-all-${g.project}`, "Stop all", (cx) => this.containers("stop", running, cx), c)))))
      .children(g.stacks.map((s) => this.stackRow(s, c)))
      .children(g.containers.map((k) => this.row(k, c)));
  }

  head(id, title, note, open, c) {
    return h_flex().w_full().items_end().justify_between().gap(G.md).pb(G.xs)
      .child(quietLink(`ct-${id}`, `${open ? "Hide" : "Show"} ${title}`, (cx) => { this.show = { ...this.show, [id]: !open }; cx.notify(); }, c, { color: c.text }))
      .child(div().min_w(0).truncate().text_size(T.body).text_color(c.dim).child(note));
  }

  imagesView(c) {
    const decided = this.panel.can.cleanImages, unused = decided ? this.images.filter((i) => i.unused) : [], listed = this.panel.images !== null;
    const total = this.images.reduce((t, i) => t + i.mb, 0), spare = unused.reduce((t, i) => t + i.mb, 0);
    const open = this.show.images, name = this.pull.value().trim();
    return v_flex().w_full().gap(G.xs)
      .child(this.head("images", "images", listed ? `${this.images.length} · ${size(total)}${spare > 0 ? ` · ${size(spare)} unused` : ""}` : "", open, c))
      // Pull is always here: a new image is one line away.
      .child(h_flex().w_full().gap(G.sm).items_center()
        .child(field("ct-pull-image", this.pull, c).flex_1().min_w(0))
        .child(quietLink("ct-pull", "Pull", () => this.pullImage(), c, { color: name ? c.text : c.border, disabled: !name })))
      .when(unused.length > 0, (el) => el.child(h_flex()
        .child(this.armed.link("ct-rmi", `Remove unused images (${size(spare)})`, `remove ${unused.length}`,
          "rmi", (cx) => this.act(["rmi", ...unused.flatMap((i) => i.tags)], cx, { ids: unused.map((i) => i.id), what: "remove images" }), c))))
      .when(open && listed, (el) => el.children(this.images.map((i) => this.imageRow(i, c, decided))));
  }

  imageRow(i, c, decided) {
    const form = this.runFor?.id === i.id ? this.runFor : null;
    return v_flex().w_full()
      .child(row(`ct-image-${i.id}`, c, {
        name: i.name, dimmed: decided && i.unused, meta: size(i.mb), pending: this.busy.has(i.id),
        second: !decided ? i.age : i.unused ? `unused · ${i.age}` : `${i.projects.join(", ")} · ${i.users.join(", ")}`,
        verbs: [
          { label: form ? "Cancel" : "Run…", onClick: (cx) => this.openRun(i, cx), color: c.text },
          decided && i.unused ? this.armed.verb("Remove", "remove", `rmi:${i.id}`, (cx) => this.act(["rmi", ...i.tags], cx, { ids: [i.id], what: "remove image" })) : null,
        ].filter(Boolean),
      }))
      .when(Boolean(form), (el) => el.child(h_flex().w_full().gap(G.sm).items_center()
        .child(field(`ct-run-name-${i.id}`, form.name, c).flex_1().min_w(0))
        .child(field(`ct-run-port-${i.id}`, form.port, c).flex_1().min_w(0))
        .child(quietLink(`ct-run-go-${i.id}`, "Run", (cx) => this.runImage(cx), c, { color: c.text }))));
  }

  volumeRow(v, c, decided) {
    return row(`ct-volume-${v.name}`, c, {
      name: v.anonymous ? v.name.slice(0, 12) : v.name, dimmed: decided && v.unused,
      detail: v.anonymous ? { text: "anonymous", tip: v.name } : null,
      second: !decided ? "" : v.unused ? "unused" : v.users.join(", "),
    });
  }

  volumesView(c) {
    const decided = this.panel.can.cleanVolumes, unused = decided ? this.volumes.filter((v) => v.unused) : [], open = this.show.volumes;
    return v_flex().w_full().gap(G.xs)
      .child(this.head("volumes", "volumes", `${this.volumes.length}${unused.length ? ` · ${unused.length} unused` : ""}`, open, c))
      .when(unused.length > 0, (el) => el.child(h_flex()
        .child(this.armed.link("ct-vrm", `Remove ${unused.length} unused volume${unused.length === 1 ? "" : "s"}`, "delete their data for good",
          "vrm", (cx) => this.act(["volume", "rm", ...unused.map((v) => v.name)], cx, { ids: unused.map((v) => v.name), what: "remove volumes" }), c))))
      .when(open, (el) => el.children(this.volumes.map((v) => this.volumeRow(v, c, decided))));
  }

  spaceView(c) {
    const cache = this.panel.spare["Build Cache"] ?? 0;
    if (cache < 1 || !this.panel.can.clearCache) return null;
    return h_flex().w_full().items_center().justify_between().gap(G.md)
      .child(div().text_size(T.value).text_color(c.muted).child(`Build cache: ${size(cache)} you can get back`))
      .child(this.armed.link("ct-cache", "Clear", "clear", "cache", (cx) => this.act(["builder", "prune", "-f"], cx, { ids: ["build-cache"], what: "clear the build cache" }), c, { color: c.text }));
  }

  body(c) {
    const { state, message, can } = this.panel;
    if (state === "missing") return div().text_size(T.value).text_color(c.dim).child("Docker is not installed on this computer.");
    if (state === "down") {
      return v_flex().gap(G.sm)
        .child(div().text_size(T.value).text_color(c.muted).child("Docker isn't running."))
        .child(h_flex().child(quietLink("ct-open-docker", "Open Docker", (cx) => this.openDocker(cx), c, { color: c.text })));
    }
    if (this.groups === null && message) {
      return failureBlock({ text: "Can't read Docker", source: message, fix: this.reading ? "" : "Read again" })("ct-failed", c, { onClick: (cx) => this.retry(cx) });
    }
    if (this.groups === null) return skeletonOf({ shape: "two lines", count: 3 })("kanso-skeleton", c);
    const all = this.groups.flatMap((g) => g.containers);
    const running = all.filter((k) => k.health === "running").length;
    const remote = Boolean(this.context?.remote);
    // What Docker costs this computer comes first: its VM keeps memory even with nothing running.
    const hero = v_flex().gap(G.md)
      .when(can.memory, (el) => el.child(v_flex().gap(G.xs)
        .child(div().text_size(T.value).text_color(c.dim).child("Docker uses of this computer's memory"))
        .child(metric({ value: typeof this.panel.held === "number" ? size(this.panel.held) : "–", unit: this.limit ? `can grow to ${size(this.limit)}` : "" })("ct-metric", c))))
      .when(remote, (el) => el.child(div().text_size(T.value).text_color(c.yellow)
        .child(`Docker context ${this.context?.name}: these containers run on ${this.context?.host}, not this computer.`)))
      .child(h_flex().items_center().gap(G.md).flex_wrap()
        .child(div().text_size(T.card).text_color(c.text).child(`${running} running`))
        .child(div().text_size(T.value).text_color(c.dim).child(`${all.length - running} stopped`))
        .when(can.quit, (el) => el.child(this.armed.link("ct-quit", running ? `Quit Docker (stops ${running})` : "Quit Docker", "quit Docker",
          "quit", (cx) => this.quitDocker(cx), c))));
    const space = this.spaceView(c);
    return v_flex().w_full().gap(32)
      .child(hero)
      .when(this.groups.length === 0, (el) => el.child(div().text_size(T.value).text_color(c.dim).child("No containers. Pull an image and run it below, or a project's compose file shows here to bring up.")))
      .children(this.groups.map((g) => this.group(g, c)))
      .child(this.imagesView(c))
      .when(this.volumes.length > 0, (el) => el.child(this.volumesView(c)))
      .when(Boolean(space), (el) => el.child(space));
  }

  render(cx) {
    this.front?.wake(cx, (frontCx) => this.refresh(frontCx));
    const c = tokens(theme()), narrow = this.width < 560;
    const header = h_flex().w_full().items_center().justify_between().gap(G.md)
      .child(div().text_size(narrow ? 17 : 20).text_color(c.text).child("Containers"))
      .child(iconButton("ct-refresh", "refresh-cw", "Read again", (cx) => this.retry(cx), c, { spin: this.reading, disabled: this.reading }));
    return v_flex().id("kanso-containers").size_full().min_h(0).bg(c.canvas).text_color(c.text).overflow_y_scrollbar()
      .on_size_change((s, sizeCx) => { if (Math.abs(this.width - s.width) >= 1) { this.width = s.width; sizeCx.notify(); } })
      .child(pageFrame(narrow, narrow ? 28 : 40, (column) => column
        .child(header)
        .child(this.body(c))
        .when(Boolean(this.error), (el) => el.child(div().text_size(T.value).text_color(c.red).child(this.error ?? "")))
        .children([this.groups === null ? null : this.panel.message, this.panel.unattributed ? UNATTRIBUTED : null, this.note].filter(Boolean)
          .map((text) => div().text_size(T.body).text_color(text === "Starting Docker…" ? c.dim : c.red).child(text)))));
  }
}

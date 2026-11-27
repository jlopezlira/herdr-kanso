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
  parseContainers, contextOf, vmPids, lookIn, urlOf, since, size, failed, okRead, failedRead, readOf, settle, panelOf, cleanupOf, proves, containerKey, idKey, pullable,
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
const LISTING = { volumes: ["volume", "ls", "--format", VOLUMES_FORMAT], images: ["images", "--no-trunc", "--format", IMAGES_FORMAT], disk: ["system", "df", "--format", "{{json .}}"] };
const CLEANING = {
  volumes: (names) => ["volume", "rm", ...names],
  images: (list) => ["rmi", ...list.flatMap((i) => (i.tags.length ? i.tags : [i.id]))],
  disk: () => ["builder", "prune", "-f"],
};
const onEngine = (name, argv) => (argv[0] === "docker" ? ["docker", "--context", name, ...argv.slice(1)] : argv);
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
  // `all` (Refresh, coming forward): everything, the memory limit and context too.
  refresh(cx, soon = false, again = false) {
    if (this.front.rests(this.snapshot !== null || this.reading)) {
      try { this.ticker?.cancel(); } catch { /* already gone */ }
      this.ticker = null;
      return;
    }
    const back = this.front.woke();
    const ask = { now: soon || back, all: again || back, again };
    this.armTicker(cx);
    const kept = this.queued;
    const next = kept || (this.reading && ask.now) ? { now: true, all: ask.all || Boolean(kept?.all), again: ask.again || Boolean(kept?.again) } : ask;
    if (this.reading) { if (next.now) this.queued = next; return; }
    this.queued = null;
    this.read(cx, next);
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
        const earlier = before.containers?.data == null ? null : parseContainers(before.containers.data);
        this.reads = this.reads + 1;
        const plan = readPlan(this.reads);
        const whole = all || !earlier;
        const inspectContext = () => ask(["context", "inspect", "--format", CONTEXT_FORMAT]);
        const cached = before.context?.state === "ok" && !all ? contextOf(before.context.data) : null;
        const [config, first] = await Promise.all([whole || plan.stored ? bounded(currentContext(), cx.timer, CALL_MS).then((v) => (v?.late ? null : v)) : null, cached ? null : inspectContext()]);
        const moved = config !== null && before.config?.data != null && config !== before.config.data;
        const known = moved ? null : cached;
        const ctx = first ?? (!known ? await inspectContext() : plan.stored ? await ask(["context", "inspect", "--format", CONTEXT_FORMAT, known.name]) : null);
        take({ config: config === null ? null : okRead(config), context: readOf(ctx, said, "context") });
        const engine = !ctx ? known : this.got.context?.state === "ok" ? contextOf(ctx.stdout) : null;
        if (!engine) return;
        const on = (args) => ask(["--context", engine.name, ...args]);
        const ps = await on(["ps", "-a", "--format", PS_FORMAT]);
        take({ containers: readOf(ps, said, "containers") });
        if (this.got.containers.state !== "ok") return;
        const found = parseContainers(ps.stdout);
        this.projects = kansoProjects();
        const set = containerKey(found), ids = idKey(found);
        const inspected = before.details?.state === "ok" ? before.details.data : null;
        const covered = inspected?.set === set;
        const fixed = whole || moved || before.limit?.state !== "ok";
        const stored = whole || now || ids !== idKey(earlier) || plan.stored || Boolean(this.pulling);
        const usage = whole || plan.stats;
        const { deep, shallow } = lookIn(this.projects.flatMap((p) => p.folders).slice(0, 24), home());
        const named = (depth, list) => within(cx.timer, strict(fileApi).walk(list, { depth: Number(depth), names: COMPOSE_FILES }).then((paths) => ({ code: 0, stdout: paths.join("\n") })));
        const [im, info, ps2, ins, vols, df, files] = await Promise.all([
          stored ? on(["images", "--no-trunc", "--format", IMAGES_FORMAT]) : null,
          fixed ? on(["info", "--format", "{{.MemTotal}}"]) : null,
          usage ? within(cx.timer, timed(processApi).memory()) : null,
          !found.length ? { code: 0, stdout: "" } : covered && !whole ? null : on(["inspect", "--format", INSPECT_FORMAT, ...found.map((c) => c.id)]),
          stored ? on(["volume", "ls", "--format", VOLUMES_FORMAT]) : null,
          stored ? on(["system", "df", "--format", "{{json .}}"]) : null,
          lookFiles(plan, again) && deep.length ? Promise.all([named("2", deep), shallow.length ? named("1", shallow) : { code: 0, stdout: "" }])
            .then((both) => both.find(failed) ?? { code: 0, stdout: both.map((r) => r.stdout ?? "").join("\n") }) : null]);
        const details = readOf(ins, said, "details");
        take({
          images: readOf(im, said, "images"), limit: readOf(info, said), memory: readOf(ps2, firstLine),
          details: details && (details.state === "ok" ? okRead({ set, text: ins.stdout }) : details),
          volumes: readOf(vols, said, "volumes"), disk: readOf(df, said, "disk"), files: readOf(files, firstLine),
        });
        if (im?.code === 0 && this.pulling) this.pulling = im.stdout === this.pulling.seen && this.pulling.left > 1 ? { ...this.pulling, left: this.pulling.left - 1 } : null;
        const openFiles = ps2?.code === 0 ? await bounded(timed(processApi).openFiles(vmPids(ps2.stdout)).catch(unread), cx.timer, CALL_MS)
          .then((r) => (r?.late ? unread(firstLine(r)) : r)) : null;
        take({ attribution: openFiles && (openFiles.state === "error" ? failedRead(openFiles.reason) : okRead(openFiles)) });
        take({ stats: usage ? readOf(await on(["stats", "--no-stream", "--format", STATS_FORMAT]), said) : null });
      } catch (e) {
        this.thrown = String(e?.message ?? e);
      } finally {
        this.conclude(n);
        this.reading = false;
        const next = this.queued;
        if (!next || this.front.rests(true)) { cx.notify(); return; }
        this.queued = null;
        this.read(cx, next);
      }
    });
  }

  conclude(n) {
    this.snapshot = settle(this.snapshot, { n, reads: this.got, thrown: this.thrown, time: Date.now() });
    if (this.got.containers?.state === "ok") this.note = null;
    try {
      this.panel = this.derive();
    } catch (e) {
      this.snapshot = settle(this.snapshot, { n, reads: {}, thrown: String(e?.message ?? e) });
      this.panel = panelOf(this.snapshot, { projects: this.projects });
    }
    if (this.armed.key?.startsWith("clean:") && !this.panel.keys.has(this.armed.key)) this.armed.clear();
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
    return panelOf(this.snapshot, { projects: this.projects, names: all, now: Date.now() });
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

  clean(target, what, cx) {
    const items = Array.isArray(target.items) ? target.items.map((x) => `${target.kind}:${x.id ?? x}`) : [];
    this.hold([`clean:${target.kind}`, ...items], cx, async (cx) => {
      const proven = await this.prove(target.kind, target.engine.name, cx);
      if (!proves(target, proven)) { this.armed.clear(); this.refresh(cx, true, true); return; }
      const r = await within(cx.timer, docker(["--context", target.engine.name, ...CLEANING[target.kind](target.items)], ACT_MS), ACT_MS);
      this.error = r.code === 0 ? null : `${what} failed: ${firstLine(r)}`;
    });
  }

  async prove(kind, name, cx) {
    const ask = (args) => within(cx.timer, docker(args));
    const on = (args) => ask(["--context", name, ...args]);
    const ctx = await ask(["context", "inspect", "--format", CONTEXT_FORMAT, name]);
    if (readOf(ctx, said, "context").state !== "ok") return null;
    const ps = await on(["ps", "-a", "--format", PS_FORMAT]);
    if (readOf(ps, said, "containers").state !== "ok") return null;
    const found = parseContainers(ps.stdout);
    const [ins, list] = await Promise.all([found.length ? on(["inspect", "--format", INSPECT_FORMAT, ...found.map((c) => c.id)]) : { code: 0, stdout: "" }, on(LISTING[kind])]);
    if (readOf(ins, said, "details").state !== "ok" || readOf(list, said, kind).state !== "ok") return null;
    return cleanupOf({ context: ctx.stdout, containers: ps.stdout, details: { set: containerKey(found), text: ins.stdout }, [kind]: list.stdout });
  }

  containers(verb, list, cx) {
    const free = list.filter((c) => !this.busy.has(`containers:${c.id}`)), name = this.panel.engine?.name;
    if (free.length && name) this.act(["--context", name, verb, ...free.map((c) => c.id)], cx, { ids: free.map((c) => `containers:${c.id}`), what: verb });
  }

  pullImage() {
    const name = this.pull.value().trim();
    const engine = this.panel.engine?.name;
    if (!engine || !pullable(name)) return;
    inTab(`pull ${name}`, onEngine(engine, ["docker", "pull", name]));
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
    this.runFor = { id: image.id, target: image.tags[0] ?? image.id, engine: this.panel.engine, name, port };
    name.focus();
    cx.notify();
  }

  runnable(f) {
    const now = this.panel.engine;
    return Boolean(f?.engine && now && f.engine.name === now.name && f.engine.host === now.host && this.panel.images?.find((i) => i.id === f.id)?.run);
  }

  runImage(cx) {
    const f = this.runFor;
    if (!f) return;
    const name = f.name.value().trim(), port = f.port.value().trim();
    if (port && !/^\d+(:\d+)?$/.test(port)) { this.error = "Port: a number, or host:container like 8080:80."; cx.notify(); return; }
    if (name && !/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(name)) { this.error = "Name: letters, digits, _ . or -, starting with a letter or digit."; cx.notify(); return; }
    if (!this.runnable(f)) return;
    const args = ["--context", f.engine.name, "run", "-d", ...(name ? ["--name", name] : []), ...(port ? ["-p", port.includes(":") ? port : `${port}:${port}`] : []), f.target];
    this.closeRun();
    this.act(args, cx, { what: "run" });
  }

  // In the stack's folder with no -f, so Compose reads its file and override as it would itself;
  // under the project name a running stack has, so Down and Up reach the same containers.
  stack(s, verb) {
    const args = { up: ["up", "-d"], down: ["down"], rebuild: ["up", "-d", "--build"] }[verb], engine = this.panel.engine?.name;
    if (!engine || !s.verbs[verb]) return;
    inTab(`${s.name} ${verb}`, ["docker", "--context", engine, "compose", ...(s.compose ? ["-p", s.compose] : []), ...(s.files ?? []).flatMap((f) => ["-f", f]), ...args], s.dir);
  }

  // Docker Desktop's own command, else asked to quit like any app: the VM ends and its memory comes back.
  quitDocker(cx) {
    const name = this.panel.engine?.name;
    this.hold([DOCKER], cx, async (cx) => {
      const where = name ? await within(cx.timer, docker(["context", "inspect", "--format", CONTEXT_FORMAT, name])) : null;
      if (!where || readOf(where, said, "context").state !== "ok" || !contextOf(where.stdout)?.local) { this.refresh(cx, true, true); return; }
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

  row(k, c) {
    const busy = this.busy.has(`containers:${k.id}`), open = this.opened.has(k.id) && k.verbs.details, { verbs: can, mem } = k, engine = this.panel.engine?.name;
    const tone = HEALTH_TONES[k.health];
    const act = (verb) => (cx) => { if (!busy) this.containers(verb, [k], cx); };
    const verbs = [
      ...can.copy.map((p) => ({ label: `:${p.port}`, spoken: `Copy localhost:${p.port}`, onClick: (cx) => cx.write_to_clipboard?.(`localhost:${p.port}`) })),
      can.toggle ? { label: busy ? "Working…" : can.toggle === "stop" ? "Stop" : "Start", onClick: act(can.toggle), color: c.text, disabled: busy } : null,
      can.restart ? { label: "Restart", onClick: act("restart"), disabled: busy } : null,
      can.open ? { label: "Open", onClick: (cx) => cx.open_url(urlOf(can.open)) } : null,
      can.shell ? { label: "Shell", onClick: () => inTab(`shell ${k.service ?? k.name}`, onEngine(engine, localService(systemApi).containerShell(k.name, this.details.get(k.id.slice(0, 12))?.platform))) } : null,
      can.logs ? { label: "Logs", onClick: () => inTab(`logs ${k.service ?? k.name}`, ["docker", "--context", engine, "logs", "-f", "--tail", "200", k.name]) } : null,
      can.details ? { label: open ? "Less" : "Details", onClick: (cx) => { this.opened = open ? new Set([...this.opened].filter((x) => x !== k.id)) : new Set([...this.opened, k.id]); cx.notify(); } } : null,
      can.remove ? this.armed.verb("Remove", "remove", `rm:${k.id}`, (cx) => this.containers("rm", [k], cx), { disabled: busy }) : null,
    ].filter(Boolean);
    return v_flex().w_full()
      .child(row(`ct-${k.id}`, c, {
        name: k.service ?? k.name, dimmed: k.stale,
        detail: tone ? { text: since(k), tone } : since(k),
        meta: typeof mem === "number" && k.health === "running" ? size(mem) : null,
        second: [k.image, k.service ? k.name : null, ...(this.panel.remote ? k.ports.slice(0, 3).map((p) => `:${p.port}`) : [])],
        verbs,
        pending: busy,
      }))
      .when(open, (el) => el.child(this.detailsView(k, c)));
  }

  stackRow(s, c) {
    const state = !s.count ? null : s.count.total === 0 ? "not started" : `${s.count.running} of ${s.count.total} running`;
    const id = `${s.dir}:${s.compose ?? ""}`;
    return row(`ct-stack-${id}`, c, {
      name: s.compose && s.compose !== s.name ? s.compose : s.name, dimmed: s.stale,
      detail: [{ text: "compose", tip: s.file }, state].filter(Boolean),
      verbs: [
        s.verbs.up ? { label: s.count?.running ? "Up again" : "Up", onClick: () => this.stack(s, "up"), color: c.text } : null,
        s.verbs.rebuild ? { label: "Rebuild", onClick: () => this.stack(s, "rebuild") } : null,
        s.verbs.down ? this.armed.verb("Down", "take it down", `down:${id}`, () => this.stack(s, "down")) : null,
      ].filter(Boolean),
    });
  }

  group(g, c) {
    return v_flex().w_full().gap(G.xs)
      .child(h_flex().w_full().flex_wrap().items_end().justify_between().gap_x(G.md).gap_y(G.xs).pb(G.xs)
        .child(div().min_w(0).flex_shrink(1).truncate().text_size(T.title).text_color(g.project === OTHER ? c.muted : c.text).child(g.project))
        .child(h_flex().flex_none().gap(G.md).items_center()
          .when(Boolean(g.count?.total), (el) => el.child(div().text_size(T.body).text_color(c.dim).child(`${g.count?.running} of ${g.count?.total} running`)))
          .when(g.startAll.length > 0, (el) => el.child(quietLink(`ct-start-all-${g.project}`, "Start all", (cx) => this.containers("start", g.startAll, cx), c)))
          .when(g.stopAll.length > 0, (el) => el.child(quietLink(`ct-stop-all-${g.project}`, "Stop all", (cx) => this.containers("stop", g.stopAll, cx), c)))))
      .children(g.stacks.map((s) => this.stackRow(s, c)))
      .children(g.containers.map((k) => this.row(k, c)));
  }

  head(id, title, note, open, c) {
    return h_flex().w_full().items_end().justify_between().gap(G.md).pb(G.xs)
      .child(quietLink(`ct-${id}`, `${open ? "Hide" : "Show"} ${title}`, (cx) => { this.show = { ...this.show, [id]: !open }; cx.notify(); }, c, { color: c.text }))
      .child(div().min_w(0).truncate().text_size(T.body).text_color(c.dim).child(note));
  }

  imagesView(c) {
    const { imagesSummary: summary, targets, can } = this.panel, open = this.show.images, name = this.pull.value().trim();
    const ready = pullable(name) && can.pull, wrong = Boolean(name) && !pullable(name);
    const spare = summary?.spare ?? 0;
    return v_flex().w_full().gap(G.xs)
      .child(this.head("images", "images", summary ? `${summary.count} · ${size(summary.mb)}${spare > 0 ? ` · ${size(spare)} unused` : ""}` : "", open, c))
      .child(h_flex().w_full().gap(G.sm).items_center()
        .child(field("ct-pull-image", this.pull, c, { error: wrong }).flex_1().min_w(0))
        .child(quietLink("ct-pull", "Pull", () => this.pullImage(), c, { color: ready ? c.text : c.border, disabled: !ready })))
      .when(wrong, (el) => el.child(div().text_size(T.body).text_color(c.red).child("An image name has no spaces and does not start with -, such as nginx:alpine")))
      .when(Boolean(targets.images), (el) => el.child(h_flex()
        .child(this.armed.link("ct-rmi", `Remove unused images (${size(spare)})`, `remove ${targets.images?.items.length}`,
          targets.images?.key, (cx) => this.clean(targets.images, "remove images", cx), c))))
      .when(open && Boolean(this.panel.images), (el) => el.children(this.images.map((i) => this.imageRow(i, c))));
  }

  imageRow(i, c) {
    const form = this.runFor?.id === i.id ? this.runFor : null;
    return v_flex().w_full()
      .child(row(`ct-image-${i.id}`, c, {
        name: i.name, dimmed: i.stale || i.unused, meta: size(i.mb), pending: this.busy.has(`images:${i.id}`),
        second: !i.known ? i.age : i.unused ? `unused · ${i.age}` : `${i.projects.join(", ")} · ${i.users.join(", ")}`,
        verbs: [
          i.run ? { label: form ? "Cancel" : "Run…", onClick: (cx) => this.openRun(i, cx), color: c.text } : null,
          i.target ? this.armed.verb("Remove", "remove", i.target.key, (cx) => this.clean(i.target, "remove image", cx)) : null,
        ].filter(Boolean),
      }))
      .when(Boolean(form), (el) => el.child(h_flex().w_full().gap(G.sm).items_center()
        .child(field(`ct-run-name-${i.id}`, form.name, c).flex_1().min_w(0))
        .child(field(`ct-run-port-${i.id}`, form.port, c).flex_1().min_w(0))
        .when(this.runnable(form), (el) => el.child(quietLink(`ct-run-go-${i.id}`, "Run", (cx) => this.runImage(cx), c, { color: c.text })))));
  }

  volumeRow(v, c) {
    return row(`ct-volume-${v.name}`, c, {
      name: v.anonymous ? v.name.slice(0, 12) : v.name, dimmed: v.stale || v.unused, pending: this.busy.has(`volumes:${v.name}`),
      detail: v.anonymous ? { text: "anonymous", tip: v.name } : null,
      second: !v.known ? "" : v.unused ? "unused" : v.users.join(", "),
    });
  }

  volumesView(c) {
    const { volumesSummary: summary, targets } = this.panel, open = this.show.volumes, unused = targets.volumes?.items.length ?? 0;
    return v_flex().w_full().gap(G.xs)
      .child(this.head("volumes", "volumes", summary ? `${summary.count}${unused ? ` · ${unused} unused` : ""}` : "", open, c))
      .when(unused > 0, (el) => el.child(h_flex()
        .child(this.armed.link("ct-vrm", `Remove ${unused} unused volume${unused === 1 ? "" : "s"}`, "delete their data for good",
          targets.volumes?.key, (cx) => this.clean(targets.volumes, "remove volumes", cx), c))))
      .when(open, (el) => el.children(this.volumes.map((v) => this.volumeRow(v, c))));
  }

  spaceView(c) {
    const cache = this.panel.cleanup.disk;
    if (!this.panel.can.clearCache) return null;
    return h_flex().w_full().items_center().justify_between().gap(G.md)
      .child(div().text_size(T.value).text_color(c.muted).child(`Build cache: ${size(cache)} you can get back`))
      .child(this.armed.link("ct-cache", "Clear", "clear", this.panel.targets.disk.key, (cx) => this.clean(this.panel.targets.disk, "clear the build cache", cx), c, { color: c.text }));
  }

  body(c) {
    const { state, message, can, counts, remote, context } = this.panel;
    if (state === "missing") return div().text_size(T.value).text_color(c.dim).child("Docker is not installed on this computer.");
    if (state === "down") {
      return v_flex().gap(G.sm)
        .child(div().text_size(T.value).text_color(c.muted).child("Docker isn't running."))
        .when(can.open, (el) => el.child(h_flex().child(quietLink("ct-open-docker", "Open Docker", (cx) => this.openDocker(cx), c, { color: c.text }))));
    }
    if (this.groups === null && message) {
      return failureBlock({ text: "Can't read Docker", source: message, fix: this.reading ? "" : "Refresh" })("ct-failed", c, { onClick: (cx) => this.retry(cx) });
    }
    if (this.groups === null) return skeletonOf({ shape: "two lines", count: 3 })("kanso-skeleton", c);
    const running = counts?.running ?? 0;
    // What Docker costs this computer comes first: its VM keeps memory even with nothing running.
    const hero = v_flex().gap(G.md)
      .when(can.memory, (el) => el.child(v_flex().gap(G.xs)
        .child(div().text_size(T.value).text_color(c.dim).child("Docker uses of this computer's memory"))
        .child(metric({ value: typeof this.panel.held === "number" ? size(this.panel.held) : "–", unit: this.limit ? `can grow to ${size(this.limit)}` : "" })("ct-metric", c))))
      .when(remote, (el) => el.child(div().text_size(T.value).text_color(c.yellow)
        .child(`Docker context ${context?.name}: these containers run on ${context?.host}, not this computer.`)))
      .child(h_flex().items_center().gap(G.md).flex_wrap()
        .when(Boolean(counts), (el) => el
          .child(div().text_size(T.card).text_color(c.text).child(`${running} running`))
          .child(div().text_size(T.value).text_color(c.dim).child(`${counts?.stopped} stopped`)))
        .when(can.quit, (el) => el.child(this.armed.link("ct-quit", running ? `Quit Docker (stops ${running})` : "Quit Docker", "quit Docker",
          "quit", (cx) => this.quitDocker(cx), c))));
    const space = this.spaceView(c);
    return v_flex().w_full().gap(32)
      .child(hero)
      .when(this.panel.empty, (el) => el.child(div().text_size(T.value).text_color(c.dim).child("No containers. Pull an image and run it below, or a project's compose file shows here to bring up.")))
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
      .child(iconButton("ct-refresh", "refresh-cw", "Refresh", (cx) => this.retry(cx), c, { spin: this.reading, disabled: this.reading }));
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

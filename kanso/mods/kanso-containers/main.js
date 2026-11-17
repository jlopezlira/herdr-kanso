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
import { G, tokens } from "./ui.js";
import { Armed, quietLink, iconButton } from "./ui-button.js";
import { field, TextField } from "./ui-field.js";
import { row } from "./ui-row.js";
import { skeletonOf } from "./kit.js";
import { afterMount, parseOr } from "./pure.js";
import { pageFrame } from "./page.js";
import { Front } from "./front.js";
import {
  PS_FORMAT, IMAGES_FORMAT, STATS_FORMAT, INSPECT_FORMAT, CONTEXT_FORMAT, VOLUMES_FORMAT, COMPOSE_FILES, OTHER,
  parseContainers, parseInspect, contextOf, parseImages, parseStats, vmPids, dockerVms, dockerHeld, byProject, imageRows,
  volumeRows, reclaimable, composeFiles, knownStacks, lookIn, isWeb, urlOf, since, size, daemonDown,
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

const docker = (args) => exec("docker", args);
const fail = (e) => ({ code: 1, stdout: "", stderr: String(e?.message ?? e) });
const firstLine = (r) => (r.stderr || r.stdout || "").trim().split("\n")[0];
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
    this.groups = null;       // [{ project, containers, stacks, running }], null until first read
    this.images = []; this.volumes = []; this.spare = {}; this.files = [];
    this.state = "reading";   // reading, ok, down (no daemon), missing (no docker)
    this.note = null;         // what the last read could not do
    this.error = null;        // what the last action could not do, until the next action
    this.busy = new Set();    // container ids being changed
    this.reading = false;
    this.seq = 0;             // the latest read; an older one finishing late is dropped
    this.show = { images: false, volumes: false };
    this.opened = new Set();  // containers showing their details
    this.armed = new Armed();
    this.width = 368;
    this.mem = new Map(); this.details = new Map();
    this.held = null; this.limit = null; this.context = null; this.unattributed = false;
    this.known = null;        // what the last read saw, null until Docker answered: read everything then
    this.imagesText = ""; this.volumesText = "";
    this.pulling = null;      // a pull in a tab: images read each time until they change
    this.reads = 0;
    this.front = new Front();
    this.names = new Map();   // compose folder -> [{ name, files }] seen there, so Up after Down uses them
    this.namesKey = null;     // the Docker context they belong to
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
    const now = soon || back, all = again || back;
    this.armTicker(cx);
    if (this.reading && !now) return;
    this.reading = true;
    this.seq = this.seq + 1;
    const seq = this.seq;
    const down = () => { this.state = "down"; this.groups = []; this.images = []; this.volumes = []; this.known = null; };
    cx.spawn(async (cx) => {
      try {
        const ps = await docker(["ps", "-a", "--format", PS_FORMAT]);
        if (seq !== this.seq) return;
        if (daemonDown(ps)) { down(); return; }
        if (ps.code !== 0) { this.note = `Docker said: ${firstLine(ps)}`; return; }
        const found = parseContainers(ps.stdout);
        const projects = kansoProjects();
        this.reads = this.reads + 1;
        const plan = readPlan(this.reads);
        const lookFiles = plan.files || again;
        // First read, Read again, coming forward, or Docker back after being down: everything.
        const whole = all || !this.known;
        const set = containerKey(found), ids = idKey(found);
        const changed = set !== this.known?.containers;
        const config = whole || plan.stored ? await currentContext() : null;
        if (seq !== this.seq) return;
        const fixed = whole || !this.known.fixed || (config !== null && config !== this.known.config);
        const stored = whole || now || ids !== this.known?.ids || plan.stored || Boolean(this.pulling);
        const usage = whole || plan.stats;
        const { deep, shallow } = lookIn(projects.flatMap((p) => p.folders).slice(0, 24), home());
        const named = (depth, list) => localService(fileApi).walk(list, { depth: Number(depth), names: COMPOSE_FILES }).then((paths) => ({ code: 0, stdout: paths.join("\n") })).catch(fail);
        const [im, info, ps2, ins, ctx, vols, df, files] = await Promise.all([
          stored ? docker(["images", "--no-trunc", "--format", IMAGES_FORMAT]).catch(fail) : null,
          fixed ? docker(["info", "--format", "{{.MemTotal}}"]).catch(fail) : null,
          usage ? localService(processApi).memory().catch(fail) : null,
          !found.length ? { code: 0, stdout: "" } : whole || changed ? docker(["inspect", "--format", INSPECT_FORMAT, ...found.map((c) => c.id)]).catch(fail) : null,
          fixed ? docker(["context", "inspect", "--format", CONTEXT_FORMAT]).catch(fail) : null,
          stored ? docker(["volume", "ls", "--format", VOLUMES_FORMAT]).catch(fail) : null,
          stored ? docker(["system", "df", "--format", "{{json .}}"]).catch(fail) : null,
          lookFiles && deep.length ? Promise.all([named("2", deep), shallow.length ? named("1", shallow) : { stdout: "" }])
            .then(([a, b]) => ({ code: 0, stdout: `${a.stdout ?? ""}\n${b.stdout ?? ""}` })) : null]);
        const vms = ps2 ? vmPids(ps2.stdout) : [];
        const openFiles = ps2 ? await localService(processApi).openFiles(vms).catch(() => ({ state: "error", values: [] })) : null;
        const owned = dockerVms(openFiles?.values ?? []);
        const st = usage ? await docker(["stats", "--no-stream", "--format", STATS_FORMAT]).catch(() => null) : null;
        if (seq !== this.seq) return;
        // Docker quit while this read went on: say so rather than show what ran before.
        if ([im, info, st, vols].some(daemonDown)) { down(); return; }
        if (ctx) this.context = ctx.code === 0 ? contextOf(ctx.stdout) : null;
        if (info) this.limit = Number(info.stdout) > 0 ? Number(info.stdout) / 1e6 : null;
        // Docker on another machine: what this computer holds says nothing about it.
        if (ps2) this.held = ps2.code === 0 && openFiles.state === "ok" && !this.context?.remote ? dockerHeld(ps2.stdout, owned) : null;
        if (openFiles) this.unattributed = openFiles.state === "unavailable";
        if (st?.code === 0) this.mem = parseStats(st.stdout);
        if (files) this.files = composeFiles(files.stdout);
        if (ins) this.details = ins.code === 0 ? parseInspect(ins.stdout) : new Map();
        // A failed limit or context is asked again on the next read.
        this.known = { containers: !ins || ins.code === 0 ? set : null, ids, fixed: fixed ? info.code === 0 && ctx.code === 0 : this.known?.fixed ?? false,
          config: config ?? this.known?.config ?? null };
        const withDetails = found.map((c) => { const d = this.details.get(c.id.slice(0, 12)); return { ...c, imageId: d?.imageId ?? null, mounts: d?.mounts ?? [] }; });
        const key = namesKey(this.context);
        if (key !== this.namesKey) { this.namesKey = key; this.names = savedNames(key); }
        const fresh = [...new Set(withDetails.filter((c) => c.dir && c.compose).map((c) => c.dir))].map((d) => {
          const now = withDetails.filter((c) => c.dir === d && c.compose).map((c) => ({ name: c.compose, files: c.files ?? [] }));
          const merged = [...(this.names.get(d) ?? []).filter((k) => !now.some((x) => x.name === k.name)), ...now];
          return [d, merged.filter((k, i) => merged.findIndex((x) => x.name === k.name) === i)];
        });
        if (fresh.length) {
          this.names = new Map([...this.names, ...fresh]);
          if (JSON.stringify(Object.fromEntries(this.names)) !== JSON.stringify(shared(key) ?? {})) setShared(key, Object.fromEntries(this.names));
        }
        const groups = byProject(withDetails, projects, this.context?.remote ? [] : knownStacks(this.files, withDetails, this.names), this.names);
        this.groups = groups;
        if (im) {
          if (this.pulling) this.pulling = im.stdout === this.pulling.seen && this.pulling.left > 1 ? { ...this.pulling, left: this.pulling.left - 1 } : null;
          this.imagesText = im.stdout;
        }
        if (vols) this.volumesText = vols.code === 0 ? vols.stdout : "";
        this.images = imageRows(parseImages(this.imagesText), groups);
        this.volumes = volumeRows(this.volumesText, groups.flatMap((g) => g.containers));
        if (df?.code === 0) this.spare = reclaimable(df.stdout);
        this.state = "ok"; this.note = this.unattributed && !this.context?.remote ? "Docker VM memory attribution requires a Herdr API on Windows." : null;
      } catch {
        if (seq === this.seq) { this.state = "missing"; this.groups = []; this.images = []; this.volumes = []; this.known = null; }
      } finally { if (seq === this.seq) { this.reading = false; cx.notify(); } }
    });
  }

  // Short `docker` commands; `ids` are rows to dim until Docker has made the change.
  act(args, cx, { ids = [], what = args[0] } = {}) {
    this.busy = new Set([...this.busy, ...ids]);
    cx.notify();
    cx.spawn(async (cx) => {
      const r = await docker(args).catch(fail);
      this.error = r.code === 0 ? null : `${what} failed: ${firstLine(r)}`;
      this.busy = new Set([...this.busy].filter((id) => !ids.includes(id)));
      this.refresh(cx, true);
    });
  }

  containers(verb, list, cx) { this.act([verb, ...list.map((c) => c.id)], cx, { ids: list.map((c) => c.id) }); }

  pullImage() {
    const name = this.pull.value().trim();
    // A name, never an option: docker would take "-…" as one.
    if (!name || /\s/.test(name) || name.startsWith("-")) return;
    inTab(`pull ${name}`, ["docker", "pull", name]);
    this.pulling = { seen: this.imagesText, left: PULL_READS };
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
    cx.spawn(async (cx) => {
      const r = await docker(["desktop", "stop"]).catch(() => null);
      const q = r?.code === 0 ? r : await localService(systemApi).stopDocker().catch(fail);
      this.error = q.code === 0 ? null : `Docker did not quit: ${firstLine(q)}`;
      this.refresh(cx, true);
    });
  }

  openDocker(cx) {
    cx.spawn(async (cx) => {
      const r = await localService(systemApi).startDocker().catch(fail);
      this.note = r.code === 0 ? "Starting Docker…" : null;
      this.error = r.code === 0 ? null : "Docker could not be opened from here: open it yourself.";
      cx.notify();
    });
  }

  detailsView(k, c) {
    const d = this.details.get(k.id.slice(0, 12));
    if (!d) return div().pl(15).text_size(11.5).text_color(c.dim).child("No details from Docker.");
    const line = (label, text) => h_flex().w_full().gap(G.sm).items_start()
      .child(div().w(64).flex_none().text_size(11).text_color(c.dim).child(label))
      .child(div().flex_1().min_w(0).text_size(11.5).text_color(c.muted).child(text));
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
    const mem = this.mem.get(k.id.slice(0, 12));
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
    return v_flex().w_full().gap(4)
      .child(h_flex().w_full().flex_wrap().items_end().justify_between().gap_x(G.md).gap_y(G.xs).pb(G.xs)
        .child(div().min_w(0).flex_shrink(1).truncate().text_size(15).text_color(g.project === OTHER ? c.muted : c.text).child(g.project))
        .child(h_flex().flex_none().gap(G.md).items_center()
          .when(g.containers.length > 0, (el) => el.child(div().text_size(12).text_color(c.dim).child(`${g.running} of ${g.containers.length} running`)))
          .when(stopped.length > 1, (el) => el.child(quietLink(`ct-start-all-${g.project}`, "Start all", (cx) => this.containers("start", stopped, cx), c)))
          .when(running.length > 1, (el) => el.child(quietLink(`ct-stop-all-${g.project}`, "Stop all", (cx) => this.containers("stop", running, cx), c)))))
      .children(g.stacks.map((s) => this.stackRow(s, c)))
      .children(g.containers.map((k) => this.row(k, c)));
  }

  head(id, title, note, open, c) {
    return h_flex().w_full().items_end().justify_between().gap(G.md).pb(G.xs)
      .child(quietLink(`ct-${id}`, `${open ? "Hide" : "Show"} ${title}`, (cx) => { this.show = { ...this.show, [id]: !open }; cx.notify(); }, c, { color: c.text }))
      .child(div().min_w(0).truncate().text_size(12).text_color(c.dim).child(note));
  }

  imagesView(c) {
    const unused = this.images.filter((i) => i.unused);
    const total = this.images.reduce((t, i) => t + i.mb, 0), spare = unused.reduce((t, i) => t + i.mb, 0);
    const open = this.show.images, name = this.pull.value().trim();
    return v_flex().w_full().gap(4)
      .child(this.head("images", "images", `${this.images.length} · ${size(total)}${spare > 0 ? ` · ${size(spare)} unused` : ""}`, open, c))
      // Pull is always here: a new image is one line away.
      .child(h_flex().w_full().gap(G.sm).items_center()
        .child(field("ct-pull-image", this.pull, c).flex_1().min_w(0))
        .child(quietLink("ct-pull", "Pull", () => this.pullImage(), c, { color: name ? c.text : c.border, disabled: !name })))
      .when(unused.length > 0, (el) => el.child(h_flex()
        .child(this.armed.link("ct-rmi", `Remove unused images (${size(spare)})`, `remove ${unused.length}`,
          "rmi", (cx) => this.act(["rmi", ...unused.flatMap((i) => i.tags)], cx, { what: "remove images" }), c))))
      .when(open, (el) => el.children(this.images.map((i) => this.imageRow(i, c))));
  }

  imageRow(i, c) {
    const form = this.runFor?.id === i.id ? this.runFor : null;
    return v_flex().w_full()
      .child(row(`ct-image-${i.id}`, c, {
        name: i.name, dimmed: i.unused, meta: size(i.mb),
        second: i.unused ? `unused · ${i.age}` : `${i.projects.join(", ")} · ${i.users.join(", ")}`,
        verbs: [
          { label: form ? "Cancel" : "Run…", onClick: (cx) => this.openRun(i, cx), color: c.text },
          i.unused ? this.armed.verb("Remove", "remove", `rmi:${i.id}`, (cx) => this.act(["rmi", ...i.tags], cx, { what: "remove image" })) : null,
        ].filter(Boolean),
      }))
      .when(Boolean(form), (el) => el.child(h_flex().w_full().gap(G.sm).items_center()
        .child(field(`ct-run-name-${i.id}`, form.name, c).flex_1().min_w(0))
        .child(field(`ct-run-port-${i.id}`, form.port, c).flex_1().min_w(0))
        .child(quietLink(`ct-run-go-${i.id}`, "Run", (cx) => this.runImage(cx), c, { color: c.text }))));
  }

  volumeRow(v, c) {
    return row(`ct-volume-${v.name}`, c, {
      name: v.anonymous ? v.name.slice(0, 12) : v.name, dimmed: v.unused,
      detail: v.anonymous ? { text: "anonymous", tip: v.name } : null,
      second: v.unused ? "unused" : v.users.join(", "),
    });
  }

  volumesView(c) {
    const unused = this.volumes.filter((v) => v.unused), open = this.show.volumes;
    return v_flex().w_full().gap(4)
      .child(this.head("volumes", "volumes", `${this.volumes.length}${unused.length ? ` · ${unused.length} unused` : ""}`, open, c))
      .when(unused.length > 0, (el) => el.child(h_flex()
        .child(this.armed.link("ct-vrm", `Remove ${unused.length} unused volume${unused.length === 1 ? "" : "s"}`, "delete their data for good",
          "vrm", (cx) => this.act(["volume", "rm", ...unused.map((v) => v.name)], cx, { what: "remove volumes" }), c))))
      .when(open, (el) => el.children(this.volumes.map((v) => this.volumeRow(v, c))));
  }

  spaceView(c) {
    const cache = this.spare["Build Cache"] ?? 0;
    if (cache < 1) return null;
    return h_flex().w_full().items_center().justify_between().gap(G.md)
      .child(div().text_size(12.5).text_color(c.muted).child(`Build cache: ${size(cache)} you can get back`))
      .child(this.armed.link("ct-cache", "Clear", "clear", "cache", (cx) => this.act(["builder", "prune", "-f"], cx, { what: "clear the build cache" }), c, { color: c.text }));
  }

  body(c) {
    if (this.state === "missing") return div().text_size(13).text_color(c.dim).child("Docker is not installed on this computer.");
    if (this.state === "down") {
      return v_flex().gap(G.sm)
        .child(div().text_size(13).text_color(c.muted).child("Docker isn't running."))
        .child(h_flex().child(quietLink("ct-open-docker", "Open Docker", (cx) => this.openDocker(cx), c, { color: c.text })));
    }
    if (this.groups === null) return skeletonOf({ shape: "two lines", count: 3 })("kanso-skeleton", c);
    const all = this.groups.flatMap((g) => g.containers);
    const running = all.filter((k) => k.health === "running").length;
    const remote = Boolean(this.context?.remote);
    // What Docker costs this computer comes first: its VM keeps memory even with nothing running.
    const hero = v_flex().gap(G.md)
      .when(!remote, (el) => el.child(v_flex().gap(4)
        .child(div().text_size(12.5).text_color(c.dim).child("Docker uses of this computer's memory"))
        .child(h_flex().items_end().gap(G.md).flex_wrap()
          .child(div().text_size(48).line_height(1).font_light().text_color(c.text).child(typeof this.held === "number" ? size(this.held) : "–"))
          .when(Boolean(this.limit), (el2) => el2.child(div().pb(6).text_size(13).text_color(c.dim).child(`can grow to ${size(this.limit)}`))))))
      .when(remote, (el) => el.child(div().text_size(12.5).text_color(c.yellow)
        .child(`Docker context ${this.context?.name}: these containers run on ${this.context?.host}, not this computer.`)))
      .child(h_flex().items_center().gap(G.md).flex_wrap()
        .child(div().text_size(13).text_color(c.text).child(`${running} running`))
        .child(div().text_size(13).text_color(c.dim).child(`${all.length - running} stopped`))
        .when(!remote, (el) => el.child(this.armed.link("ct-quit", running ? `Quit Docker (stops ${running})` : "Quit Docker", "quit Docker",
          "quit", (cx) => this.quitDocker(cx), c))));
    const space = this.spaceView(c);
    return v_flex().w_full().gap(32)
      .child(hero)
      .when(this.groups.length === 0, (el) => el.child(div().text_size(13).text_color(c.dim).child("No containers. Pull an image and run it below, or a project's compose file shows here to bring up.")))
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
      .child(iconButton("ct-refresh", "refresh-cw", "Read again", (cx) => this.refresh(cx, true, true), c, { spin: this.reading }));
    return v_flex().id("kanso-containers").size_full().min_h(0).bg(c.canvas).text_color(c.text).overflow_y_scrollbar()
      .on_size_change((s, sizeCx) => { if (Math.abs(this.width - s.width) >= 1) { this.width = s.width; sizeCx.notify(); } })
      .child(pageFrame(narrow, narrow ? 28 : 40, (column) => column
        .child(header)
        .child(this.body(c))
        .when(Boolean(this.error), (el) => el.child(div().text_size(12).text_color(c.red).child(this.error ?? "")))
        .when(Boolean(this.note), (el) => el.child(div().text_size(12).text_color(this.note === "Starting Docker…" ? c.dim : c.red).child(this.note ?? "")))));
  }
}

import { localService } from "./platform-host.js";
import { paths } from "./platform-paths.js";
import { processApi } from "./platform-processes.js";
import { fileApi } from "./platform-files.js";
import { systemApi } from "./platform-system.js";
// Containers, by jlopezlira (https://github.com/jlopezlira/herdr-kanso). Apache-2.0.
// Docker, simply: what runs and for which project, and everything you'd open Docker Desktop for.
import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { exec, run, spaces, panes, home, theme, shared, setShared } from "herdr";
import { G, Armed, tokens, quietLink, iconButton, ghost, breathe } from "./ui.js";
import { afterMount } from "./pure.js";
import {
  PS_FORMAT, IMAGES_FORMAT, STATS_FORMAT, INSPECT_FORMAT, CONTEXT_FORMAT, VOLUMES_FORMAT, COMPOSE_FILES, OTHER,
  parseContainers, parseInspect, contextOf, parseImages, parseStats, vmPids, dockerVms, dockerHeld, byProject, imageRows,
  volumeRows, reclaimable, composeFiles, knownStacks, lookIn, isWeb, urlOf, since, size, daemonDown,
} from "./model.js";

// Read while the panel is open; a closed panel is unmounted, so nothing runs behind it.
const EVERY_MS = 5000;
// `docker stats` takes a second or two: every third read. Compose files are looked for once a minute.
const STATS_EVERY = 3, FILES_EVERY = 12;
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
    this.held = null; this.limit = null; this.context = null;
    this.reads = 0;
    this.names = new Map();   // compose folder -> [{ name, files }] seen there, so Up after Down uses them
    this.namesKey = null;     // the Docker context they belong to
    this.pull = InputState.new({ placeholder: "postgres:17, redis, nginx:alpine…" });
    this.pull.on("change", (_e, cx) => cx.notify());
    this.pull.on("submit", () => this.pullImage());
    this.runFor = null;       // the image whose Run form is open, with its fields
    afterMount(cx, (cx) => this.refresh(cx));
    this.ticker = cx.timer.every(EVERY_MS, (cx) => this.refresh(cx));
  }

  close() {
    try { this.ticker?.cancel(); this.pull.release(); } catch { /* already gone */ }
    this.closeRun();
  }

  // `now`: after an action, a read that overtakes any still going; the timer's waits its turn.
  refresh(cx, now = false) {
    if (this.reading && !now) return;
    this.reading = true;
    this.seq = this.seq + 1;
    const seq = this.seq;
    const down = () => { this.state = "down"; this.groups = []; this.images = []; this.volumes = []; };
    cx.spawn(async (cx) => {
      try {
        const ps = await docker(["ps", "-a", "--format", PS_FORMAT]);
        if (seq !== this.seq) return;
        if (daemonDown(ps)) { down(); return; }
        if (ps.code !== 0) { this.note = `Docker said: ${firstLine(ps)}`; return; }
        const found = parseContainers(ps.stdout);
        const projects = kansoProjects();
        this.reads = this.reads + 1;
        const lookFiles = this.reads % FILES_EVERY === 1;
        const { deep, shallow } = lookIn(projects.flatMap((p) => p.folders).slice(0, 24), home());
        const named = (depth, list) => localService(fileApi).walk(list, { depth: Number(depth), names: COMPOSE_FILES }).then((paths) => ({ code: 0, stdout: paths.join("\n") })).catch(fail);
        const [im, info, ps2, ins, ctx, vols, df, files] = await Promise.all([
          docker(["images", "--no-trunc", "--format", IMAGES_FORMAT]).catch(fail),
          docker(["info", "--format", "{{.MemTotal}}"]).catch(fail),
          localService(processApi).memory().catch(fail),
          found.length ? docker(["inspect", "--format", INSPECT_FORMAT, ...found.map((c) => c.id)]).catch(fail) : { code: 0, stdout: "" },
          docker(["context", "inspect", "--format", CONTEXT_FORMAT]).catch(fail),
          docker(["volume", "ls", "--format", VOLUMES_FORMAT]).catch(fail),
          lookFiles || now ? docker(["system", "df", "--format", "{{json .}}"]).catch(fail) : null,
          lookFiles && deep.length ? Promise.all([named("2", deep), shallow.length ? named("1", shallow) : { stdout: "" }])
            .then(([a, b]) => ({ code: 0, stdout: `${a.stdout ?? ""}\n${b.stdout ?? ""}` })) : null]);
        const vms = vmPids(ps2.stdout);
        const openFiles = await localService(processApi).openFiles(vms).catch(() => ({ state: "error", values: [] }));
        const owned = dockerVms(openFiles.values ?? []);
        const st = this.reads % STATS_EVERY === 1 ? await docker(["stats", "--no-stream", "--format", STATS_FORMAT]).catch(() => null) : null;
        if (seq !== this.seq) return;
        // Docker quit while this read went on: say so rather than show what ran before.
        if ([im, info, st, vols].some(daemonDown)) { down(); return; }
        this.context = ctx.code === 0 ? contextOf(ctx.stdout) : null;
        // Docker on another machine: what this computer holds says nothing about it.
        this.held = ps2.code === 0 && openFiles.state === "ok" && !this.context?.remote ? dockerHeld(ps2.stdout, owned) : null;
        this.limit = Number(info.stdout) > 0 ? Number(info.stdout) / 1e6 : null;
        if (st?.code === 0) this.mem = parseStats(st.stdout);
        if (files) this.files = composeFiles(files.stdout);
        this.details = ins.code === 0 ? parseInspect(ins.stdout) : new Map();
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
        this.images = imageRows(parseImages(im.stdout), groups);
        this.volumes = vols.code === 0 ? volumeRows(vols.stdout, groups.flatMap((g) => g.containers)) : [];
        if (df?.code === 0) this.spare = reclaimable(df.stdout);
        this.state = "ok"; this.note = openFiles.state === "unavailable" && !this.context?.remote ? "Docker VM memory attribution requires a Herdr API on Windows." : null;
      } catch {
        if (seq === this.seq) { this.state = "missing"; this.groups = []; this.images = []; this.volumes = []; }
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
    const name = InputState.new({ placeholder: `name (${base})` }), port = InputState.new({ placeholder: "port, e.g. 8080:80" });
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

  dot(c, health) {
    const color = { running: c.green, busy: c.yellow, failed: c.red }[health] ?? c.border;
    return div().size(7).flex_none().rounded_full().bg(color);
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

  row(k, c) {
    const busy = this.busy.has(k.id), on = k.health === "running" || k.health === "busy";
    const removeKey = `rm:${k.id}`, armed = this.armed.is(removeKey), open = this.opened.has(k.id);
    const mem = this.mem.get(k.id.slice(0, 12));
    const web = !this.context?.remote && on ? k.ports.find(isWeb) : null;
    return v_flex().w_full().px(G.md).py(9).gap(4).rounded(6).hover((s) => s.bg(c.subtle)).when(busy, (el) => el.opacity(0.45))
      .child(h_flex().w_full().items_center().gap(G.sm)
        .child(this.dot(c, k.health))
        .child(div().flex_1().min_w(0).truncate().text_size(13).text_color(c.text).tooltip(k.name).child(k.service ?? k.name))
        .when(typeof mem === "number" && k.health === "running", (el) => el.child(div().flex_none().text_size(11.5).text_color(c.muted).child(size(mem))))
        .child(div().flex_none().text_size(11).text_color(k.health === "failed" ? c.red : c.dim).child(since(k))))
      .child(h_flex().w_full().min_w(0).gap(G.md).items_center().pl(15)
        .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(c.dim).child(k.image))
        // On another machine's Docker, localhost is not where they are: shown, not copied.
        .children(k.ports.slice(0, 3).map((p) => (this.context?.remote
          ? div().flex_none().text_size(11.5).text_color(c.dim).child(`:${p.port}`)
          : quietLink(`ct-port-${k.id}-${p.port}`, `:${p.port}`, (cx) => cx.write_to_clipboard?.(`localhost:${p.port}`), c,
            { size: 11.5, color: c.muted, label: `Copy localhost:${p.port}` })))))
      .child(h_flex().flex_wrap().gap_x(G.lg).pl(15)
        .child(quietLink(`ct-toggle-${k.id}`, busy ? "Working…" : on ? "Stop" : "Start", (cx) => { if (!busy) this.containers(on ? "stop" : "start", [k], cx); }, c, { color: c.text, disabled: busy }))
        .when(on, (el) => el.child(quietLink(`ct-restart-${k.id}`, "Restart", (cx) => { if (!busy) this.containers("restart", [k], cx); }, c, { disabled: busy })))
        .when(Boolean(web), (el) => el.child(quietLink(`ct-open-${k.id}`, "Open", (cx) => cx.open_url(urlOf(web)), c)))
        .when(k.health === "running", (el) => el.child(quietLink(`ct-shell-${k.id}`, "Shell", () => inTab(`shell ${k.service ?? k.name}`, localService(systemApi).containerShell(k.name, this.details.get(k.id.slice(0, 12))?.platform)), c)))
        .child(quietLink(`ct-logs-${k.id}`, "Logs", () => inTab(`logs ${k.service ?? k.name}`, ["docker", "logs", "-f", "--tail", "200", k.name]), c))
        .child(quietLink(`ct-more-${k.id}`, open ? "Less" : "Details", (cx) => { this.opened = open ? new Set([...this.opened].filter((x) => x !== k.id)) : new Set([...this.opened, k.id]); cx.notify(); }, c))
        .when(!on, (el) => el.child(quietLink(`ct-rm-${k.id}`, armed ? "Press again to remove" : "Remove",
          (cx) => { if (!busy) this.armed.press(removeKey, cx, (cx) => this.containers("rm", [k], cx)); }, c, { color: armed ? c.red : c.muted, disabled: busy }))))
      .when(open, (el) => el.child(this.detailsView(k, c)));
  }

  stackRow(s, c) {
    const state = s.total === 0 ? "not started" : `${s.running} of ${s.total} running`;
    const id = `${s.dir}:${s.compose ?? ""}`, downKey = `down:${id}`, armed = this.armed.is(downKey);
    return h_flex().w_full().flex_wrap().items_center().gap_x(G.lg).gap_y(G.xs).px(G.md).py(7).rounded(6).bg(c.subtle)
      .child(div().min_w(0).flex_shrink(1).truncate().text_size(12.5).text_color(c.text).tooltip(s.file).child(`${s.compose && s.compose !== s.name ? s.compose : s.name} · compose`))
      .child(div().flex_none().text_size(11.5).text_color(c.dim).child(state))
      .child(h_flex().flex_none().gap(G.md)
        .child(quietLink(`ct-up-${id}`, s.running ? "Up again" : "Up", () => this.stack(s, "up"), c, { size: 12, color: c.text }))
        .child(quietLink(`ct-build-${id}`, "Rebuild", () => this.stack(s, "rebuild"), c, { size: 12 }))
        .when(s.total > 0, (el) => el.child(quietLink(`ct-down-${id}`, armed ? "Press again: down" : "Down",
          (cx) => this.armed.press(downKey, cx, () => this.stack(s, "down")), c, { size: 12, color: armed ? c.red : c.muted }))));
  }

  group(g, c) {
    const stopped = g.containers.filter((k) => k.health !== "running" && k.health !== "busy");
    const running = g.containers.filter((k) => k.health === "running" || k.health === "busy");
    return v_flex().w_full().gap(4)
      .child(h_flex().w_full().flex_wrap().items_end().justify_between().gap_x(G.md).gap_y(G.xs).pb(G.xs)
        .child(div().min_w(0).flex_shrink(1).truncate().text_size(15).text_color(g.project === OTHER ? c.muted : c.text).child(g.project))
        .child(h_flex().flex_none().gap(G.md).items_center()
          .when(g.containers.length > 0, (el) => el.child(div().text_size(12).text_color(c.dim).child(`${g.running} of ${g.containers.length} running`)))
          .when(stopped.length > 1, (el) => el.child(quietLink(`ct-start-all-${g.project}`, "Start all", (cx) => this.containers("start", stopped, cx), c, { size: 12 })))
          .when(running.length > 1, (el) => el.child(quietLink(`ct-stop-all-${g.project}`, "Stop all", (cx) => this.containers("stop", running, cx), c, { size: 12 })))))
      .children(g.stacks.map((s) => this.stackRow(s, c)))
      .children(g.containers.map((k) => this.row(k, c)));
  }

  head(id, title, note, open, c) {
    return h_flex().w_full().items_end().justify_between().gap(G.md).pb(G.xs)
      .child(quietLink(`ct-${id}`, `${open ? "Hide" : "Show"} ${title}`, (cx) => { this.show = { ...this.show, [id]: !open }; cx.notify(); }, c, { size: 13, color: c.text }))
      .child(div().min_w(0).truncate().text_size(12).text_color(c.dim).child(note));
  }

  imagesView(c) {
    const unused = this.images.filter((i) => i.unused);
    const total = this.images.reduce((t, i) => t + i.mb, 0), spare = unused.reduce((t, i) => t + i.mb, 0);
    const armed = this.armed.is("rmi"), open = this.show.images, name = this.pull.value().trim();
    return v_flex().w_full().gap(4)
      .child(this.head("images", "images", `${this.images.length} · ${size(total)}${spare > 0 ? ` · ${size(spare)} unused` : ""}`, open, c))
      // Pull is always here: a new image is one line away.
      .child(h_flex().w_full().gap(G.sm).items_center()
        .child(h_flex().flex_1().min_w(0).h(28).px(8).rounded(6).border_1().border_color(c.input).bg(c.canvas)
          .child(Input.new(this.pull).flex_1().h_full().text_size(12)))
        .child(quietLink("ct-pull", "Pull", () => this.pullImage(), c, { size: 12, color: name ? c.text : c.border, disabled: !name })))
      .when(unused.length > 0, (el) => el.child(h_flex()
        .child(quietLink("ct-rmi", armed ? `Press again to remove ${unused.length}` : `Remove unused images (${size(spare)})`,
          (cx) => this.armed.press("rmi", cx, (cx) => this.act(["rmi", ...unused.flatMap((i) => i.tags)], cx, { what: "remove images" })), c,
          { size: 12, color: armed ? c.red : c.muted }))))
      .when(open, (el) => el.children(this.images.map((i) => this.imageRow(i, c))));
  }

  imageRow(i, c) {
    const key = `rmi:${i.id}`, armed = this.armed.is(key), form = this.runFor?.id === i.id ? this.runFor : null;
    const field = (state) => h_flex().flex_1().min_w(0).h(26).px(8).rounded(6).border_1().border_color(c.input).bg(c.canvas)
      .child(Input.new(state).flex_1().h_full().text_size(12));
    return v_flex().w_full().gap(4).px(G.md).py(7).border_t(1).border_color(c.border)
      .child(h_flex().w_full().items_center().gap(G.md)
        .child(v_flex().flex_1().min_w(0).gap(2)
          .child(div().w_full().truncate().text_size(12.5).text_color(i.unused ? c.muted : c.text).child(i.name))
          .child(div().w_full().truncate().text_size(11).text_color(c.dim).child(i.unused ? `unused · ${i.age}` : `${i.projects.join(", ")} · ${i.users.join(", ")}`)))
        .child(div().flex_none().text_size(12).text_color(c.muted).child(size(i.mb))))
      .child(h_flex().flex_wrap().gap_x(G.lg)
        .child(quietLink(`ct-run-${i.id}`, form ? "Cancel" : "Run…", (cx) => this.openRun(i, cx), c, { size: 12, color: c.text }))
        .when(i.unused, (el) => el.child(quietLink(`ct-rmi-${i.id}`, armed ? "Press again to remove" : "Remove",
          (cx) => this.armed.press(key, cx, (cx) => this.act(["rmi", ...i.tags], cx, { what: "remove image" })), c, { size: 12, color: armed ? c.red : c.muted }))))
      .when(Boolean(form), (el) => el.child(h_flex().w_full().gap(G.sm).items_center()
        .child(field(form.name)).child(field(form.port))
        .child(quietLink(`ct-run-go-${i.id}`, "Run", (cx) => this.runImage(cx), c, { size: 12, color: c.text }))));
  }

  volumesView(c) {
    const unused = this.volumes.filter((v) => v.unused), armed = this.armed.is("vrm"), open = this.show.volumes;
    return v_flex().w_full().gap(4)
      .child(this.head("volumes", "volumes", `${this.volumes.length}${unused.length ? ` · ${unused.length} unused` : ""}`, open, c))
      .when(unused.length > 0, (el) => el.child(h_flex()
        .child(quietLink("ct-vrm", armed ? `Press again: their data is gone for good` : `Remove ${unused.length} unused volume${unused.length === 1 ? "" : "s"}`,
          (cx) => this.armed.press("vrm", cx, (cx) => this.act(["volume", "rm", ...unused.map((v) => v.name)], cx, { what: "remove volumes" })), c,
          { size: 12, color: armed ? c.red : c.muted }))))
      .when(open, (el) => el.children(this.volumes.map((v) => h_flex().w_full().items_center().gap(G.md).px(G.md).py(7).border_t(1).border_color(c.border)
        .child(v_flex().flex_1().min_w(0).gap(2)
          .child(div().w_full().truncate().text_size(12.5).text_color(v.unused ? c.muted : c.text).tooltip(v.name).child(v.anonymous ? `${v.name.slice(0, 12)} (anonymous)` : v.name))
          .child(div().w_full().truncate().text_size(11).text_color(c.dim).child(v.unused ? "unused" : v.users.join(", ")))))));
  }

  spaceView(c) {
    const cache = this.spare["Build Cache"] ?? 0, armed = this.armed.is("cache");
    if (cache < 1) return null;
    return h_flex().w_full().items_center().justify_between().gap(G.md)
      .child(div().text_size(12.5).text_color(c.muted).child(`Build cache: ${size(cache)} you can get back`))
      .child(quietLink("ct-cache", armed ? "Press again to clear" : "Clear", (cx) => this.armed.press("cache", cx, (cx) => this.act(["builder", "prune", "-f"], cx, { what: "clear the build cache" })), c,
        { size: 12, color: armed ? c.red : c.text }));
  }

  skeleton(c) {
    const { block, line } = ghost(c);
    const two = (i) => v_flex().w_full().py(9).gap(4)
      .child(line([160, 140, 180, 120][i], 13)).child(line([200, 150, 110, 170][i], 11));
    return breathe(v_flex().id("kanso-skeleton").w_full().gap(32))
      .child(v_flex().gap(G.md)
        .child(line(180, 12))
        .child(block(120, 48, 6))
        .child(h_flex().gap(G.md).children([70, 64, 48].map((w) => line(w, 13)))))
      .child(v_flex().w_full().children([0, 1, 2, 3].map(two)));
  }

  body(c) {
    if (this.state === "missing") return div().text_size(13).text_color(c.dim).child("Docker is not installed on this computer.");
    if (this.state === "down") {
      return v_flex().gap(G.sm)
        .child(div().text_size(13).text_color(c.muted).child("Docker isn't running."))
        .child(h_flex().child(quietLink("ct-open-docker", "Open Docker", (cx) => this.openDocker(cx), c, { color: c.text })));
    }
    if (this.groups === null) return this.skeleton(c);
    const all = this.groups.flatMap((g) => g.containers);
    const running = all.filter((k) => k.health === "running").length, failed = all.filter((k) => k.health === "failed").length;
    const armedQuit = this.armed.is("quit"), remote = Boolean(this.context?.remote);
    // What Docker costs this computer comes first: its VM keeps memory even with nothing running.
    const hero = v_flex().gap(G.md)
      .when(!remote, (el) => el.child(v_flex().gap(4)
        .child(div().text_size(12.5).text_color(c.dim).child("Docker uses of this Mac's memory"))
        .child(h_flex().items_end().gap(G.md).flex_wrap()
          .child(div().text_size(48).line_height(1).font_light().text_color(c.text).child(typeof this.held === "number" ? size(this.held) : "–"))
          .when(Boolean(this.limit), (el2) => el2.child(div().pb(6).text_size(13).text_color(c.dim).child(`can grow to ${size(this.limit)}`))))))
      .when(remote, (el) => el.child(div().text_size(12.5).text_color(c.yellow)
        .child(`Docker context ${this.context?.name}: these containers run on ${this.context?.host}, not this computer.`)))
      .child(h_flex().items_center().gap(G.md).flex_wrap()
        .child(div().text_size(13).text_color(c.text).child(`${running} running`))
        .child(div().text_size(13).text_color(c.dim).child(`${all.length - running} stopped`))
        .when(failed > 0, (el) => el.child(div().text_size(13).text_color(c.red).child(`${failed} failed`)))
        .when(!remote, (el) => el.child(quietLink("ct-quit", armedQuit ? "Press again to quit Docker" : running ? `Quit Docker (stops ${running})` : "Quit Docker",
          (cx) => this.armed.press("quit", cx, (cx) => this.quitDocker(cx)), c, { size: 12.5, color: armedQuit ? c.red : c.muted }))));
    const space = this.spaceView(c);
    return v_flex().w_full().gap(32)
      .child(hero)
      .when(this.groups.length === 0, (el) => el.child(div().text_size(13).text_color(c.dim).child("No containers. Pull an image and run it below, or a project's compose file shows here to bring up.")))
      .children(this.groups.map((g) => this.group(g, c)))
      .child(this.imagesView(c))
      .when(this.volumes.length > 0, (el) => el.child(this.volumesView(c)))
      .when(Boolean(space), (el) => el.child(space));
  }

  render() {
    const c = tokens(theme()), narrow = this.width < 560;
    const header = h_flex().w_full().items_center().justify_between().gap(G.md)
      .child(div().text_size(narrow ? 17 : 20).text_color(c.text).child("Containers"))
      .child(iconButton("ct-refresh", "refresh", "Read again", (cx) => this.refresh(cx, true), c, { spin: this.reading }));
    return v_flex().id("kanso-containers").size_full().min_h(0).bg(c.canvas).text_color(c.text).overflow_y_scrollbar()
      .on_size_change((s, sizeCx) => { if (Math.abs(this.width - s.width) >= 1) { this.width = s.width; sizeCx.notify(); } })
      .child(h_flex().flex_none().w_full().justify_center().px(narrow ? G.lg : 32).py(narrow ? G.lg : 28)
        .child(v_flex().w_full().max_w(1080).gap(narrow ? 28 : 40)
          .child(header)
          .child(this.body(c))
          .when(Boolean(this.error), (el) => el.child(div().text_size(12).text_color(c.red).child(this.error ?? "")))
          .when(Boolean(this.note), (el) => el.child(div().text_size(12).text_color(this.note === "Starting Docker…" ? c.dim : c.red).child(this.note ?? "")))
          .child(div().text_size(10.5).text_color(c.dim).child("Docker on this computer, grouped by the Kanso project each container is for: its compose folder, else its name. Pulls, compose, shells and logs open in a tab."))));
  }
}

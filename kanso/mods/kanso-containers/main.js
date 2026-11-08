// Containers, by jlopezlira (https://github.com/jlopezlira/herdr-kanso). Apache-2.0.
// Docker, simply: what runs and for which project, started, stopped, read and removed from one place.
import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { exec, run, spaces, theme } from "herdr";
import { G, Armed, tokens, quietLink, iconButton, section } from "./ui.js";
import { PS_FORMAT, IMAGES_FORMAT, STATS_FORMAT, INSPECT_FORMAT, CONTEXT_FORMAT, OTHER, parseContainers, parseImageIds, contextOf, parseImages, parseStats, vmPids, dockerVms, dockerHeld, byProject, imageRows, since, size, daemonDown } from "./model.js";

// Read while the panel is open; a closed panel is unmounted, so nothing runs behind it.
const EVERY_MS = 5000;
// `docker stats` takes a second or two: every third read.
const STATS_EVERY = 3;

const docker = (args) => exec("docker", args);

export default class Containers extends View {
  init(_props, cx) {
    this.groups = null;      // [{ project, containers, running }], null until first read
    this.images = [];
    this.state = "reading";  // reading, ok, down (no daemon), missing (no docker)
    this.note = null;        // what the last read could not do
    this.error = null;       // what the last action could not do, until the next action
    this.busy = new Set();   // container ids being changed
    this.reading = false;
    this.seq = 0;            // the latest read; an older one finishing late is dropped
    this.showImages = false;
    this.armed = new Armed();
    this.width = 368;
    this.mem = new Map();    // short container id -> MB
    this.held = null;        // MB Docker and its VM hold on this computer
    this.limit = null;       // MB the VM may take
    this.reads = 0;
    this.refresh(cx);
    this.ticker = cx.timer.every(EVERY_MS, (cx) => this.refresh(cx));
  }

  close() { try { this.ticker?.cancel(); } catch { /* already gone */ } }

  // `now`: after an action, a read that overtakes any still going; the timer's waits its turn.
  refresh(cx, now = false) {
    if (this.reading && !now) return;
    this.reading = true;
    this.seq = this.seq + 1;
    const seq = this.seq;
    const down = () => { this.state = "down"; this.groups = []; this.images = []; };
    cx.spawn(async (cx) => {
      try {
        const ps = await docker(["ps", "-a", "--format", PS_FORMAT]);
        if (seq !== this.seq) return;
        if (daemonDown(ps)) { down(); return; }
        if (ps.code !== 0) { this.note = `Docker said: ${(ps.stderr || ps.stdout).trim()}`; return; }
        const found = parseContainers(ps.stdout);
        const [im, info, ps2, ins, ctx] = await Promise.all([
          docker(["images", "--no-trunc", "--format", IMAGES_FORMAT]).catch(() => ({ code: 1, stdout: "" })),
          docker(["info", "--format", "{{.MemTotal}}"]).catch(() => ({ code: 1, stdout: "" })),
          exec("ps", ["-axo", "pid=,rss=,comm="]).catch(() => ({ code: 1, stdout: "" })),
          found.length ? docker(["inspect", "--format", INSPECT_FORMAT, ...found.map((c) => c.id)]).catch(() => ({ code: 1, stdout: "" })) : { code: 0, stdout: "" },
          docker(["context", "inspect", "--format", CONTEXT_FORMAT]).catch(() => ({ code: 1, stdout: "" }))]);
        const vms = vmPids(ps2.stdout);
        const owned = vms.length ? dockerVms((await exec("lsof", ["-a", "-p", vms.join(","), "-Fpn"]).catch(() => ({ stdout: "" }))).stdout) : new Set();
        this.reads = this.reads + 1;
        const st = this.reads % STATS_EVERY === 1 ? await docker(["stats", "--no-stream", "--format", STATS_FORMAT]).catch(() => null) : null;
        if (seq !== this.seq) return;
        // Docker quit while this read went on: say so rather than show what ran before.
        if ([im, info, st].some(daemonDown)) { down(); return; }
        this.context = ctx.code === 0 ? contextOf(ctx.stdout) : null;
        // Docker on another machine: what this computer holds says nothing about it.
        this.held = ps2.code === 0 && !this.context?.remote ? dockerHeld(ps2.stdout, owned) : null;
        this.limit = Number(info.stdout) > 0 ? Number(info.stdout) / 1e6 : null;
        if (st?.code === 0) this.mem = parseStats(st.stdout);
        const projects = spaces().filter((w) => !w.machine && w.folder).map((w) => ({ name: w.name, folder: w.folder }));
        const ids = ins.code === 0 ? parseImageIds(ins.stdout) : new Map();
        const groups = byProject(found.map((c) => ({ ...c, imageId: ids.get(c.id.slice(0, 12)) ?? null })), projects);
        this.groups = groups;
        this.images = imageRows(parseImages(im.stdout), groups);
        this.state = "ok"; this.note = null;
      } catch {
        if (seq === this.seq) { this.state = "missing"; this.groups = []; this.images = []; }
      } finally { if (seq === this.seq) { this.reading = false; cx.notify(); } }
    });
  }

  // `docker <verb> <ids>`; the rows show their change until Docker has made it.
  act(verb, list, cx, extra = []) {
    const ids = list.map((c) => c.id);
    this.busy = new Set([...this.busy, ...ids]);
    cx.notify();
    cx.spawn(async (cx) => {
      const r = await docker([verb, ...extra, ...ids]).catch((e) => ({ code: 1, stderr: String(e?.message ?? e) }));
      this.error = r.code === 0 ? null : `${verb} failed: ${(r.stderr || r.stdout || "").trim().split("\n")[0]}`;
      this.busy = new Set([...this.busy].filter((id) => !ids.includes(id)));
      this.refresh(cx, true);
    });
  }

  removeImages(list, cx) {
    cx.spawn(async (cx) => {
      // By its tags: an image under more than one name won't go by its id alone.
      const r = await docker(["rmi", ...list.flatMap((i) => i.tags)]).catch((e) => ({ code: 1, stderr: String(e?.message ?? e) }));
      this.error = r.code === 0 ? null : `Some images stayed: ${(r.stderr || "").trim().split("\n")[0]}`;
      this.refresh(cx, true);
    });
  }

  logs(c) {
    run("terminal.open", { argv: ["docker", "logs", "-f", "--tail", "200", c.name], name: `logs ${c.service ?? c.name}`, place: "tab" });
  }

  // Docker Desktop's own command, else asked to quit like any app: the VM ends and its memory comes back.
  quitDocker(cx) {
    cx.spawn(async (cx) => {
      const r = await docker(["desktop", "stop"]).catch(() => null);
      const q = r?.code === 0 ? r : await exec("osascript", ["-e", 'quit app "Docker"']).catch((e) => ({ code: 1, stderr: String(e?.message ?? e) }));
      this.error = q.code === 0 ? null : `Docker did not quit: ${(q.stderr || q.stdout || "").trim().split("\n")[0]}`;
      this.refresh(cx, true);
    });
  }

  openDocker(cx) {
    cx.spawn(async (cx) => {
      const fail = (e) => ({ code: 1, stderr: String(e?.message ?? e) });
      const mac = await exec("open", ["-a", "Docker"]).catch(fail);
      const r = mac.code === 0 ? mac : await exec("systemctl", ["--user", "start", "docker-desktop"]).catch(fail);
      this.note = r.code === 0 ? "Starting Docker…" : null;
      this.error = r.code === 0 ? null : "Docker could not be opened from here: open it yourself.";
      cx.notify();
    });
  }

  dot(c, health) {
    const color = { running: c.green, busy: c.yellow, failed: c.red }[health] ?? c.border;
    return div().size(7).flex_none().rounded_full().bg(color);
  }

  row(k, c) {
    const busy = this.busy.has(k.id), on = k.health === "running" || k.health === "busy";
    const removeKey = `rm:${k.id}`, armed = this.armed.is(removeKey);
    return v_flex().w_full().px(G.md).py(9).gap(4).rounded(6).hover((s) => s.bg(c.subtle)).when(busy, (el) => el.opacity(0.45))
      .child(h_flex().w_full().items_center().gap(G.sm)
        .child(this.dot(c, k.health))
        .child(div().flex_1().min_w(0).truncate().text_size(13).text_color(c.text).tooltip(k.name).child(k.service ?? k.name))
        .when(typeof this.mem.get(k.id.slice(0, 12)) === "number" && k.health === "running",
          (el) => el.child(div().flex_none().text_size(11.5).text_color(c.muted).child(size(this.mem.get(k.id.slice(0, 12))))))
        .child(div().flex_none().text_size(11).text_color(k.health === "failed" ? c.red : c.dim).child(since(k))))
      .child(h_flex().w_full().min_w(0).gap(G.md).items_center().pl(15)
        .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(c.dim).child(k.image))
        // On another machine's Docker, localhost is not where they are: shown, not copied.
        .children(k.ports.slice(0, 3).map((p) => (this.context?.remote
          ? div().flex_none().text_size(11.5).text_color(c.dim).child(`:${p.port}`)
          : quietLink(`ct-port-${k.id}-${p.port}`, `:${p.port}`, (cx) => cx.write_to_clipboard?.(`localhost:${p.port}`), c,
            { size: 11.5, color: c.muted, label: `Copy localhost:${p.port}` })))))
      .child(h_flex().flex_wrap().gap_x(G.lg).pl(15)
        .child(quietLink(`ct-toggle-${k.id}`, busy ? "Working…" : on ? "Stop" : "Start", (cx) => { if (!busy) this.act(on ? "stop" : "start", [k], cx); }, c, { color: c.text, disabled: busy }))
        .when(on, (el) => el.child(quietLink(`ct-restart-${k.id}`, "Restart", (cx) => { if (!busy) this.act("restart", [k], cx); }, c, { disabled: busy })))
        .child(quietLink(`ct-logs-${k.id}`, "Logs", () => this.logs(k), c))
        .when(!on, (el) => el.child(quietLink(`ct-rm-${k.id}`, armed ? "Press again to remove" : "Remove",
          (cx) => { if (!busy) this.armed.press(removeKey, cx, (cx) => this.act("rm", [k], cx)); }, c, { color: armed ? c.red : c.muted, disabled: busy }))));
  }

  group(g, c) {
    const stopped = g.containers.filter((k) => k.health !== "running" && k.health !== "busy");
    const running = g.containers.filter((k) => k.health === "running" || k.health === "busy");
    return v_flex().w_full().gap(2)
      .child(h_flex().w_full().flex_wrap().items_end().justify_between().gap_x(G.md).gap_y(G.xs).pb(G.xs)
        .child(div().min_w(0).flex_shrink(1).truncate().text_size(15).text_color(g.project === OTHER ? c.muted : c.text).child(g.project))
        .child(h_flex().flex_none().gap(G.md).items_center()
          .child(div().text_size(12).text_color(c.dim).child(`${g.running} of ${g.containers.length} running`))
          .when(stopped.length > 1, (el) => el.child(quietLink(`ct-start-all-${g.project}`, "Start all", (cx) => this.act("start", stopped, cx), c, { size: 12 })))
          .when(running.length > 1, (el) => el.child(quietLink(`ct-stop-all-${g.project}`, "Stop all", (cx) => this.act("stop", running, cx), c, { size: 12 })))))
      .children(g.containers.map((k) => this.row(k, c)));
  }

  imagesView(c) {
    const unused = this.images.filter((i) => i.unused);
    const total = this.images.reduce((t, i) => t + i.mb, 0), spare = unused.reduce((t, i) => t + i.mb, 0);
    const armed = this.armed.is("rmi");
    return v_flex().w_full().gap(2)
      .child(h_flex().w_full().items_end().justify_between().gap(G.md).pb(G.xs)
        .child(quietLink("ct-images", `${this.showImages ? "Hide" : "Show"} images`, (cx) => { this.showImages = !this.showImages; cx.notify(); }, c, { size: 13, color: c.text }))
        .child(div().text_size(12).text_color(c.dim).child(`${this.images.length} · ${size(total)}${spare > 0 ? ` · ${size(spare)} unused` : ""}`)))
      .when(unused.length > 0, (el) => el.child(h_flex().pb(G.xs)
        .child(quietLink("ct-rmi", armed ? `Press again to remove ${unused.length}` : `Remove unused images (${size(spare)})`,
          (cx) => this.armed.press("rmi", cx, (cx) => this.removeImages(unused, cx)), c, { size: 12, color: armed ? c.red : c.muted }))))
      .when(this.showImages, (el) => el.children(this.images.map((i) => h_flex().w_full().items_center().gap(G.md).px(G.md).py(7).border_t(1).border_color(c.border)
        .child(v_flex().flex_1().min_w(0).gap(2)
          .child(div().w_full().truncate().text_size(12.5).text_color(i.unused ? c.muted : c.text).child(i.name))
          .child(div().w_full().truncate().text_size(11).text_color(c.dim)
            .child(i.unused ? `unused · ${i.age}` : `${i.projects.join(", ")} · ${i.users.join(", ")}`)))
        .child(div().flex_none().text_size(12).text_color(c.muted).child(size(i.mb))))));
  }

  body(c) {
    if (this.state === "missing") return div().text_size(13).text_color(c.dim).child("Docker is not installed on this computer.");
    if (this.state === "down") {
      return v_flex().gap(G.sm)
        .child(div().text_size(13).text_color(c.muted).child("Docker isn't running."))
        .child(h_flex().child(quietLink("ct-open-docker", "Open Docker", (cx) => this.openDocker(cx), c, { color: c.text })));
    }
    if (this.groups === null) return div().text_size(13).text_color(c.dim).child("Asking Docker");
    const all = this.groups.flatMap((g) => g.containers);
    const running = all.filter((k) => k.health === "running").length, failed = all.filter((k) => k.health === "failed").length;
    const armedQuit = this.armed.is("quit");
    // What Docker costs this computer comes first: its VM holds memory even with nothing running.
    const hero = v_flex().gap(G.md)
      .child(h_flex().items_end().gap(G.md).flex_wrap()
        .child(div().text_size(48).line_height(1).font_light().text_color(c.text).child(typeof this.held === "number" ? size(this.held) : "–"))
        .child(div().pb(6).text_size(13).text_color(c.dim).child(`held by Docker${this.limit ? ` · its VM may take ${size(this.limit)}` : ""}`)))
      .when(Boolean(this.context?.remote), (el) => el.child(div().text_size(12.5).text_color(c.yellow)
        .child(`Docker context ${this.context?.name}: these containers run on ${this.context?.host}, not this computer.`)))
      .child(h_flex().items_center().gap(G.md).flex_wrap()
        .child(div().text_size(13).text_color(c.text).child(`${running} running`))
        .child(div().text_size(13).text_color(c.dim).child(`${all.length - running} stopped`))
        .when(failed > 0, (el) => el.child(div().text_size(13).text_color(c.red).child(`${failed} failed`)))
        .when(!this.context?.remote, (el) => el.child(quietLink("ct-quit", armedQuit ? "Press again to quit Docker" : running ? `Quit Docker (stops ${running})` : "Quit Docker",
          (cx) => this.armed.press("quit", cx, (cx) => this.quitDocker(cx)), c, { size: 12.5, color: armedQuit ? c.red : c.muted }))));
    return v_flex().w_full().gap(32)
      .child(hero)
      .when(all.length === 0, (el) => el.child(div().text_size(13).text_color(c.dim).child("No containers. Ones you run or compose up show here, by project.")))
      .children(this.groups.map((g) => this.group(g, c)))
      .when(this.images.length > 0, (el) => el.child(this.imagesView(c)));
  }

  render() {
    const c = tokens(theme()), narrow = this.width < 560;
    const header = h_flex().w_full().items_center().justify_between().gap(G.md)
      .child(div().text_size(narrow ? 17 : 20).text_color(c.text).child("Containers"))
      .child(iconButton("ct-refresh", "refresh", "Read again", (cx) => this.refresh(cx), c, { spin: this.reading }));
    return v_flex().id("kanso-containers").size_full().min_h(0).bg(c.canvas).text_color(c.text).overflow_y_scrollbar()
      .on_size_change((s, sizeCx) => { if (Math.abs(this.width - s.width) >= 1) { this.width = s.width; sizeCx.notify(); } })
      .child(h_flex().flex_none().w_full().justify_center().px(narrow ? G.lg : 32).py(narrow ? G.lg : 28)
        .child(v_flex().w_full().max_w(1080).gap(narrow ? 28 : 40)
          .child(header)
          .child(this.body(c))
          .when(Boolean(this.error), (el) => el.child(div().text_size(12).text_color(c.red).child(this.error ?? "")))
          .when(Boolean(this.note), (el) => el.child(div().text_size(12).text_color(this.note === "Starting Docker…" ? c.dim : c.red).child(this.note ?? "")))
          .child(div().text_size(10.5).text_color(c.dim).child("Docker on this computer, grouped by the Kanso project each container is for: its compose folder, else its name."))));
  }
}

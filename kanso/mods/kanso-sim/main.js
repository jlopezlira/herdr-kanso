import { View, div, image } from "gpui-kit";
import { h_flex, v_flex, Input, InputState } from "gpui-base";
import { exec, home, appHome, shared, setShared, window, theme, layout, spaces } from "herdr";
import { mkdir, readFile, readdir, unlink } from "fs/promises";
import { pathApi } from "./platform-paths.js";
import { checked } from "./platform-command.js";
import { G, H, R, T, tokens, quietLink, skeleton } from "./ui.js";
import { Front } from "./front.js";
import { TOOLS, PROBE_MS, probeTools } from "./registration.js";
import { iosCommand } from "./ios.js";
import { adbCommand, readDevices, startDevice, deviceSize, captureDevice } from "./devices.js";
import { BEAT_MS, FRAME_MS, BOOT_MS, FrameLoop, TextBatch, canStart, canRotate, bootState, age, pictureSize, fitPicture, screenPoint, gesture, keyInput, textParts, CONTROLS, panelShown } from "./model.js";

const PICKED = "kanso.sim.picked";
const failure = (error) => String(error?.message ?? error).split(/\r?\n/)[0];
const fileKey = (id) => encodeURIComponent(id).replace(/\*/g, "%2A");

export default class Simulator extends View {
  init(_props, cx) {
    this.platform = window()?.platform ?? "macos";
    this.paths = pathApi(this.platform);
    this.directory = this.paths.join(appHome(), "data", "kanso-sim");
    this.tools = shared(TOOLS) ?? null;
    this.devices = null; this.error = null; this.note = null;
    this.selected = shared(PICKED) ?? null; this.boot = null;
    this.loop = new FrameLoop(); this.batch = new TextBatch();
    this.front = new Front(() => this.inFront());
    this.bounds = null; this.size = null; this.press = null;
    this.readAt = 0; this.reading = false; this.sending = false; this.acting = false;
    this.closed = false; this.frameNo = 0;
    this.focus = cx.focus_handle();
    this.url = InputState.new({ placeholder: "URL" });
    this.url.on("submit", (_event, cx) => this.openUrl(cx));
    cx.timer.after(0, (next) => this.tick(next));
  }

  inFront() { return !this.closed && window()?.active !== false && panelShown(layout()); }

  close() {
    this.closed = true;
    this.timer?.cancel(); this.textTimer?.cancel(); this.deadline?.cancel(); this.actionDeadline?.cancel();
    this.batch.take(); this.focus.release(); this.url.release();
  }

  current() { return this.devices?.find((device) => device.id === this.selected) ?? null; }

  schedule(cx, ms = BEAT_MS) {
    this.timer?.cancel(); this.timer = null;
    if (!this.inFront()) { this.front.rest(); return; }
    this.timer = cx.timer.after(ms, (next) => { this.timer = null; this.tick(next); });
  }

  tick(cx) {
    if (!this.inFront()) { this.front.rest(); this.loop.ready(Date.now(), false, this.selected); return; }
    if (this.front.woke()) this.loop.next = 0;
    if (this.boot && Date.now() >= this.boot.until) { this.error = "Start timed out."; this.boot = null; cx.notify(); }
    if (this.reading || this.loop.inFlight) {
      if (this.loop.late(Date.now())) cx.notify();
      this.schedule(cx, 1000); return;
    }
    if (!this.tools || !this.devices || Date.now() - this.readAt >= (this.boot ? 1000 : 5000)) { this.refresh(cx); return; }
    const device = this.current(), key = device?.state === "Booted" ? device.id : null;
    if (!this.loop.ready(Date.now(), true, key)) { this.schedule(cx); return; }
    this.frame(device, cx);
  }

  refresh(cx) {
    if (this.reading || !this.inFront()) return;
    this.reading = true;
    this.readToken = (this.readToken ?? 0) + 1;
    const token = this.readToken;
    this.deadline?.cancel();
    this.deadline = cx.timer.after(PROBE_MS + FRAME_MS, (next) => {
      if (this.readToken !== token || !this.reading) return;
      this.readToken = this.readToken + 1;
      this.note = "Devices did not answer."; this.devices ??= []; this.reading = false; this.readAt = Date.now();
      next.notify(); this.schedule(next, 0);
    });
    this.schedule(cx, 1000);
    cx.spawn(async (next) => {
      try {
        const tools = this.tools ?? await probeTools(this.platform, home(), exec);
        if (!this.inFront() || token !== this.readToken) return;
        this.tools = tools;
        const devices = await readDevices(exec, tools, () => this.inFront() && token === this.readToken);
        if (!this.inFront() || token !== this.readToken) return;
        this.devices = devices; this.note = null;
        if (!devices.some((device) => device.id === this.selected)) this.selected = devices.find((device) => device.state === "Booted")?.id ?? devices[0]?.id ?? null;
        const status = bootState(devices.find((device) => device.id === this.boot?.id), this.boot, Date.now());
        if (status === "Start timed out.") this.error = status;
        if (!status || status === "Start timed out.") this.boot = null;
      } catch (error) { if (token === this.readToken) { this.note = failure(error); this.devices ??= []; } }
      finally {
        if (token === this.readToken) {
          this.reading = false; this.readAt = Date.now(); this.deadline?.cancel();
          next.notify(); this.schedule(next, 0);
        }
      }
    });
  }

  pick(device, cx) {
    this.selected = device.id; this.size = null; this.press = null; this.error = null;
    this.loop.ready(Date.now(), this.inFront(), device.state === "Booted" ? device.id : null);
    this.batch.take(); setShared(PICKED, device.id);
    cx.notify(); this.schedule(cx, 0);
  }

  frame(device, cx) {
    const key = this.loop.begin(Date.now());
    this.frameNo = this.frameNo + 1;
    const prefix = `${fileKey(key)}-`, filename = `${prefix}${Date.now()}-${this.frameNo}.${device.platform === "ios" ? "jpg" : "png"}`;
    const file = this.paths.join(this.directory, filename);
    this.deadline?.cancel();
    this.deadline = cx.timer.after(FRAME_MS, (next) => next.notify());
    this.schedule(cx, 1000);
    cx.spawn(async (next) => {
      try {
        await mkdir(this.directory, { recursive: true });
        if (!this.inFront()) { this.loop.land(key, null, Date.now()); return; }
        if (device.platform === "android") {
          const size = await deviceSize(exec, this.tools, device);
          if (!size) throw new Error("Android did not give a screen size.");
          if (this.selected === key) this.size = size;
        }
        if (!this.inFront()) { this.loop.land(key, null, Date.now()); return; }
        await captureDevice(exec, this.platform, this.tools, device, file);
        const size = pictureSize(await readFile(file));
        if (!size?.width || !size.height) throw new Error("No picture from the device.");
        const older = (await readdir(this.directory)).filter((name) => name.startsWith(prefix) && name !== filename);
        await Promise.all(older.map((name) => unlink(this.paths.join(this.directory, name)).catch(() => {})));
        this.loop.land(key, { path: this.paths.join("data", "kanso-sim", filename), ...size }, Date.now());
      } catch {
        this.loop.land(key, null, Date.now());
        await unlink(file).catch(() => {});
      } finally { this.deadline?.cancel(); next.notify(); this.schedule(next, key === this.selected ? BEAT_MS : 0); }
    });
  }

  act(action, cx) {
    if (this.acting || !this.inFront()) return;
    this.acting = true; this.error = null; cx.notify();
    this.actionToken = (this.actionToken ?? 0) + 1;
    const token = this.actionToken;
    this.actionDeadline = cx.timer.after(FRAME_MS + 1000, (next) => {
      if (this.actionToken !== token || !this.acting) return;
      this.actionToken = this.actionToken + 1;
      this.error = "Command did not answer."; this.acting = false; this.boot = null;
      this.readAt = 0; next.notify(); this.schedule(next, 0);
    });
    cx.spawn(async (next) => {
      try { await action(); }
      catch (error) { if (token === this.actionToken) { this.error = failure(error); this.boot = null; } }
      finally {
        if (token === this.actionToken) {
          this.actionDeadline?.cancel(); this.acting = false; this.readAt = 0;
          next.notify(); this.schedule(next, 0);
        }
      }
    });
  }

  start(device, cx) {
    if (!canStart(device, this.tools)) return;
    this.boot = { id: device.id, until: Date.now() + BOOT_MS };
    this.act(() => startDevice(exec, this.platform, this.tools, device), cx);
  }

  android(args, cx) {
    const device = this.current();
    if (device?.platform !== "android" || device.state !== "Booted" || !this.inFront()) return;
    this.batch.add(device.target, { args }); this.flushSoon(cx, 0);
  }

  flushSoon(cx, ms = 80) {
    if (this.textTimer || this.sending) return;
    this.textTimer = cx.timer.after(ms, (next) => { this.textTimer = null; this.flush(next); });
  }

  flush(cx) {
    if (!this.inFront()) { this.batch.take(); return; }
    if (this.sending) return;
    const items = this.batch.take();
    if (!items.length) return;
    this.sending = true;
    cx.spawn(async (next) => {
      try {
        for (const item of items) {
          if (!this.inFront() || item.target !== this.current()?.target) break;
          const commands = item.text ? textParts(item.text).map((part) => ["shell", "input", "text", part]) : [item.args ?? ["shell", "input", "keyevent", String(item.code)]];
          for (const args of commands) {
            if (!this.inFront() || item.target !== this.current()?.target) break;
            await adbCommand(exec, this.tools, item.target, args);
          }
        }
      } catch (error) { this.error = failure(error); }
      finally { this.sending = false; if (this.batch.items.length) this.flushSoon(next); next.notify(); }
    });
  }

  key(event, cx) {
    const device = this.current(), input = keyInput(event);
    if (device?.platform !== "android" || device.state !== "Booted" || !input || !this.inFront()) return;
    this.batch.add(device.target, input); this.flushSoon(cx); cx.stop_propagation();
  }

  point(event) { return screenPoint(event.local_position, event.bounds, this.size, this.loop.last); }

  touch(event, cx, down) {
    const point = this.point(event);
    if (this.current()?.platform !== "android" || !this.loop.last || !point || !this.inFront()) return;
    if (down) { this.focus.focus(); this.press = { point, at: Date.now() }; return; }
    const press = this.press; this.press = null;
    if (!press) return;
    const args = gesture(press.point, point, Date.now() - press.at);
    if (args) this.android(["shell", "input", ...args], cx);
  }

  openUrl(cx) {
    const device = this.current(), url = this.url.value().trim();
    if (device?.platform !== "ios" || device.state !== "Booted" || !/^[a-z][a-z\d+.-]*:\S+$/i.test(url)) return;
    this.act(() => iosCommand(exec, ["openurl", device.target, url]), cx);
  }

  line(text, c, error = false) { return div().text_size(T.body).text_color(error ? c.red : c.muted).child(text); }

  loading(c) { return skeleton(c).block(H.control * 3, H.control * 5, R.card); }

  controls(device, c) {
    const link = (label, fn) => quietLink(`sim-${label}`, label, fn, c, { disabled: this.acting });
    if (device.platform === "android") return h_flex().flex_none().flex_wrap().gap_x(G.md).gap_y(G.xs)
      .children(CONTROLS.map(([label, code]) => link(label, (cx) => this.android(["shell", "input", "keyevent", String(code)], cx))))
      .when(canRotate(device), (el) => el
        .child(link("Rotate", (cx) => this.android(["emu", "rotate"], cx)))
        .child(link("Shut down", (cx) => this.android(["emu", "kill"], cx))));
    return v_flex().flex_none().gap(G.xs)
      .child(h_flex().flex_wrap().gap_x(G.md)
        .child(link("Open in Simulator", (cx) => this.act(() => exec("open", ["-a", "Simulator"]).then(checked), cx)))
        .children(["light", "dark"].map((mode) => link(`Appearance ${mode}`, (cx) => this.act(() => iosCommand(exec, ["ui", device.target, "appearance", mode]), cx))))
        .child(link("Shut down", (cx) => this.act(() => iosCommand(exec, ["shutdown", device.target]), cx))))
      .child(h_flex().gap(G.sm).items_center()
        .child(Input.new(this.url).flex_1().min_w(0).h(H.control))
        .child(link("Open a URL", (cx) => this.openUrl(cx))));
  }

  screen(c) {
    const device = this.current(), frame = this.loop.last, fitted = fitPicture(frame, this.bounds);
    if (this.devices === null) return this.loading(c);
    if (device?.state !== "Booted") return this.line(bootState(device, this.boot, Date.now()) ?? (device ? "Off" : "No devices."), c);
    if (fitted) return div().id("sim-picture").w(fitted.width).h(fitted.height).flex_none().overflow_hidden()
      .on_mouse_down("left", (event, cx) => this.touch(event, cx, true))
      .on_mouse_up("left", (event, cx) => this.touch(event, cx, false))
      .child(image(frame.path).w(fitted.width).h(fitted.height));
    if (this.loop.late(Date.now())) return this.line("No picture from the device.", c);
    return this.loading(c);
  }

  render(cx) {
    if (!this.inFront()) { this.front.rest(); this.batch.take(); }
    this.front.wake(cx, (next) => this.tick(next));
    const c = tokens(theme()), device = this.current();
    const status = bootState(device, this.boot, Date.now());
    const late = this.loop.late(Date.now());
    return v_flex().id("kanso-sim").track_focus(this.focus).size_full().min_h(0).bg(c.canvas).text_color(c.text).gap(G.sm).p(G.lg)
      .on_key_down((event, next) => this.key(event, next))
      .child(h_flex().flex_none().items_center().gap(G.sm)
        .child(div().flex_1().text_size(T.title).font_semibold().child("Simulator"))
        .child(quietLink("sim-refresh", "Refresh", (next) => { this.readAt = 0; this.tick(next); }, c, { disabled: this.reading })))
      .when(this.devices === null, (el) => el.child(skeleton(c).row()))
      .when(Boolean(this.devices), (el) => el.child(v_flex().id("sim-devices").flex_none().max_h(H.control * 5).overflow_y_scrollbar().gap(G.xs)
        .children((this.devices ?? []).map((item) => h_flex().id(`sim-device-${item.id}`).min_h(H.control).px(G.sm).gap(G.sm).rounded(R.control).items_center().cursor_pointer()
          .when(item.id === this.selected, (row) => row.bg(c.selected))
          .hover((row) => row.bg(c.subtle))
          .on_click((_event, next) => this.pick(item, next))
          .child(div().flex_1().min_w(0).truncate().text_size(T.value).child(item.name))
          .child(div().flex_none().text_size(T.small).text_color(c.dim).child(item.runtime ?? "Android"))
          .child(this.line(this.boot?.id === item.id ? bootState(item, this.boot, Date.now()) ?? item.state : item.state, c))))))
      .when(Boolean(spaces().find((space) => space.active)?.machine), (el) => el.child(this.line("Devices are on this computer.", c)))
      .when(Boolean(this.tools?.adb && !this.tools.emulator), (el) => el.child(this.line("Android SDK emulator binary is missing.", c)))
      .when(Boolean(this.note), (el) => el.child(this.line(this.note, c)))
      .when(Boolean(this.error), (el) => el.child(this.line(this.error, c, true)))
      .when(Boolean(device?.issue), (el) => el.child(this.line(device.issue, c)))
      .when(canStart(device, this.tools) && !status, (el) => el.child(quietLink("sim-start", "Start", (next) => this.start(device, next), c, { disabled: this.acting })))
      .child(div().id("sim-screen-area").flex_1().min_h(0).w_full().flex().items_center().justify_center().overflow_hidden()
        .on_size_change((size, next) => { if (this.bounds?.width !== size.width || this.bounds?.height !== size.height) { this.bounds = size; next.notify(); } })
        .child(this.screen(c)))
      .when(Boolean(late && this.loop.last), (el) => el.child(this.line(age(this.loop.last.at, Date.now()), c)))
      .when(device?.state === "Booted", (el) => el.child(this.controls(device, c)));
  }
}

// Copyright (c) 2026 Robert Soriano
// Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions: The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
// Modified by jlopezlira (Kanso, https://github.com/jlopezlira/herdr-kanso): the device view from herdr-sim, as a Kanso panel.
import { View, div, image, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { exec, theme, appHome, shared, setShared, nextCommand, window, spaces, home } from "herdr";
import { G, H, T, ICON, tokens, quietLink, iconButton, skeleton } from "./ui.js";
import { pathApi } from "./platform-paths.js";
import { powershell } from "./platform-command.js";
import { connectTcp, makeDir, portOpen, writeBytes } from "./host-io.js";
import { bootIos, killIos, listSimulators, openIos } from "./ios.js";
import { bootAvd, listEmulators, openAndroid } from "./android.js";
import {
  ENV_NAMES, IOS_ONLY, INSTALL_LINE, LAST_PICKED, REMOTE_LINE, SERVE_INSTALL,
  commandError, gapRows, iosOn, probeRuntime, probeTools, readNamedEnv, streamBlock,
} from "./sim-register.js";
import {
  RELOAD_MS, RING, advanceSlot, chooseDevice, claimSlot, createParser, fitScreen, fractionOf, frameFile,
  freshStack, freshness, imageAspect, keyUsages, promoteStack, pushBytes, releaseSlot, scheduleFrame,
  scrollFractions, touchEdge, unwatch, watch,
} from "./model.js";

const ICONS = "mods/kanso-sim/icons/";
const CONSUMER = 12;
const VOLUME_UP = 233;
const VOLUME_DOWN = 234;
const TOOLS = [
  { id: "home", icon: "house", tip: "Home", run: (input) => input.button("home") },
  { id: "lock", icon: "lock", tip: "Lock", run: (input) => input.button("lock") },
  { id: "volume-down", icon: "volume-1", tip: "Volume down", run: (input) => input.hid(CONSUMER, VOLUME_DOWN) },
  { id: "volume-up", icon: "volume-2", tip: "Volume up", run: (input) => input.hid(CONSUMER, VOLUME_UP) },
  { id: "rotate", icon: "rotate-ccw", tip: "Rotate", run: (input) => input.rotate() },
  { id: "keyboard", icon: "keyboard", tip: "Software keyboard", ios: true, run: (input) => input.softwareKeyboard() },
];
const later = (cx, ms) => new Promise((resolve) => { cx.timer.after(ms, resolve); });
const VIEWERS = "kanso.sim.viewers";
const SLOTS = "kanso.sim.slots";

export default class Simulator extends View {
  init(_props, cx) {
    this.phase = "reading";
    this.devices = [];
    this.device = null;
    this.wanted = null;
    this.picking = false;
    this.gaps = [];
    this.platform = "macos";
    this.remote = false;
    this.node = false;
    this.serve = false;
    this.simctl = false;
    this.sdk = false;
    this.adb = null;
    this.emulator = null;
    this.dirs = [];
    this.env = null;
    this.aspect = 9 / 19.5;
    this.size = { width: 368, height: 720 };
    this.lastAt = null;
    this.inputError = null;
    this.inputDirty = false;
    this.error = null;
    this.token = 0;
    this.bootingId = null;
    this.installing = false;
    this.prepared = false;
    this.streaming = false;
    this.socket = null;
    this.session = null;
    this.held = null;
    this.keys = new Map();
    this.touch = null;
    this.closed = false;
    this.dirReady = false;
    this.frameIndex = 0;
    this.focus = cx.focus_handle();
    const claimed = claimSlot(shared(SLOTS) ?? []);
    setShared(SLOTS, claimed.taken);
    this.slot = claimed.id;
    this.files = Array.from({ length: RING }, (_, index) => frameFile(this.slot, index));
    this.stack = freshStack();
    this.filled = new Set();
    cx.timer.after(0, (cx) => this.begin(cx));
  }

  begin(cx) {
    this.tick = cx.timer.every(1000, (cx) => this.paintFresh(cx));
    cx.spawn((cx) => this.commands(cx));
    cx.spawn((cx) => this.loop(cx));
  }

  async close() {
    this.closed = true;
    this.token += 1;
    try { this.tick?.cancel(); } catch { /* already gone */ }
    this.socket?.close();
    await this.dropHeld();
    setShared(SLOTS, releaseSlot(shared(SLOTS) ?? [], this.slot));
  }

  hold(id, platform) {
    if (this.held === id) return;
    setShared(VIEWERS, watch(shared(VIEWERS) ?? {}, id).book);
    this.held = id;
    this.heldPlatform = platform;
  }

  release() {
    if (!this.held) return { last: false };
    const step = unwatch(shared(VIEWERS) ?? {}, this.held);
    setShared(VIEWERS, step.book);
    const prev = { last: step.last, id: this.held, platform: this.heldPlatform };
    this.held = null;
    return prev;
  }

  async commands(cx) {
    for (;;) {
      const next = await nextCommand().then((value) => value, () => undefined);
      if (next == null) break;
      if (next === "focus") this.focus?.focus();
      cx.notify();
    }
  }

  paintFresh(cx) {
    if (this.inputDirty) { this.inputDirty = false; cx.notify(); }
    if (!this.streaming) return;
    if (window()?.active === false) { this.socket?.close(); return; }
    const next = freshness(this.lastAt, Date.now());
    if (next === "stalled" && this.phase === "live") { this.phase = "stalled"; cx.notify(); }
    else if (next === "live" && this.phase === "stalled") { this.phase = "live"; cx.notify(); }
  }

  failInput(message) {
    const text = String(message ?? "").trim();
    this.inputError = text.startsWith("Input failed") ? text : text ? `Input failed. ${text}` : "Input failed.";
    this.inputDirty = true;
  }

  clearInput() {
    if (!this.inputError) return;
    this.inputError = null;
    this.inputDirty = true;
  }

  waitUntil(cx, pred, ms) {
    const mark = Date.now() + (ms ?? 0);
    const timed = ms != null;
    return new Promise((resolve) => {
      const step = () => {
        if (this.closed || pred() || (timed && Date.now() >= mark)) { resolve(); return; }
        cx.timer.after(200, step);
      };
      step();
    });
  }

  async loop(cx) {
    while (!this.closed) {
      if (!this.prepared) {
        try { await this.prepare(); this.prepared = true; }
        catch (error) {
          this.phase = "error";
          this.error = String(error?.message ?? error);
          cx.notify();
          const token = this.token;
          await this.waitUntil(cx, () => this.token !== token);
          continue;
        }
      }
      const token = this.token;
      if (window()?.active === false) {
        await this.park();
        if (this.phase === "live" || this.phase === "stalled") this.phase = "stopped";
        cx.notify();
        await this.waitUntil(cx, () => window()?.active !== false || this.token !== token);
        continue;
      }
      try {
        await this.relist();
        this.showDevice();
        const device = this.device;
        if (!device) {
          this.phase = this.gaps.length ? "missing" : "empty";
          cx.notify();
          await this.waitUntil(cx, () => this.token !== token, 2000);
          continue;
        }
        if (!device.booted) {
          this.phase = this.bootingId === device.id ? "booting" : "shutdown";
          cx.notify();
          await this.waitUntil(cx, () => this.token !== token, 1000);
          continue;
        }
        const block = streamBlock({ platform: this.platform, node: this.node, simctl: this.simctl, sdk: this.sdk, serve: this.serve, device });
        if (block) {
          this.phase = "missing";
          cx.notify();
          await this.waitUntil(cx, () => this.token !== token, 1000);
          continue;
        }
        this.phase = "starting";
        cx.notify();
        await this.connect(cx, device);
        if (this.closed || this.token !== token) continue;
        await this.stream(cx, token);
        if (this.closed || this.token !== token || window()?.active === false) continue;
        this.lastAt = null;
        this.phase = "stopped";
        cx.notify();
        await this.waitUntil(cx, () => this.token !== token);
      } catch (error) {
        if (this.closed) return;
        this.phase = "error";
        this.error = String(error?.message ?? error);
        cx.notify();
        await this.waitUntil(cx, () => this.token !== token, 2000);
      }
    }
  }

  async prepare() {
    this.platform = window()?.platform ?? "macos";
    this.api = pathApi(this.platform);
    this.env = await readNamedEnv(this.platform, exec, ENV_NAMES, powershell);
    const tools = await probeTools({ platform: this.platform, home: home(), env: this.env, run: exec, api: this.api });
    const runtime = await probeRuntime(exec);
    this.simctl = tools.ios;
    this.sdk = tools.android;
    this.node = runtime.node;
    this.serve = runtime.serve;
  }

  async relist() {
    this.remote = Boolean(spaces().find((space) => space.active)?.machine);
    const ios = this.simctl ? await listSimulators().catch(() => []) : [];
    const android = await listEmulators(this.platform, this.env).catch(() => ({ sdk: this.sdk, devices: [], adb: this.adb, emulator: this.emulator, dirs: this.dirs }));
    this.sdk = android.sdk;
    this.adb = android.adb;
    this.emulator = android.emulator;
    this.dirs = android.dirs ?? [];
    this.devices = [...ios, ...android.devices];
    this.gaps = gapRows({ platform: this.platform, node: this.node, simctl: this.simctl, sdk: this.sdk, serve: this.serve });
  }

  showDevice() {
    this.device = chooseDevice(this.devices, this.wanted ?? shared(LAST_PICKED));
    if (this.device) this.wanted = this.device.id;
  }

  async connect(cx, device) {
    if (this.held !== device.id) {
      if (this.held) await this.dropHeld();
      this.hold(device.id, device.platform);
    }
    this.session?.input?.close();
    try {
      this.session = device.platform === "ios"
        ? await openIos(device, (message) => this.failInput(message), () => this.clearInput())
        : await openAndroid(device, this.adb, this.dirs, this.platform, (message) => this.failInput(message), () => this.clearInput());
      if (device.platform === "android" && !(await this.waitPort(cx, this.session.port))) throw new Error("The emulator's screen stream didn't start");
    } catch (error) {
      await this.dropHeld();
      throw error;
    }
  }

  async waitPort(cx, port, left = 50) {
    if (this.closed || left <= 0) return false;
    if (await portOpen(port)) return true;
    await later(cx, 100);
    return this.waitPort(cx, port, left - 1);
  }

  async stream(cx, token) {
    const { host, port, path } = this.session;
    const socket = await connectTcp(host, port);
    this.socket = socket;
    this.streaming = true;
    this.due = 0;
    this.parser = createParser();
    await socket.write(`GET ${path} HTTP/1.1\r\nHost: ${host}\r\n\r\n`);
    try {
      while (!this.closed && this.token === token && window()?.active !== false) {
        const chunk = await socket.read(65536).catch(() => null);
        if (chunk == null || this.token !== token || this.closed) break;
        const step = pushBytes(this.parser, chunk);
        this.parser = step.parser;
        for (const frame of step.frames) {
          this.lastAt = Date.now();
          if (this.phase !== "live") { this.phase = "live"; cx.notify(); }
          const next = scheduleFrame(this.due, this.lastAt);
          if (next == null) continue;
          this.due = next;
          const aspect = imageAspect(frame);
          if (aspect) this.aspect = aspect;
          const slot = this.frameIndex;
          this.frameIndex = advanceSlot(this.frameIndex);
          if (!this.dirReady) {
            await makeDir(this.api.join(appHome(), "mods", "kanso-sim-frames"));
            this.dirReady = true;
          }
          await writeBytes(this.api.join(appHome(), "mods", "kanso-sim-frames", `${this.slot}-${slot}.jpg`), frame);
          this.filled.add(slot);
          cx.timer.after(RELOAD_MS, (cx) => { this.stack = promoteStack(this.stack, slot); cx.notify(); });
        }
      }
    } finally {
      socket.close();
      if (this.socket === socket) this.socket = null;
      this.streaming = false;
    }
  }

  async park() {
    this.socket?.close();
    this.socket = null;
    this.streaming = false;
    await this.dropHeld();
  }

  async dropHeld() {
    const prev = this.release();
    this.session?.input?.close();
    this.session = null;
    if (prev.last && prev.platform === "ios") {
      try { await killIos(prev.id); } catch { /* helper already gone */ }
    }
  }

  boot(cx) {
    const device = this.device;
    if (!device || device.booted || this.bootingId) return;
    this.bootingId = device.id;
    this.phase = "booting";
    this.token += 1;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        if (device.platform === "ios") await bootIos(device.id);
        else await bootAvd(this.emulator, device.avd, this.platform);
      } catch (error) {
        this.phase = "error";
        this.error = String(error?.message ?? error);
        cx.notify();
      }
      if (this.bootingId === device.id) this.bootingId = null;
    });
  }

  install(cx) {
    if (this.installing || !this.node) return;
    this.installing = true;
    this.phase = "starting";
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        const result = await exec("npx", SERVE_INSTALL, { timeout: 600000 });
        const error = commandError(result, "npx failed");
        if (error) throw error;
        this.serve = true;
        this.gaps = gapRows({ platform: this.platform, node: this.node, simctl: this.simctl, sdk: this.sdk, serve: true });
        this.token += 1;
      } catch (error) {
        this.phase = "error";
        this.error = String(error?.message ?? error);
        cx.notify();
      }
      this.installing = false;
    });
  }

  pick(device, cx) {
    if (device.unusable) return;
    this.picking = false;
    this.wanted = device.id;
    this.device = device;
    setShared(LAST_PICKED, device.id);
    this.token += 1;
    this.socket?.close();
    cx.notify();
  }

  reconnect(cx) {
    this.error = null;
    this.phase = "starting";
    this.token += 1;
    this.socket?.close();
    cx.notify();
  }

  keyDown(event, cx) {
    const input = this.session?.input;
    const key = input && keyUsages(event);
    if (!key) return;
    cx.stop_propagation();
    if (this.keys.has(key.usage)) return;
    this.keys.set(key.usage, key.modifiers);
    for (const modifier of key.modifiers) input.key("down", modifier);
    input.key("down", key.usage);
  }

  keyUp(event, cx) {
    const input = this.session?.input;
    const key = input && keyUsages(event);
    const modifiers = key && this.keys.get(key.usage);
    if (!modifiers) return;
    cx.stop_propagation();
    this.keys.delete(key.usage);
    input.key("up", key.usage);
    for (const modifier of modifiers.toReversed()) input.key("up", modifier);
  }

  pointerDown(event) {
    this.focus?.focus();
    const point = fractionOf(event.local_position, event.bounds);
    const input = this.session?.input;
    if (!point || !input || this.phase !== "live") return;
    this.touch = { ...point, edge: touchEdge(point) };
    input.touch("begin", point, this.touch.edge);
  }

  pointerMove(event) {
    const point = fractionOf(event.local_position, event.bounds);
    if (!this.touch || !point) return;
    this.touch = { ...this.touch, ...point };
    this.session?.input?.touch("move", point, this.touch.edge);
  }

  pointerUp(event) {
    const point = fractionOf(event?.local_position, event?.bounds);
    const touch = this.touch;
    if (!touch) return;
    this.touch = null;
    this.session?.input?.touch("end", point ?? touch, touch.edge);
  }

  wheel(event) {
    const point = fractionOf(event.local_position, event.bounds);
    const move = scrollFractions(event.delta, event.delta_lines, event.bounds);
    if (!point || !move || !this.session?.input || this.phase !== "live") return;
    this.session.input.scroll(move.dx, move.dy, point);
  }

  fit() {
    const maxW = Math.max(1, (this.size?.width ?? 368) - G.md * 2 - G.sm * 2);
    const maxH = Math.max(1, (this.size?.height ?? 720) - H.control - H.compact - G.md * 2 - G.sm * 4);
    return fitScreen(maxW, maxH, this.aspect || 9 / 19.5);
  }

  render() {
    const c = tokens(theme());
    const fit = this.fit();
    const device = this.device;
    return v_flex().id("kanso-sim").size_full().min_h(0).p(G.md).gap(G.sm)
      .track_focus(this.focus)
      .on_key_down((event, cx) => this.keyDown(event, cx))
      .on_key_up((event, cx) => this.keyUp(event, cx))
      .on_size_change((size, cx) => { this.size = size; cx.notify(); })
      .child(this.head(c, device))
      .when(this.picking, (el) => el.child(this.list(c)))
      .when(this.gaps.length, (el) => el.child(this.gapList(c)))
      .child(this.toolbar(c))
      .when(this.inputError, (el) => el.child(div().text_size(T.small).text_color(c.red).child(this.inputError)))
      .child(this.stage(c, fit));
  }

  head(c, device) {
    return v_flex().w_full().gap(G.xs)
      .when(this.remote, (el) => el.child(div().text_size(T.small).text_color(c.dim).child(REMOTE_LINE)))
      .when(!iosOn(this.platform), (el) => el.child(div().text_size(T.small).text_color(c.dim).child(IOS_ONLY)))
      .child(h_flex().w_full().items_center().gap(G.sm)
        .child(div().flex_1().min_w(0).truncate().text_size(T.card).text_color(device ? c.text : c.dim).child(device ? device.name : "Simulator"))
        .when(device, (el) => el.child(div().flex_none().text_size(T.small).text_color(c.dim).child(device.os)))
        .when(device?.booted, (el) => el.child(div().flex_none().text_size(T.small).text_color(c.muted).child("Booted")))
        .when(device && !device.booted && !device.unusable, (el) => el.child(quietLink("sim-boot", "Boot", (cx) => this.boot(cx), c)))
        .child(quietLink("sim-change", "Change", (cx) => { this.picking = !this.picking; if (this.picking) cx.spawn(async (cx) => { try { await this.relist(); this.showDevice(); } catch { /* keep the list */ } cx.notify(); }); cx.notify(); }, c)));
  }

  list(c) {
    if (!this.devices.length) return div();
    return v_flex().w_full().gap(G.xs).children(this.devices.map((device) => this.row(c, device)));
  }

  row(c, device) {
    const id = `sim-row-${device.id.replace(/[^A-Za-z0-9_-]/g, "-")}`;
    return h_flex().id(id).w_full().items_center().gap(G.sm).py(G.xs)
      .when(device.unusable, (el) => el.opacity(0.5))
      .when(!device.unusable, (el) => el.cursor_pointer().on_click((_event, cx) => this.pick(device, cx)))
      .child(svg(`${ICONS}${device.platform === "ios" ? "apple" : "android"}.svg`).size(ICON).flex_none().text_color(c.muted))
      .child(div().flex_1().min_w(0).truncate().text_size(T.body).text_color(c.text).child(device.name))
      .child(div().flex_none().text_size(T.small).text_color(c.dim).child(device.unusable ?? device.os))
      .when(device.booted, (el) => el.child(div().flex_none().text_size(T.small).text_color(c.muted).child("Booted")));
  }

  gapList(c) {
    return v_flex().w_full().gap(G.sm).children(this.gaps.map((row) => this.gap(c, row)));
  }

  gap(c, row) {
    return v_flex().w_full().gap(G.xs)
      .when(!row.install, (el) => el.child(div().text_size(T.body).text_color(c.text).child(row.text)))
      .when(row.command, (el) => el.child(div().text_size(T.small).text_color(c.muted).child(row.command)))
      .when(row.link, (el) => el.child(quietLink(`sim-link-${row.id}`, row.link.replace(/^https:\/\//, ""), (cx) => cx.open_url(row.link), c, { size: T.small })))
      .when(row.install, (el) => el.child(quietLink("sim-install", this.installing ? INSTALL_LINE : row.text, (cx) => this.install(cx), c, { disabled: this.installing, size: T.small })));
  }

  toolbar(c) {
    const on = Boolean(this.session?.input);
    const ios = this.device?.platform === "ios";
    return h_flex().w_full().items_center().justify_end().gap(G.xs).children(TOOLS.filter((tool) => !tool.ios || ios).map((tool) => iconButton(
      `sim-${tool.id}`, `${ICONS}${tool.icon}.svg`, tool.tip,
      (cx) => {
        const input = this.session?.input;
        if (!input) return;
        cx.spawn(async (cx) => {
          try { await tool.run(input); }
          catch (error) { this.failInput(error?.message ?? error); cx.notify(); }
        });
      },
      c,
      { disabled: !on },
    )));
  }

  stage(c, fit) {
    if (this.phase === "reading" || this.phase === "booting" || this.phase === "starting") return this.bones(c);
    if (this.phase === "live") return this.screen(c, fit);
    const text = this.phase === "stalled" ? "The picture stalled."
      : this.phase === "stopped" ? "The stream stopped."
      : this.phase === "empty" ? "No simulators or emulators."
      : this.phase === "error" ? (this.error || "The stream stopped.")
      : null;
    const again = this.phase === "stalled" || this.phase === "stopped" || this.phase === "error";
    if (!text && !again) return div();
    return v_flex().w_full().gap(G.sm).items_start()
      .when(text, (el) => el.child(div().text_size(T.body).text_color(c.text).child(text)))
      .when(again, (el) => el.child(quietLink("sim-reconnect", "Reconnect", (cx) => this.reconnect(cx), c)));
  }

  bones(c) {
    const sk = skeleton(c);
    return v_flex().w_full().gap(G.sm).child(sk.row(0)).child(sk.row(1)).child(sk.row(2));
  }

  screen(c, fit) {
    const shown = this.stack.filter((index) => this.filled.has(index));
    const picture = div().id("sim-screen").relative().w(fit.width).h(fit.height)
      .children(shown.map((index) => image(this.files[index]).absolute().top(0).left(0).w(fit.width).h(fit.height).rounded(fit.radius)))
      .on_mouse_down("left", (event) => this.pointerDown(event))
      .on_mouse_move((event) => this.pointerMove(event))
      .on_mouse_up("left", (event) => this.pointerUp(event))
      .on_hover((hovered) => { if (!hovered) this.pointerUp(null); })
      .on_scroll_wheel((event) => this.wheel(event));
    return div().p(G.sm).rounded(fit.radius + G.sm).bg(c.raised).border_1().border_color(c.border).child(picture);
  }
}

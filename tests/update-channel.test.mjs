// The update channel: what the shell is given, what the toast says, and the What's new row.
import assert from "node:assert/strict";
import test from "node:test";
import { hostInstall } from "../kanso/mods/kanso-chrome/release.js";
import { context, load, tape } from "./helpers.mjs";

const listing = [
  "a\trefs/tags/v3.29.0",
  "b\trefs/tags/v3.30.0-beta.1",
  "c\trefs/tags/v3.30.0-beta.2",
  "d\trefs/tags/v3.30.0",
  "e\trefs/tags/v3.31.0-beta.1",
].join("\n");

function updaterHost({ store, toasts = [], version = "3.30.0", onExec }) {
  return {
    appHome: () => "/app",
    layout: () => null,
    shared: (key) => store[key],
    setShared: (key, value) => { store[key] = value; },
    notify: (note) => { toasts.push(note); return String(toasts.length); },
    readTextFile: async () => `{"version":"${version}"}`,
    exec: async (command, args) => {
      if (onExec) return onExec(command, args);
      return command === "git" ? { code: 0, stdout: listing, stderr: "" } : { code: 0, stdout: "", stderr: "" };
    },
  };
}

test("A prerelease download uses the tag, and the version check wants X.Y.Z", async () => {
  const store = { "kanso.update": { channel: "beta", tag: "3.30.0-beta.1", latest: "3.30.0-beta.2", autoCheck: true } };
  const urls = [];
  const sh = [];
  const { Updater } = await load("kanso-chrome/update.js", ["Updater"], updaterHost({
    store,
    onExec: async (command, args) => {
      if (command === "curl") { urls.push(args.at(-1)); return { code: 1, stdout: "", stderr: "" }; }
      if (command === "sh") { sh.push(args); return { code: String(args[1]).startsWith("dir=") ? 1 : 0, stdout: "", stderr: "could not start" }; }
      return { code: 0, stdout: "", stderr: "" };
    },
  }));
  const updater = new Updater();
  updater.installed = "3.30.0";
  const { cx } = context();
  await updater.install(cx);
  const spec = hostInstall("3.30.0-beta.2", "3.30.0");
  const launch = sh.find((args) => String(args[1]).startsWith("dir="));
  assert.equal(launch[6], `https://github.com/jlopezlira/herdr-kanso/archive/refs/tags/v${spec.tag}.tar.gz`);
  assert.equal(launch[10], spec.want);
  assert.equal(launch[11], spec.from);
  assert.equal(spec.want, "3.30.0");
  assert.ok(urls.some((url) => url.includes("/v3.30.0-beta.1/")));
  assert.ok(urls.some((url) => url.includes("/v3.30.0-beta.2/")));
});

test("A finished install records its tag when version.json is that version", async () => {
  const store = { "kanso.update": { channel: "beta", tag: "3.30.0-beta.1" } };
  const { Updater } = await load("kanso-chrome/update.js", ["Updater"], updaterHost({ store }));
  const updater = new Updater();
  updater.installed = "3.30.0";
  const { cx } = context();
  await updater.report(cx, "ok", "", { version: "3.30.0-beta.2" });
  assert.equal(store["kanso.update"].tag, "3.30.0-beta.2");

  const moved = { "kanso.update": { tag: "3.30.0-beta.2" } };
  const { Updater: Again } = await load("kanso-chrome/update.js", ["Updater"], updaterHost({ store: moved, version: "3.31.0" }));
  const next = new Again();
  await next.report(cx, "ok", "", { version: "3.30.0-beta.2" });
  assert.equal(next.installed, "3.31.0");
  assert.equal(moved["kanso.update"].tag ?? null, null);
});

test("The toast names the tag, and Stable never offers an older release", async () => {
  const look = async (state, version) => {
    const store = { "kanso.update": { autoCheck: true, ...state } };
    const toasts = [];
    const { Updater } = await load("kanso-chrome/update.js", ["Updater"], updaterHost({ store, toasts, version }));
    const updater = new Updater();
    const { cx } = context();
    await updater.check(cx, true, true);
    return { updater, toasts };
  };
  const early = await look({ channel: "beta", tag: "3.30.0-beta.1" }, "3.30.0");
  assert.equal(early.toasts[0].title, "kansō 3.31.0-beta.1 is available");
  assert.match(early.toasts[0].body, /You have 3.30.0-beta.1/);

  const stable = await look({ tag: "3.30.0-beta.2" }, "3.30.0");
  assert.equal(stable.toasts[0].title, "kansō 3.30.0 is available");
  assert.match(stable.toasts[0].body, /You have 3.30.0-beta.2/);
  assert.equal(stable.toasts.some((note) => note.title.includes("beta")), false);

  const ahead = await look({ tag: "3.31.0-beta.1" }, "3.31.0");
  assert.equal(ahead.updater.available(), null);
  assert.equal(ahead.toasts[0].title, "kansō is up to date");
  assert.match(ahead.toasts[0].body, /You have 3.31.0-beta.1/);
});

test("Choosing Early looks again, and Stable stays the default until then", async () => {
  const store = { "kanso.update": { autoCheck: true, tag: "3.30.0-beta.2", latest: "3.29.0" } };
  let asked = 0;
  const { Updater } = await load("kanso-chrome/update.js", ["Updater"], updaterHost({
    store,
    onExec: async (command) => {
      if (command === "git") { asked += 1; return { code: 0, stdout: listing, stderr: "" }; }
      return { code: 0, stdout: "", stderr: "" };
    },
  }));
  const updater = new Updater();
  const timers = [];
  const { cx, drain } = context();
  cx.timer = { every(ms, fn) { timers.push({ ms, fn }); } };
  updater.start(cx);
  await drain();
  const seen = asked;
  const fit = timers.filter((timer) => timer.ms === 1500);
  assert.equal(fit.length, 1);
  fit[0].fn(cx);
  await drain();
  assert.equal(asked, seen, "the first look at the channel does not check again");
  store["kanso.update"] = { ...store["kanso.update"], channel: "beta" };
  fit[0].fn(cx);
  await drain();
  assert.equal(asked, seen + 1);
  assert.equal(updater.available(), "3.31.0-beta.1");
  assert.equal(updater.channel(), "beta");
});

const colors = () => ({
  foreground: "#111", background: "#fff", muted: "#888", dim: "#999", border: "#ccc", input: "#ccc",
  raised: "#eee", canvas: "#fff", accent: "#a00", popover: "#fff", solid: "#111", solid_foreground: "#fff",
  ansi2: "#070", hover: "#eee",
});

async function settingsOf(store) {
  const ui = tape();
  ui.host.Toggle = { new: (id) => ui.host.Button.new(id) };
  const { Settings } = await load("kanso-settings/main.js", ["Settings"], {
    ...ui.host,
    theme: colors,
    props: () => ({}),
    shared: (key) => store[key],
    setShared: (key, value) => { store[key] = value; },
    appHome: () => "/app",
    keys: () => [],
    run: () => {},
    closeOverlay: () => {},
  });
  const settings = new Settings();
  settings.page = "news";
  settings.handle = {};
  settings.news = { entries: [], error: null, from: null };
  settings.installed = "3.30.0";
  return { ui, settings };
}

const drawn = (ui) => ui.texts.join("");

test("What's new offers Stable or Early, and Early is the only place that asks for a star", async () => {
  const store = { "kanso.update": { autoCheck: true } };
  const { ui, settings } = await settingsOf(store);
  settings.newsPage(colors(), colors());
  assert.equal(settings.shown(), "3.30.0");
  assert.match(drawn(ui), /Updates/);
  assert.match(drawn(ui), /Stable/);
  assert.match(drawn(ui), /Early/);
  assert.match(drawn(ui), /Check for updates/);
  assert.equal(drawn(ui).includes("Star on GitHub"), false);
  assert.equal(drawn(ui).includes("until Stable reaches it"), false);
  assert.equal(ui.handlers.has("updates-channel-stable"), true);
  assert.equal(ui.handlers.has("updates-star"), false);

  const cx = { notes: 0, notify() { this.notes += 1; }, open_url(url) { this.url = url; } };
  const before = JSON.stringify(store);
  ui.handlers.get("updates-channel-stable")(null, cx);
  assert.equal(JSON.stringify(store), before);
  ui.handlers.get("updates-channel-beta")(null, cx);
  assert.equal(store["kanso.update"].channel, "beta");
  assert.equal(store["kanso.update"].autoCheck, true);
  assert.equal(cx.notes, 1);

  ui.texts.length = 0;
  ui.handlers.clear();
  settings.newsPage(colors(), colors());
  assert.equal(drawn(ui).includes("until Stable reaches it"), false);
  assert.match(drawn(ui), /Early gets changes before they are tested by everyone\. If kansō is useful to you, Star on GitHub helps others find it\./);
  ui.handlers.get("updates-star")(null, cx);
  assert.equal(cx.url, "https://github.com/jlopezlira/herdr-kanso");

  store["kanso.update"] = { autoCheck: true, channel: "stable", tag: "3.30.0-beta.2", latest: "3.29.0" };
  ui.texts.length = 0;
  ui.handlers.clear();
  settings.render();
  assert.equal(settings.shown(), "3.30.0-beta.2");
  assert.match(drawn(ui), /You stay on 3.30.0-beta.2 until Stable reaches it/);
  assert.equal(drawn(ui).includes("Star on GitHub"), false);
  assert.match(drawn(ui), /3\.30\.0-beta\.2/);
});

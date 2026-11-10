import assert from "node:assert/strict";
import test from "node:test";
import { load } from "./helpers.mjs";

function tape() {
  const make = () => {
    const node = { calls: [], kids: [], ids: [], loops: [], texts: [] };
    const proxy = new Proxy(node, {
      get(_target, prop) {
        if (prop === "__node") return node;
        if (typeof prop === "symbol") return undefined;
        if (prop === "child") return (c) => { keep(node, c); return proxy; };
        if (prop === "children") return (list) => { for (const c of list ?? []) keep(node, c); return proxy; };
        if (prop === "when") return (cond, f) => { if (cond) f(proxy); return proxy; };
        return (...args) => {
          node.calls.push([String(prop), args]);
          if (prop === "id" && args[0] != null) node.ids.push(args[0]);
          if (prop === "loop") node.loops.push(args);
          if (typeof args[0] === "string" && (prop === "child" || prop === "text")) node.texts.push(args[0]);
          for (const arg of args) if (arg && arg.__node) keep(node, arg);
          return proxy;
        };
      },
    });
    return proxy;
  };
  return make;
}

function keep(node, c) {
  if (c == null) return;
  if (typeof c === "string") { node.texts.push(c); return; }
  if (Array.isArray(c)) { for (const x of c) keep(node, x); return; }
  node.kids.push(c.__node ?? c);
}

function walk(el) {
  const out = { ids: [], loops: [], texts: [], calls: [] };
  const seen = new Set();
  const visit = (n) => {
    if (!n || typeof n !== "object" || seen.has(n)) return;
    seen.add(n);
    out.ids.push(...(n.ids ?? []));
    out.loops.push(...(n.loops ?? []));
    out.texts.push(...(n.texts ?? []));
    out.calls.push(...(n.calls ?? []));
    for (const k of n.kids ?? []) visit(k);
  };
  visit(el?.__node ?? el);
  return out;
}

const breathing = (info) => info.loops.some((a) => a[0] === "opacity" && a[1]?.from === 0.35 && a[1]?.to === 0.8 && a[1]?.period === 1800);
const quiet = (info) => info.texts.every((t) => !/Reading|Loading|Asking Docker|Drawing it|Adding up what/i.test(String(t)));

function assertSkeleton(el, id = "kanso-skeleton") {
  const info = walk(el);
  assert.equal(info.ids.includes(id), true, id);
  assert.equal(breathing(info), true, "breathes");
  assert.equal(quiet(info), true, info.texts.join(" | "));
  return info;
}

const c = {
  border: "#ccc", canvas: "#fff", text: "#111", dim: "#888", muted: "#777", subtle: "#eee",
  primary: "#111", primaryText: "#fff", red: "#c00", green: "#090", yellow: "#cc0", accent: "#36c",
  input: "#ddd", raised: "#f4f4f4", selected: "#eee", popover: "#fff",
};

test("the shared skeleton is one vocabulary: a line, a block, the old list row and a header", async () => {
  const make = tape();
  const { skeleton, ghost, breathe, BREATH } = await load("kanso-panel/ui.js", ["skeleton", "ghost", "breathe", "BREATH"], {
    div: make, h_flex: make, svg: make,
  });
  assert.equal(ghost, skeleton);
  const { line, row, header } = skeleton({ border: "#ccc" });
  const plain = row(0).__node.calls;
  const plainAll = walk(row(0));
  assert.equal(plain.some(([p, a]) => p === "py" && a[0] === 9), true);
  assert.equal(plain.some(([p]) => p === "h"), false);
  assert.equal(plainAll.calls.some(([p, a]) => p === "w" && a[0] === 120), true);
  assert.equal(plainAll.calls.some(([p, a]) => p === "w" && a[0] === 40), true);
  assert.equal(plainAll.calls.some(([p, a]) => p === "h" && a[0] === 11), true);
  const fixed = row(1, 28).__node.calls;
  const fixedAll = walk(row(1, 28));
  assert.equal(fixed.some(([p, a]) => p === "h" && a[0] === 28), true);
  assert.equal(fixed.some(([p, a]) => p === "py"), false);
  assert.equal(fixedAll.calls.some(([p, a]) => p === "w" && a[0] === 14), true);
  assert.equal(fixedAll.calls.some(([p, a]) => p === "w" && a[0] === 40), false);
  const head = walk(header());
  assert.equal(head.calls.some(([p, a]) => p === "w" && a[0] === 88), true);
  assert.equal(head.calls.some(([p, a]) => p === "w" && a[0] === 26 && head.calls.some(([q, b]) => q === "h" && b[0] === 26)), true);
  const ruled = walk(line(80, 12));
  assert.equal(ruled.calls.some(([p, a]) => p === "rounded" && a[0] === 3), true);
  const el = make();
  const back = breathe(el);
  assert.equal(back, el);
  assert.deepEqual(el.__node.loops[0], ["opacity", BREATH]);
  assert.equal(/focus|visibility|hidden/.test(breathe.toString()), false);
});

function hostFor(make) {
  const factory = { new: () => make() };
  return {
    div: make, svg: make, image: make, h_flex: make, v_flex: make,
    Button: factory, Toggle: factory, Input: factory, Popover: factory, Editor: factory,
    TextView: factory, Textarea: factory, EditorState: factory, TextareaState: factory,
    Scrollbar: { vertical: make }, v_virtual_list: make,
    theme: () => ({ ...c, foreground: c.text, background: c.canvas }),
    key: () => "ctx", props: () => ({}), spaces: () => [], panes: () => [], machines: () => [],
    home: () => "/Users/me", appHome: () => "/tmp/app", shared: () => ({}), setShared: () => {},
    closeOverlay: () => {}, run: () => {}, layout: () => null,
  };
}

test("files, preview and a document show the shared skeleton while they are read", async () => {
  const make = tape();
  const host = hostFor(make);
  const { Files } = await load("kanso-panel/files.js", ["Files"], host);
  const files = new Files();
  Object.assign(files, { context: "ctx", loading: true, entries: new Map(), file: null, error: null, root: "/repo", folders: new Set(), marks: {}, limited: false });
  assertSkeleton(files.render({}));
  assertSkeleton(files.bones(c));
  Object.assign(files, { loading: false, error: null });
  assert.equal(walk(files.render({})).texts.includes("No files"), true);
  Object.assign(files, { file: "a.txt", text: null, code: null, fileError: null });
  assertSkeleton(files.render({}));
  Object.assign(files, { fileError: "Cannot preview this file" });
  assert.equal(walk(files.render({})).texts.includes("Cannot preview this file"), true);

  const { Preview } = await load("kanso-panel/preview.js", ["Preview"], host);
  const preview = new Preview();
  Object.assign(preview, { handle: {}, path: "/repo/a.js", doc: null, error: null, code: null, back: null, on: null });
  assertSkeleton(preview.render());
  assertSkeleton(preview.bones(c));
  preview.error = "Binary file: no text preview";
  assert.equal(walk(preview.render()).texts.includes("Binary file: no text preview"), true);

  const { MarkdownDoc, readingLines } = await load("kanso-panel/doc.js", ["MarkdownDoc", "readingLines"], host);
  assertSkeleton(readingLines(c));
  const doc = new MarkdownDoc("/repo/PLAN.md", null);
  assertSkeleton(doc.body(c, "doc"));
  doc.error = "Cannot read this file";
  assert.equal(walk(doc.body(c, "doc")).texts.includes("Cannot read this file"), true);
});

test("the side panels show the shared skeleton before they are ready and while their data is still out", async () => {
  const make = tape();
  const host = hostFor(make);
  const { Look } = await load("kanso-panel/look.js", ["Look"], host);
  const look = new Look();
  look.selected = { path: "/repo/shot.png" };
  look.shown = { busy: true };
  assertSkeleton(look.view(c));
  assertSkeleton(look.bones(c));

  const { PullRequest } = await load("kanso-panel/pr.js", ["PullRequest"], host);
  const pr = new PullRequest();
  assertSkeleton(pr.skeleton(c, true));
  assertSkeleton(pr.bones(c, true));
  Object.assign(pr, { tab: "closed", closedPrs: null, closedLoading: true, openPrs: [] });
  assertSkeleton(pr.listPage(c));
  Object.assign(pr, { diffLoading: true, diffs: null });
  assertSkeleton(pr.diffView(c, "a.js"));
  Object.assign(pr, { picker: "labels", pr: { author: { login: "me" } }, candidates: null, query: "", pickerError: null, search: {}, pending: null, truncated: false });
  assertSkeleton(pr.pickerFor("labels", c));

  const { Worktrees } = await load("kanso-panel/worktrees.js", ["Worktrees"], host);
  const trees = new Worktrees();
  assertSkeleton(trees.skeleton(c, true));
  assertSkeleton(trees.bones(c, true));
  trees.hist = null; trees.storeNote = null;
  assertSkeleton(trees.freed(c, true));
  trees.storeNote = "The history could not be read.";
  assert.equal(walk(trees.freed(c, true)).texts.includes("The history could not be read."), true);

  const { Ports } = await load("kanso-panel/ports.js", ["Ports"], host);
  const ports = new Ports();
  Object.assign(ports, { list: null, width: 368, share: { open: false }, reading: false, note: null, hist: null, digest: { lists: { opened: [], ended: [] } }, range: "day" });
  assertSkeleton(ports.render({}));
  assertSkeleton(ports.bones(c, true));

  const { Shipped } = await load("kanso-panel/shipped.js", ["Shipped"], host);
  const shipped = new Shipped();
  Object.assign(shipped, {
    kind: "week", offset: 0, github: {}, stats: null, syncing: false, syncError: null, phase: null, rhythm: {},
    width: 368, share: { open: false }, loading: false, days: null, records: {}, fresh: new Set(), reposOpen: false,
  });
  assertSkeleton(shipped.render({}));
  assertSkeleton(shipped.bones(c, true));

  const { Panel } = await load("kanso-panel/main.js", ["Panel"], host);
  const panel = new Panel();
  let framed = false;
  panel.ready = false;
  panel.panel = { bones() { framed = true; return make(); } };
  panel.project = null;
  panel.render({});
  assert.equal(framed, true);
});

test("spend, settings, memory and containers load as the shared skeleton", async () => {
  const make = tape();
  const host = hostFor(make);
  const { TokenSpend } = await load("kanso-spend/main.js", ["TokenSpend"], host);
  const spend = new TokenSpend();
  Object.assign(spend, { runtimeError: null, error: null, running: null, scan: { partial: true, processed: 1, total: 4 }, settings: null, planInputs: [], queuedSources: false });
  assertSkeleton(spend.waitingView(c, true));
  assert.equal(/first time/.test(walk(spend.waitingView(c, true)).texts.join(" ")), false);
  assertSkeleton(spend.settingsView(c));

  const { Settings } = await load("kanso-settings/main.js", ["Settings"], host);
  const settings = new Settings();
  settings.news = { entries: null, error: null, from: null };
  settings.installed = "3.18.11";
  assertSkeleton(settings.newsPage({}, c));
  assert.equal(walk(settings.newsPage({}, c)).texts.includes("Check for updates"), true);

  const { Memory } = await load("kanso-guard/main.js", ["Memory"], host);
  const memory = new Memory();
  Object.assign(memory, { awake: true, width: 960, now: null, share: { open: false }, busy: {} });
  assertSkeleton(memory.render({ timer: { after() {} } }));

  const { Containers } = await load("kanso-containers/main.js", ["Containers"], host);
  const containers = new Containers();
  Object.assign(containers, { state: "reading", groups: null, width: 368, reading: false, error: null, note: null });
  assertSkeleton(containers.render());
  containers.state = "down";
  assert.equal(walk(containers.render()).texts.includes("Docker isn't running."), true);
});

test("spaces, sleep and arrangements show the shape they are about to draw", async () => {
  const make = tape();
  const host = hostFor(make);
  const { Spaces } = await load("kanso-spaces/main.js", ["Spaces"], host);
  const spaces = new Spaces();
  const open = assertSkeleton(spaces.machineBones({ border: "#ccc" }, false, null), "machine-loading-local");
  assert.equal(open.calls.some(([p, a]) => p === "h" && a[0] === 36), true);
  const rail = assertSkeleton(spaces.machineBones({ border: "#ccc" }, true, "odin"), "machine-loading-odin");
  assert.equal(rail.calls.some(([p, a]) => p === "h" && a[0] === 46), true);
  const threads = assertSkeleton(spaces.threadsView({ border: "#ccc" })[0].el);
  assert.equal(threads.calls.filter(([p, a]) => p === "h" && a[0] === 64).length >= 5, true);
  assert.equal(threads.calls.some(([p, a]) => p === "w" && a[0] === 132), true);
  assert.equal(threads.calls.some(([p, a]) => p === "w" && a[0] === 170), true);

  const { Sleep } = await load("kanso-sleep/main.js", ["Sleep"], host);
  const sleep = new Sleep();
  Object.assign(sleep, { handle: {}, space: { name: "App", folder: "/repo" }, busy: null, error: null, at: 0, armed: null, work: [] });
  sleep.view = "list"; sleep.asleep = null;
  assertSkeleton(sleep.render());
  sleep.view = "progress"; sleep.progress = null;
  assertSkeleton(sleep.render());
  sleep.view = "sleep"; sleep.sleepers = null; sleep.whole = false; sleep.onlyPane = false;
  assertSkeleton(sleep.render());
  sleep.view = "list"; sleep.asleep = []; sleep.work = [];
  assert.equal(walk(sleep.render()).texts.includes("Nothing is asleep."), true);

  const { Arrange } = await load("kanso-arrange/main.js", ["Arrange"], host);
  const arrange = new Arrange();
  Object.assign(arrange, { handle: {}, space: { name: "App", folder: "/repo" }, busy: null, error: null, at: 0, others: [], view: "list", list: null });
  assertSkeleton(arrange.render());
  Object.assign(arrange, { view: "save", capture: { cols: [] }, name: { value: () => "" }, target: null, list: [] });
  assertSkeleton(arrange.render());
  arrange.list = [];
  arrange.view = "list";
  assert.equal(walk(arrange.render()).texts.includes("No arrangement yet."), true);
});

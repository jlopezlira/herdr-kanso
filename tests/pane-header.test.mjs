import test from "node:test";
import assert from "node:assert/strict";
import { load, clone, chain, gpuiHost, failure, success, calls, arg, find, all, CHROME_NIGHT, fieldWith, texts } from "./helpers.mjs";

const night = CHROME_NIGHT;
const model = () => load("kanso-strip/header-model.js", ["FOLDS", "shownAt", "foldFor", "headerWidths", "hoverTools", "menuEntries", "placeOf", "paneLabel", "headerMark", "prTitle"]);
const strip = () => load("kanso-strip/main.js", ["digestSegments", "readDigest", "settleDigest"]);
const pr = { number: 142, state: "OPEN", mergeStateStatus: "UNSTABLE", fail: 1, failed: "test / unit", pending: 0 };
const digest = { files: 3, add: 42, del: 6, ahead: 2, pr };

test("As the pane narrows, the header folds folder, branch, the tools, commits, files, the verdict word, the pull request, then close, and what shows always fits", async () => {
  const { FOLDS, foldFor, headerWidths } = await model();
  const { digestSegments } = await strip();
  const sized = headerWidths({ name: "checkout", place: { folder: "~/checkout-v2", branch: "limits-table" }, digest: digestSegments(digest), hover: true, mark: true });
  const need = (fold) => sized.base + FOLDS.slice(fold + 1).reduce((sum, step) => sum + sized.widths[step], 0);
  const rooms = Array.from({ length: 120 }, (_, i) => 1200 - i * 10);
  const folds = rooms.map((room) => foldFor(room, sized.base, sized.widths));
  assert.equal(folds[0], 0, "a wide pane folds nothing");
  assert.equal(folds.at(-1), FOLDS.length - 1, "a narrow pane folds everything but the program, the name and the mark");
  folds.forEach((fold, i) => i && assert.ok(fold >= folds[i - 1], "narrower never unfolds"));
  assert.deepEqual([...new Set(folds)], clone(FOLDS).map((_, i) => i), "every step folds, one after another, in the drawn order");
  rooms.forEach((room, i) => folds[i] < FOLDS.length - 1 && assert.ok(need(folds[i]) <= room, `${room}px: nothing overlaps`));
  assert.deepEqual(clone(FOLDS), ["nothing", "folder", "branch", "tools into ⋯", "commits", "files", "verdict word", "PR", "close into ⋯"]);
});

test("A step with nothing to show takes no room, so the header folds the next one instead", async () => {
  const { foldFor, headerWidths } = await model();
  const sized = headerWidths({ name: "checkout", digest: [], hover: false });
  assert.equal(sized.widths.folder, 0);
  assert.equal(sized.widths["tools into ⋯"], 0, "at rest the tools are not up");
  assert.equal(foldFor(sized.base, sized.base, sized.widths), 0);
});

test("Under the pointer: split right, wider or narrower, close and ⋯; folded tools and close move into ⋯", async () => {
  const { hoverTools, menuEntries } = await model();
  const tools = { sleep: "menu", send: "menu" };
  assert.deepEqual(clone(hoverTools({ fold: 0, strip: true })), ["split-right", "width", "close"]);
  assert.deepEqual(clone(menuEntries({ strip: true, pinned: false, zoomed: false, tools, fold: 0, canOpen: true })),
    ["split-down", "pin", "zoom", "send", "open-with", "sleep", "separator", "needed", "hide", "settings"]);
  assert.deepEqual(clone(hoverTools({ fold: 3, strip: true })), ["close"], "the tools fold into ⋯ and close stays");
  assert.deepEqual(clone(menuEntries({ strip: true, pinned: true, zoomed: true, tools, fold: 3, canOpen: true })).slice(0, 8),
    ["split-right", "split-down", "width", "unpin", "unzoom", "send", "open-with", "sleep"]);
  assert.deepEqual(clone(hoverTools({ fold: 8, strip: true })), []);
  assert.ok(menuEntries({ strip: true, pinned: false, zoomed: false, tools, fold: 8, canOpen: true }).includes("close"), "close folds into ⋯ last");
  const rest = menuEntries({ strip: true, pinned: false, zoomed: false, tools: { sleep: "out", send: "out" }, fold: 0, canOpen: true });
  assert.equal(rest.includes("sleep") || rest.includes("send"), false, "Sleep and Send resting out are not in ⋯ too");
});

test("A pane with no project is a Terminal with no Open with; folder and branch show only where they differ from the tab's project", async () => {
  const { menuEntries, paneLabel, placeOf } = await model();
  assert.equal(paneLabel({ agent: false, cwd: null, given: null, name: "zsh" }), "Terminal");
  assert.equal(paneLabel({ agent: false, cwd: null, given: "server", name: "zsh" }), "server", "a name you gave wins");
  assert.equal(paneLabel({ agent: false, cwd: "/repo", given: null, name: "npm run dev" }), "npm run dev");
  assert.equal(menuEntries({ strip: true, pinned: false, zoomed: false, tools: { sleep: "hidden", send: "hidden" }, fold: 0, canOpen: false }).includes("open-with"), false);
  const project = { folder: "/repo", branch: "main" };
  assert.deepEqual(clone(placeOf({ cwd: "/repo/", branch: "main" }, project, "/home/me")), { folder: null, branch: null });
  assert.deepEqual(clone(placeOf({ cwd: "/repo-v2", branch: "limits" }, project, "/home/me")), { folder: "/repo-v2", branch: "limits" });
  assert.deepEqual(clone(placeOf({ cwd: "/home/me", branch: null }, { folder: "", branch: null }, "/home/me")), { folder: null, branch: null }, "a project with no folder starts at home");
});

test("Working, waiting and done are their marks, and a computer out of reach shows none", async () => {
  const { headerMark } = await model();
  assert.deepEqual(["none", "working", "blocked", "done", "idle"].map((status) => headerMark(status, false)), [null, "working", "blocked", "done", null]);
  assert.equal(headerMark("blocked", true), null);
});

test("The pull request has no dot, and its tooltip keeps what the header folded away", async () => {
  const { prTitle } = await model();
  const { digestSegments } = await strip();
  const segments = digestSegments(digest);
  assert.equal(segments.some((seg) => "dot" in seg), false);
  assert.equal(prTitle(segments, 0), "test / unit failed");
  assert.equal(prTitle(segments, 5), "2 commits · 3 files · test / unit failed");
});

test("GitHub not answering keeps the pull request it last named with gh's words, and no pull request is an answer", async () => {
  const { readDigest, settleDigest, digestSegments } = await strip();
  const answer = (stderr) => async (cmd, args) => {
    if (cmd === "gh") return failure(stderr);
    const line = args.join(" ");
    const out = line.includes("is-inside-work-tree") ? "true\n" : line.includes("rev-list") ? "0\n" : line.includes("symbolic-ref") ? "feat\n" : "";
    return success(out);
  };
  const failed = await readDigest("/repo", answer("HTTP 502: Bad Gateway (https://api.github.com/graphql)\nmore"));
  assert.equal(failed.failure, "HTTP 502: Bad Gateway (https://api.github.com/graphql)");
  assert.equal((await readDigest("/repo", answer("no pull requests found for branch \"feat\""))).failure, null);
  const was = { ...digest, at: 1 };
  const kept = settleDigest(was, failed);
  assert.equal(kept.pr, pr);
  assert.deepEqual(clone(digestSegments(kept).at(-1)), { kind: "failure", text: "Can't read #142", tip: failed.failure });
  assert.equal(settleDigest(null, failed).failure, null, "with no pull request named before, there is nothing to put in its place");
  assert.equal(digestSegments({ ...kept, reading: true }).at(-1).kind, "pr", "a refresh in flight shows the pull request again");
});

// One header, drawn by the real view against a fake Herdr.
async function header({ pane: over = {}, space: room = {}, store: kept = {}, computers = [] } = {}) {
  const store = { ...kept };
  const ran = [], labels = [];
  const pane = { pane: "p1", terminal: "t1", tab: "t1", title: "checkout", cwd: "/repo", branch: "main", status: "done", focused: true, zoomed: false,
    program: { agent: true, shell: false, name: "Claude Code", icon: null }, ...over };
  const { Strip, tokens, mix, OPACITY } = await load("kanso-strip/main.js", ["Strip", "tokens", "mix", "OPACITY"], {
    ...gpuiHost(), Popover: { new: (id) => chain(id) }, HoverCard: { new: (id) => chain(id) },
    InputState: { new: fieldWith },
    theme: () => night, props: () => ({ pane: "p1", strip: true }), panes: () => [pane], agents: () => [], focused: () => null,
    spaces: () => [{ id: "s1", folder: "/repo", branch: "main", machine: null, tabs: [{ id: "t1" }], ...room }], machines: () => computers,
    home: () => "/home/me", terminals: () => [], shared: (key) => store[key] ?? null, setShared: (key, value) => { store[key] = value; },
    run: (cmd, args) => { ran.push([cmd, args]); }, hc: async (args) => { labels.push(args); return { code: 0 }; }, openOverlay: () => {},
  });
  const view = new Strip();
  view.init({}, {});
  const cx = { stop_propagation() {}, notify() {}, timer: { after() {} } };
  return { view, cx, ran, labels, store, c: tokens(night), mix, OPACITY };
}

const drawnHeader = async () => {
  const head = await header();
  return { head, root: head.view.render() };
};
const byTag = (root, tag) => find(root, (el) => el.tag === tag);
const handler = (el, name) => calls(el, name).at(-1)?.at(-1);
const leftDown = (el) => calls(el, "on_mouse_down").find((call) => call[1] === "left")[2];
// ⋯'s Menu is the Popover's content, not a child.
const menuItems = (root) => {
  const pop = find(root, (el) => calls(el, "content").length > 0);
  return pop ? all(arg(pop, "content"), (el) => /^ph-menu-list-p1-\d+$/.test(el.tag)) : [];
};

test("Each look is a state: focus is the ground, waiting the wash and mark, keyboard focus the accent ring, out of reach 55% with no mark", async () => {
  const focus = await header();
  const root = focus.view.render();
  assert.equal(arg(root, "bg"), focus.c.selected);
  assert.equal(arg(root, "border_color"), "#00000000", "no ring without the keyboard");
  assert.equal(texts(root).includes("Needs you"), false);
  const waits = await header({ pane: { status: "blocked" } });
  const blocked = waits.view.render();
  assert.equal(arg(blocked, "bg"), waits.mix(waits.c.blocked, waits.c.background, waits.OPACITY.blockedWash));
  assert.equal(texts(blocked).includes("Needs you"), false, "the wash and the mark say it; no words");
  const keys = await header({ store: { "strip.keys": "p1", "strip.state": { t1: { focus: "p1", cols: [{ panes: ["p1"], w: 1 }] } } } });
  assert.equal(arg(keys.view.render(), "border_color"), keys.c.accent);
  const away = await header({ space: { machine: "dark" }, computers: [{ name: "dark", layout: "unavailable" }], pane: { status: "working" } });
  const far = away.view.render();
  assert.equal(arg(far, "opacity"), away.OPACITY.away);
  assert.equal(calls(far, "child").some((call) => call[1]?.calls?.some((c) => c[0] === "spin")), false, "no mark");
});

test("Pinned is a pin after the name, and the header itself is the handle: no grip", async () => {
  const pinned = await header({ store: { "strip.state": { t1: { focus: "p1", cols: [{ panes: ["p1"], w: 0.5, pin: "left" }] } } } });
  const root = pinned.view.render();
  assert.ok(byTag(root, "h_flex") && all(root, (el) => calls(el, "tooltip").some((call) => call[1] === "Pinned")).length === 1);
  assert.equal(calls(root, "cursor_grab").length, 0, "a pinned pane does not move");
  const free = await header();
  const handle = free.view.render();
  assert.equal(calls(handle, "cursor_grab").length, 1);
  assert.equal(all(handle, (el) => calls(el, "tooltip").some((call) => /Hold and drag/.test(call[1]))).length, 0);
  leftDown(handle)({ click_count: 1, position: { x: 10, y: 10 }, modifiers: {} }, free.cx);
  handler(handle, "on_mouse_move")({ position: { x: 11, y: 10 }, local_position: { x: 11, y: 10 }, bounds: { width: 400 } });
  assert.equal(free.store["strip.drag"] ?? null, null, "a click that barely moves only focuses");
  handler(handle, "on_mouse_move")({ position: { x: 30, y: 10 }, local_position: { x: 30, y: 10 }, bounds: { width: 400 } });
  assert.equal(free.store["strip.drag"].pane, "p1", "a press moved a few pixels picks the pane up");
});

test("A press released outside the header never picks the pane up when the pointer comes back", async () => {
  const { head, root } = await drawnHeader();
  const move = (x) => handler(root, "on_mouse_move")({ position: { x, y: 10 }, local_position: { x, y: 10 }, bounds: { width: 400 } });
  handler(root, "on_hover")(true, head.cx);
  handler(root, "on_mouse_down")({ click_count: 1, position: { x: 10, y: 10 }, modifiers: {} }, head.cx);
  handler(root, "on_hover")(false, head.cx);
  handler(root, "on_hover")(true, head.cx);
  move(40);
  assert.equal(head.store["strip.drag"] ?? null, null);
});

test("Close asks twice while an agent is in the pane, and once for a terminal", async () => {
  const agent = await header();
  handler(agent.view.render(), "on_hover")(true, agent.cx);
  const first = byTag(agent.view.render(), "ph-close-p1");
  handler(first, "on_click")({}, agent.cx);
  assert.deepEqual(agent.ran, [], "the first press only arms");
  const armed = byTag(agent.view.render(), "ph-close-p1");
  assert.equal(arg(armed, "accessibility_label"), "Press again to close Claude Code");
  assert.equal(arg(armed, "bg"), agent.c.accent);
  handler(armed, "on_click")({}, agent.cx);
  assert.deepEqual(clone(agent.ran), [["pane.close", { pane: "p1" }]]);
  const shell = await header({ pane: { status: null, cwd: null, program: { agent: false, shell: true, name: "zsh", icon: null } } });
  handler(shell.view.render(), "on_hover")(true, shell.cx);
  handler(byTag(shell.view.render(), "ph-close-p1"), "on_click")({}, shell.cx);
  assert.deepEqual(clone(shell.ran), [["pane.close", { pane: "p1" }]]);
});

test("A terminal with no project is called Terminal, has no digest, and its ⋯ has no Open with", async () => {
  const shell = await header({ pane: { status: null, cwd: null, title: "zsh", program: { agent: false, shell: true, name: "zsh", icon: null } },
    store: { "kanso.digest": { p1: digest } } });
  shell.view.moreOpen = true;
  const root = shell.view.render();
  assert.ok(texts(root).includes("Terminal"));
  assert.equal(byTag(root, "digest-p1") ?? find(root, (el) => calls(el, "id").some((call) => call[1] === "digest-p1")), null);
  const items = menuItems(root).map((el) => arg(el, "accessibility_label"));
  assert.deepEqual(items, ["Split down", "Pin", "Zoom", "Only when needed", "Hide this", "Settings for this…"]);
});

test("Only when needed and Hide this in ⋯ act on files, commits and the pull request together", async () => {
  const head = await header();
  head.view.moreOpen = true;
  const root = head.view.render();
  const hide = menuItems(root).find((el) => arg(el, "accessibility_label") === "Hide this");
  handler(hide, "on_click")({}, head.cx);
  assert.deepEqual(clone(head.store["kanso.pieces"]), { "header.digest": "hide", "header.pr": "hide" });
});

test("GitHub not answering is the failure line with Refresh, and the refresh in flight draws the pull request pending", async () => {
  const head = await header({ store: { "kanso.digest": { p1: { ...digest, failure: "HTTP 502" } } } });
  const root = head.view.render();
  assert.ok(texts(root).includes("Can't read #142"));
  const refresh = byTag(root, "digest-failure-p1-fix");
  handler(refresh, "on_click")({}, head.cx);
  assert.equal(head.store["kanso.digest"].p1.reading, true);
  const pending = find(head.view.render(), (el) => calls(el, "id").some((call) => call[1] === "digest-p1"));
  assert.equal(arg(pending, "opacity"), 0.8);
  assert.ok(find(pending, (el) => calls(el, "id").some((call) => call[1] === "digest-pending-p1")));
  assert.equal(texts(pending).includes("Can't read #142"), false);
});

test("Double-click renames in place, and Enter keeps the new name as the terminal's label", async () => {
  const { head, root } = await drawnHeader();
  leftDown(root)({ click_count: 2, position: { x: 0, y: 0 }, modifiers: {} }, head.cx);
  assert.ok(head.view.renaming, "the name is a field in the header");
  head.view.endRename({ terminal: "t1" }, "Claude Code", head.cx, true);
  assert.deepEqual(head.labels, [], "the same name writes nothing");
  head.view.startRename({ terminal: "t1" }, "Claude Code", head.cx);
  head.view.renaming.state.value = () => "  billing  ";
  head.view.endRename({ terminal: "t1" }, "Claude Code", head.cx, true);
  assert.deepEqual(clone(head.labels), [["label", "t1", "kanso.name=billing"]]);
  assert.equal(head.view.renaming, null);
});

test("A header segment is one fact: its parts each in their tone, trimmed at the segment's width, and a click that opens its home", async () => {
  const kit = { ...await load("kanso-panel/ui.js", ["tokens", "G", "R", "W"], gpuiHost()), ...await load("kanso-panel/ui-header.js", ["headerSegment"], gpuiHost()) };
  const c = kit.tokens(night);
  const opened = [];
  const stopped = [];
  const cx = { stop_propagation: () => stopped.push(true) };
  const seg = kit.headerSegment("s", { parts: [{ text: "#142", tone: "muted" }, { text: "· test / unit failed", tone: "blocked" }, null], title: "2 commits", act: () => opened.push("pr") }, c);
  assert.equal(arg(seg, "px"), kit.G.xs);
  assert.equal(arg(seg, "rounded"), kit.R.sm);
  assert.equal(arg(seg, "tooltip"), "2 commits");
  assert.equal(seg.kids.length, 2, "an empty part draws nothing");
  assert.deepEqual(seg.kids.map((part) => arg(part, "text_color")), [c.muted, c.blocked]);
  assert.equal(arg(seg.kids[0], "max_w"), kit.W.paneSegment);
  handler(seg, "on_mouse_down")({}, cx);
  handler(seg, "on_click")({}, cx);
  assert.deepEqual(opened, ["pr"]);
  assert.equal(stopped.length, 2, "a press on a segment never picks the pane up or focuses it");
  const still = kit.headerSegment("p", { icon: "pin", tone: "dim", title: "Pinned" }, c);
  assert.equal(calls(still, "on_click").length, 0);
  assert.equal(arg(still, "text_color"), c.dim);
});

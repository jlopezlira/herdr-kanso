// One drawing per state: empty, failure as a block or on a line, and pending, from the kit's tokens.
import test from "node:test";
import assert from "node:assert/strict";
import { load, chain, gpuiHost } from "./helpers.mjs";

const kit = () => load("kanso-panel/ui.js", ["stateEmpty", "stateBlock", "stateLine", "pendingDot", "PENDING", "tokens", "G", "H", "R", "T", "ICON_ROW", "BREATH"], gpuiHost());
const night = { background: "#1b1b19", foreground: "#d8d4cb", hover: "#232321", selected: "#2b2b28", solid: "#d8d4cb", solid_foreground: "#161615", dim: "#6b6860", muted: "#949086", blocked: "#d5674f" };

const calls = (el, name) => el.calls.filter((call) => call[0] === name);
const arg = (el, name) => calls(el, name)[0]?.[1];
const texts = (el) => [...calls(el, "child").map((call) => call[1]).filter((x) => typeof x === "string"), ...el.kids.flatMap(texts)];
const find = (el, test) => (test(el) ? el : el.kids.map((kid) => find(kid, test)).find(Boolean) ?? null);
const buttons = (el) => [...(calls(el, "accessibility_label").length ? [el] : []), ...el.kids.flatMap(buttons)];

test("Empty is the view's icon dim at 20, one muted sentence, 24 above and below, and no action unless one is given", async () => {
  const { stateEmpty, tokens, G, T } = await kit();
  const c = tokens(night);
  const quiet = stateEmpty("agents-empty", "activity", "No agents running", c);
  assert.equal(arg(quiet, "py"), G.xl);
  const icon = quiet.kids[0];
  assert.equal(arg(icon, "size"), 20);
  assert.equal(arg(icon, "text_color"), c.dim);
  const line = find(quiet, (el) => calls(el, "child").some((call) => call[1] === "No agents running"));
  assert.equal(arg(line, "text_size"), T.value);
  assert.equal(arg(line, "text_color"), c.muted);
  assert.deepEqual(texts(quiet), ["No agents running"]);
  assert.equal(buttons(quiet).length, 0);
  let made = 0;
  const one = stateEmpty("projects-empty", "folder", "No projects", c, { label: "New project", onClick: () => { made += 1; } });
  const [action] = buttons(one);
  assert.equal(arg(action, "bg"), c.subtle, "the one action is tonal");
  arg(action, "on_click")({}, {});
  assert.equal(made, 1);
});

test("A failure block is a blocked edge, our words, the source's words, then the fix solid and the rest tonal", async () => {
  const { stateBlock, tokens, G, R, T } = await kit();
  const c = tokens(night);
  const mark = chain("mark");
  const done = [];
  const block = stateBlock("wt-failed", {
    mark, what: "Can't list worktrees on dark", why: "git worktree list: timed out after 30 s",
    fixes: [{ label: "Refresh", onClick: () => done.push("refresh") }, { label: "Sign in", onClick: () => done.push("sign") }],
  }, c);
  assert.equal(arg(block, "border_color"), c.blocked);
  assert.equal(calls(block, "border_1").length, 1);
  assert.equal(calls(block, "bg").length, 0, "no fill");
  assert.equal(arg(block, "rounded"), R.card);
  assert.equal(arg(block, "p"), G.md);
  assert.ok(find(block, (el) => el === mark));
  const what = find(block, (el) => calls(el, "child").some((call) => call[1] === "Can't list worktrees on dark"));
  assert.equal(arg(what, "text_size"), T.card);
  assert.equal(arg(what, "text_color"), c.text, "our words stay in the foreground");
  const why = find(block, (el) => calls(el, "child").some((call) => call[1] === "git worktree list: timed out after 30 s"));
  assert.equal(arg(why, "text_color"), c.muted);
  assert.equal(arg(why, "tooltip"), "git worktree list: timed out after 30 s");
  const [fix, rest] = buttons(block);
  assert.equal(arg(fix, "bg"), c.primary, "the fix is solid");
  assert.equal(arg(rest, "bg"), c.subtle, "the rest are tonal");
  assert.equal(calls(fix, "flex_1").length, 1, "the buttons share the width");
  arg(fix, "on_click")({}, {});
  arg(rest, "on_click")({}, {});
  assert.deepEqual(done, ["refresh", "sign"]);
});

test("A failure with neither slot is the words alone", async () => {
  const { stateBlock, tokens } = await kit();
  const block = stateBlock("limit", { mark: chain("mark"), what: "GitHub rate limit reached" }, tokens(night));
  assert.deepEqual(texts(block), ["GitHub rate limit reached"]);
  assert.equal(buttons(block).length, 0);
});

test("A panel's failure note puts our words first and the tool's words below them", async () => {
  const { said, failNote } = await load("kanso-panel/lib.js", ["said", "failNote"], { ...gpuiHost(), theme: () => night });
  const note = said("Can't read the ports", new Error("lsof: permission denied").message);
  assert.deepEqual({ ...note }, { what: "Can't read the ports", why: "lsof: permission denied" });
  assert.deepEqual(texts(failNote("pt-note", note, (await kit()).tokens(night))).slice(-2), ["Can't read the ports", "lsof: permission denied"]);
  assert.equal(said("Memory is not available on Linux.").why, null, "our words alone when the tool said nothing");
});

test("A failure on a line is the mark, our words and one small tonal fix", async () => {
  const { stateLine, tokens, H, T } = await kit();
  const c = tokens(night);
  let fixed = 0;
  const line = stateLine("status-computer", chain("mark"), "Can't reach dark", c, { label: "Refresh", onClick: () => { fixed += 1; } });
  assert.equal(line.kids[0].tag, "mark");
  assert.deepEqual(texts(line), ["Can't reach dark", "Refresh"]);
  const words = find(line, (el) => calls(el, "child").some((call) => call[1] === "Can't reach dark"));
  assert.equal(arg(words, "text_size"), T.value, "the words keep their size wherever the line sits");
  assert.equal(calls(words, "font_medium").length, 1);
  const [fix] = buttons(line);
  assert.equal(arg(fix, "h"), H.compact);
  assert.equal(arg(fix, "bg"), c.subtle);
  arg(fix, "on_click")({}, {});
  assert.equal(fixed, 1);
});

test("Pending is drawn at 80% with a 4 px muted dot breathing beside it", async () => {
  const { pendingDot, PENDING, tokens, G, BREATH } = await kit();
  const c = tokens(night);
  const dot = pendingDot("pull-pending", c);
  assert.equal(PENDING, 0.8);
  assert.equal(arg(dot, "size"), G.xs);
  assert.equal(arg(dot, "bg"), c.muted);
  assert.deepEqual(calls(dot, "loop")[0].slice(1), ["opacity", BREATH]);
});

test("The title bar draws the window's lights only: no Herdr mark and no name", async () => {
  const drawn = [];
  const host = {
    ...gpuiHost(),
    image: (path) => { drawn.push(path); return chain("image"); },
    theme: () => ({ chrome: "chrome", foreground: "foreground" }), props: () => ({}), shared: () => null, setShared: () => {},
    window: () => ({ platform: "macos" }),
  };
  const { WorkspaceChrome } = await load("kanso-chrome/main.js", ["WorkspaceChrome"], host);
  const bar = new WorkspaceChrome().render();
  assert.deepEqual(drawn, []);
  assert.deepEqual(texts(bar), []);
  assert.equal(arg(bar, "bg"), "chrome");
});

test("A pull is drawn at once: the count gives way to the breathing dot at 80%, and a count at rest is muted, not red", async () => {
  const { gitTail } = await load("kanso-spaces/sidebar-draw.js", ["gitTail"], { ...gpuiHost(), run: () => {} });
  const t = { dim: "dim", muted: "muted", ansi1: "red", ansi2: "green", foreground: "#d8d4cb", background: "#1b1b19" };
  const place = { cwd: "/work/app", on: null };
  const rest = gitTail({ name: "app", branch: "main", behind: 12 }, null, "app", t, place, { id: "app", pulling: false, pull: () => {}, open: () => {} });
  const count = find(rest, (el) => calls(el, "child").some((call) => call[1] === "↓12"));
  assert.equal(arg(count, "text_color"), "muted");
  assert.equal(arg(rest, "opacity"), 1);
  const busy = gitTail({ name: "app", branch: "main", behind: 12 }, null, "app", t, place, { id: "app", pulling: "pull::/work/app", pull: () => {}, open: () => {} });
  assert.equal(texts(busy).includes("↓12"), false);
  assert.equal(arg(busy, "opacity"), 0.8);
  assert.ok(find(busy, (el) => calls(el, "loop").length > 0), "the dot breathes");
});

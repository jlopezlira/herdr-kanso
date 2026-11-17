// One drawing per state: empty, failure as a block or on a line, and pending, from the kit's tokens.
import { loadWorkspaceChrome } from "./mod-fixtures.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { load, chain, gpuiHost, calls, find, texts } from "./helpers.mjs";
import { samplePanel } from "../stories/kit/samples.js";

const kit = async () => ({
  ...await load("kanso-panel/ui.js", ["tokens", "G", "H", "R", "T", "ICON_ROW", "ICON_EMPTY", "BREATH"], gpuiHost()),
  ...await load("kanso-panel/ui-state.js", ["stateBlockPx", "pendingDot", "PENDING"], gpuiHost()),
  ...await load("kanso-panel/kit.js", ["emptyState", "failureLine", "failureBlock"], gpuiHost()),
});
const night = { background: "#1b1b19", foreground: "#d8d4cb", hover: "#232321", selected: "#2b2b28", solid: "#d8d4cb", solid_foreground: "#161615", dim: "#6b6860", muted: "#949086", blocked: "#d5674f" };
// The Storybook's own props: the panel page's states and the State patterns page.
const { empty: noWorktrees, failure: { agent, ...cantList } } = samplePanel;
const noPullRequests = { icon: "lu-git-pull-request", text: "No pull requests on this branch", action: "Create" };
const cantReach = { text: "Can't reach dark", fix: "Refresh", detail: "ssh: connect to host dark port 22: Operation timed out" };

const arg = (el, name) => calls(el, name)[0]?.[1];
const holding = (el, words) => find(el, (kid) => calls(kid, "child").some((call) => call[1] === words));

const press = (button) => arg(button, "on_click")({}, {});
const buttons = (el) => [...(calls(el, "accessibility_label").length ? [el] : []), ...el.kids.flatMap(buttons)];

test("Empty is the view's icon dim at its token, one muted sentence, 24 above and below, and no action unless one is given", async () => {
  const { emptyState, tokens, G, T, ICON_EMPTY } = await kit();
  const c = tokens(night);
  const quiet = emptyState(noWorktrees)("wt-empty", c);
  assert.equal(arg(quiet, "py"), G.xl);
  const icon = quiet.kids[0];
  assert.equal(arg(icon, "size"), ICON_EMPTY);
  assert.equal(arg(icon, "text_color"), c.dim);
  const line = holding(quiet, noWorktrees.text);
  assert.equal(arg(line, "text_size"), T.value);
  assert.equal(arg(line, "text_color"), c.muted);
  assert.deepEqual(texts(quiet), [noWorktrees.text]);
  assert.equal(buttons(quiet).length, 0);
  let made = 0;
  const one = emptyState(noPullRequests)("pr-empty", c, { onClick: () => { made += 1; } });
  const [action] = buttons(one);
  assert.equal(arg(action, "accessibility_label"), "Create");
  assert.equal(arg(action, "bg"), c.subtle, "the one action is tonal");
  press(action);
  assert.equal(made, 1);
});

test("A failure block is a blocked edge, the mark and our words, the source's words in mono, then the one fix solid", async () => {
  const { failureBlock, tokens, G, R, T } = await kit();
  const c = tokens(night);
  let fixed = 0;
  const block = failureBlock(cantList)("wt-failed", c, { onClick: () => { fixed += 1; } });
  assert.equal(arg(block, "border_color"), c.blocked);
  assert.equal(calls(block, "border_1").length, 1);
  assert.equal(calls(block, "bg").length, 0, "no fill");
  assert.equal(arg(block, "rounded"), R.card);
  assert.equal(arg(block, "p"), G.md);
  assert.ok(find(block, (el) => calls(el, "bg").some((call) => call[1] === c.blocked)), "the blocked mark leads");
  const what = holding(block, cantList.text);
  assert.equal(arg(what, "text_size"), T.card);
  assert.equal(arg(what, "text_color"), c.text, "our words stay in the foreground");
  const why = holding(block, cantList.source);
  assert.equal(arg(why, "text_color"), c.muted);
  assert.equal(arg(why, "tooltip"), cantList.source);
  assert.equal(arg(why, "font_family"), "JetBrains Mono", "the tool's words in the terminal's mono");
  const [fix, ...rest] = buttons(block);
  assert.equal(rest.length, 0, "one fix");
  assert.equal(arg(fix, "bg"), c.primary, "the fix is solid");
  press(fix);
  assert.equal(fixed, 1);
});

test("A failure block's height is read from the block's own sizes, so a fixed-size home can make room for it", async () => {
  const { failureBlock, stateBlockPx, tokens } = await kit();
  const parts = { text: "kansō didn't update", source: "the download failed", fix: "Update" };
  const block = failureBlock(parts)("refused", tokens(night));
  const [what, why, fix] = [holding(block, parts.text), holding(block, parts.source), buttons(block)[0]];
  const fixes = find(block, (el) => el.kids.includes(fix));
  const edge = calls(block, "border_1").length;
  const words = arg(what, "text_size") * arg(what, "line_height");
  const evidence = arg(why, "max_h");
  const drawn = 2 * (edge + arg(block, "p")) + words + arg(block, "gap") + evidence + arg(block, "gap") + arg(fixes, "pt") + arg(fix, "h");
  assert.equal(stateBlockPx(parts), drawn);
  assert.equal(evidence, arg(why, "text_size") * arg(why, "line_height") * 2, "the source's words at most two lines");
  assert.equal(stateBlockPx({ text: parts.text }), 2 * (edge + arg(block, "p")) + words, "the words alone");
  assert.equal(stateBlockPx(parts, 2), drawn + words, "our words wrapped to a second line");
});

test("A failure with neither source nor fix is the words alone", async () => {
  const { failureBlock, tokens } = await kit();
  const block = failureBlock({ text: "GitHub rate limit reached" })("limit", tokens(night));
  assert.deepEqual(texts(block).filter((text) => text !== "!"), ["GitHub rate limit reached"]);
  assert.equal(buttons(block).length, 0);
});

test("A panel's failure note is the failure block's props: our words first and the tool's words below them", async () => {
  const { said } = await load("kanso-panel/lib.js", ["said"], { ...gpuiHost(), theme: () => night });
  const { failureBlock, tokens } = await kit();
  const note = said("Can't read the ports", new Error("lsof: permission denied").message);
  assert.deepEqual({ ...note }, { text: "Can't read the ports", source: "lsof: permission denied" });
  assert.deepEqual(texts(failureBlock(note)("pt-note", tokens(night))).slice(-2), ["Can't read the ports", "lsof: permission denied"]);
  assert.equal(said("Memory is not available on Linux.").source, "", "our words alone when the tool said nothing");
});

test("A failure on a line is the mark, our words and one small quiet fix, with the source's words in its tooltip", async () => {
  const { failureLine, tokens, H, T } = await kit();
  const c = tokens(night);
  let fixed = 0;
  const line = failureLine(cantReach)("status-computer", c, { onClick: () => { fixed += 1; } });
  assert.equal(arg(line, "tooltip"), cantReach.detail);
  assert.equal(arg(line.kids[0], "bg"), c.blocked, "the blocked mark first");
  assert.deepEqual(texts(line).filter((text) => text !== "!"), ["Can't reach dark", "Refresh"]);
  const words = holding(line, cantReach.text);
  assert.equal(arg(words, "text_size"), T.value, "the words keep their size wherever the line sits");
  assert.equal(calls(words, "font_medium").length, 1);
  const [fix] = buttons(line);
  assert.equal(arg(fix, "h"), H.compact);
  assert.equal(calls(fix, "bg").length, 0, "the fix is quiet");
  press(fix);
  assert.equal(fixed, 1);
});

test("The app gives a state pattern only its handler: anything else throws", async () => {
  const { emptyState, failureLine, failureBlock, tokens } = await kit();
  const c = tokens(night);
  assert.throws(() => emptyState(noWorktrees)("e", c, { action: "Create" }), /only handlers, not action/);
  assert.throws(() => failureLine(cantReach)("l", c, { detail: "more" }), /only handlers, not detail/);
  assert.throws(() => failureBlock(cantList)("b", c, { font: "Menlo" }), /only handlers, not font/);
});

test("Pending is drawn at 80% with a 4 px muted dot breathing beside it", async () => {
  const { pendingDot, PENDING, tokens, G, BREATH } = await kit();
  const c = tokens(night);
  const dot = pendingDot("pull-pending", c);
  assert.equal(PENDING, 0.8);
  assert.equal(arg(dot, "size"), G.xs);
  assert.equal(arg(dot, "bg"), c.muted);
  const [, property, policy] = calls(dot, "loop")[0];
  assert.equal(property, "opacity");
  assert.deepEqual({ ...policy }, { ...BREATH });
});

test("The title bar draws the window's lights only: no Herdr mark and no name", async () => {
  const drawn = [];
  const host = {
    ...gpuiHost(),
    image: (path) => { drawn.push(path); return chain("image"); },
    theme: () => ({ chrome: "chrome", foreground: "foreground" }), props: () => ({}), shared: () => null, setShared: () => {},
    window: () => ({ platform: "macos" }),
  };
  const { WorkspaceChrome } = await loadWorkspaceChrome(host);
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

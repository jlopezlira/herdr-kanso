// Send's and Sleep's bodies inside the dialog piece: kit rows in the kit's dialog list, the kit's empty state, and the keys they had.
import test from "node:test";
import assert from "node:assert/strict";
import { load, nodes, texts, calls, arg, clone, repoText, KIT_NIGHT } from "./helpers.mjs";
import { byTag, dialogHost, keyDown, openedSend } from "./mod-fixtures.mjs";

const host = dialogHost;
const cx = () => ({ notify() {}, stop_propagation() {}, spawn() {} });

const kit = async () => {
  const ui = await load("kanso-panel/ui.js", ["tokens", "G", "H", "DIALOG"], host());
  return { ...ui, c: ui.tokens(KIT_NIGHT), ...await load("kanso-panel/kit.js", ["stack", "row"], host()) };
};

const AGENTS = [
  { address: "t2", status: "blocked", labels: { "kanso.shown": "Nova", "kanso.project": "App" } },
  { address: "t3", status: "working", program: { icon: "mods/x/claude.svg", tint: true }, labels: { "kanso.shown": "Atlas", "kanso.project": "App" } },
];
const sendView = async (terms, query = "", seen = [], to = "t3") => ({
  send: await openedSend({ terminals: () => terms, closeOverlay: (overlay) => seen.push(["close", overlay]) }, { to, query }), seen,
});
// Drawn in an object: a drawn element answers every name, `then` too, so it is never awaited bare.
const sendDrawn = async (terms, query = "", to = "t3") => ({ el: (await sendView(terms, query, [], to)).send.render() });
const listOf = (el, name) => nodes(el).find((kid) => calls(kid, "id").some(([, id]) => id === name));

test("Send's agents are kit rows, a project a heading row, in the kit's dialog list that scrolls past six rows", async () => {
  const { G, H, DIALOG } = await kit();
  const { el } = await sendDrawn(AGENTS);
  const list = listOf(el, "send-list");
  assert.ok(list, "the list is the kit's dialog list");
  assert.deepEqual(calls(list, "overflow_y_scrollbar").length, 1);
  assert.equal(arg(list, "h"), Math.min(3 * (H.line + G.hair) - G.hair, DIALOG.list), "three rows high, a hairline apart");
  assert.ok(["to-project-App", "to-t2", "to-t3"].every((id) => byTag(el, id)), "each row a kit button, by the same id as before");
  assert.ok(["App", "Nova", "Needs you", "Atlas"].every((word) => texts(el).includes(word)), texts(el).join(" | "));
  const many = Array.from({ length: 9 }, (_, i) => ({ address: `t${i + 10}`, status: "idle", labels: { "kanso.shown": `A${i}`, "kanso.project": "App" } }));
  const tall = listOf((await sendDrawn(many)).el, "send-list");
  assert.equal(arg(tall, "h"), DIALOG.list, "past six rows the list keeps six and scrolls");
  assert.equal(DIALOG.list, 6 * H.line + 5 * G.hair, "the token is six rows and their hairlines");
});

test("An agent with no program art leads with the terminal's icon, in the muted ink, so every name starts in one place", async () => {
  const { c } = await kit();
  const { el } = await sendDrawn(AGENTS);
  const glyph = nodes(byTag(el, "to-t2")).find((kid) => calls(kid, "svg").some(([, path]) => path.endsWith("terminal.svg")));
  assert.equal(arg(glyph, "text_color"), c.muted);
  const svgs = nodes(byTag(el, "to-t2")).flatMap((kid) => calls(kid, "svg").map(([, path]) => path));
  assert.deepEqual(svgs.filter((path) => path.endsWith("terminal.svg")).length, 1);
  const art = nodes(byTag(el, "to-t3")).flatMap((kid) => calls(kid, "svg").map(([, path]) => path));
  assert.ok(art.includes("mods/x/claude.svg"));
});

test("No one to send to, or no match, is the kit's empty state with the same words", async () => {
  assert.ok(texts((await sendDrawn([{ address: "t9", state: "live" }], "", null)).el).includes("No other agent is running. Start one in a pane, then send."), "a roster read with no agent in it");
  assert.ok(texts((await sendDrawn([], "", null)).el).includes("Can't see the agents right now."), "a roster not read yet is not an empty one");
  const { el } = await sendDrawn(AGENTS, "zz");
  assert.ok(texts(el).includes("No agent or project by that name."));
  const empty = listOf(el, "send-list");
  assert.equal(calls(empty, "items_center").length, 1, "centred, as the kit's empty state");
});

test("Send's keys are as before: a press picks an agent or a project, Cmd+Enter sends, Escape closes", async () => {
  const { send, seen } = await sendView(AGENTS);
  let sent = 0;
  send.send = () => { sent += 1; };
  const el = send.render();
  calls(byTag(el, "to-t2"), "on_click").forEach(([, fn]) => fn({}, cx()));
  assert.equal(send.to, "t2");
  calls(byTag(el, "to-project-App"), "on_click").forEach(([, fn]) => fn({}, cx()));
  assert.equal(send.toProject, "App", "a project's heading picks every agent of it");
  keyDown(el, { key: "enter", modifiers: { platform: true } });
  assert.equal(sent, 1, "Cmd+Enter sends");
  keyDown(el, { key: "enter", modifiers: {} });
  assert.equal(sent, 1, "a plain Enter is the message's new line");
  keyDown(el, { key: "escape" });
  assert.deepEqual(clone(seen), [["close", "o1"]]);
});

const sleepView = async (reads, more = {}) => {
  const { Sleep } = await load("kanso-sleep/main.js", ["Sleep"], { ...host(), theme: () => KIT_NIGHT, props: () => ({}), home: () => "/home/me" });
  return Object.assign(new Sleep(), { handle: {}, space: { name: "App", folder: "/repo" }, busy: null, error: null, order: { scope: "project" }, reads, ...more });
};

test("Sleep lists what keeps its conversation and what will only stop as kit rows in the dialog list", async () => {
  const { c } = await kit();
  const sleep = await sleepView([
    { terminal: "t1", name: "checkout", resume: "id-1", running: true, argv: ["claude"], cwd: "/repo" },
    { terminal: "t2", name: "t2", resume: null, running: true, argv: ["npm", "run", "dev"], cwd: "/home/me/web" },
    { terminal: "t3", name: "t3", resume: null, running: false, argv: null, cwd: "/repo" },
  ]);
  const el = sleep.render();
  const list = listOf(el, "sl");
  assert.ok(list, "the kit's dialog list");
  assert.equal(calls(list, "overflow_y_scrollbar").length, 0, "it shows every row");
  const [kept, stops] = ["sl-0", "sl-1"].map((id) => nodes(el).find((kid) => calls(kid, "id").some(([, own]) => own === id)));
  assert.ok(texts(kept).includes("checkout") && texts(kept).includes("keeps its conversation"));
  assert.ok(texts(stops).includes("npm run dev") && texts(stops).includes("~/web"));
  assert.equal(arg(stops, "text_color"), c.muted, "what only stops is dimmed");
  assert.equal(nodes(el).filter((kid) => calls(kid, "id").some(([, id]) => id === "sl-2")).length, 0, "a shell at rest is not listed");
  assert.ok(texts(el).includes("npm run dev will stop now."));
});

test("Sleep keeps its states: the skeleton while it reads, and no list when nothing runs", async () => {
  const reading = await sleepView(null);
  assert.ok(nodes(reading.render()).some((kid) => calls(kid, "id").some(([, id]) => id === "kanso-skeleton")));
  const idle = await sleepView([{ terminal: "t3", name: "t3", resume: null, running: false, argv: null, cwd: "/repo" }], { error: "It can't sleep now: nothing here keeps a conversation to wake on." });
  const el = idle.render();
  assert.equal(nodes(el).filter((kid) => calls(kid, "id").some(([, id]) => id === "sl")).length, 0);
  assert.ok(texts(el).includes("It can't sleep now: nothing here keeps a conversation to wake on."));
});

test("Proposed: the dialog list, and its scroll past six rows; the app gives the stack only handlers", async () => {
  const { stack, row, c } = await kit();
  assert.throws(() => stack({ variant: "dialog list", wide: true }, row({ name: "a" }))("l", c), /has no state wide/);
  assert.throws(() => stack({ variant: "dialog list" }, row({ name: "a" }))("l", c, { gap: 4 }), /only handlers/);
  assert.match(repoText("kanso/mods/kanso-panel/ui-stack.js"), /Proposed: `scroll`/);
});

test("No hand drawing is left in the three dialogs, and the deleted helpers are gone", () => {
  for (const file of ["kanso-send/main.js", "kanso-sleep/main.js", "kanso-prompt-editor/main.js"]) {
    const text = repoText(`kanso/mods/${file}`);
    assert.deepEqual(text.match(/\b(?:div|h_flex|v_flex)\(/g) ?? [], [], `${file} draws only through the kit`);
    assert.doesNotMatch(text, /\.(?:p|px|py|pt|pb|gap|text_size|mt|mb)\(/, `${file} sets no spacing or size of its own`);
  }
  assert.doesNotMatch(repoText("kanso/mods/kanso-send/main.js"), /LIST_ROWS|programIcon|from "\.\/ui-row\.js"/);
  assert.doesNotMatch(repoText("kanso/mods/kanso-sleep/main.js"), /from "gpui-base"/);
  assert.doesNotMatch(repoText("kanso/mods/kanso-prompt-editor/main.js"), /\bEditor\.|EditorState|inputFocused|ui-button/);
});

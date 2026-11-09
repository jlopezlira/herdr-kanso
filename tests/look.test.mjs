import assert from "node:assert/strict";
import test from "node:test";
import { load, clone, context, singleUse } from "./helpers.mjs";

const MODEL = ["mentions", "resolvePath", "itemOf", "shows", "arrived", "pinFrom", "aboutMessage", "keyOf"];
const model = () => load("kanso-panel/look-model.js", MODEL);

const OUTPUT = `⏺ Write(tests/shot.png)
  Saved the screenshot to /tmp/out/a.PNG. The plan is in \`./docs/plan.md\`.
  Open http://localhost:3000/logo.png or https://example.com/a/b.svg to compare.
  file:///Users/me/report.pdf, then (src/app.tsx:42) and \x1b[1mbold/img.webp\x1b[0m [hero](images/hero.jpg)
  index.html renders in the browser; the clip is demo.mov.
  tests/shot.png again`;

test("Look finds the files an agent printed, newest first and once each, never a link or a page", async () => {
  const { mentions } = await model();
  assert.deepEqual(clone(mentions(OUTPUT)), [
    "tests/shot.png", "demo.mov", "images/hero.jpg", "bold/img.webp", "src/app.tsx", "/Users/me/report.pdf", "./docs/plan.md", "/tmp/out/a.PNG",
  ], "backticks, parentheses, Markdown links, file:// and colors read; URLs and HTML left to the browser; the last mention counts");
  assert.deepEqual(clone(mentions("see out.png. and x.png, y.pdf;")), ["y.pdf", "x.png", "out.png"], "a sentence's punctuation is not the name");
  assert.deepEqual(clone(mentions("")), []);
  assert.deepEqual(clone(mentions(`Saved "/tmp/home page.png" and \`~/Shots/a b.pdf\`, then 'out/x y.webp'.`)),
    ["out/x y.webp", "~/Shots/a b.pdf", "/tmp/home page.png"], "a quoted path with spaces is one path, not the name after its last space");
  assert.deepEqual(clone(mentions(`Then 'see shot.png' and "home page.png"`)), ["home page.png", "page.png", "see shot.png", "shot.png"],
    "quoted without a folder may be a sentence: both, and only the files that exist stay");
  assert.deepEqual(clone(mentions(`it's in shot.png, not 'x.png`)), ["x.png", "shot.png"], "a lone quote leaves bare names alone");
  assert.equal(mentions(Array.from({ length: 60 }, (_, i) => `f${i}.png`).join(" ")).length, 40, "a long screen gives the newest 40");
});

test("Look resolves a printed path from the terminal's folder and home, and knows what it is", async () => {
  const { resolvePath, itemOf, shows } = await model();
  assert.equal(resolvePath("out/../shots/./a.png", "/repo/web", "/home/me"), "/repo/web/shots/a.png");
  assert.equal(resolvePath("~/Desktop/a.png", "/repo", "/home/me"), "/home/me/Desktop/a.png");
  assert.equal(resolvePath("/tmp//a.png", "/repo", "/home/me"), "/tmp/a.png");
  assert.equal(resolvePath("a.png", null, "/home/me"), null, "relative with no folder: nothing to look at");
  assert.equal(resolvePath("~bob/a.png", "/repo", "/home/me"), null, "another user's home");
  const kinds = ["a.png", "b.SVG", "c.heic", "d.pdf", "e.mp4", "f.md", "g.ts", "h.html", "i.zip"].map((n) => itemOf(`/r/${n}`).kind);
  assert.deepEqual(clone(kinds), ["image", "image", "convert", "pdf", "media", "text", "text", null, null]);
  assert.deepEqual(clone(itemOf("/r/a.png")), { path: "/r/a.png", name: "a.png", kind: "image" });
  assert.deepEqual(clone(kinds.map((kind) => shows({ kind }))), [true, true, true, true, false, false, false, false, false], "pictures and PDFs show in Look");
});

test("Look moves to the newest new picture, not to a document or what it already had", async () => {
  const { arrived, itemOf } = await model();
  const items = (...names) => names.map((n) => itemOf(`/r/${n}`));
  assert.equal(arrived(items("plan.md", "b.png", "a.png"), null).path, "/r/b.png", "first read: the newest picture");
  assert.equal(arrived(items("c.png", "b.png", "a.png"), items("b.png", "a.png")).path, "/r/c.png");
  assert.equal(arrived(items("notes.md", "b.png"), items("b.png")), null, "a new document stays in the list");
  assert.equal(arrived(items("b.png"), items("b.png")), null);
});

test("A note to the agent names the file and where each pin sits on the picture", async () => {
  const { aboutMessage, pinFrom, keyOf } = await model();
  const item = { path: "/repo/shots/home.png" };
  assert.equal(aboutMessage(item, "  the header covers the logo \n"), "About /repo/shots/home.png: the header covers the logo");
  assert.equal(aboutMessage(item, "too dark", [{ x: 0.421, y: 0.18 }, { x: 1, y: 0 }]),
    "About /repo/shots/home.png: too dark\nPins on /repo/shots/home.png, from its top left corner: 1 at 42% across, 18% down; 2 at 100% across, 0% down.");
  assert.match(aboutMessage({ path: "/r/spec.pdf" }, "x", [{ x: 0.5, y: 0.5 }], "/app/look/k-1.png"), /Pins on \/app\/look\/k-1\.png/, "a PDF's pins are on the page Look drew");
  assert.deepEqual(clone(pinFrom({ x: 50, y: 300 }, { width: 200, height: 200 })), { x: 0.25, y: 1 }, "clamped to the picture");
  assert.equal(pinFrom(undefined, { width: 1, height: 1 }), null, "not painted yet: no pin");
  assert.equal(keyOf("/r/a.png"), keyOf("/r/a.png"));
  assert.notEqual(keyOf("/r/a.png"), keyOf("/r/b.png"));
  assert.match(keyOf("/r/a.png"), /^[0-9a-z]+$/);
});

// The panel in a fake Herdr: agent t1 whose screen shows `screen`, a shell t2, and the files in `files`.
// `copy(args)`: what cp answers, a promise a test can hold back.
async function panel({ screen = OUTPUT, files = ["/repo/tests/shot.png", "/repo/images/hero.jpg", "/repo/docs/plan.md"], status = "idle", focus = "t1",
  copy = async () => ({ code: 0, stdout: "" }), session = null, transcript = "" } = {}) {
  const calls = [], store = {};
  const box = { text: "", value() { return this.text; }, set_value(v) { this.text = v; }, on() {}, focus() {} };
  // What Herdr reports, changed by a test as the agent ends.
  const world = {
    terminals: [{ address: "t1", cwd: "/repo", status, labels: { "kanso.shown": "web agent" } }, { address: "t2", cwd: "/repo", status: null, labels: {} }],
    panes: [{ pane: "p1", terminal: "t1", program: { name: "Claude", agent: true } }, { pane: "p2", terminal: "t2", program: { name: "zsh", shell: true } }],
  };
  const host = {
    ...singleUse(), image: singleUse().div, TextareaState: { new: () => box },
    focused: () => ({ terminal: focus }), theme: () => ({}), home: () => "/home/me", appHome: () => "/app",
    terminals: () => world.terminals, panes: () => world.panes,
    shared: (k) => store[k], setShared: (k, v) => { store[k] = clone(v); },
    watchFolder: async () => { throw new Error("no watch in a test"); },
    hc: async (args) => {
      calls.push(["hc", ...args]);
      if (args[0] === "read") return { code: 0, stdout: screen };
      if (args[0] === "get") return { code: 0, stdout: JSON.stringify({ address: args[1], foreground: session ? { pid: session.pid } : null }) };
      return { code: 0, stdout: "" };
    },
    readTextFile: async (path) => (session && path === `/home/me/.claude/sessions/${session.pid}.json` ? JSON.stringify(session) : null),
    exec: async (cmd, args) => {
      calls.push([cmd, ...args]);
      if (cmd === "tail") return { code: 0, stdout: transcript };
      if (cmd === "sh" && args[1].startsWith("for f;")) return { code: 0, stdout: args.slice(3).filter((p) => files.includes(p)).map((p) => `${p}\n`).join("") };
      return cmd === "cp" ? copy(args) : { code: 0, stdout: "" };
    },
  };
  const { Look } = await load("kanso-panel/look.js", ["Look"], host);
  const { cx, drain } = context();
  const look = new Look();
  look.init({ ...cx, timer: { every() {}, after() {} }, focus_handle: () => ({}) }, {});
  await drain();
  return { look, cx, drain, calls, box, store, world };
}

const settle = () => new Promise((r) => setImmediate(r));

test("The Look panel reads the agent in focus and shows its newest picture, copied where Herdr can draw it", async () => {
  const { look, calls } = await panel();
  assert.deepEqual(clone(calls[0]), ["hc", "read", "t1", "--lines", "400"]);
  assert.deepEqual(clone(look.list().map((i) => i.path)), ["/repo/tests/shot.png", "/repo/images/hero.jpg", "/repo/docs/plan.md"], "only files that exist, from the agent's folder");
  assert.equal(look.selected.path, "/repo/tests/shot.png");
  assert.equal(look.picked, false);
  assert.match(look.shown.image, /^data\/kanso-panel\/look\/[0-9a-z]+-\d+\.png$/);
  assert.equal(look.shown.picture, "/repo/tests/shot.png", "a picture's pins point at the file itself");
  assert.ok(calls.some((c) => c[0] === "cp" && c[2] === "/repo/tests/shot.png" && c[3] === `/app/${look.shown.image}`));
});

test("A Claude agent's conversation on disk gives Look the whole paths its screen abbreviates or no longer shows", async () => {
  const { projectDir, transcriptPath, spoken } = await load("kanso-panel/transcript.js", ["projectDir", "transcriptPath", "spoken"]);
  assert.equal(spoken('ut"}\n{"a":{"b":"one","c":["two",3,null]}}\n{"x":"three"}\n{"cut'), "one\ntwo\nthree", "the first line is cut, the last may be too: every string of the rest, one per line");
  assert.equal(projectDir("/Users/jj/Apps/prjct"), "-Users-jj-Apps-prjct");
  assert.equal(transcriptPath({ sessionId: "s1", cwd: "/repo" }, "/home/me"), "/home/me/.claude/projects/-repo/s1.jsonl");
  assert.equal(transcriptPath({ pid: 7 }, "/home/me"), null, "a record without a conversation: nothing to read");
  const session = { pid: 7, sessionId: "07e8cebe-420b-47d2-9fba-a76c2e4dd30d", cwd: "/repo" };
  const transcript = [
    JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "Saved the desk to /repo/shots/u-desk-ideas.png and /repo/shots/old.png" }] } }),
    JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", content: "wrote /repo/shots/u-desk-tasks.png" }] } }),
  ].join("\n");
  const screen = "› [image] …/u-desk-tasks.png (112KB)\n› [image] …/u-desk-ideas.png (98KB)\n";
  const files = ["/repo/shots/u-desk-ideas.png", "/repo/shots/u-desk-tasks.png"];
  const { look, calls } = await panel({ screen, files, session, transcript });
  assert.deepEqual(clone(calls.filter((c) => c[0] === "hc" && c[1] === "get").map((c) => c[2])), ["t1"], "the agent's process, for its session record");
  assert.deepEqual(clone(calls.find((c) => c[0] === "tail")), ["tail", "-c", String(256 * 1024), "/home/me/.claude/projects/-repo/07e8cebe-420b-47d2-9fba-a76c2e4dd30d.jsonl"]);
  assert.deepEqual(clone(look.list().map((i) => i.path)), ["/repo/shots/u-desk-tasks.png", "/repo/shots/u-desk-ideas.png"], "whole, newest first, only those that exist; the screen's stubs resolve to nothing");
  assert.equal(look.selected.path, "/repo/shots/u-desk-tasks.png");
  const shell = await panel({ screen, files, session: null, transcript });
  assert.ok(!shell.calls.some((c) => c[0] === "tail"), "no Claude process in front: the screen alone");
});

test("What you picked stays while the agent makes more, and a note goes to it with the pins", async () => {
  const { look, cx, drain, calls, box } = await panel();
  look.select(look.list()[1], cx, true);
  await drain();
  look.readAt = 0;
  look.read(cx);
  await drain();
  assert.equal(look.selected.path, "/repo/images/hero.jpg", "a read does not take you off what you picked");
  look.pin({ local_position: { x: 30, y: 10 }, bounds: { width: 300, height: 200 } }, cx);
  box.text = "crop the top";
  assert.ok(look.render(cx), "the picture, its pin and the box draw");
  look.send(cx);
  await drain();
  const sent = calls.find((c) => c[0] === "hc" && c[1] === "send");
  assert.deepEqual(clone(sent), ["hc", "send", "t1", "About /repo/images/hero.jpg: crop the top\nPins on /repo/images/hero.jpg, from its top left corner: 1 at 10% across, 5% down."]);
  assert.ok(calls.some((c) => c[0] === "hc" && c[1] === "label" && c[2] === "t1"), "marked unread, as Send does");
  assert.equal(box.text, "", "the box empties");
  assert.equal(look.pins.length, 0);
  assert.equal(look.note.text, "Sent to web agent.");
});

test("Look sends nothing to an agent waiting on its own question", async () => {
  const { look, cx, drain, calls, box } = await panel({ status: "blocked" });
  box.text = "looks good";
  look.send(cx);
  await drain();
  assert.equal(calls.some((c) => c[1] === "send"), false);
  assert.equal(look.note.text, "web agent is waiting on its own question. Answer it first, then send.");
});

test("Look never takes a shell as the one to send to: it would run the note", async () => {
  const { look, cx, drain, calls, box } = await panel({ focus: "t2" });
  assert.equal(look.agent(), null, "a shell in focus is no recipient");
  assert.equal(calls.some((c) => c[1] === "read"), false, "and its screen is not read");
  look.ask("/repo/tests/shot.png", cx);
  await drain();
  box.text = "crop it";
  look.send(cx);
  await drain();
  assert.equal(calls.some((c) => c[1] === "send"), false, "nothing pasted into the shell");
  look.follow = "t1";
  look.tick(cx);
  assert.equal(look.follow, "t1", "a shell taking focus keeps the agent Look was on");
});

test("An agent that ends leaves a shell: Look sends it nothing and lets go of its pin", async () => {
  const { look, cx, drain, calls, box, world } = await panel();
  look.pinned = "t1";
  world.terminals = [{ address: "t1", cwd: "/repo", status: null, labels: {} }];
  world.panes = [{ pane: "p1", terminal: "t1", program: { name: "zsh", shell: true } }];
  box.text = "crop it";
  look.send(cx);
  await drain();
  assert.equal(calls.some((c) => c[1] === "send"), false, "the note never reaches the shell");
  assert.equal(look.note.text, "No agent to send to");
  look.tick(cx);
  await drain();
  assert.equal(look.pinned, null, "the pin goes with its agent");
  assert.equal(look.agent(), null, "nor does Look follow the shell");
});

test("A, B, then A again while A still draws: A's draws run in turn and the shown copy is never cleared away", async () => {
  const held = [];
  const copy = () => new Promise((resolve) => { held.push(() => resolve({ code: 0, stdout: "" })); });
  const { look, cx, drain, calls } = await panel({ files: [], copy });
  const { keyOf } = await model();
  const [a, b] = ["/repo/a.png", "/repo/b.png"].map((path) => ({ path, name: path.split("/").at(-1), kind: "image" }));
  const cleared = () => calls.flatMap((c, i) => (c[0] === "sh" && c[2].startsWith("mkdir") && c[5] === keyOf(a.path) ? [i] : []));
  const copied = () => calls.flatMap((c, i) => (c[0] === "cp" && c[2] === a.path ? [i] : []));
  look.select(a, cx, true); await settle();
  look.select(b, cx, true); await settle();
  look.select(a, cx, true); await settle();
  assert.equal(held.length, 2, "the second A waits for the first");
  assert.equal(cleared().length, 1);
  held[0](); await settle(); await settle();
  assert.equal(look.shown.busy, true, "the first A's copy, about to be replaced, never shows");
  assert.equal(held.length, 3, "the second A starts once the first is done");
  assert.ok(cleared()[1] > copied()[0], "its cleanup runs after the first copy, never during it");
  held[2](); await settle(); await settle();
  const shown = look.shown.image;
  assert.equal(`/app/${shown}`, calls[copied()[1]][3], "the second A's copy shows");
  held[1]();
  await drain();
  assert.equal(look.shown.image, shown, "B's late copy does not replace it");
  assert.ok(cleared().every((i) => i < copied()[1]), "nothing cleared A's copies after the shown one was made");
});

test("Only the latest drawing of a picture lands, and one file is never drawn twice at once", async () => {
  const held = [];
  const copy = () => new Promise((resolve) => { held.push(() => resolve({ code: 0, stdout: "" })); });
  const { look, cx, drain } = await panel({ files: [], copy });
  const [a, b] = ["/repo/a.png", "/repo/b.png"].map((path) => ({ path, name: path.split("/").at(-1), kind: "image" }));
  look.select(a, cx, true);
  look.draw(a, cx);
  look.draw(a, cx);
  await new Promise((r) => setImmediate(r));
  assert.equal(held.length, 1, "asked again while drawing: waits for the one running");
  look.select(b, cx, true);
  await new Promise((r) => setImmediate(r));
  held[1]();
  await new Promise((r) => setImmediate(r));
  assert.match(look.shown.image, /\.png$/);
  const bShown = look.shown.image;
  held[0]();
  await drain();
  assert.equal(look.shown.path, "/repo/b.png", "a's late copy does not replace b's");
  assert.equal(look.shown.image, bShown);
  assert.equal(held.length, 2, "a's second draw was dropped once b was picked");
});

test("Look opens what kanso-tabs.look names, as if you picked it, and refuses what is not a file it shows", async () => {
  const { look, cx, drain } = await panel({ files: [] });
  look.ask("~/Desktop/mock.heic", cx);
  await drain();
  assert.deepEqual(clone(look.list().map((i) => i.path)), ["/home/me/Desktop/mock.heic"]);
  assert.equal(look.picked, true);
  look.ask("http://localhost:3000", cx);
  assert.match(look.note.text, /^Look shows files/);
  const r = look.render(cx);
  assert.ok(r, "it draws");
});

test("One way to send text to an agent, from Send and from Look", async () => {
  const calls = [];
  const { deliver, sendKey, waitingNote } = await load("kanso-send/deliver.js", ["deliver", "sendKey", "waitingNote"], {
    hc: async (args) => { calls.push(args); return { code: args[0] === "send" && args[1] === "t9" ? 1 : 0, stderr: "no such terminal" }; },
  });
  assert.equal((await deliver("t1", "hi", "you")).code, 0);
  assert.deepEqual(clone(calls), [["send", "t1", "hi"], ["label", "t1", "kanso.unread=1", "kanso.from=you"]]);
  assert.equal((await deliver("t9", "hi", "you")).code, 1);
  assert.equal(calls.length, 3, "nothing marked when it was not sent");
  assert.equal(sendKey({ key: "enter", modifiers: { platform: true } }), true);
  assert.equal(sendKey({ key: "enter", modifiers: {} }), false);
  assert.equal(waitingNote(["a", "b"]), "a, b are waiting on their own question. Answer it first, then send.");
});

test("Look draws a HEIC with sips or ImageMagick and a PDF's first page with QuickLook or pdftoppm", async () => {
  const run = (platform) => {
    const calls = [];
    const exec = async (cmd, args) => { calls.push([cmd, ...args]); return { code: cmd === "qlmanage" ? 1 : 0, stdout: "" }; };
    return { calls, host: { exec, window: () => ({ platform }) } };
  };
  const mac = run("macos"), linux = run("linux");
  const onMac = await load("kanso-panel/share.js", ["toPng", "firstPage"], mac.host);
  const onLinux = await load("kanso-panel/share.js", ["toPng", "firstPage"], linux.host);
  assert.equal(await onMac.toPng("/r/a.heic", "/app/k.png"), true);
  assert.deepEqual(clone(mac.calls[0]), ["sips", "-s", "format", "png", "/r/a.heic", "--out", "/app/k.png"]);
  assert.equal(await onLinux.toPng("/r/a.heic", "/app/k.png"), true);
  assert.deepEqual(clone(linux.calls[0]), ["magick", "/r/a.heic", "/app/k.png"]);
  assert.equal(await onMac.firstPage("/r/spec.pdf", 736, "/app/k.png"), true, "QuickLook failed: Poppler did it");
  assert.deepEqual(clone(mac.calls.filter((c) => c[0] !== "sh").map((c) => c[0])), ["sips", "qlmanage", "pdftoppm"]);
  assert.deepEqual(clone(mac.calls.at(-2)), ["pdftoppm", "-png", "-singlefile", "-f", "1", "-scale-to", "736", "/r/spec.pdf", "/app/k"]);
});

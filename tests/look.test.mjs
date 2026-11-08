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

// The panel in a fake Herdr: one agent whose screen shows `screen`, and the files in `files`.
async function panel({ screen = OUTPUT, files = ["/repo/tests/shot.png", "/repo/images/hero.jpg", "/repo/docs/plan.md"], status = "idle", focus = "t1" } = {}) {
  const calls = [], store = {};
  const box = { text: "", value() { return this.text; }, set_value(v) { this.text = v; }, on() {}, focus() {} };
  const host = {
    ...singleUse(), image: singleUse().div, TextareaState: { new: () => box },
    focused: () => ({ terminal: focus }), theme: () => ({}), home: () => "/home/me", appHome: () => "/app",
    terminals: () => [{ address: "t1", cwd: "/repo", status, labels: { "kanso.shown": "web agent" } }],
    panes: () => [{ pane: "p1", terminal: "t1", program: { name: "Claude", agent: true } }],
    shared: (k) => store[k], setShared: (k, v) => { store[k] = clone(v); },
    watchFolder: async () => { throw new Error("no watch in a test"); },
    hc: async (args) => { calls.push(["hc", ...args]); return args[0] === "read" ? { code: 0, stdout: screen } : { code: 0, stdout: "" }; },
    exec: async (cmd, args) => {
      calls.push([cmd, ...args]);
      if (cmd === "sh" && args[1].startsWith("for f;")) return { code: 0, stdout: args.slice(3).filter((p) => files.includes(p)).map((p) => `${p}\n`).join("") };
      return { code: 0, stdout: "" };
    },
  };
  const { Look } = await load("kanso-panel/look.js", ["Look"], host);
  const { cx, drain } = context();
  const look = new Look();
  look.init({ ...cx, timer: { every() {}, after() {} }, focus_handle: () => ({}) }, {});
  await drain();
  return { look, cx, drain, calls, box, store };
}

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

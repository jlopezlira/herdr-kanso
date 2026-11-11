import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { mkdir, readdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, posix } from "node:path";
import { fileApi } from "../kanso/mods/kanso-panel/platform-files.js";
import { paths } from "../kanso/mods/kanso-panel/platform-paths.js";
import test from "node:test";
import { load, clone, context, singleUse, exec as run, nativeWindow, nativePlatform } from "./helpers.mjs";

const dirs = [];
process.on("exit", () => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

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
    "tests/shot.png", "images/hero.jpg", "bold/img.webp", "/tmp/out/a.PNG",
  ], "backticks, parentheses, Markdown links, file:// and colors read; URLs, HTML and every file that is not a picture left alone; the last mention counts");
  assert.deepEqual(clone(mentions("see out.png. and x.png, y.jpg;")), ["y.jpg", "x.png", "out.png"], "a sentence's punctuation is not the name");
  assert.deepEqual(clone(mentions("")), []);
  assert.deepEqual(clone(mentions(`Saved "/tmp/home page.png" and \`~/Shots/a b.heic\`, then 'out/x y.webp'.`)),
    ["out/x y.webp", "~/Shots/a b.heic", "/tmp/home page.png"], "a quoted path with spaces is one path, not the name after its last space");
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
  assert.deepEqual(clone(kinds), ["image", "image", "convert", null, null, null, null, null, null], "pictures only: PDFs, media, documents and code are other apps' to open");
  assert.deepEqual(clone(itemOf("/r/a.png")), { path: "/r/a.png", name: "a.png", kind: "image" });
  assert.deepEqual(clone(kinds.map((kind) => shows({ kind }))), [true, true, true, false, false, false, false, false, false], "every picture listed is drawn");
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
  assert.equal(aboutMessage(item, [{ x: 0.421, y: 0.18, note: " too dark \n" }, { x: 1, y: 0, note: null }, { x: 0.5, y: 0.5, note: "the logo" }]),
    "About /repo/shots/home.png:\n1 (42% across, 18% down): too dark\n3 (50% across, 50% down): the logo", "one line per pin with a note, numbered as drawn");
  assert.match(aboutMessage({ path: "/r/a.heic" }, [{ x: 0.5, y: 0.5, note: "x" }], "/app/look/k-1.png"), /^About \/r\/a\.heic \(the pins are on \/app\/look\/k-1\.png\):/, "a converted picture says what the pins are on");
  assert.deepEqual(clone(pinFrom({ x: 50, y: 300 }, { width: 200, height: 200 })), { x: 0.25, y: 1 }, "clamped to the picture");
  assert.equal(pinFrom(undefined, { width: 1, height: 1 }), null, "not painted yet: no pin");
  assert.equal(keyOf("/r/a.png"), keyOf("/r/a.png"));
  assert.notEqual(keyOf("/r/a.png"), keyOf("/r/b.png"));
  assert.match(keyOf("/r/a.png"), /^[0-9a-z]+$/);
});

// The panel in a fake Herdr: agent t1 whose screen shows `screen`, a shell t2, and the files in `files`.
// `copy(args)`: what cp answers, a promise a test can hold back.
async function panel({ screen = OUTPUT, files = ["/repo/tests/shot.png", "/repo/images/hero.jpg", "/repo/docs/plan.md"], status = "idle", focus = "t1",
  copy = async () => ({ code: 0, stdout: "" }), session = null, transcript = "", appHome = "/app", bad = [], remote = null, statText = "4 1700000000\n" } = {}) {
  if (appHome !== "/app") dirs.push(appHome);
  const calls = [], ons = [], store = {};
  const address = remote ? `${remote}/${focus}` : focus;
  // A pin's note, as the prompt dialog answers it: `say(text)` is what you typed, null is Cancel.
  const say = (text, token = calls.findLast((c) => c[0] === "openOverlay")?.[1].props.token) => { store["kanso.look.note"] = { ...(store["kanso.look.note"] ?? {}), [token]: { text, at: Date.now() } }; };
  // What Herdr reports, changed by a test as the agent ends.
  const world = {
    focus: remote ? address : focus, screen, files, bad, statText,
    terminals: remote
      ? [{ address, cwd: "/repo", status, labels: { "kanso.shown": "web agent" } }, { address: "t2", cwd: "/repo", status: null, labels: {} }]
      : [{ address: "t1", cwd: "/repo", status, labels: { "kanso.shown": "web agent" } }, { address: "t2", cwd: "/repo", status: null, labels: {} }],
    panes: remote
      ? [{ pane: "p1", terminal: address, program: { name: "Claude", agent: true } }, { pane: "p2", terminal: "t2", program: { name: "zsh", shell: true } }]
      : [{ pane: "p1", terminal: "t1", program: { name: "Claude", agent: true } }, { pane: "p2", terminal: "t2", program: { name: "zsh", shell: true } }],
    session,
  };
  const sipsPath = (args) => { const at = args.indexOf("--out"); return at > 0 ? args[at - 1] : args.at(-1); };
  const host = {
    ...singleUse(), image: singleUse().div,
    openOverlay: (spec) => { calls.push(["openOverlay", spec]); return "o1"; },
    focused: () => ({ terminal: world.focus }), theme: () => ({}), home: () => "/home/me", appHome: () => appHome, window: () => ({ platform: "macos" }),
    terminals: () => world.terminals, panes: () => world.panes,
    shared: (k) => store[k], setShared: (k, v) => { store[k] = clone(v); },
    watchFolder: async () => { throw new Error("no watch in a test"); },
    hc: async (args) => {
      calls.push(["hc", ...args]);
      if (args[0] === "read") return { code: 0, stdout: world.screen };
      if (args[0] === "get") return { code: 0, stdout: JSON.stringify({ address: args[1], foreground: world.session ? { pid: world.session.pid, argv: world.session.argv ?? ["claude"] } : null }) };
      return { code: 0, stdout: "" };
    },
    readTextFile: async (path, options) => {
      if (options?.on) ons.push(["readTextFile", options.on, path]);
      return world.session && (path === posix.join("/home/me", ".claude", "sessions", `${world.session.pid}.json`) || path.endsWith(`/${world.session.pid}.json`)) ? JSON.stringify(world.session) : null;
    },
    writeFile, mkdir, readdir, unlink, stat,
    exec: async (cmd, args = [], options) => {
      calls.push([cmd, ...args]);
      if (options?.on) ons.push([cmd, options.on, ...args]);
      if (options?.on && (cmd === "pwsh" || cmd === "powershell")) return { code: 127, stdout: "", stderr: "" };
      if (options?.on && cmd === "uname") return { code: 0, stdout: "Darwin\n" };
      if (options?.on && cmd === "stat") return { code: 0, stdout: world.statText };
      if (cmd === "stat") {
        const info = await stat(args.at(-1)).catch(() => null);
        if (info) return { code: 0, stdout: `${info.size} ${Math.floor(info.mtimeMs / 1000)}\n`, stderr: "" };
      }
      if (cmd === "mv") {
        await rename(args.at(-2), args.at(-1));
        return { code: 0, stdout: "", stderr: "" };
      }
      if (options?.on && cmd === "base64") return { code: 0, stdout: "AQIDBA==\n" };
      if (cmd === "base64" && args[0] === "-D") {
        const text = await readFile(args[2], "utf8");
        await writeFile(args[4], Buffer.from(String(text).replace(/\s/g, ""), "base64"));
        return { code: 0, stdout: "", stderr: "" };
      }
      if (options?.on && cmd === "sh" && String(args[1]).includes("printf %s")) return { code: 0, stdout: "/home/light\n" };
      if (cmd === "sqlite3") return run(cmd, args, options);
      if (cmd === "mkdir") return fileApi(nativePlatform, run).mkdir(args.at(-1), options);
      if (cmd === "ps") return { code: 0, stdout: world.session?.etime ?? "00:05" };
      if (cmd === "sh" && args[1].startsWith('f="$1"')) {
        const from = args[4];
        const size = transcript.length;
        if (from === String(size)) return { code: 3, stdout: "" };
        const shrunk = Number(from) > size;
        const start = shrunk ? 0 : Number(from) || 0;
        return { code: 0, stdout: `${size}\n${shrunk ? 0 : from}\nm\n${transcript.slice(start)}` };
      }
      if (cmd === "sh" && args[1].startsWith("for f;")) return { code: 0, stdout: args.slice(3).filter((p) => world.files.includes(p)).map((p) => `${p}\n`).join("") };
      if (cmd === "sh" && args[1].includes("kanso-dot")) return { code: 0, stdout: "#c45a3a\n" };
      if (cmd === "sh" && args[1].startsWith("head -c 800")) return { code: world.bad.includes(args[3]) ? 1 : 0, stdout: "" };
      if (cmd === "sips" && args[0] === "-g") return { code: 0, stdout: world.bad.includes(args.at(-1)) ? "pixelWidth: <nil>\n" : "pixelWidth: 32\n" };
      if (cmd === "sips" && world.bad.includes(sipsPath(args))) return { code: 1, stdout: "" };
      return cmd === "cp" ? copy(args) : { code: 0, stdout: "" };
    },
  };
  const { Look } = await load("kanso-panel/look.js", ["Look"], host);
  const { Kdb } = await load("kanso-panel/kdb.js", ["Kdb"], host);
  const { cx, drain } = context();
  cx.timer = { every() {}, after() {} };
  const look = new Look(new Kdb());
  look.init({ ...cx, focus_handle: () => ({}) }, {});
  await drain();
  return { look, cx, drain, calls, ons, say, store, world };
}

// A draw ends in a directory read, so wait for the state under test. One tick first, so a copy that should not start has a chance to.
const until = async (ready) => {
  const deadline = Date.now() + 2000;
  do {
    await new Promise((resolve) => setTimeout(resolve, 1));
    if (await ready()) return;
  } while (Date.now() < deadline);
};

test("The Look panel reads the agent in focus and shows its newest picture, copied where Herdr can draw it", async () => {
  const { look, calls } = await panel();
  assert.deepEqual(clone(calls[0]), ["hc", "read", "t1", "--lines", "400"]);
  assert.deepEqual(clone(look.list().map((i) => i.path)), ["/repo/tests/shot.png", "/repo/images/hero.jpg"], "only pictures that exist, from the agent's folder");
  assert.equal(look.selected.path, "/repo/tests/shot.png");
  assert.equal(look.picked, false);
  assert.match(look.shown.image, /^data\/kanso-panel\/look\/[0-9a-z]+-\d+\.png$/);
  assert.equal(look.shown.picture, "/repo/tests/shot.png", "a picture's pins point at the file itself");
  assert.ok(calls.some((c) => c[0] === "cp" && c[2] === "/repo/tests/shot.png" && c[3] === `/app/${look.shown.image}`));
});

test("A Claude agent's conversation on disk gives Look the whole paths its screen abbreviates or no longer shows", async () => {
  const { projectDir, transcriptPath, PATTERN, pathOf } = await load("kanso-panel/transcript.js", ["projectDir", "transcriptPath", "PATTERN", "pathOf"]);
  assert.ok(PATTERN.startsWith("(^|[^A-Za-z0-9@+._~/-])[A-Za-z0-9@+._~/-]*\\.(") && PATTERN.endsWith(")([^A-Za-z0-9]|$)"), "grep's pattern: a whole path up to one of Look's extensions, with what came before and after");
  assert.deepEqual(['"/repo/shots/a.png"', "[../docs/DEC-102.md]", " methodology/rules.md\\", "\\n./docs/a.md ", "://static.linear.app/icon.svg", "/\\/json-schema.org"].map(pathOf),
    ["/repo/shots/a.png", "../docs/DEC-102.md", "methodology/rules.md", "./docs/a.md", null, "/\\/json-schema.org"], "quotes, brackets and JSON's line breaks off; a URL's tail is no path, and a stray one is a file that does not exist");
  assert.equal(projectDir("/Users/jj/Apps/prjct"), "-Users-jj-Apps-prjct");
  const long = `/Users/jj/${"a".repeat(220)}/x`;
  assert.match(projectDir(long), /^-Users-jj-a{190}-[0-9a-z]+$/, "over 200 characters: cut there, with Claude Code's hash of the whole folder");
  assert.equal(projectDir(long).length > 200 && projectDir(long).slice(0, 200), long.replace(/[^A-Za-z0-9]/g, "-").slice(0, 200));
  const emoji = `/repo/${"nested/".repeat(32)}art-\u{1f680}`;
  const claude = (cwd) => { const slug = cwd.replace(/[^a-zA-Z0-9]/g, "-"); let h = 0; for (let i = 0; i < cwd.length; i++) h = (h << 5) - h + cwd.charCodeAt(i) | 0; return slug.length > 200 ? `${slug.slice(0, 200)}-${Math.abs(h).toString(36)}` : slug; };
  assert.equal(projectDir(emoji), claude(emoji), "hashed over UTF-16 units, as Claude Code does");
  assert.equal(transcriptPath({ sessionId: "s1", cwd: "/repo" }, "/home/me"), posix.join("/home/me", ".claude", "projects", "-repo", "s1.jsonl"));
  assert.equal(transcriptPath({ pid: 7 }, "/home/me"), null, "a record without a conversation: nothing to read");
  const session = { pid: 7, sessionId: "07e8cebe-420b-47d2-9fba-a76c2e4dd30d", cwd: "/repo", startedAt: Date.now() - 5000 };
  // What grep hands back: the paths in the file, oldest first.
  const transcript = ['"/repo/shots/u-desk-ideas.png"', ' /repo/shots/old.png ', '\\n/repo/shots/u-desk-tasks.png"'].join("\n");
  const screen = "› [image] …/u-desk-tasks.png (112KB)\n› [image] …/u-desk-ideas.png (98KB)\n";
  const files = ["/repo/shots/u-desk-ideas.png", "/repo/shots/u-desk-tasks.png"];
  const { look, cx, drain, calls } = await panel({ screen, files, session, transcript });
  assert.deepEqual(clone(calls.filter((c) => c[0] === "hc" && c[1] === "get").map((c) => c[2])), ["t1"], "the agent's process, for its session record");
  const scan = calls.find((c) => c[0] === "sh" && c[2].startsWith('f="$1"'));
  assert.deepEqual(clone(scan.slice(4)), [posix.join("/home/me", ".claude", "projects", "-repo", "07e8cebe-420b-47d2-9fba-a76c2e4dd30d.jsonl"), "0", PATTERN, "2000", ""], "the whole file, first time");
  assert.deepEqual(clone(look.list().map((i) => i.path)), ["/repo/shots/u-desk-tasks.png", "/repo/shots/u-desk-ideas.png"], "whole, newest first, only those that exist; the screen's stubs resolve to nothing");
  assert.equal(look.selected.path, "/repo/shots/u-desk-tasks.png");
  assert.equal(look.transcript.size, String(transcript.length));
  assert.deepEqual(clone(look.transcript.paths), ["/repo/shots/u-desk-ideas.png", "/repo/shots/old.png", "/repo/shots/u-desk-tasks.png"], "as said, oldest first, whether the file has them or not");
  look.readAt = 0; look.read(cx); await drain();
  const again = calls.filter((c) => c[0] === "sh" && c[2].startsWith('f="$1"')).at(-1);
  assert.equal(again[5], String(transcript.length), "the next read says what size it saw: grep is skipped while the file has not grown");
  assert.deepEqual(clone(look.list().map((i) => i.path)), ["/repo/shots/u-desk-tasks.png", "/repo/shots/u-desk-ideas.png"], "and the list stays");
  const shell = await panel({ screen, files, session: null, transcript });
  assert.ok(!shell.calls.some((c) => c[0] === "sh" && c[2].startsWith('f="$1"')), "no Claude process in front: the screen alone");
  const codex = await panel({ screen, files, session: { ...session, argv: ["codex"] }, transcript });
  assert.ok(!codex.calls.some((c) => c[0] === "sh" && c[2].startsWith('f="$1"')), "another program with a pid Claude once had: Claude's record is not its conversation");
  const reborn = await panel({ screen, files, session: { ...session, etime: "01:00:00" }, transcript });
  assert.ok(!reborn.calls.some((c) => c[0] === "sh" && c[2].startsWith('f="$1"')), "a Claude an hour old with a record written five seconds ago: the record is another Claude's");
  // The same terminal, a new Claude on another conversation: what the last one made is not shown as this one's.
  const { look: next, cx: cx2, drain: drain2 } = await panel({ screen: "", files, session, transcript });
  next.select(next.list()[1], cx2, true); await drain2();
  assert.deepEqual([next.selected.path, next.picked], ["/repo/shots/u-desk-ideas.png", true], "you picked one from the last conversation");
  next.transcript = { ...next.transcript, file: "/home/me/.claude/projects/-repo/older.jsonl" };
  next.readAt = 0; next.read(cx2); await drain2();
  assert.deepEqual([next.selected.path, next.picked], ["/repo/shots/u-desk-tasks.png", false], "your pick is let go; the new conversation's newest shows, as at a start");
  // A read in between with no record (the new Claude still starting) does not make Look forget which conversation it read.
  const gap = await panel({ screen: "", files, session, transcript });
  gap.look.select(gap.look.list()[1], gap.cx, true); await gap.drain();
  gap.world.session = null;
  gap.look.readAt = 0; gap.look.read(gap.cx); await gap.drain();
  assert.deepEqual([gap.look.selected.path, gap.look.picked, gap.look.transcript.file], ["/repo/shots/u-desk-ideas.png", true, posix.join("/home/me", ".claude", "projects", "-repo", "07e8cebe-420b-47d2-9fba-a76c2e4dd30d.jsonl")], "no record for a moment: your pick stays, and the conversation read is remembered");
  gap.world.session = { ...session, sessionId: "11111111-2222-4333-8444-555555555555" };
  gap.look.readAt = 0; gap.look.read(gap.cx); await gap.drain();
  assert.equal(gap.look.picked, false, "the conversation changed: the pick is let go");
  // Codex takes the terminal after Claude: it has no conversation to read, but it is another program, so the same.
  const swap = await panel({ screen: "", files, session, transcript });
  swap.look.select(swap.look.list()[1], swap.cx, true); await swap.drain();
  swap.world.session = { pid: 9, argv: ["codex"] };
  swap.look.readAt = 0; swap.look.read(swap.cx); await swap.drain();
  assert.deepEqual([swap.look.selected, swap.look.picked, clone(swap.look.list())], [null, false, []], "Claude's picture is not Codex's: nothing selected, nothing to send about");
  assert.deepEqual(clone(next.list().map((i) => i.path)), ["/repo/shots/u-desk-tasks.png", "/repo/shots/u-desk-ideas.png"], "and the list is the new conversation's");
});

test("What you picked stays while the agent makes more, and a note goes to it with the pins", async () => {
  const { look, cx, drain, calls, say, store } = await panel();
  look.select(look.list()[1], cx, true);
  await drain();
  look.readAt = 0;
  look.read(cx);
  await drain();
  assert.equal(look.selected.path, "/repo/images/hero.jpg", "a read does not take you off what you picked");
  look.pin({ local_position: { x: 30, y: 10 }, bounds: { width: 300, height: 200 } }, cx);
  const dialog = calls.find((c) => c[0] === "openOverlay")?.[1];
  assert.deepEqual([dialog?.mod, dialog?.props.title, dialog?.props.shared, typeof dialog?.props.token], ["kanso-prompt", "Pin 1", "kanso.look.note", "string"], "a pin asks what about that spot, in a dialog of its own");
  say("someone else's answer", "another-window"); look.render(cx);
  assert.deepEqual(clone(look.pins.map((p) => p.note)), [null], "an answer to another dialog is not this pin's, and stays in the box for whoever asked");
  assert.ok(store["kanso.look.note"]["another-window"], "left for its asker");
  look.send(cx); await drain();
  assert.ok(!calls.some((c) => c[0] === "hc" && c[1] === "send"), "nothing to send while no pin has a note");
  say("crop the top");
  assert.ok(look.render(cx), "the picture, its pin and its note draw");
  assert.deepEqual(clone(look.pins.map((p) => p.note)), ["crop the top"], "the answer went on its pin");
  // Two more pins; the dialog is open for the third when the second is dropped: the answer still lands on the third.
  look.pin({ local_position: { x: 60, y: 10 }, bounds: { width: 300, height: 200 } }, cx); say("b"); look.render(cx);
  look.pin({ local_position: { x: 90, y: 10 }, bounds: { width: 300, height: 200 } }, cx);
  look.drop(1, cx); say("c"); look.render(cx);
  assert.deepEqual(clone(look.pins.map((p) => [Math.round(p.x * 100), p.note])), [[10, "crop the top"], [30, "c"]], "dropping a pin never moves the dialog's answer onto another");
  look.drop(1, cx);
  look.pin({ local_position: { x: 150, y: 100 }, bounds: { width: 300, height: 200 } }, cx);
  say(null); look.render(cx);
  assert.equal(look.pins.length, 1, "Cancel on a new pin drops it");
  look.send(cx);
  await drain();
  const sent = calls.find((c) => c[0] === "hc" && c[1] === "send");
  assert.deepEqual(clone(sent), ["hc", "send", "t1", "About /repo/images/hero.jpg:\n1 (10% across, 5% down): crop the top"]);
  assert.ok(calls.some((c) => c[0] === "hc" && c[1] === "label" && c[2] === "t1"), "marked unread, as Send does");
  assert.equal(look.pins.length, 0, "sent: the pins go");
  assert.equal(look.note.text, "Sent to web agent.");
});

test("Look sends nothing to an agent waiting on its own question", async () => {
  const { look, cx, drain, calls, say } = await panel({ status: "blocked" });
  look.pin({ local_position: { x: 30, y: 10 }, bounds: { width: 300, height: 200 } }, cx); say("looks good"); look.render(cx);
  look.send(cx);
  await drain();
  assert.equal(calls.some((c) => c[1] === "send"), false);
  assert.equal(look.note.text, "web agent is waiting on its own question. Answer it first, then send.");
});

test("Look never takes a shell as the one to send to: it would run the note", async () => {
  const { look, cx, drain, calls, say } = await panel({ focus: "t2" });
  assert.equal(look.agent(), null, "a shell in focus is no recipient");
  assert.equal(calls.some((c) => c[1] === "read"), false, "and its screen is not read");
  look.ask("/repo/tests/shot.png", cx);
  await drain();
  look.pin({ local_position: { x: 30, y: 10 }, bounds: { width: 300, height: 200 } }, cx); say("crop it"); look.render(cx);
  look.send(cx);
  await drain();
  assert.equal(calls.some((c) => c[1] === "send"), false, "nothing pasted into the shell");
  look.follow = "t1";
  look.tick(cx);
  assert.equal(look.follow, "t1", "a shell taking focus keeps the agent Look was on");
});

test("An agent that ends leaves a shell: Look sends it nothing and lets go of its pin", async () => {
  const { look, cx, drain, calls, say, world } = await panel();
  look.pinned = "t1";
  look.pin({ local_position: { x: 30, y: 10 }, bounds: { width: 300, height: 200 } }, cx); say("crop it"); look.render(cx);
  world.terminals = [{ address: "t1", cwd: "/repo", status: null, labels: {} }];
  world.panes = [{ pane: "p1", terminal: "t1", program: { name: "zsh", shell: true } }];
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
  look.select(a, cx, true);
  await until(() => held.length >= 1);
  look.select(b, cx, true);
  await until(() => held.length >= 2);
  look.select(a, cx, true);
  await until(() => held.length === 2);
  assert.equal(held.length, 2, "the second A waits for the first");
  assert.equal(cleared().length, 1);
  held[0]();
  await until(() => held.length >= 3);
  assert.equal(look.shown.busy, true, "the first A's copy, about to be replaced, never shows");
  assert.equal(held.length, 3, "the second A starts once the first is done");
  assert.ok(cleared()[1] > copied()[0], "its cleanup runs after the first copy, never during it");
  held[2]();
  await until(() => look.shown?.image);
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
  await until(() => held.length >= 1);
  assert.equal(held.length, 1, "asked again while drawing: waits for the one running");
  look.select(b, cx, true);
  await until(() => held.length >= 2);
  held[1]();
  await until(() => look.shown?.image);
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
  assert.match(look.note.text, /^Images shows pictures/);
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
  assert.deepEqual(clone(mac.calls.filter((c) => !["sh", "test"].includes(c[0])).map((c) => c[0])), ["sips", "qlmanage", "pdftoppm"]);
  assert.deepEqual(clone(mac.calls.at(-2)), ["pdftoppm", "-png", "-singlefile", "-f", "1", "-scale-to", "736", "/r/spec.pdf", "/app/k"]);
});

test("Images keeps the picture big and one circle per picture, the active one in that picture's color", async () => {
  const { readFile } = await import("node:fs/promises");
  const src = await readFile(new URL("../kanso/mods/kanso-panel/look.js", import.meta.url), "utf8");
  const dots = src.slice(src.indexOf("dots(list, c) {"), src.indexOf("picture(c) {"));
  assert.match(dots, /h_flex\(\)\.id\("look-dots"\)/, "a row of circles");
  assert.match(dots, /overflow_x_scrollbar\(\)/, "scrolled sideways when it does not fit");
  assert.match(src, /item\.color/, "the active circle uses the picture's color");
  assert.match(src, /Pictures this agent writes show up here, from its conversation\./);
  assert.doesNotMatch(src, /look-strip|flex_wrap\(\)|thumbnail\(/, "no thumbnail strip and nothing wraps into a grid");
  const { look, cx, drain } = await panel();
  await drain();
  assert.equal(look.list().length, 2);
  assert.equal(look.list()[0].color, "#c45a3a", "the color is stored on the picture");
  assert.ok(look.render(cx), "the picture and the circles draw");
});

test("an index keeps first-seen order and a color, and a full read starts again", async () => {
  const { indexRows, colorOf } = await load("kanso-panel/look-model.js", ["indexRows", "colorOf"]);
  assert.equal(colorOf("pixel #C45A3A\n"), "#c45a3a");
  assert.equal(colorOf("none"), null);
  const first = indexRows([], ["/a.png", "/b.png"]);
  assert.deepEqual(clone(first.map((r) => [r.path, r.ord])), [["/a.png", 1], ["/b.png", 2]]);
  const colored = first.map((r) => (r.path === "/a.png" ? { ...r, color: "#c45a3a" } : r));
  const more = indexRows(colored, ["/a.png", "/b.png", "/c.png"]);
  assert.equal(more.at(-1).ord, 3);
  assert.equal(more[0].color, "#c45a3a");
  assert.deepEqual(clone(indexRows(more, ["/a.png", "/c.png"]).map((r) => r.path)), ["/a.png", "/c.png"], "one no longer found is dropped");
  assert.deepEqual(clone(indexRows(more, ["/c.png"], { replaced: true })), [{ path: "/c.png", ord: 1, color: null }]);
});

test("Images reads only the bytes appended since the offset it stored, and replaces the rows when the file shrinks", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kanso-look-"));
  dirs.push(dir);
  const session = { pid: 7, sessionId: "07e8cebe-420b-47d2-9fba-a76c2e4dd30d", cwd: "/repo", startedAt: Date.now() - 5000 };
  const a = "/repo/shots/a.png\n", b = "/repo/shots/b.png\n";
  const files = ["/repo/shots/a.png", "/repo/shots/b.png", "/repo/shots/c.png"];
  const scanOf = (calls) => calls.find((c) => c[0] === "sh" && String(c[2]).startsWith('f="$1"'));
  const first = await panel({ screen: "", files, session, transcript: a, appHome: dir });
  assert.equal(scanOf(first.calls)[5], "0", "nothing stored yet: the whole file");
  assert.deepEqual(clone(first.look.list().map((i) => i.path)), ["/repo/shots/a.png"]);
  assert.equal(first.look.list()[0].color, "#c45a3a");
  const second = await panel({ screen: "", files, session, transcript: a + b, appHome: dir });
  assert.equal(scanOf(second.calls)[5], String(a.length), "only the bytes after the stored offset");
  assert.equal(scanOf(second.calls).at(-1), "m", "the stored prefix mark is what the next read checks");
  assert.deepEqual(clone(second.look.list().map((i) => i.path)), ["/repo/shots/b.png", "/repo/shots/a.png"]);
  assert.equal(second.look.list().find((i) => i.path.endsWith("a.png")).color, "#c45a3a", "the color stored the first time is kept");
  assert.deepEqual(clone(second.calls.filter((c) => c[0] === "sh" && String(c[2]).includes("kanso-dot")).map((c) => c[4])), ["/repo/shots/b.png"], "a picture that already has a color is not sampled again");
  const third = await panel({ screen: "", files, session, transcript: "/repo/shots/c.png\n", appHome: dir });
  assert.equal(scanOf(third.calls)[5], String((a + b).length), "the stored offset is what is asked");
  assert.deepEqual(clone(third.look.list().map((i) => i.path)), ["/repo/shots/c.png"], "a shorter file replaces that transcript's rows");
});

test("a picture whose file is gone leaves the index, and the next one is shown", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kanso-look-"));
  dirs.push(dir);
  const session = { pid: 7, sessionId: "07e8cebe-420b-47d2-9fba-a76c2e4dd30d", cwd: "/repo", startedAt: Date.now() - 5000 };
  const files = ["/repo/shots/a.png", "/repo/shots/b.png", "/repo/shots/c.png"];
  const { look, cx, drain } = await panel({ screen: "", files, session, transcript: `${files.join("\n")}\n`, appHome: dir });
  assert.deepEqual(clone(look.list().map((i) => i.path)), ["/repo/shots/c.png", "/repo/shots/b.png", "/repo/shots/a.png"]);
  look.select(look.list().find((i) => i.path.endsWith("b.png")), cx, true);
  await drain();
  files.splice(files.indexOf("/repo/shots/b.png"), 1);
  look.readAt = 0;
  look.read(cx);
  await drain();
  assert.equal(look.selected.path, "/repo/shots/a.png", "the one after the picture that went");
  assert.deepEqual(clone(look.list().map((i) => i.path)), ["/repo/shots/c.png", "/repo/shots/a.png"]);
});

test("a pin and its note stay on their picture until Send, including after another read", async () => {
  const { look, cx, drain, calls, say } = await panel();
  const [first, second] = look.list();
  const spot = (x) => ({ local_position: { x, y: 10 }, bounds: { width: 300, height: 200 } });
  const notes = () => look.pins.map((p) => p.note);
  look.pin(spot(30), cx); say("on the first"); look.render(cx);
  assert.deepEqual(clone(notes()), ["on the first"]);
  look.select(second, cx, true);
  await drain();
  assert.equal(look.selected.path, second.path);
  assert.deepEqual(clone(notes()), [], "the other picture does not take this note");
  look.readAt = 0; look.read(cx); await drain();
  assert.equal(look.selected.path, second.path, "a later read stays on the picture you opened");
  look.pin(spot(60), cx); say("on the second"); look.render(cx);
  look.select(first, cx, true);
  await drain();
  assert.deepEqual(clone(notes()), ["on the first"], "leaving and a read in between keep the note");
  assert.equal(Math.round(look.pins[0].x * 100), 10);
  look.select(second, cx, true);
  await drain();
  assert.deepEqual(clone(notes()), ["on the second"]);
  look.send(cx);
  await drain();
  assert.equal(look.pins.length, 0, "Send clears the picture that was sent");
  assert.equal(calls.filter((c) => c[0] === "hc" && c[1] === "send").length, 1);
  look.select(first, cx, true);
  await drain();
  assert.deepEqual(clone(notes()), ["on the first"], "the other picture's note is still there");
  look.send(cx);
  await drain();
  assert.equal(look.pins.length, 0);
  look.select(second, cx, true);
  await drain();
  assert.deepEqual(clone(notes()), [], "a sent picture does not get its pins back");
});

test("an agent with no pictures is told what shows up here", async () => {
  const { look, cx } = await panel({ screen: "nothing to see", files: [] });
  assert.equal(look.list().length, 0);
  assert.equal(look.emptyLine(), "Pictures this agent writes show up here, from its conversation.");
  assert.ok(look.render(cx));
  const none = await panel({ focus: "t2" });
  assert.equal(none.look.emptyLine(), "No agent in focus.");
  assert.ok(none.look.render(none.cx));
});

test("a path cut at the stored offset is indexed once the line is whole, and a rewritten file is read again", async () => {
  const { scanFile } = await load("kanso-panel/transcript.js", ["scanFile"], { exec: run, window: nativeWindow });
  const dir = mkdtempSync(join(tmpdir(), "kanso-scan-"));
  dirs.push(dir);
  const file = join(dir, "s.jsonl");
  const partial = "/repo/a.png\n/repo/b.pn";
  writeFileSync(file, partial);
  const first = await scanFile(file, "0", "");
  assert.equal(first.code, 0);
  assert.deepEqual(clone(first.paths), ["/repo/a.png"], "the unfinished path is not indexed");
  assert.equal(first.size, String("/repo/a.png\n".length), "the offset stays after the last whole line");
  const again = await scanFile(file, first.size, first.mark);
  assert.equal(again.code, 3, "no new whole line: nothing is read");
  writeFileSync(file, "/repo/a.png\n/repo/b.png");
  const still = await scanFile(file, first.size, first.mark);
  assert.equal(still.code, 3, "a line that still has no end is left where it was");
  writeFileSync(file, "/repo/a.png\n/repo/b.png\n/repo/c.png\n");
  const done = await scanFile(file, first.size, first.mark);
  assert.equal(done.from, first.size, "the finished line is read with what was appended, not skipped");
  assert.deepEqual(clone(done.paths), ["/repo/b.png", "/repo/c.png"]);
  const repaired = await scanFile(file, String(partial.length), "");
  assert.equal(repaired.from, "0", "an offset saved mid-line, with no mark, is read from the start");
  assert.deepEqual(clone(repaired.paths), ["/repo/a.png", "/repo/b.png", "/repo/c.png"]);
  const same = "/repo/z.png\n";
  const named = join(dir, "same.jsonl");
  writeFileSync(named, "/repo/a.png\n");
  const kept = await scanFile(named, "0", "");
  writeFileSync(named, same);
  const rewritten = await scanFile(named, kept.size, kept.mark);
  assert.equal(rewritten.from, "0", "the same length is not the same file");
  assert.deepEqual(clone(rewritten.paths), ["/repo/z.png"]);
  const longer = join(dir, "long.jsonl");
  writeFileSync(longer, "/repo/old.png\n");
  const head = await scanFile(longer, "0", "");
  writeFileSync(longer, "/repo/new.png\n/repo/extra.png\n");
  const grew = await scanFile(longer, head.size, head.mark);
  assert.equal(grew.from, "0");
  assert.deepEqual(clone(grew.paths), ["/repo/new.png", "/repo/extra.png"]);
  writeFileSync(longer, "");
  const empty = await scanFile(longer, grew.size, grew.mark);
  assert.equal(empty.code, 0);
  assert.equal(empty.from, "0");
  assert.deepEqual(clone(empty.paths), [], "a file replaced with nothing is read, not skipped");
});

test("an unsent pin stays with the agent it was pinned on", async () => {
  const shot = "/repo/tests/shot.png";
  const hero = "/repo/images/hero.jpg";
  const session = { pid: 7, sessionId: "07e8cebe-420b-47d2-9fba-a76c2e4dd30d", cwd: "/repo", startedAt: Date.now() - 5000 };
  const { look, cx, drain, calls, say, world } = await panel({ session, transcript: `${shot}\n` });
  world.panes = [
    { pane: "p1", terminal: "t1", program: { name: "Claude", agent: true } },
    { pane: "p2", terminal: "t2", program: { name: "Claude", agent: true } },
  ];
  world.terminals[1] = { address: "t2", cwd: "/repo", status: "idle", labels: { "kanso.shown": "other agent" } };
  const spot = { local_position: { x: 30, y: 10 }, bounds: { width: 300, height: 200 } };
  const sent = () => calls.filter((c) => c[0] === "hc" && c[1] === "send").length;
  const notes = () => look.pins.map((p) => p.note);
  const show = async (path) => { const item = look.list().find((i) => i.path === path); assert.ok(item, path); look.select(item, cx, true); await drain(); };
  await show(shot);
  look.pin(spot, cx);
  world.focus = "t2";
  world.screen = "no pictures";
  world.files = [hero];
  look.tick(cx);
  await drain();
  say("keep mine");
  look.render(cx);
  assert.equal(look.agent(), "t2");
  assert.deepEqual(clone(notes()), [], "the other agent's list does not take the note");
  look.send(cx);
  await drain();
  assert.equal(sent(), 0, "Send does not deliver it there");
  world.focus = "t1";
  world.screen = OUTPUT;
  world.files = [shot, hero, "/repo/docs/plan.md"];
  look.tick(cx);
  await drain();
  await show(shot);
  assert.deepEqual(clone(notes()), ["keep mine"], "the note is there when that agent is back");
  world.focus = "t2";
  world.screen = "tests/shot.png";
  world.files = [shot];
  look.tick(cx);
  await drain();
  assert.equal(look.selected?.path, shot);
  assert.deepEqual(clone(notes()), [], "the same path on the other agent has its own pins");
  look.send(cx);
  await drain();
  assert.equal(sent(), 0);
  world.focus = "t1";
  world.screen = OUTPUT;
  world.files = [shot, hero];
  look.tick(cx);
  await drain();
  await show(shot);
  assert.deepEqual(clone(notes()), ["keep mine"]);
  world.focus = "t2";
  world.screen = "images/hero.jpg";
  world.files = [hero];
  look.tick(cx);
  await drain();
  look.pin(spot, cx);
  say("from b");
  look.render(cx);
  assert.deepEqual(clone(notes()), ["from b"]);
  world.focus = "t1";
  world.screen = OUTPUT;
  world.files = [shot, hero];
  look.tick(cx);
  await drain();
  world.session = { ...session, sessionId: "11111111-2222-4333-8444-555555555555" };
  look.readAt = 0;
  look.read(cx);
  await drain();
  await show(shot);
  assert.deepEqual(clone(notes()), [], "a new conversation clears that agent's pins");
  world.focus = "t2";
  world.screen = "images/hero.jpg";
  world.files = [hero];
  look.tick(cx);
  await drain();
  assert.equal(look.selected?.path, hero);
  assert.deepEqual(clone(notes()), ["from b"], "the other agent's note stays");
});

test("a picture that will not open leaves the row and the next one is shown", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kanso-look-"));
  dirs.push(dir);
  const session = { pid: 7, sessionId: "07e8cebe-420b-47d2-9fba-a76c2e4dd30d", cwd: "/repo", startedAt: Date.now() - 5000 };
  const good = "/repo/shots/a.png";
  const bad = "/repo/shots/bad.png";
  const heic = "/repo/shots/a.heic";
  const svg = "/repo/shots/a.svg";
  const { look, cx, drain } = await panel({ screen: "", files: [good, bad], session, transcript: `${good}\n${bad}\n`, appHome: dir, bad: [bad] });
  assert.equal(look.selected.path, good, "the picture after the one that will not open");
  assert.deepEqual(clone(look.list().map((i) => i.path)), [good]);
  look.readAt = 0;
  look.read(cx);
  await drain();
  assert.deepEqual(clone(look.list().map((i) => i.path)), [good], "a later read does not bring it back");
  const only = await panel({ screen: "", files: [heic], session: { ...session, sessionId: "11111111-2222-4333-8444-555555555555" }, transcript: `${heic}\n`, bad: [heic] });
  assert.equal(only.look.list().length, 0);
  assert.equal(only.look.selected, null);
  assert.equal(only.look.emptyLine(), "Pictures this agent writes show up here, from its conversation.");
  const drawing = await panel({ screen: "", files: [svg], session: { ...session, sessionId: "22222222-3333-4444-8555-666666666666" }, transcript: `${svg}\n` });
  assert.deepEqual(clone(drawing.look.list().map((i) => i.path)), [svg], "a picture that opens stays");
  const broken = await panel({ screen: "", files: [svg, good], session: { ...session, sessionId: "33333333-4444-4555-8666-777777777777" }, transcript: `${good}\n${svg}\n`, bad: [svg] });
  assert.deepEqual(clone(broken.look.list().map((i) => i.path)), [good]);
});

test("a transcript that names no picture drops the ones it kept, and the next open stays empty", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kanso-look-"));
  dirs.push(dir);
  const session = { pid: 7, sessionId: "07e8cebe-420b-47d2-9fba-a76c2e4dd30d", cwd: "/repo", startedAt: Date.now() - 5000 };
  const file = "/repo/shots/a.png";
  const first = await panel({ screen: "", files: [file], session, transcript: `${file}\n`, appHome: dir });
  assert.deepEqual(clone(first.look.list().map((i) => i.path)), [file]);
  const cleared = await panel({ screen: "", files: [file], session, transcript: "no pictures\n", appHome: dir });
  assert.deepEqual(clone(cleared.look.list()), []);
  const again = await panel({ screen: "", files: [file], session, transcript: "no pictures\n", appHome: dir });
  assert.deepEqual(clone(again.look.list()), [], "the mark of that read does not bring the old picture back");
});

test("a picture that failed to open is tried again the next time Images opens", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kanso-look-"));
  dirs.push(dir);
  const session = { pid: 7, sessionId: "07e8cebe-420b-47d2-9fba-a76c2e4dd30d", cwd: "/repo", startedAt: Date.now() - 5000 };
  const good = "/repo/shots/a.png";
  const heic = "/repo/shots/a.heic";
  const first = await panel({ screen: "", files: [good, heic], session, transcript: `${good}\n${heic}\n`, appHome: dir, bad: [heic] });
  assert.deepEqual(clone(first.look.list().map((i) => i.path)), [good], "this session hides the one sips could not convert");
  const again = await panel({ screen: "", files: [good, heic], session, transcript: `${good}\n${heic}\n`, appHome: dir });
  assert.deepEqual(clone(again.look.list().map((i) => i.path)), [heic, good], "the next open tries that path again");
});

test("Images reads an agent on another computer there, and draws a copy from this one", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kanso-look-"));
  dirs.push(dir);
  const session = { pid: 7, sessionId: "07e8cebe-420b-47d2-9fba-a76c2e4dd30d", cwd: "/repo", startedAt: Date.now() - 5000 };
  const file = "/repo/shots/a.png";
  const { look, calls, ons } = await panel({ remote: "light", screen: "", files: [file], session, transcript: `${file}\n`, appHome: dir });
  assert.equal(look.agent(), "light/t1");
  assert.deepEqual(clone(calls[0]), ["hc", "read", "light/t1", "--lines", "400"]);
  assert.equal(look.list()[0].path, file);
  assert.match(look.shown.image, /^data\/kanso-panel\/look\//);
  const onOf = (cmd) => ons.filter((c) => c[0] === cmd).map((c) => c[1]);
  for (const cmd of ["readTextFile", "stat", "base64", "sips"]) assert.deepEqual([...new Set(onOf(cmd))], ["light"], cmd);
  assert.ok(ons.some((c) => c[0] === "sh" && c[1] === "light" && String(c[3]).includes("printf %s")), "the home is that computer's");
  assert.ok(ons.some((c) => c[0] === "sh" && c[1] === "light" && String(c[3]).startsWith('f="$1"')), "the conversation is read from the byte stored last time");
  assert.ok(ons.some((c) => c[0] === "sh" && c[1] === "light" && String(c[3]).startsWith("for f;")), "the file is checked there");
  assert.equal(ons.some((c) => c[0] === "cp"), false, "the drawing copy stays on this computer");
  const copied = calls.find((c) => c[0] === "cp");
  assert.equal(paths.dirname(copied[2]), paths.join(dir, "data/kanso-panel/remote"));
  assert.equal(paths.dirname(copied[3]), paths.join(dir, "data/kanso-panel/look"));
});

test("a picture on a computer that does not answer stays listed and says why", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kanso-look-"));
  dirs.push(dir);
  const file = "/repo/tests/shot.png";
  const { look } = await panel({ remote: "light", files: [file], appHome: dir, statText: `${20 * 1024 * 1024 + 1} 1\n` });
  assert.equal(look.list().some((i) => i.path === file), true);
  assert.equal(look.shown, null);
  assert.match(look.note.text, /over 20 MB/);
});

test("a picture over 2 MB on another computer waits until it is asked for", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kanso-look-"));
  dirs.push(dir);
  const file = "/repo/tests/shot.png";
  const { look, ons } = await panel({ remote: "light", files: [file], appHome: dir, statText: `${3 * 1024 * 1024} 1\n` });
  assert.equal(look.list().some((i) => i.path === file), true);
  assert.equal(look.shown?.deferred, true);
  assert.equal(look.shown.size, 3 * 1024 * 1024);
  assert.equal(ons.some((c) => c[0] === "base64"), false);
  assert.equal(look.note, null);
});

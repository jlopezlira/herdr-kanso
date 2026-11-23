import { loadOpenWith } from "./mod-fixtures.mjs";
import assert from "node:assert/strict";
import test from "node:test";

function psLiteral(text) {
  assert.equal(text[0], "'");
  let value = "", i = 1;
  const quotes = "'‘’‚‛";
  for (; i < text.length; i++) {
    const ch = text[i];
    if (!quotes.includes(ch)) value += ch;
    else if (quotes.includes(text[i + 1] ?? "\0")) { value += ch; i++; }
    else return { value, rest: text.slice(i + 1) };
  }
  assert.fail("Unterminated PowerShell literal");
}

// Open with on Windows, and the last command it launched.
const onWindows = async () => {
  let command;
  const { OpenWith } = await loadOpenWith({
    exec: async (_program, args) => { command = args.at(-1); return { code: 0 }; },
  });
  const view = Object.assign(new OpenWith(), { platform: "windows" });
  return { view, command: () => command };
};

test("Windows launch keeps all PowerShell single quotes inside literals", async () => {
  const { view, command: launched } = await onWindows();
  for (const quote of "'‘’‚‛") {
    const path = `C:\\repo\\report${quote}); Write-Output marker; #.txt`;
    const cli = `C:\\Users\\O${quote}Brien\\editor.exe`;
    await view.spawn(cli, [path]);
    const command = launched();
    const prefix = "Start-Process -FilePath ";
    const executable = psLiteral(command.slice(command.indexOf(prefix) + prefix.length));
    assert.equal(executable.value, cli);
    assert.ok(executable.rest.startsWith(" -ArgumentList "));
    const argument = psLiteral(executable.rest.slice(" -ArgumentList ".length));
    assert.equal(argument.value, `"${path}"`);
    assert.equal(argument.rest, " -ErrorAction Stop");
  }
});

test("Windows arguments retain spaces, empty strings, quotes and trailing slashes", async () => {
  const { view, command: launched } = await onWindows();
  await view.spawn("editor.exe", ["--remote", "ssh-remote+host", "C:\\My Project\\", "", 'a"b', 'a\\"b']);
  const command = launched();
  const executable = psLiteral(command.slice(command.indexOf("Start-Process -FilePath ") + "Start-Process -FilePath ".length));
  const argument = psLiteral(executable.rest.slice(" -ArgumentList ".length));
  assert.equal(argument.value, String.raw`"--remote" "ssh-remote+host" "C:\My Project\\" "" "a\"b" "a\\\"b"`);
  for (const invalid of ["a\0b", "a\rb", "a\nb"]) {
    assert.throws(() => view.spawn("editor.exe", [invalid]), /Invalid path/);
  }
});

// Open with in a menu drawn by the fake kit: what the user reads and the presses it offers.
const chooser = async ({ exec, tree = { id: "root", children: [] } }) => {
  const { gpuiHost, texts, find, calls } = await import("./helpers.mjs");
  const closed = [];
  const store = {};
  const { OpenWith } = await loadOpenWith({
    ...gpuiHost(), exec, layout: () => tree, props: () => ({ file: "/repo/README.md", overlay: "ov" }), closeOverlay: (id) => closed.push(id),
    shared: (key) => store[key], setShared: (key, value) => { store[key] = value; }, theme: () => ({}), win: () => ({ platform: "macos" }),
    focused: () => null, panes: () => [], spaces: () => [], home: () => "/home/me", appHome: () => "/app",
  });
  const pending = [];
  const cx = { spawn: (fn) => pending.push(fn(cx)), notify() {}, focus_handle: () => ({ focus() {}, is_focused: () => false }), stop_propagation() {} };
  const view = new OpenWith();
  view.init({}, cx);
  const settle = async () => { while (pending.length) await pending.shift(); };
  const press = (label) => calls(find(view.render(cx), (el) => calls(el, "accessibility_label").some((c) => c[1] === label)), "on_click").at(-1).at(-1)({}, cx);
  return { view, cx, closed, settle, press, words: () => texts(view.render(cx)) };
};

test("A failed look for editors says so and offers Retry, which looks again", async () => {
  let fail = true;
  const { settle, press, words } = await chooser({ exec: async () => { if (fail) throw new Error("no shell"); return { code: 0, stdout: "", stderr: "" }; } });
  await settle();
  assert.ok(words().includes("Could not look for editors"), "the failure, not a loading list");
  fail = false;
  press("Retry");
  await settle();
  assert.ok(!words().includes("Could not look for editors"), "Retry looked again");
});

test("Preview in the panel is dim when the layout has no panel, and choosing it keeps the chooser open", async () => {
  const { view, settle, closed, words } = await chooser({ exec: async () => ({ code: 0, stdout: "", stderr: "" }) });
  await settle();
  assert.ok(words().includes("no panel in this layout"));
  await view.open(view.list()[0]);
  assert.deepEqual(closed, [], "nothing opened, so nothing closed");
});

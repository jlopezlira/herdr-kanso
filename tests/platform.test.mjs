import test from "node:test";
import assert from "node:assert/strict";
import { win32, posix } from "node:path";
import { pathApi } from "../kanso/mods/kanso-panel/platform-paths.js";
import { processApi } from "../kanso/mods/kanso-panel/platform-processes.js";
import { portApi } from "../kanso/mods/kanso-panel/platform-ports.js";
import { killApi } from "../kanso/mods/kanso-panel/platform-kill.js";
import { openApi } from "../kanso/mods/kanso-panel/platform-open.js";
import { clipboardApi } from "../kanso/mods/kanso-panel/platform-clipboard.js";
import { fileApi } from "../kanso/mods/kanso-panel/platform-files.js";
import { powershell, psQuote } from "../kanso/mods/kanso-panel/platform-command.js";

function runner(output = "", code = 0) {
  const calls = [];
  return { calls, run: async (program, args, options) => { calls.push({ program, args, options }); return { code, stdout: output, stderr: code ? "Access denied" : "" }; } };
}

for (const name of ["macos", "linux", "windows"]) {
  test(`${name} paths preserve roots, resolve parents and enforce directory boundaries`, () => {
    const api = pathApi(name), native = name === "windows" ? win32 : posix;
    const roots = name === "windows" ? ["C:\\", "C:\\Users\\A B", "\\\\server\\share", "\\\\server\\share\\folder"] : ["/", "/Users/A B", "/tmp"];
    for (const root of roots) {
      for (const tail of ["child", "child/../next", "../sibling"]) assert.equal(api.join(root, tail), native.join(root, tail));
      assert.equal(api.dirname(api.join(root, "file.txt")), native.normalize(root));
      assert.equal(api.basename(api.join(root, "file.txt")), "file.txt");
      assert.equal(api.within(api.join(root, "child"), root), true);
    }
    const root = roots[1];
    assert.equal(api.within(root + "-other", root), false);
    assert.equal(api.relative(root, root + "-other"), null);
    assert.equal(api.shorten(api.join(root, "child"), root), "~" + native.sep + "child");
    const file = api.join(root, "hello # % ü.txt");
    assert.equal(api.fromFileUrl(api.fileUrl(file)), file);
  });

  test(`${name} process inspection normalizes parents and reports foreign metadata availability`, async () => {
    const input = name === "windows" ? JSON.stringify([{ pid: 42, ppid: 7, name: "node.exe", command: "node server.js", created: "2026-01-01T00:00:00Z" }]) : "42 7 01:02 node server.js\n";
    const r = runner(input), api = processApi(name, r.run), table = await api.list();
    assert.equal(table.byPid.get(42).ppid, 7);
    assert.equal(table.byParent.get(7)[0].command, "node server.js");
    assert.equal(r.calls[0].program, name === "windows" ? "pwsh" : "ps");
    await assert.rejects(api.list({ pids: ["42;evil"] }), /Invalid process/);
    if (name === "windows") {
      assert.equal((await api.cwd([42])).state, "unavailable");
      assert.match((await api.openFiles([42])).reason, /Herdr API/);
      assert.equal(r.calls.length, 1);
    } else {
      const files = processApi(name, runner("p42\nn/home/a b\nn/home/file.txt\n").run);
      assert.equal((await files.cwd([42])).values.get(42), "/home/file.txt");
      assert.deepEqual((await files.openFiles([42])).values.map((file) => file.path), ["/home/a b", "/home/file.txt"]);
    }
    await assert.rejects(processApi(name, runner("", 5).run).list(), /Access denied/);
  });

  test(`${name} listeners deduplicate IPv4 and IPv6 ports`, async () => {
    const input = name === "windows" ? '[{"pid":42,"port":3000},{"pid":42,"port":3000},{"pid":42,"port":8080}]' : "p42\ncnode\nn127.0.0.1:3000\nn[::1]:3000\nn*:8080\n";
    const r = runner(input), listeners = await portApi(name, r.run).listen();
    assert.deepEqual(listeners.get(42).ports, [3000, 8080]);
    await assert.rejects(portApi(name, runner("", 5).run).listen(), /Access denied/);
  });

  test(`${name} stopping is graceful first and forced only when requested`, async () => {
    const r = runner(), api = killApi(name, r.run);
    await api.stop(42); await api.stop(42, { force: true });
    assert.deepEqual(r.calls.map(({ program, args }) => [program, args]), name === "windows" ? [["taskkill", ["/PID", "42"]], ["taskkill", ["/PID", "42", "/F"]]] : [["kill", ["-TERM", "42"]], ["kill", ["-KILL", "42"]]]);
    assert.throws(() => api.stop(-1), /Invalid process/);
    assert.equal(r.calls.length, 2);
  });

  test(`${name} opener passes filenames as arguments`, async () => {
    const r = runner(), api = openApi(name, r.run), target = "a '); bad; #.txt";
    await api.open(target);
    if (name === "windows") assert.ok(r.calls[0].args.at(-1).includes(psQuote(target)));
    else assert.deepEqual(r.calls[0].args, [target]);
    await api.spawn("editor", [target]);
    assert.equal(r.calls.at(-1).program, name === "windows" ? "pwsh" : "sh");
    assert.match(api.terminalLine("folder", ["claude", "--resume", "a'b"]), name === "windows" ? /Set-Location -LiteralPath/ : /^cd /);
  });

  test(`${name} image clipboard and text use the platform interface`, async () => {
    const r = runner(), api = clipboardApi(name, r.run);
    assert.equal(await api.image("image.png"), true);
    assert.equal(r.calls[0].program, name === "windows" ? "powershell" : name === "macos" ? "osascript" : "sh");
    const cx = { write_to_clipboard(text) { this.text = text; }, read_from_clipboard() { return this.text; } };
    api.write(cx, "a\nü"); assert.equal(api.read(cx), "a\nü");
  });

  test(`${name} filesystem operations preserve literal paths and failures`, async () => {
    const r = runner(), api = fileApi(name, r.run), target = "a '); bad; #";
    await api.mkdir(target); await api.copy(target, "next"); await api.move(target, "next"); await api.remove([target], { recursive: true });
    assert.equal(r.calls.length, 4);
    assert.equal(await api.test(target), true);
    assert.equal(await fileApi(name, runner("", 1).run).test(target), false);
    await assert.rejects(fileApi(name, runner("", 5).run).test(target), /Access denied/);
    if (name === "windows") assert.ok(r.calls.every(({ args }) => args.at(-1).includes(psQuote(target))));
    else assert.deepEqual(r.calls[0].args, ["-p", target]);
  });
}

test("PowerShell falls back only when the executable is missing", async () => {
  const calls = [];
  const run = async (program) => { calls.push(program); if (program === "pwsh") throw new Error("not found"); return { code: 0 }; };
  assert.equal((await powershell(run, "Write-Output ok")).code, 0);
  assert.deepEqual(calls, ["pwsh", "powershell"]);
  assert.throws(() => psQuote("line\nbreak"), /Invalid path or argument/);
});

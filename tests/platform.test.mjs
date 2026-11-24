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

function runner(output = "", code = 0, stderr = code ? "Access denied" : "") {
  const calls = [];
  return { calls, run: async (program, args, options) => { calls.push({ program, args, options }); return { code, stdout: output, stderr }; } };
}

const opener = { macos: "open", linux: "xdg-open", windows: "pwsh" };

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
      const files = processApi(name, runner(name === "linux" ? "42\t/home/a b\n42\t/home/file.txt\n" : "p42\nn/home/a b\nn/home/file.txt\n").run);
      assert.equal((await files.cwd([42])).values.get(42), "/home/file.txt");
      assert.deepEqual((await files.openFiles([42])).values.map((file) => file.path), ["/home/a b", "/home/file.txt"]);
    }
    await assert.rejects(processApi(name, runner("", 5).run).list(), /Access denied/);
  });

  test(`${name} listeners deduplicate IPv4 and IPv6 ports`, async () => {
    const input = {
      windows: '[{"pid":42,"port":3000},{"pid":42,"port":3000},{"pid":42,"port":8080}]',
      linux: 'LISTEN 0 511 127.0.0.1:3000 0.0.0.0:* users:(("node",pid=42,fd=20))\nLISTEN 0 511 [::1]:3000 [::]:* users:(("node",pid=42,fd=21))\nLISTEN 0 511 *:8080 *:* users:(("node",pid=42,fd=22))\n',
    }[name] ?? "p42\ncnode\nn127.0.0.1:3000\nn[::1]:3000\nn*:8080\n";
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

  test(`On ${name}, kansō refuses file links, command options and network paths without launching anything.`, async () => {
    const r = runner(), api = openApi(name, r.run);
    for (const target of ["file:///System/Applications/Calculator.app", "-aCalculator", "\\\\evil\\share\\x.exe", "http://example.org/", "mailto:reader@example.org",
      "https://example.org:invalid/", "https://user@example.org/", "https://example.org:70000/", "http://172.32.0.1/", "https://exa mple.org/", "javascript:alert(1)"]) {
      assert.equal((await api.web(target)).code, 1, target);
    }
    assert.deepEqual(r.calls, []);
  });

  test(`On ${name}, kansō opens an https link anywhere and an http link only on this computer or a private network.`, async () => {
    const r = runner(), api = openApi(name, r.run);
    const links = ["https://example.org:8443/a?b#c", "https://[2001:db8::1]/", "http://localhost:3000/", "http://127.0.0.1:8080", "http://[::1]/", "http://10.0.0.7/",
      "http://192.168.1.20:5173/x", "http://172.16.0.1/", "http://172.31.255.1/"];
    for (const link of links) assert.equal((await api.web(link)).code, 0, link);
    assert.equal(r.calls.length, links.length);
  });

  test(`On ${name}, kansō opens a GitHub pull request link with the system opener.`, async () => {
    const r = runner(), api = openApi(name, r.run), url = "https://github.com/x/y/pull/1";
    assert.equal((await api.web(url)).code, 0);
    assert.equal(r.calls.length, 1);
    const { program, args } = r.calls[0];
    assert.equal(program, opener[name]);
    if (name === "windows") assert.ok(args.at(-1).endsWith(`; Start-Process -FilePath ${psQuote(url)} -ErrorAction Stop`));
    else assert.deepEqual(args, [url]);
  });

  if (name !== "windows") {
    test(`On ${name}, kansō opens a filename starting with a dash as a relative path.`, async () => {
      const r = runner(), api = openApi(name, r.run);
      await api.open("-x");
      assert.deepEqual(r.calls, [{ program: opener[name], args: ["./-x"], options: {} }]);
    });
  }

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
    assert.equal(await fileApi(name, runner("", 1, "").run).test(target), false);
    if (name === "windows") await assert.rejects(fileApi(name, runner("", 1).run).test(target), /Access denied/);
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

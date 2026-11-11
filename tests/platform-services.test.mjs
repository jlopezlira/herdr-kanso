import test from "node:test";
import assert from "node:assert/strict";
import { processApi } from "../kanso/mods/kanso-panel/platform-processes.js";
import { transcriptApi } from "../kanso/mods/kanso-panel/platform-transcripts.js";
import { repositoryApi } from "../kanso/mods/kanso-panel/platform-repositories.js";
import { imageApi } from "../kanso/mods/kanso-panel/platform-images.js";
import { systemApi } from "../kanso/mods/kanso-panel/platform-system.js";
import { markdownApi, markdownMentions } from "../kanso/mods/kanso-panel/platform-markdown.js";
import { petApi } from "../kanso/mods/kanso-panel/platform-pets.js";
import { clipboardApi } from "../kanso/mods/kanso-panel/platform-clipboard.js";
import { fileApi } from "../kanso/mods/kanso-panel/platform-files.js";
import { openApi } from "../kanso/mods/kanso-panel/platform-open.js";
import { load, clone } from "./helpers.mjs";

function stub(answer = () => "") {
  const calls = [];
  const run = async (program, args, options) => {
    calls.push({ program, args, options });
    const value = await answer(program, args, options);
    return typeof value === "string" ? { code: 0, stdout: value, stderr: "" } : value;
  };
  return { calls, run };
}

for (const platform of ["macos", "linux", "windows"]) {
  const windows = platform === "windows";
  test(`${platform} process identity, existence and memory keep absence distinct from errors`, async () => {
    const created = "2026-11-10T00:00:00Z", now = Date.parse(created) + 62000;
    const r = stub((_p, args) => windows ? JSON.stringify([{ pid: 42, ppid: 1, name: "claude.exe", created, kb: 123, comm: "claude.exe" }]) : args.includes("etime=,comm=") ? "01:02 /bin/claude" : args.includes("etime=") ? "01:02" : "42 123 claude");
    const api = processApi(platform, r.run);
    assert.equal(await api.exists(42), true);
    assert.equal(await api.startTime(42, now), Date.parse(created));
    assert.equal((await api.identity(42, now)).start, Date.parse(created));
    assert.match((await api.memory()).stdout, /42 123 claude/);
    const empty = processApi(platform, stub(() => windows ? "[]" : { code: 1, stdout: "", stderr: "no such process" }).run);
    assert.equal(await empty.exists(42), false);
    assert.equal(await empty.identity(42), null);
    assert.ok(Number.isNaN(await empty.startTime(42)));
    const denied = processApi(platform, stub(() => ({ code: 1, stdout: "", stderr: "Permission denied" })).run);
    if (windows) await assert.rejects(denied.exists(42), /Permission denied/);
    else assert.equal(await denied.exists(42), null);
  });

  test(`${platform} transcript operations preserve byte budgets and unavailable metadata`, async () => {
    const r = stub(() => "10 20\n{}\n"), api = transcriptApi(platform, r.run);
    assert.equal((await api.slice("file.jsonl", 5, 8192, 16000)).stdout, "10 20\n{}\n");
    assert.equal(r.calls[0].options.timeout, 60000);
    await api.thread("file.jsonl");
    await api.scan("file.jsonl", 0, "", "pattern", "png|md", 2000, 100000);
    await api.locate(42, "claude", "C:\\Users\\me");
    const unavailable = await api.locate(42, "codex", "home");
    assert.equal(unavailable.state, windows ? "unavailable" : "ok");
    if (windows) {
      assert.match(unavailable.reason, /Herdr API/);
      assert.match(r.calls[0].args.at(-1), /\$budget=8192/);
      assert.ok(r.calls.every(({ args }) => !args.at(-1).includes("\\`n")), "PowerShell newline expressions contain no literal backslash");
    } else assert.deepEqual(r.calls[0].args.slice(-4), ["file.jsonl", "5", "8192", "16000"]);
  });

  test(`${platform} image services select native tools and keep external renderer failures visible`, async () => {
    const r = stub((program) => program === "sips" ? "pixelWidth: 100" : windows ? "[]" : "#112233"), api = imageApi(platform, r.run);
    assert.equal(await api.probe("image.png", "image", "png"), true);
    await api.color("image.png"); await api.fresh("cache", "key"); await api.avatars("avatars", ["one", "two"]);
    const programs = await api.chromiums();
    assert.ok(programs.includes(windows ? "msedge" : "chromium"));
    if (windows) {
      assert.ok(r.calls.every(({ program }) => program === "pwsh"));
      assert.equal(await api.probe("image.webp", "image", "webp"), true);
      assert.match(r.calls.at(-1).args.at(-1), /'WEBP'/);
      assert.ok(!r.calls.at(-1).args.at(-1).includes("System.Drawing"));
    }
    const failed = imageApi(platform, stub(() => ({ code: 1, stdout: "", stderr: "missing renderer" })).run);
    assert.equal(await failed.toPng("image.heic", "out.png"), false);
    assert.equal(await failed.firstPage("file.pdf", 800, "out.png"), false);
  });

  test(`${platform} system operations resolve host directories and container shells`, async () => {
    const r = stub(() => windows ? "C:\\Temp" : "/tmp"), api = systemApi(platform, r.run);
    assert.ok((await api.temporary()).length > 0);
    assert.equal(await api.userHome(), windows ? "C:\\Temp" : "/tmp");
    await api.hostname(); await api.hostname({ short: false }); await api.status("app"); await api.restart("app");
    if (!windows) assert.deepEqual(r.calls.filter(({ program }) => program === "hostname").map(({ args }) => args), [["-s"], []]);
    await api.startDocker(); await api.stopDocker();
    assert.deepEqual(api.containerShell("container", "windows"), ["docker", "exec", "-it", "container", "cmd.exe"]);
    assert.equal(api.containerShell("container", "linux").at(-2), "-c");
    assert.equal(api.memoryGuardAvailable, platform !== "linux");
    if (windows) {
      await api.guardRun("node", "guard.mjs", ["install"], "C:\\App");
      assert.match(r.calls.at(-1).args.at(-1), /Start-Process.*Hidden.*installerPid/s);
      await api.guardStop("node", "guard.mjs", ["123", "456:force"]);
      assert.match(r.calls.at(-1).args.at(-1), /stop-server.*123.*456.*force/s);
    }
    const battery = (text) => systemApi(platform, stub(() => text).run).battery();
    assert.equal(await battery(windows ? "Offline" : platform === "macos" ? "Battery Power" : "0\n"), true);
    assert.equal(await battery(windows ? "Online" : platform === "macos" ? "AC Power" : "1\n"), false);
  });

  test(`${platform} file walkers and migration keep names literal`, async () => {
    const target = windows ? "C:\\Users\\O'Brien\\repo" : "/home/O'Brien/repo";
    const r = stub(() => windows ? JSON.stringify([target]) : target + "\0"), api = fileApi(platform, r.run);
    assert.deepEqual(await api.walk([target], { names: [".git"], depth: 9 }), [target]);
    assert.equal(await api.recent([target], Date.now()), true);
    await api.migrate(target, "destination"); await api.touch([target]); await api.drain(target);
    if (windows) assert.ok(r.calls.every(({ program }) => program === "pwsh"));
    else assert.deepEqual(r.calls.map(({ program }) => program), ["find", "find", "sh", "touch", "sh"]);
    assert.deepEqual(await api.walk([]), []);
  });

  test(`${platform} clipboard paste validates the destination and reports failure`, async () => {
    const r = stub(() => windows ? "42" : "com.example.browser"), api = clipboardApi(platform, r.run);
    assert.equal(await api.frontApp(), platform === "linux" ? null : windows ? "42" : "com.example.browser");
    assert.equal((await api.paste(windows ? "42" : "com.example.browser")).state, "ok");
    const failed = clipboardApi(platform, stub(() => ({ code: 1, stdout: "", stderr: "blocked" })).run);
    assert.equal((await failed.paste("42")).state, "error");
    if (windows) {
      assert.equal((await api.paste("42; injected")).state, "error");
      assert.match(r.calls.at(-1).args.at(-1), /GetForegroundWindow\(\).ToInt64\(\)!=target/);
    }
  });

  test(`${platform} pet lists and imports use one platform service`, async () => {
    const r = stub(), api = petApi(platform, r.run);
    await api.list("cache", ["source", "brought"]);
    await api.bring("brought", [{ id: "cat", name: "O'Brien", url: "file:///cat.zip", zip: true }]);
    assert.equal(r.calls[0].program, windows ? "pwsh" : "sh");
    if (windows) assert.match(r.calls[1].args.at(-1), /Expand-Archive -LiteralPath/);
    else assert.deepEqual(r.calls[1].args.slice(-4), ["cat", "O'Brien", "file:///cat.zip", "zip"]);
  });

  test(`${platform} repository services dispatch through the injected runner`, async () => {
    const r = stub((_program, args) => windows ? args.includes("--show-toplevel") ? "C:/repo/.git\nC:/repo" : args.includes("--get") ? "url" : "refs" : "result");
    const api = repositoryApi(platform, r.run);
    assert.equal((await api.fingerprint("repo")).code, 0);
    if (windows) assert.ok(r.calls.every(({ program }) => program === "git"));
    else {
      await api.discover(["repo"]); await api.bases("repo"); await api.probe("repo", 0, []); await api.forget("repo", "tree");
      assert.deepEqual(r.calls.map(({ program }) => program), ["sh", "bash", "bash", "bash", "bash"]);
    }
  });
}

test("Windows session recovery verifies process identity before claiming an existing conversation", async () => {
  const r = stub((_program, args) => {
    const script = args.at(-1);
    if (script.includes("Get-CimInstance")) return JSON.stringify([{ pid: 42, name: "claude.exe", created: "2026-11-10T00:00:00Z" }]);
    if (script.includes("Get-ChildItem")) return '[{"name":"42.json","dir":false}]';
    if (script.includes("UTF8.GetString")) return '{"sessionId":"session","procStart":"2026-11-10T00:00:00Z"}';
    return "";
  });
  assert.equal(await processApi("windows", r.run).runningSession("session", "C:\\Users\\me"), 42);
  assert.equal(await processApi("windows", r.run).runningSession("different", "C:\\Users\\me"), null);
});

test("Windows session lookup keeps directory access failures distinct from an absent session", async () => {
  for (const phase of ["lookup", "read"]) {
    const r = stub((_program, args) => phase === "lookup" || args.at(-1).includes("Get-ChildItem") ? { code: 1, stdout: "", stderr: "Access denied" } : "");
    await assert.rejects(processApi("windows", r.run).runningSession("session", "C:\\Users\\me"), /Access denied/);
  }
  const missing = stub(() => ({ code: 1, stdout: "", stderr: "" }));
  assert.equal(await processApi("windows", missing.run).runningSession("session", "C:\\Users\\me"), null);
});

test("Windows Markdown waiting records survive inspection errors and remove only departed owners", async () => {
  const r = stub((_program, args) => {
    const script = args.at(-1);
    if (script.includes("Get-ChildItem")) return '[{"name":"42.path","dir":false},{"name":"43.path","dir":false}]';
    if (script.includes("Get-CimInstance")) return '[{"pid":42}]';
    if (script.includes("UTF8.GetString")) return "C:\\Users\\me\\note.md";
    return "";
  });
  assert.equal((await markdownApi("windows", r.run).waiting("reviews")).stdout, "42\tC:\\Users\\me\\note.md\0");
  assert.equal(r.calls.filter(({ args }) => args.at(-1).includes("Remove-Item")).length, 1);
  assert.deepEqual(markdownMentions('See "C:\\Users\\me\\a b.md" and /tmp/x.mdx'), ["C:\\Users\\me\\a b.md", "/tmp/x.mdx"]);
});

for (const platform of ["macos", "linux", "windows"]) {
  test(`${platform} host selection scopes remote runners and caches platform detection`, async () => {
    const r = stub((program, args) => args.at(-1).includes("OSVersion")
      ? platform === "windows" ? "Win32NT\n" : { code: 127, stdout: "", stderr: "command not found" }
      : program === "uname" ? platform === "macos" ? "Darwin\n" : "Linux\n" : platform === "windows" ? "[]" : "42 1 01:00 node");
    const { serviceOn, localName, localService } = await load("kanso-panel/platform-host.js", ["serviceOn", "localName", "localService"], { exec: r.run, window: () => ({ platform: "macos" }) });
    const remote = await serviceOn(processApi, "remote");
    await remote.list();
    const before = r.calls.length;
    await serviceOn(processApi, "remote");
    assert.equal(r.calls.length, before);
    assert.equal(r.calls.filter(({ args }) => args.at(-1).includes("OSVersion")).length, platform === "windows" ? 1 : 2);
    assert.ok(r.calls.every(({ options }) => options.on === "remote" && options.timeout === 12000));
    assert.equal(localName(), "macos");
    assert.equal((await serviceOn((_name, runner) => runner, null)), r.run);
    assert.equal(localService((name) => name), "macos");
    assert.equal(r.calls.at(-1).program, platform === "windows" ? "pwsh" : "ps");
  });
  test(`${platform} host delays preserve the requested duration`, async () => {
    const r = stub();
    const { localSleep } = await load("kanso-panel/platform-host.js", ["localSleep"], { exec: r.run, window: () => ({ platform }) });
    await localSleep(3);
    assert.equal(r.calls[0].program, platform === "windows" ? "pwsh" : "sleep");
    assert.ok(platform === "windows" ? r.calls[0].args.at(-1).includes("Start-Sleep -Milliseconds 3000") : r.calls[0].args[0] === "3");
  });
}

test("Windows paths printed by agents retain their drive, separators and spaces", async () => {
  const { mentions, resolvePath } = await load("kanso-panel/look-model.js", ["mentions", "resolvePath"]);
  assert.deepEqual(clone(mentions('Saved "C:\\My Project\\a b.png" then C:\\repo\\out.png')), ["C:\\repo\\out.png", "C:\\My Project\\a b.png"]);
  assert.equal(resolvePath("out/shot.png", "C:\\My Project", "C:\\Users\\me"), "C:\\My Project\\out\\shot.png");
});

test("Windows stopping waits the existing three seconds before forcing the same foreground process", async () => {
  let foreground = 42, elapsed = 0;
  const stops = [];
  const { stopIn } = await load("kanso-sleep/sleepwork.js", ["stopIn"], {
    window: () => ({ platform: "windows" }),
    hc: async () => ({ code: 0, stdout: JSON.stringify({ pid: 1, foreground: { pid: foreground, argv: foreground ? ["claude.exe"] : ["pwsh.exe"] } }) }),
    exec: async (program, args) => {
      assert.equal(program, "taskkill");
      stops.push({ args: clone(args), elapsed });
      if (args.includes("/F")) foreground = 0;
      return { code: 0, stdout: "" };
    },
  });
  assert.equal(await stopIn("terminal", { sleep: async (ms) => { elapsed += ms; } }, 42), true);
  assert.deepEqual(stops, [{ args: ["/PID", "42"], elapsed: 0 }, { args: ["/PID", "42", "/F"], elapsed: 3000 }]);
});

test("Windows repository operations cover discovery, safety probes and metadata removal with injected commands", async () => {
  const r = stub((program, args) => {
    if (program === "git") {
      if (args.includes("--git-common-dir")) return "C:/repo/.git\n";
      if (args.includes("--show-toplevel")) return "C:/repo\n";
      if (args.includes("--porcelain")) return "";
      if (args.includes("--absolute-git-dir")) return "C:/repo/.git/worktrees/feature\n";
      if (args.includes("symbolic-ref")) return { code: 1, stdout: "", stderr: "" };
      if (args.includes("--verify") && args.includes("--quiet")) return { code: 1, stdout: "", stderr: "" };
      if (args.includes("rev-list")) return "0\n";
      if (args.includes("log")) return "1700000000\n";
      return "";
    }
    const script = args.at(-1);
    if (script.includes("Remove-Item")) return "";
    if (script.includes("function walk")) return '["C:\\\\repo\\\\.git"]';
    if (script.includes("Get-ChildItem")) return '[{"name":"feature","dir":true}]';
    if (script.includes("UTF8.GetString")) return "C:/tree/.git\n";
    if (script.includes("ConvertTo-Json")) return "[]";
    if (script.includes("Test-Path")) {
      const exists = script.includes("'C:\\repo'") || script.includes("'C:\\worktree'") || script.includes("'C:\\repo\\.git'") || script.includes("'C:\\repo\\.git\\worktrees'") || script.includes("'C:\\tree\\.git'") || script.includes("'C:\\repo\\.git\\worktrees\\feature\\gitdir'");
      return { code: exists ? 0 : 1, stdout: "", stderr: "" };
    }
    return "";
  });
  const api = repositoryApi("windows", r.run);
  assert.match((await api.createWorktree("C:\\repo", "feature", "C:\\trees", "C:\\Users\\me")).stdout, /^made\tC:\\trees\\repo-[a-f0-9]+\\feature-[a-f0-9]+/);
  await assert.rejects(api.createWorktree("C:\\missing", "feature", "C:\\trees", "C:\\Users\\me"), /folder is not there/);
  assert.equal((await api.discover(["C:\\repo"])).stdout, "R\tC:\\repo");
  assert.match((await api.bases("C:\\repo")).stdout, /^main$/m);
  assert.equal((await api.probe("C:\\missing", 0, ["main"])).stdout, "gone");
  assert.match((await api.probe("C:\\worktree", 60, ["main"])).stdout, /^merged$/m);
  assert.equal((await api.forget("C:\\repo", "C:\\tree")).stdout, "forgot");
  await assert.rejects(api.removeOrphan("C:\\absent"), /marker is no longer a file/);
  assert.ok(r.calls.every(({ program }) => program === "git" || program === "pwsh"));
});

test("Windows recent Markdown uses clipboard paths without requiring a POSIX shell", async () => {
  const r = stub((_program, args) => args.at(-1).includes("ConvertTo-Json") ? '["C:\\\\Users\\\\me\\\\note.md"]' : "");
  const result = await markdownApi("windows", r.run).recent(null, "C:\\Users\\me", "C:\\app", '"C:\\Users\\me\\note.md"');
  assert.equal(result.stdout, "C:\\Users\\me\\note.md");
  assert.ok(r.calls.every(({ program }) => program === "pwsh"));
});

test("Windows editor discovery keeps executable paths returned by where", async () => {
  const r = stub((_program, args) => args[0] === "code" ? "C:\\Program Files\\Editor\\code.cmd\r\nC:\\other\\code.cmd\r\n" : { code: 1, stdout: "", stderr: "missing" });
  const found = await openApi("windows", r.run).detectEditors([{ id: "code", cli: ["code", "code-insiders"] }, { id: "missing", cli: ["absent"] }]);
  assert.deepEqual(found, { code: { cli: "C:\\Program Files\\Editor\\code.cmd" } });
  assert.ok(r.calls.every(({ program }) => program === "where"));
});

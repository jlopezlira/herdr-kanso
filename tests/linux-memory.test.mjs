import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdir, open, readFile, writeFile } from "node:fs/promises";
import { delimiter, dirname, join } from "node:path";
import { guardHost, linuxMemory, linuxPss, logindIdle, omarchyIdle, systemdService, systemdTimer } from "../kanso/mods/kanso-guard/guard-host.mjs";
import { clone, exec, folderWith, load, loadSystemApi, success, temporary } from "./helpers.mjs";

const systemApi = await loadSystemApi();
const { linuxPorts } = await load("kanso-panel/platform-ports.js", ["linuxPorts"]);
const { procLinks, processApi } = await load("kanso-panel/platform-processes.js", ["procLinks", "processApi"]);
const { dockerHeld } = await load("kanso-containers/model.js", ["dockerHeld"]);
const { clipboardApi, hyprlandClass } = await load("kanso-panel/platform-clipboard.js", ["clipboardApi", "hyprlandClass"]);
const { openApi } = await load("kanso-panel/platform-open.js", ["openApi"]);
const { petApi } = await load("kanso-panel/platform-pets.js", ["petApi"]);

const magick = (await exec("sh", ["-c", "command -v magick"])).stdout.trim();
const handler = new URL("../kanso/mods/kanso-tabs/markdown-handler.sh", import.meta.url);
const lines = (body) => body.join("\n");

const executable = async (dir, name, body) => {
  await mkdir(dir, { recursive: true });
  const file = join(dir, name);
  await writeFile(file, body.endsWith("\n") ? body : body + "\n");
  await chmod(file, 0o755);
  return file;
};
const shell = (bin, extra = {}) => (command, args) => exec(command === "sh" ? "/bin/sh" : command, args, { env: { ...process.env, PATH: bin + delimiter + (process.env.PATH ?? ""), ...extra } });

test("Proportional memory is the Pss line in kilobytes, and machine memory comes from meminfo", () => {
  assert.equal(linuxPss("Rss: 100 kB\nPss: 2048 kB\n"), 2048);
  assert.equal(linuxPss("Pss: 0 kB\n"), 0);
  assert.equal(linuxPss(""), null);
  assert.deepEqual(linuxMemory("MemTotal: 1024 kB\nMemAvailable: 512 kB\nSwapTotal: 2048 kB\nSwapFree: 1024 kB\n"), { totalMB: 1, freePct: 50, swapMB: 1, swapTotalMB: 2 });
});

test("Omarchy idle is zero until the shell says idle, and logind idle is zero until IdleHint is yes", () => {
  assert.equal(omarchyIdle('{"idle":false,"screensaver":45}'), 0);
  assert.equal(omarchyIdle('{"idle":true,"screensaver":45}'), 45);
  const now = 1_000_000_000_000;
  const since = String((now - 5000) * 1000);
  assert.equal(logindIdle("IdleHint=no\nIdleSinceHint=" + since + "\n", now), 0);
  assert.equal(logindIdle("IdleHint=yes\nIdleSinceHint=" + since + "\n", now), 5);
});

test("The systemd user service quotes its paths, escapes quotes and percent signs, and the timer repeats every 60 seconds", () => {
  const unit = systemdService({ node: "/usr/bin/node", self: "/opt/kanso guard 100%.mjs", appHome: '/home/jj/my "herdr"', log: "/var/log/kanso 5%.log" });
  assert.ok(unit.includes('ExecStart="/usr/bin/node" "/opt/kanso guard 100%%.mjs" check'));
  assert.ok(unit.includes('Environment="HERDR_APP_HOME=/home/jj/my \\"herdr\\""'));
  assert.ok(unit.includes("StandardOutput=append:/var/log/kanso 5%%.log"));
  assert.match(systemdTimer(), /OnUnitActiveSec=60s/);
});

test("Memory is available on Linux, and the window pid is the one ss reports for the socket", async () => {
  assert.equal(systemApi("linux", () => success("")).memoryGuardAvailable, true);
  const host = guardHost({
    platform: "linux", appHome: "/app", home: "/home/jj", self: "/mod/guard.mjs", node: "/usr/bin/node",
    run: async (command, args) => {
      assert.deepEqual([command, args], ["ss", ["-xlpH", "src", "/app/herdr-app.sock"]]);
      return success('u_str LISTEN 0 128 /app/herdr-app.sock 0 users:(("herdr-app",pid=4242,fd=8))\n');
    },
  });
  assert.equal(host.available, true);
  assert.deepEqual(await host.window(), { pid: 4242 });
});

test("ss lines give each user its port, including an IPv6 socket, and a line with no users adds none", () => {
  const text = [
    'LISTEN 0 128 0.0.0.0:22 0.0.0.0:* users:(("sshd",pid=100,fd=3),("sshd",pid=101,fd=3))',
    'LISTEN 0 511 [::]:443 [::]:* users:(("nginx",pid=200,fd=6))',
    "LISTEN 0 128 127.0.0.1:3000 0.0.0.0:*",
  ].join("\n");
  const got = [...linuxPorts(text)].map(([pid, row]) => [pid, row.command, row.ports]);
  assert.deepEqual(clone(got), [[100, "sshd", [22]], [101, "sshd", [22]], [200, "nginx", [443]]]);
});

test("A proc link line is a pid and the path after the first tab", () => {
  assert.deepEqual(clone(procLinks("12\t/tmp/work\n0\t/no\nbad\n")), [{ pid: 12, path: "/tmp/work" }]);
});

test("Linux reads this process's working directory and open files from /proc", { skip: process.platform !== "linux" && "Linux /proc" }, async (t) => {
  const dir = await temporary(t);
  const note = join(dir, "note.txt");
  await writeFile(note, "x");
  const handle = await open(note, "r");
  const previous = process.cwd();
  process.chdir(dir);
  try {
    const api = processApi("linux", (command, args) => exec(command, args));
    const cwd = await api.cwd([process.pid]);
    assert.equal(cwd.state, "ok");
    assert.equal(cwd.values.get(process.pid), dir);
    const files = await api.openFiles([process.pid]);
    assert.equal(files.state, "ok");
    assert.ok(files.values.some((row) => row.pid === process.pid && row.path === note));
  } finally {
    process.chdir(previous);
    await handle.close();
  }
});

test("Docker's engine processes count, and Docker Desktop on macOS still counts", () => {
  const rows = [[1, 102400, "dockerd"], [2, 51200, "containerd"], [3, 20480, "containerd-shim-runc-v2"], [4, 10240, "docker-proxy"], [5, 30720, "rootlesskit"], [6, 111600, "/Applications/Docker.app/Contents/MacOS/com.docker.backend"], [7, 500000, "Safari"]];
  const text = rows.map((row) => row[0] + " " + row[1] + " " + row[2]).join("\n");
  assert.equal(dockerHeld(text), rows.filter((row) => row[2] !== "Safari").reduce((sum, row) => sum + row[1] / 1024, 0));
});

test("A paste aimed at another front class does not type, and Hyprland's class is the window class", async () => {
  assert.equal(hyprlandClass('{"class":"Code"}'), "Code");
  assert.equal(hyprlandClass("not json"), null);
  const calls = [];
  const api = clipboardApi("linux", async (program, args) => {
    calls.push([program, args]);
    if (program === "hyprctl") return success(JSON.stringify({ class: "Code" }));
    if (program === "wtype") return success("");
    return { code: 1, stdout: "", stderr: "missing" };
  });
  assert.deepEqual(clone(await api.paste("Obsidian")), { state: "error" });
  assert.equal(calls.some(([program]) => program === "wtype"), false);
  assert.deepEqual(clone(await api.paste("Code")), { state: "ok" });
  assert.deepEqual(clone(calls.filter(([program]) => program === "wtype")), [["wtype", ["-M", "ctrl", "-k", "v", "-m", "ctrl"]]]);
});

test("Linux Docker starts the user unit when systemctl --user cat succeeds, and otherwise asks docker info", async (t) => {
  const dir = await temporary(t);
  const log = join(dir, "log");
  const bin = join(dir, "bin");
  const docker = lines(["#!/bin/sh", "echo \"docker $*\" >> \"$LOG\"", "exit 0"]);
  const unit = lines(["#!/bin/sh", "echo \"systemctl $*\" >> \"$LOG\"", "[ \"$2\" = cat ] && [ \"$3\" = docker.service ] && exit 0", "exit 1"]);
  const none = lines(["#!/bin/sh", "echo \"systemctl $*\" >> \"$LOG\"", "[ \"$2\" = cat ] && exit 1", "exit 0"]);
  await executable(bin, "docker", docker);
  await executable(bin, "systemctl", unit);
  const run = shell(bin, { LOG: log });
  await systemApi("linux", run).startDocker();
  assert.match(await readFile(log, "utf8"), /systemctl --user start docker/);
  assert.doesNotMatch(await readFile(log, "utf8"), /docker info/);
  await writeFile(log, "");
  await executable(bin, "systemctl", none);
  await systemApi("linux", run).startDocker();
  const after = await readFile(log, "utf8");
  assert.match(after, /docker info/);
  assert.doesNotMatch(after, /systemctl start docker/);
});

test("An editor icon is found from a desktop file and written as a 64 px png", { skip: !magick && "needs magick" }, async (t) => {
  const dir = await temporary(t);
  const xdg = join(dir, "share");
  const out = join(dir, "out");
  await mkdir(join(xdg, "icons/hicolor/64x64/apps"), { recursive: true });
  await mkdir(join(xdg, "applications"), { recursive: true });
  await exec(magick, ["-size", "8x8", "xc:red", join(xdg, "icons/hicolor/64x64/apps/code.png")]);
  await writeFile(join(xdg, "applications/code.desktop"), "[Desktop Entry]\nExec=code %F\nIcon=code\n");
  const env = { ...process.env, XDG_DATA_HOME: xdg, HOME: dir, PATH: dirname(magick) + delimiter + (process.env.PATH ?? "") };
  const api = openApi("linux", (command, args) => exec(command === "sh" ? "/bin/sh" : command, args, { env }));
  assert.deepEqual(clone(await api.editorIcons({ code: { cli: "code" } }, out)), ["code"]);
  const png = await readFile(join(out, "code.png"));
  assert.equal(png.readUInt32BE(16), 64);
  assert.equal(png.readUInt32BE(20), 64);
});

test("A pet atlas converts with magick when sips is not installed", { skip: !magick && "needs magick" }, async (t) => {
  const dir = await temporary(t);
  const source = join(dir, "pets/rocky");
  const out = join(dir, "out");
  await mkdir(source, { recursive: true });
  await exec(magick, ["-size", "8x8", "xc:blue", join(source, "spritesheet.png")]);
  await writeFile(join(source, "pet.json"), "{\"displayName\":\"Rocky\"}\n");
  const env = { ...process.env, PATH: dirname(magick) + delimiter + "/bin" };
  assert.notEqual((await exec("/bin/sh", ["-c", "command -v sips"], { env })).code, 0);
  const listed = await petApi("linux", (command, args) => exec(command === "sh" ? "/bin/sh" : command, args, { env })).list(out, [join(dir, "pets")]);
  assert.equal(listed.code, 0);
  assert.match(listed.stdout, /rocky\trocky\.png/);
  assert.equal((await readFile(join(out, "rocky.png"))).subarray(1, 4).toString(), "PNG");
});

test("Linux Markdown install records the previous default and uninstall restores it", async (t) => {
  const { dir, bin } = await folderWith(t, "bin");
  const log = join(dir, "xdg.log");
  const state = join(dir, "default");
  const home = join(dir, "home");
  const data = join(dir, "data");
  const config = join(dir, "config");
  const app = join(dir, "herdr");
  await executable(bin, "uname", "#!/bin/sh\necho Linux\n");
  await executable(bin, "xdg-mime", lines([
    "#!/bin/sh",
    "printf '%s\\n' \"$*\" >> \"$LOG\"",
    "if [ \"$1\" = query ]; then",
    "  if [ -s \"$STATE\" ]; then cat \"$STATE\"; else printf '%s\\n' obsidian.desktop; fi",
    "else",
    "  printf '%s\\n' \"$2\" > \"$STATE\"",
    "fi",
    "exit 0",
  ]));
  const env = { ...process.env, PATH: [bin, "/bin", "/usr/bin"].join(delimiter), HOME: home, XDG_DATA_HOME: data, XDG_CONFIG_HOME: config, HERDR_APP_HOME: app, LOG: log, STATE: state };
  const run = (args) => exec("/bin/sh", [handler.pathname, ...args], { env });
  const installed = await run(["install"]);
  assert.equal(installed.code, 0, installed.stderr);
  const desktop = join(data, "applications/dev.kanso.markdown.desktop");
  const opener = join(app, "data/kanso-markdown/open.sh");
  assert.match(await readFile(opener, "utf8"), /data\/kanso-open/);
  assert.equal((await readFile(join(app, "data/kanso-markdown-previous"), "utf8")).trim(), "obsidian.desktop");
  const removed = await run(["uninstall"]);
  assert.equal(removed.code, 0, removed.stderr);
  await assert.rejects(readFile(desktop, "utf8"));
  const recorded = await readFile(log, "utf8");
  assert.match(recorded, /default dev\.kanso\.markdown\.desktop text\/markdown text\/x-markdown/);
  assert.match(recorded, /default obsidian\.desktop text\/markdown text\/x-markdown/);
});

import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdir, open, readFile, stat, writeFile } from "node:fs/promises";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { guardHost, linuxMemory, linuxPss, logindIdle, omarchyIdle, systemdService, systemdTimer } from "../kanso/mods/kanso-guard/guard-host.mjs";
import { arg, clone, context, exec, failure, find, folderWith, gpuiHost, KIT_NIGHT, load, loadSystemApi, success, temporary, texts } from "./helpers.mjs";
import { loadSettings } from "./mod-fixtures.mjs";
import { fieldState } from "./pr-fixtures.mjs";

const systemApi = await loadSystemApi();
const { linuxPorts } = await load("kanso-panel/platform-ports.js", ["linuxPorts"]);
const { procLinks, processApi } = await load("kanso-panel/platform-processes.js", ["procLinks", "processApi"]);
const { dockerHeld } = await load("kanso-containers/model.js", ["dockerHeld"]);
const { browserClasses, clipboardApi, hyprlandClass } = await load("kanso-panel/platform-clipboard.js", ["browserClasses", "clipboardApi", "hyprlandClass"]);
const { openApi } = await load("kanso-panel/platform-open.js", ["openApi"]);
const { petApi } = await load("kanso-panel/platform-pets.js", ["petApi"]);

const unixOnly = process.platform === "win32" && "its sh stubs run on macOS and Linux";
const magick = !unixOnly && (await exec("sh", ["-c", "command -v magick"])).stdout.trim();
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
      assert.deepEqual([command, args], ["ss", ["-xlpH", "src", join("/app", "herdr-app.sock")]]);
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
    const pids = [process.pid, 999999];
    const cwd = await api.cwd(pids);
    assert.equal(cwd.state, "ok");
    assert.equal(cwd.values.get(process.pid), dir);
    assert.equal(cwd.values.has(999999), false);
    const files = await api.openFiles(pids);
    assert.equal(files.state, "ok");
    assert.ok(files.values.some((row) => row.pid === process.pid && row.path === note));
    assert.equal(files.values.some((row) => row.pid === 999999), false);
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

test("Linux paste types only when the front window is the default browser", async () => {
  const browsers = browserClasses("Google-chrome\n firefox \n");
  assert.equal(browsers.size, 2);
  assert.equal(browsers.has("google-chrome"), true);
  assert.equal(browsers.has("firefox"), true);
  assert.equal(hyprlandClass('{"class":"Code"}'), "Code");
  assert.equal(hyprlandClass("not json"), null);
  const typed = (calls) => calls.some((program) => program === "wtype" || program === "xdotool");
  const lookupFirst = (calls) => { const sh = calls.indexOf("sh"), hypr = calls.indexOf("hyprctl"); return sh >= 0 && (hypr < 0 || sh < hypr); };
  const paste = async (window, target, { afterSh, wtypeFails = false } = {}) => {
    const calls = [];
    let front = window;
    const api = clipboardApi("linux", async (program) => {
      calls.push(program);
      if (program === "sh") { if (afterSh) front = afterSh; return success("google-chrome\nGoogle-chrome\n"); }
      if (program === "hyprctl") return success(JSON.stringify(front));
      if (program === "wtype") { if (wtypeFails) { front = { class: "Alacritty" }; return { code: 1, stdout: "", stderr: "missed" }; } return success(""); }
      if (program === "xdotool") return success("");
      return { code: 1, stdout: "", stderr: "missing" };
    });
    return { result: clone(await api.paste(target)), calls };
  };
  for (const target of ["Alacritty", undefined]) {
    const missed = await paste({}, target);
    assert.deepEqual(missed.result, { state: "error" });
    assert.equal(typed(missed.calls), false);
  }
  const terminal = await paste({ class: "Alacritty" }, "Alacritty");
  assert.deepEqual(terminal.result, { state: "error" });
  assert.equal(typed(terminal.calls), false);
  assert.equal(terminal.calls.includes("sh"), true);
  const browser = await paste({ class: "google-chrome" }, "google-chrome");
  assert.deepEqual(browser.result, { state: "ok" });
  assert.equal(browser.calls.includes("wtype"), true);
  assert.equal(browser.calls.includes("xdotool"), false);
  assert.equal(lookupFirst(browser.calls), true);
  const switched = await paste({ class: "google-chrome" }, "google-chrome", { afterSh: { class: "Alacritty" } });
  assert.deepEqual(switched.result, { state: "error" });
  assert.equal(typed(switched.calls), false);
  assert.equal(lookupFirst(switched.calls), true);
  const missedKey = await paste({ class: "google-chrome" }, "google-chrome", { wtypeFails: true });
  assert.deepEqual(missedKey.result, { state: "error" });
  assert.equal(missedKey.calls.includes("wtype"), true);
  assert.equal(missedKey.calls.includes("xdotool"), false);
  assert.equal(lookupFirst(missedKey.calls), true);
});

test("The Linux working-directory and open-file scripts end with exit 0", async () => {
  const scripts = [];
  const api = processApi("linux", async (command, args) => {
    assert.equal(command, "sh");
    scripts.push(args[1]);
    return success("");
  });
  assert.equal((await api.cwd([1])).state, "ok");
  assert.equal((await api.openFiles([1])).state, "ok");
  assert.deepEqual(scripts.map((script) => script.endsWith("exit 0")), [true, true]);
});

test("Linux Docker starts the user unit when systemctl --user cat succeeds, and otherwise asks docker info", { skip: unixOnly }, async (t) => {
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

test("An editor icon is found from a desktop file and written as a 64 px png", { skip: unixOnly || (!magick && "needs magick") }, async (t) => {
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

test("A pet atlas converts with magick when sips is not installed", { skip: unixOnly || (!magick && "needs magick") }, async (t) => {
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

const markdownDesktop = "dev.kanso.markdown.desktop";
const openerFolder = "kanso-markdown";
const openerFile = "open.sh";
const markdownDefaults = {
  "text/markdown": "obsidian.desktop",
  "text/x-markdown": "omawrite.desktop",
  "text/plain": "text-editor.desktop",
};
const mimeTypes = Object.keys(markdownDefaults);
const mimeState = (overrides = {}) => Object.entries({ ...markdownDefaults, ...overrides })
  .map(([type, app]) => type + " " + app + "\n").join("");
const kansoDefaults = Object.fromEntries(mimeTypes.map((type) => [type, markdownDesktop]));

const desktopLines = async (path) => (await readFile(path, "utf8")).split("\n");
const desktopExec = async (path) => (await desktopLines(path)).find((line) => line.startsWith("Exec="));

const linuxMarkdown = async (t, { dataName = "data", appName = "app" } = {}) => {
  const { dir, bin, home, config, log, state, launched } = await folderWith(
    t, "bin", "home", "config", "log", "state", "launched",
  );
  const data = join(dir, dataName);
  const app = join(dir, appName);
  const programs = {
    uname: "echo Linux",
    pgrep: "exit 1",
    "herdr-app": "exit 1",
    "update-desktop-database": "exit 0",
    "gtk-launch": "printf '%s\\n' \"$@\" >> \"$LAUNCHED\"",
    "xdg-mime": lines([
      "printf '%s\\n' \"$*\" >> \"$LOG\"",
      "if [ \"$1\" = query ]; then awk -v type=\"$3\" '$1 == type { print $2 }' \"$STATE\"; exit 0; fi",
      "desk=$2; shift 2",
      "for type in \"$@\"; do awk -v type=\"$type\" -v desk=\"$desk\" '$1 == type { $2 = desk } { print }' \"$STATE\" > \"$STATE.next\"; mv \"$STATE.next\" \"$STATE\"; done",
    ]),
  };
  for (const [name, body] of Object.entries(programs)) await executable(bin, name, "#!/bin/sh\n" + body);
  await writeFile(state, mimeState());
  const env = {
    PATH: [bin, "/bin", "/usr/bin"].join(delimiter), HOME: home, XDG_DATA_HOME: data,
    XDG_CONFIG_HOME: config, HERDR_APP_HOME: app, TMPDIR: dir, LOG: log, STATE: state, LAUNCHED: launched,
  };
  const run = async (verb) => {
    const result = await exec("/bin/sh", [fileURLToPath(handler), verb], { env });
    assert.equal(result.code, 0, result.stderr);
    return result.stdout.trim();
  };
  return {
    dir, env, launched, log, run, state,
    desktop: join(data, "applications", markdownDesktop),
    opener: join(data, openerFolder, openerFile),
    previous: join(app, "data", "kanso-markdown-previous"),
  };
};

test("Turning on the Omarchy opener covers Markdown and plain text, and turning it off restores each app", { skip: unixOnly }, async (t) => {
  const { desktop, log, previous, run, state } = await linuxMarkdown(t);
  await run("install");
  assert.ok((await desktopLines(desktop)).includes("MimeType=" + mimeTypes.join(";") + ";"));
  assert.equal(await readFile(state, "utf8"), mimeState(kansoDefaults));
  assert.equal(await readFile(previous, "utf8"), mimeState());
  assert.equal(await run("status"), "on");

  await run("install");
  assert.equal(await readFile(previous, "utf8"), mimeState());
  assert.equal(await run("uninstall"), "Markdown files open in obsidian.desktop again.");
  assert.equal(await readFile(state, "utf8"), mimeState());
  assert.equal(await run("status"), "off");
  await assert.rejects(readFile(desktop, "utf8"), { code: "ENOENT" });

  const defaults = (await readFile(log, "utf8")).split("\n").filter((line) => line.startsWith("default "));
  const register = ["default", markdownDesktop, ...mimeTypes].join(" ");
  const restore = mimeTypes.map((type) => `default ${markdownDefaults[type]} ${type}`);
  assert.deepEqual(defaults.toSorted(), [register, register, ...restore].toSorted());
});

test("The previous Omarchy opener shows as off until kansō is set to open every supported file type", { skip: unixOnly }, async (t) => {
  const { desktop, env, previous, run, state } = await linuxMarkdown(t);
  const type = "text/markdown";
  const oldOpener = await executable(join(env.HERDR_APP_HOME, "data", openerFolder), openerFile, "#!/bin/sh\nexit 0");
  await mkdir(dirname(desktop), { recursive: true });
  await writeFile(desktop, lines(["[Desktop Entry]", "Type=Application", "Name=Kanso Markdown", `Exec=${oldOpener} %f`, `MimeType=${type};`, ""]));
  await writeFile(previous, `${type} ${markdownDefaults[type]}\n`);
  await writeFile(state, mimeState({ [type]: markdownDesktop }));

  assert.equal(await run("status"), "off");
  await run("install");
  assert.equal(await readFile(state, "utf8"), mimeState(kansoDefaults));
  assert.equal(await run("status"), "on");
});

for (const [dataName, quoted, title] of [
  ["data", false, "The Omarchy opener path stays unquoted when only the app home contains a space"],
  ["shared data", true, "The Omarchy opener path is double-quoted when the data folder contains a space"],
]) {
  test(title, { skip: unixOnly }, async (t) => {
    const { desktop, opener, run } = await linuxMarkdown(t, { dataName, appName: "app home" });
    await run("install");
    const execPath = quoted ? `"${opener}"` : opener;
    assert.equal(await desktopExec(desktop), `Exec=${execPath} %f`);
    assert.ok((await stat(opener)).isFile());
    await run("uninstall");
    await assert.rejects(stat(dirname(opener)), { code: "ENOENT" });
  });
}

test("Turning off the Omarchy opener keeps defaults changed by the user", { skip: unixOnly }, async (t) => {
  const { run, state } = await linuxMarkdown(t);
  await run("install");
  const changes = { "text/markdown": "other-notes.desktop", "text/x-markdown": "other-markdown.desktop" };
  await writeFile(state, mimeState({ ...kansoDefaults, ...changes }));
  assert.equal(await run("uninstall"), "Markdown files open in other-notes.desktop again.");
  assert.equal(await readFile(state, "utf8"), mimeState(changes));
});

test("With kansō closed, Omarchy opens a Markdown file and a text file in their respective previous apps", { skip: unixOnly }, async (t) => {
  const { desktop, dir, env, launched, run } = await linuxMarkdown(t);
  await run("install");
  const opener = (await desktopExec(desktop)).slice("Exec=".length, -" %f".length);
  assert.match(await readFile(opener, "utf8"), /data\/kanso-open/);
  const documents = [["meeting notes.md", "text/markdown"], ["todo list.txt", "text/plain"]];
  const paths = documents.map(([name]) => join(dir, name));
  for (const path of paths) {
    await writeFile(path, "A note\n");
    const result = await exec(opener, [path], { env });
    assert.equal(result.code, 0, result.stderr);
  }
  const expected = documents.flatMap(([, type], i) => [markdownDefaults[type].replace(/\.desktop$/, ""), paths[i]]);
  assert.equal(await readFile(launched, "utf8"), lines([...expected, ""]));
});

const markdownLabel = {
  linux: "Open .md and text files in kansō",
  macos: "Open .md files in kansō",
};

const markdownSettings = async (t, platform, responses = []) => {
  const appHome = "/tmp/kanso settings app";
  const script = appHome + "/mods/kanso-tabs/markdown-handler.sh";
  const replies = responses.values();
  const command = t.mock.fn(async () => replies.next().value ?? failure("Unexpected Markdown command"));
  const { Settings } = await loadSettings({
    ...gpuiHost(),
    InputState: { new: fieldState },
    window: () => ({ platform }),
    props: () => ({ page: "pieces" }),
    theme: () => KIT_NIGHT,
    appHome: () => appHome,
    readTextFile: async () => null,
    exec: (program, args) => args[0] === "-c" || program === "security" || program === "cmdkey"
      ? Promise.resolve(failure("No secret store"))
      : command(program, args),
  });
  const { cx, drain } = context();
  const settings = new Settings();
  settings.init({}, cx);
  await drain();
  const page = () => settings.render();
  const toggle = (drawn = page()) => find(drawn, (el) => el.tag === "markdown-opener");
  return {
    page, toggle,
    type: (query) => settings.find.state.type(query, cx),
    calls: () => clone(command.mock.calls.map((call) => call.arguments)),
    expected: (...verbs) => verbs.map((verb) => ["sh", [script, verb]]),
    change: async (on) => {
      const control = toggle();
      assert.ok(control, "The .md opener switch is visible");
      const change = arg(control, "on_change");
      assert.equal(typeof change, "function", "The .md opener switch is enabled");
      change(on, cx);
      await drain();
    },
  };
};

for (const [platform, name] of Object.entries({ linux: "Linux", macos: "macOS" })) {
  test(`On ${name}, Settings switches .md files between kansō and the previous app`, async (t) => {
    const settings = await markdownSettings(t, platform, [
      success("on\n"), success("Restored"), success("off\n"), success("Installed"), success("on\n"),
    ]);
    assert.ok(texts(settings.page()).includes(markdownLabel[platform]), markdownLabel[platform]);
    assert.equal(arg(settings.toggle(), "pressed"), true);
    await settings.change(false);
    assert.equal(arg(settings.toggle(), "pressed"), false);
    await settings.change(true);
    assert.equal(arg(settings.toggle(), "pressed"), true);
    assert.deepEqual(settings.calls(), settings.expected("status", "uninstall", "status", "install", "status"));
  });
}

for (const [query, matches, title] of [
  ["text files", true, "Find shows the opener without an empty message when only the opener matches"],
  ["zzzz", false, "Find hides the opener and says no piece matches when nothing matches"],
]) {
  test(title, async (t) => {
    const settings = await markdownSettings(t, "linux", [success("off\n")]);
    settings.type(query);
    const page = settings.page();
    assert.equal(find(page, (el) => arg(el, "id")?.startsWith("piece-row-")), null);
    assert.equal(Boolean(settings.toggle(page)), matches, "The opener switch is shown only when it matches");
    assert.equal(texts(page).includes("No piece matches."), !matches);
  });
}

test("The opener switch shows on and is disabled while kansō sets the default app", async (t) => {
  const { promise, resolve } = Promise.withResolvers();
  const settings = await markdownSettings(t, "linux", [success("off\n"), promise, success("on\n")]);
  assert.equal(arg(settings.toggle(), "pressed"), false, "The opener starts off");
  const pending = settings.change(true);
  try {
    assert.deepEqual(settings.calls(), settings.expected("status", "install"));
    const toggle = settings.toggle();
    assert.equal(arg(toggle, "disabled"), true);
    assert.equal(arg(toggle, "pressed"), true);
  } finally {
    resolve(success("Installed"));
    await pending;
  }
});

test("Settings shows the last error line if .md files cannot be set to open in kansō", async (t) => {
  const detail = "Trying to register the opener";
  const error = "Could not set the default app";
  const settings = await markdownSettings(t, "linux", [success("off\n"), failure(detail + "\n" + error + "\n"), success("off\n")]);
  await settings.change(true);
  const rendered = texts(settings.page());
  assert.ok(rendered.includes(error));
  assert.ok(!rendered.some((word) => word.includes(detail)));
  assert.equal(arg(settings.toggle(), "pressed"), false);
  assert.deepEqual(settings.calls(), settings.expected("status", "install", "status"));
});

test("Settings does not offer to open .md files in kansō on Windows", async (t) => {
  const settings = await markdownSettings(t, "windows");
  const rendered = texts(settings.page());
  assert.ok(Object.values(markdownLabel).every((label) => !rendered.includes(label)));
  assert.equal(settings.toggle(), null);
  assert.deepEqual(settings.calls(), []);
});

// Containers: what Docker says, read into rows, and which Kanso project each is for.
import { loadContainers } from "./mod-fixtures.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { load, clone, failure, success, gpuiHost, texts, find, calls } from "./helpers.mjs";

const model = () => load("kanso-containers/model.js", ["parseContainers", "hostPorts", "health", "projectOf", "byProject", "parseImages", "imageRows",
  "parseImageIds", "contextOf", "sizeMB", "memMB", "parseStats", "vmPids", "dockerVms", "dockerHeld", "since", "size", "daemonDown", "OTHER"]);
const row = (...f) => f.join("\t");
const PS = [
  row("8362461c1aa3", "fluenty-wa-ci-pg", "running", "Up 45 hours", "postgres:17-alpine", "127.0.0.1:55432->5432/tcp", "<no value>", "<no value>", "<no value>"),
  row("aa11", "web-1", "exited", "Exited (1) 3 minutes ago", "kanzo-web", "", "kanzo", "/Users/me/Apps/kanzo/app", "web"),
  row("bb22", "db-1", "running", "Up 2 days (healthy)", "postgres:16", "0.0.0.0:5432->5432/tcp, :::5432->5432/tcp", "kanzo", "/Users/me/Apps/kanzo/app", "db"),
  row("cc33", "stray", "exited", "Exited (0) 2 weeks ago", "busybox", "", "<no value>", "<no value>", "<no value>"),
].join("\n");
const PROJECTS = [{ name: "fluenty", folder: "/Users/me/Apps/fluenty" }, { name: "kanzo", folder: "/Users/me/Apps/kanzo" }, { name: "kanzo-app", folder: "/Users/me/Apps/kanzo/app" }];

test("docker ps rows: names, state, the ports reachable from here once each, compose labels", async () => {
  const m = await model();
  const list = clone(m.parseContainers(PS));
  assert.equal(list.length, 4);
  assert.deepEqual(list[0].ports, [{ port: 55432, inside: 5432, proto: "tcp" }]);
  assert.deepEqual(list[2].ports.map((p) => p.port), [5432], "IPv4 and IPv6 of one port are one");
  assert.equal(list[0].compose, null, "<no value> is no label");
  assert.equal(list[1].service, "web");
  assert.deepEqual(clone(m.hostPorts("5432/tcp")), [], "a port not published is not reachable");
});

test("each container's health: running, failed with an error, stopped", async () => {
  const m = await model();
  assert.deepEqual(clone(m.parseContainers(PS).map((c) => m.health(c))), ["running", "failed", "running", "stopped"]);
  assert.equal(m.health({ state: "restarting", status: "Restarting (1) 2 seconds ago" }), "busy");
  assert.equal(m.since({ status: "Exited (1) 3 minutes ago" }), "failed (1) 3 minutes ago");
  assert.equal(m.since({ status: "Exited (0) 2 weeks ago" }), "stopped 2 weeks ago");
  assert.equal(m.since({ status: "Up 45 hours" }), "up 45 hours");
});

test("a container's project: the deepest folder holding its compose file, else its name, else Other", async () => {
  const m = await model();
  const [pg, web, , stray] = m.parseContainers(PS);
  assert.equal(m.projectOf(web, PROJECTS), "kanzo-app", "the deepest folder wins");
  assert.equal(m.projectOf(pg, PROJECTS), "fluenty", "fluenty-wa-ci-pg starts with fluenty");
  assert.equal(m.projectOf(stray, PROJECTS), m.OTHER);
  const kanso = [{ name: "kanso-web", folder: "/a" }, { name: "kanso-api", folder: "/b" }];
  assert.equal(m.projectOf({ name: "kanso-api-db" }, kanso), "kanso-api", "the project whose whole name starts it");
  assert.equal(m.projectOf({ name: "kanso-db" }, kanso), m.OTHER, "a shared first word alone is no project");
  assert.equal(m.projectOf({ name: "x", compose: "shop", dir: "/srv/shop" }, PROJECTS), "shop", "a compose folder Kanso doesn't know is named by its folder");
});

test("grouped by project: running ones first, Other last", async () => {
  const m = await model();
  const groups = clone(m.byProject(m.parseContainers(PS), PROJECTS));
  assert.deepEqual(groups.map((g) => [g.project, g.running, g.containers.map((c) => c.name)]),
    [["fluenty", 1, ["fluenty-wa-ci-pg"]], ["kanzo-app", 1, ["db-1", "web-1"]], [m.OTHER, 0, ["stray"]]]);
});

test("images: what uses each, the unused ones last to keep and first to remove", async () => {
  const m = await model();
  const images = m.parseImages([row("sha256:1111aaaa2222", "postgres", "17-alpine", "415MB", "2 days ago"),
    row("sha256:3333bbbb4444", "debian", "stable-slim", "140MB", "3 days ago"), row("sha256:5555cccc6666", "busybox", "latest", "4.3MB", "1 year ago")].join("\n"));
  const rows = clone(m.imageRows(images, m.byProject(m.parseContainers(PS), PROJECTS)));
  assert.deepEqual(rows.map((i) => [i.name, i.unused, i.users]), [
    ["postgres:17-alpine", false, ["fluenty-wa-ci-pg"]], ["busybox:latest", false, ["stray"]], ["debian:stable-slim", true, []]]);
  const two = m.parseImages([row("sha256:9999", "app", "latest", "100MB", "1 day ago"), row("sha256:9999", "app", "stable", "100MB", "1 day ago")].join("\n"));
  const [app] = clone(m.imageRows(two, m.byProject(m.parseContainers(row("dd44", "app-1", "running", "Up 1 minute", "app", "", "", "", "")), PROJECTS)));
  assert.deepEqual([app.name, app.unused, app.mb, app.tags], ["app:latest, app:stable", false, 100, ["app:latest", "app:stable"]], "one image under two tags: used, counted once");
  const [untagged] = clone(m.parseImages(row("sha256:abcdef1234567890", "alpine", "<none>", "8MB", "1 day ago")));
  assert.deepEqual([untagged.name, untagged.tags], ["alpine (untagged)", ["abcdef123456"]], "removed by id, never as alpine:latest");
  const digest = m.parseImages(row("sha256:feed0000aaaa1111", "alpine", "<none>", "8MB", "1 day ago"));
  const onDigest = m.byProject([{ ...m.parseContainers(row("ee55", "job", "running", "Up 1 minute", "alpine", "", "", "", ""))[0], imageId: "feed0000aaaa1111" }], PROJECTS);
  assert.equal(clone(m.imageRows(digest, onDigest))[0].unused, false, "matched by the image id Docker gave the container, whatever name it shows");
  assert.equal(clone([...m.parseImageIds(row("ee55ee55ee55ffff", "sha256:feed0000aaaa1111"))])[0][1], "feed0000aaaa1111");
  assert.deepEqual(clone(m.contextOf("desktop-linux\tunix:///Users/me/.docker/run/docker.sock")), { name: "desktop-linux", host: "unix:///Users/me/.docker/run/docker.sock", remote: false });
  assert.equal(m.contextOf("prod\tssh://me@server").remote, true, "another machine's Docker is said to be");
  assert.equal(m.sizeMB("1.2GB"), 1200);
  assert.equal(m.size(415), "415 MB");
  assert.equal(m.size(1500), "1.5 GB");
});

test("memory: each container's, and what Docker and its VM hold on this computer", async () => {
  const m = await model();
  assert.equal(Math.round(m.memMB("170.5MiB / 3.828GiB")), 179);
  assert.equal(Math.round(clone([...m.parseStats(row("8362461c1aa3ffff", "1GiB / 4GiB"))])[0][1]), 1074);
  const VMBIN = "/System/Library/Frameworks/Virtualization.framework/Versions/A/XPCServices/com.apple.Virtualization.VirtualMachine.xpc/Contents/MacOS/com.apple.Virtualization.VirtualMachine";
  const ps = [`66821 389760 ${VMBIN}`, `70000 1048576 ${VMBIN}`, "66763 111600 /Applications/Docker.app/Contents/MacOS/com.docker.backend", "500 500000 /Applications/Safari.app/Contents/MacOS/Safari"].join("\n");
  assert.deepEqual(clone(m.vmPids(ps)), [66821, 70000]);
  const vms = m.dockerVms(["p66821", "n/Applications/Docker.app/Contents/Resources/linuxkit/kernel", "p70000", "n/Users/me/VMs/ubuntu.img"].join("\n"));
  assert.deepEqual(clone([...vms]), [66821], "only the VM with Docker's disk open is Docker's");
  assert.equal(Math.round(m.dockerHeld(ps, vms)), 490, "Docker's VM and app, not another VM nor the rest");
});

test("Docker installed but its daemon not running is told apart from any other failure", async () => {
  const m = await model();
  assert.equal(m.daemonDown({ code: 1, stderr: "Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?" }), true);
  assert.equal(m.daemonDown({ code: 1, stderr: "unknown flag: --format" }), false);
  assert.equal(m.daemonDown({ code: 0, stdout: "" }), false);
});

test("details from docker inspect: mounts, networks, restart policy, and of the environment only the names", async () => {
  const { parseInspect } = await load("kanso-containers/model.js", ["parseInspect"]);
  const line = ["8362461c1aa3ffff", "sha256:feed", JSON.stringify([{ Type: "volume", Name: "pgdata", Source: "/var/lib/docker/volumes/pgdata/_data", Destination: "/var/lib/postgresql/data" }]),
    "unless-stopped", JSON.stringify({ bridge: {} }), JSON.stringify(["POSTGRES_PASSWORD=hunter2", "PATH=/usr/bin"]), "2026-11-06T06:05:45Z"].join("\t");
  const d = clone(parseInspect(line).get("8362461c1aa3"));
  assert.deepEqual(d.env, ["POSTGRES_PASSWORD", "PATH"], "names only: no value is kept");
  assert.ok(!JSON.stringify(d).includes("hunter2"));
  assert.deepEqual([d.imageId, d.restart, d.networks, d.mounts[0].name], ["feed", "unless-stopped", ["bridge"], "pgdata"]);
});

test("volumes with who mounts them; unused ones can go", async () => {
  const { volumeRows } = await load("kanso-containers/model.js", ["volumeRows"]);
  const anon = "f".repeat(64);
  const rows = clone(volumeRows(`pgdata\tlocal\nold\tlocal\n${anon}\tlocal`, [{ name: "pg", mounts: [{ type: "volume", name: "pgdata" }] }]));
  assert.deepEqual(rows.map((v) => [v.name.slice(0, 6), v.unused, v.anonymous, v.users]), [["pgdata", false, false, ["pg"]], ["old", true, false, []], ["ffffff", true, true, []]]);
});

test("compose files: one per folder, the one Compose takes first; projects show their stacks even before any container", async () => {
  const m = await load("kanso-containers/model.js", ["composeFiles", "byProject", "reclaimable", "isWeb"]);
  const files = clone(m.composeFiles("/a/api/docker-compose.yml\n/a/api/compose.yaml\n/a/api/docker-compose.override.yml\n/b/web/docker-compose.yml\n"));
  assert.deepEqual(files, [{ dir: "/a/api", file: "/a/api/compose.yaml", name: "api" }, { dir: "/b/web", file: "/b/web/docker-compose.yml", name: "web" }]);
  const projects = [{ name: "fluenty", folders: ["/a/api/src"] }, { name: "shop", folders: ["/b"] }];
  const groups = clone(m.byProject([{ id: "x1", name: "api-db-1", state: "running", status: "Up 1 minute", image: "postgres", ports: [], compose: "api", dir: "/a/api", service: "db" }], projects, files));
  assert.deepEqual(groups.map((g) => [g.project, g.stacks.map((s) => [s.name, s.running, s.total]), g.containers.length]),
    [["fluenty", [["api", 1, 1]], 1], ["shop", [["web", 0, 0]], 0]], "a pane working inside the compose folder places it; a stack with nothing up still shows");
  assert.equal(Math.round(clone(m.reclaimable('{"Type":"Build Cache","Reclaimable":"1.2GB"}\n{"Type":"Images","Reclaimable":"86.05kB (0%)"}'))["Build Cache"]), 1200);
  assert.equal(m.isWeb({ port: 55432, inside: 5432 }), false);
  assert.equal(m.isWeb({ port: 8081, inside: 80 }), true);
});

test("a compose folder belongs to the project that holds it, not to one working deeper inside; https ports open as https", async () => {
  const m = await load("kanso-containers/model.js", ["projectOf", "urlOf", "byProject"]);
  const projects = [{ name: "app", folders: ["/work/app"] }, { name: "svc", folders: ["/work/app/service/src"] }];
  assert.equal(m.projectOf({ dir: "/work/app", name: "x" }, projects), "app");
  assert.equal(m.projectOf({ dir: "/work/app/service", name: "x" }, projects), "app", "the one holding it wins over one inside it");
  assert.equal(m.projectOf({ dir: "/work/other", name: "x" }, [{ name: "inner", folders: ["/work/other/pkg"] }]), "inner", "else the one working inside it");
  assert.equal(m.urlOf({ port: 8443, inside: 443 }), "https://localhost:8443");
  assert.equal(m.urlOf({ port: 8443, inside: 80 }), "http://localhost:8443", "the container's port decides, not where it is published");
  assert.equal(m.urlOf({ port: 3000, inside: 3000 }), "http://localhost:3000");
  const [g] = clone(m.byProject([{ id: "a", name: "custom-db-1", state: "running", status: "Up", image: "pg", ports: [], compose: "custom", dir: "/work/app", service: "db" }],
    projects, [{ dir: "/work/app", file: "/work/app/compose.yaml", name: "app" }]));
  assert.equal(g.stacks[0].compose, "custom", "a stack started under another project name keeps it");
});

test("two Compose projects in one folder are two stacks; a name seen before stays for Up after Down; parents are looked in too", async () => {
  const m = await load("kanso-containers/model.js", ["byProject", "lookIn"]);
  const c = (id, compose) => ({ id, name: `${compose}-db-1`, state: "running", status: "Up", image: "pg", ports: [], compose, dir: "/w/app", service: "db" });
  const projects = [{ name: "app", folders: ["/w/app"] }], file = [{ dir: "/w/app", file: "/w/app/compose.yaml", name: "app" }];
  const [g] = clone(m.byProject([c("a", "blue"), c("b", "green")], projects, file));
  assert.deepEqual(g.stacks.map((s) => [s.compose, s.total]), [["blue", 1], ["green", 1]]);
  const [after] = clone(m.byProject([], projects, file, new Map([["/w/app", [{ name: "blue", files: ["/w/app/compose.yaml", "/w/app/compose.dev.yaml"] }]]])));
  assert.deepEqual(after.stacks[0].files, ["/w/app/compose.yaml", "/w/app/compose.dev.yaml"], "and the files it was started with");
  assert.deepEqual(after.stacks.map((s) => [s.compose, s.total]), [["blue", 0]], "after Down, Up still says -p blue");
  assert.deepEqual(clone(m.lookIn(["/Users/me/w/app/src"], "/Users/me")), { deep: ["/Users/me/w/app/src"], shallow: ["/Users/me/w/app", "/Users/me/w"] }, "parents, never home");
  assert.deepEqual(clone(m.lookIn(["/Volumes/Work/app/src"], "/Users/me")).shallow, ["/Volumes/Work/app", "/Volumes/Work"], "outside home too, never a top folder");
});

test("a stack started from a file no search finds still gets its controls, from its labels or after Down", async () => {
  const { knownStacks } = await load("kanso-containers/model.js", ["knownStacks"]);
  const c = { dir: "/w/app", compose: "app", files: ["/w/app/dev.yaml"] };
  assert.deepEqual(clone(knownStacks([], [c], new Map())), [{ dir: "/w/app", file: "/w/app/dev.yaml", name: "app" }]);
  assert.deepEqual(clone(knownStacks([], [], new Map([["/w/app", [{ name: "app", files: ["/w/app/dev.yaml"] }]]]))).map((s) => s.file), ["/w/app/dev.yaml"]);
  assert.equal(clone(knownStacks([{ dir: "/w/app", file: "/w/app/compose.yaml", name: "app" }], [c], new Map())).length, 1, "never twice");
});

test("the panel draws every part with each element in one place", async () => {
  const { singleUse } = await import("./helpers.mjs");
  const host = { ...singleUse(), theme: () => ({}), exec: async () => (failure("")), run: () => {}, spaces: () => [], panes: () => [],
    home: () => "/Users/me", shared: () => null, setShared: () => {}, InputState: { new: () => ({ on() {}, value: () => "", set_value() {}, release() {}, focus() {} }) } };
  const { Containers } = await loadContainers(host);
  const m = await model();
  const view = new Containers();
  view.init({}, { timer: { every: () => ({ cancel() {} }), after() {} }, spawn: () => {}, notify() {} });
  const groups = m.byProject(m.parseContainers(PS), PROJECTS, [{ dir: "/Users/me/Apps/kanzo/app", file: "/Users/me/Apps/kanzo/app/compose.yaml", name: "app" }]);
  Object.assign(view, { state: "ok", groups, held: 600, limit: 4000, images: [{ id: "i1", name: "pg:16", tags: ["pg:16"], mb: 400, age: "1 day", users: [], projects: [], unused: true }],
    volumes: [{ name: "pgdata", users: [], unused: true, anonymous: false }], spare: { "Build Cache": 1200 },
    show: { images: true, volumes: true }, opened: new Set(groups.flatMap((g) => g.containers.map((c) => c.id))), error: "x", note: "y" });
  assert.doesNotThrow(() => view.render());
  Object.assign(view, { state: "down" });
  assert.doesNotThrow(() => view.render());
});

// The panel open and nothing changing: Docker answers as a fixed engine, every command counted.
async function openPanel({ hung = false, drawn = false, failing = [] } = {}) {
  const { fixture, loadMod } = await import("./perf-harness.mjs");
  const f = fixture();
  const docker = { ps: [row("aa11aa11aa11", "web-1", "running", "Up 2 hours", "web", "", "", "", "", "")], images: row("sha256:1111aaaa2222", "web", "latest", "100MB", "2 days ago"), down: false,
    failing: new Set(failing), config: JSON.stringify({ currentContext: "desktop-linux" }), volumes: "pgdata\tlocal", hung, rejects: null, broken: false };
  if (drawn) Object.assign(f.host, gpuiHost());
  const spaces = f.host.spaces;
  f.host.spaces = () => { if (docker.broken) throw new Error("spaces are not ready"); return spaces(); };
  f.host.readTextFile = async (file) => (String(file).endsWith(".docker/config.json") ? docker.config : "");
  const exec = f.host.exec;
  f.host.exec = async (command, args = [], options) => {
    if (command !== "docker") return exec(command, args, options);
    await exec(command, args, options);
    if (docker.hung) return new Promise(() => {});
    if (docker.rejects) throw docker.rejects;
    if (docker.down) return failure("Cannot connect to the Docker daemon. Is the docker daemon running?");
    if (docker.failing.has(args[0])) return failure("unexpected error");
    if (args[0] === "ps" && docker.psResult) return docker.psResult;
    const out = { ps: docker.ps.join("\n"), images: docker.images, info: "8000000000", context: "desktop-linux\tunix:///var/run/docker.sock", volume: docker.volumes }[args[0]] ?? "";
    return success(out);
  };
  f.host.run = () => null;
  const { Containers } = await loadMod("kanso-containers/main.js", ["Containers"], f.host);
  const view = new Containers();
  view.init({}, f.cx);
  await f.settle();
  await f.advance(0);
  const asked = (verb) => f.state.processes.filter((p) => (verb === "find" ? p.command === "find" : p.command === "docker" && p.args.join(" ").startsWith(verb))).length;
  const fresh = () => { f.state.processes.length = 0; };
  const words = () => texts(view.render(f.cx));
  return { f, view, docker, asked, fresh, words };
}

test("the Containers panel at rest asks Docker only what can change by itself in a minute", async () => {
  const { f, asked, fresh } = await openPanel();
  assert.equal(asked("info"), 1, "opening the panel reads Docker's memory limit");
  assert.equal(asked("context inspect"), 1, "and its context");
  assert.equal(asked("inspect"), 1, "and the containers' details");
  fresh();
  await f.advance(60_000);
  const counts = Object.fromEntries(["ps", "stats", "images", "volume ls", "system df", "info", "context inspect", "inspect"].map((v) => [v, asked(v)]));
  assert.ok(counts.ps <= 12, `docker ps ${counts.ps} times; budget 12`);
  assert.ok(counts.stats <= 4, `docker stats ${counts.stats} times; budget 4`);
  for (const verb of ["images", "volume ls", "system df"]) assert.ok(counts[verb] <= 1, `docker ${verb} ${counts[verb]} times; budget 1`);
  assert.deepEqual([counts.info, counts["context inspect"], counts.inspect], [0, 0, 0], "no memory limit, context or details when nothing changed");
});

test("a container stopped or added outside kansō shows within 5 seconds, its details read only then", async () => {
  const { f, view, docker, asked, fresh } = await openPanel();
  fresh();
  docker.ps = [row("aa11aa11aa11", "web-1", "exited", "Exited (0) 1 second ago", "web", "", "", "", "", "")];
  await f.advance(5000);
  assert.equal(asked("inspect"), 1, "a stopped container asks for its details");
  assert.deepEqual([asked("images"), asked("volume ls"), asked("system df")], [0, 0, 0], "a state change alone does not read images, volumes or disk use");
  fresh();
  docker.ps = [...docker.ps, row("bb22bb22bb22", "db-1", "running", "Up 1 second", "postgres", "", "", "", "", "")];
  await f.advance(5000);
  assert.equal(asked("inspect"), 1, "an added container asks for its details");
  assert.deepEqual([asked("images"), asked("volume ls"), asked("system df")], [1, 1, 1], "a new container, as after Up, reads images, volumes and disk use once");
  assert.deepEqual(clone(view.groups.flatMap((g) => g.containers.map((c) => [c.name, c.state]))).toSorted(), [["db-1", "running"], ["web-1", "exited"]]);
  fresh();
  await f.advance(5000);
  assert.deepEqual([asked("inspect"), asked("images")], [0, 0], "the same list again reads neither");
});

test("a memory limit or context Docker failed to give is asked again on the next read, and only until it answers", async () => {
  const { f, view, docker, asked, fresh } = await openPanel();
  docker.failing = new Set(["info", "context"]);
  view.refresh(f.cx, true, true);
  await f.settle();
  assert.equal(view.limit, 8000, "the limit read before stays, with the failure said");
  assert.equal(view.failure(), "Docker said: unexpected error");
  fresh();
  await f.advance(5000);
  assert.deepEqual([asked("info"), asked("context inspect")], [1, 1], "asked again 5 seconds later");
  docker.failing = new Set();
  fresh();
  await f.advance(5000);
  assert.equal(view.limit, 8000);
  assert.equal(view.context.name, "desktop-linux");
  fresh();
  await f.advance(10_000);
  assert.deepEqual([asked("info"), asked("context inspect")], [0, 0], "and no more once it answered");
});

test("another Docker context chosen outside kansō is read within a minute, without a process at rest", async () => {
  const { f, docker, asked, fresh } = await openPanel();
  fresh();
  await f.advance(60_000);
  assert.equal(asked("context inspect"), 0, "the same context: not asked");
  docker.config = JSON.stringify({ currentContext: "colima" });
  fresh();
  await f.advance(60_000);
  assert.deepEqual([asked("context inspect"), asked("info")], [1, 1], "a new context: it and its memory limit are read");
});

test("coming forward after being behind reads everything at once", async () => {
  const { f, view, asked, fresh } = await openPanel();
  f.state.active = false;
  await f.advance(10_000);
  f.state.active = true;
  fresh();
  view.render(f.cx);
  await f.advance(0);
  for (const verb of ["ps", "images", "info", "context inspect", "inspect", "volume ls", "system df", "stats"]) assert.equal(asked(verb), 1, `coming forward asks docker ${verb}`);
});

test("an image made outside kansō shows within a minute; one from a panel action as soon as it ends", async () => {
  const { f, view, docker, asked, fresh } = await openPanel();
  docker.images = [docker.images, row("sha256:3333bbbb4444", "redis", "7", "40MB", "1 second ago")].join("\n");
  await f.advance(60_000);
  assert.ok(view.images.some((i) => i.name === "redis:7"), "outside kansō: within 60 seconds");
  fresh();
  view.act(["rmi", "redis:7"], f.cx);
  await f.settle();
  assert.equal(asked("images"), 1, "an action in the panel reads images when it ends");
  assert.equal(asked("volume ls"), 1, "and volumes");
  view.pull = { value: () => "nginx", set_value() {} };
  view.pullImage();
  fresh();
  await f.advance(10_000);
  assert.equal(asked("images"), 2, "while a pull runs in its tab, images are read each time");
  docker.images = [docker.images, row("sha256:5555cccc6666", "nginx", "latest", "60MB", "1 second ago")].join("\n");
  await f.advance(5000);
  assert.ok(view.images.some((i) => i.name === "nginx:latest"), "the pulled image shows on the next read");
  fresh();
  await f.advance(10_000);
  assert.equal(asked("images"), 0, "and the reads stop once it is there");
});

test("Read again asks everything at once, and Docker coming back reads its memory limit and context again", async () => {
  const { f, view, docker, asked, fresh } = await openPanel();
  await f.advance(5000);
  fresh();
  view.refresh(f.cx, true, true);
  await f.settle();
  for (const verb of ["ps", "images", "info", "context inspect", "inspect", "volume ls", "system df", "stats"]) assert.equal(asked(verb), 1, `Read again asks docker ${verb}`);
  assert.ok(asked("find") > 0, "Read again looks for compose files too");
  docker.down = true;
  await f.advance(5000);
  assert.equal(view.state, "down");
  docker.down = false;
  fresh();
  await f.advance(5000);
  assert.equal(view.state, "ok");
  assert.deepEqual([asked("info"), asked("context inspect")], [1, 1], "back up: memory limit and context read again");
  assert.equal(view.limit, 8000);
});

test("Volumes Docker failed to list once are kept and the failure is said, not shown as no volumes", async () => {
  const { f, view, docker, words } = await openPanel({ drawn: true });
  assert.deepEqual(clone(view.volumes.map((v) => v.name)), ["pgdata"]);
  docker.failing = new Set(["volume"]);
  view.refresh(f.cx, true, true);
  await f.settle();
  assert.deepEqual(clone(view.volumes.map((v) => v.name)), ["pgdata"], "the volumes read before are not erased");
  assert.ok(words().includes("Docker said: unexpected error"), "the failure is on screen");
  assert.ok(words().includes("Show volumes"), "and the volumes still are");
  docker.failing = new Set();
  view.refresh(f.cx, true, true);
  await f.settle();
  assert.equal(words().includes("Docker said: unexpected error"), false, "a read that works clears it");
});

test("Only Docker missing says Docker is not installed; any other failure says what failed and keeps what was read", async () => {
  const { f, view, docker, words } = await openPanel({ drawn: true });
  const missing = "Docker is not installed on this computer.";
  docker.broken = true;
  view.refresh(f.cx, true, true);
  await f.settle();
  assert.equal(words().includes(missing), false, "an error of the panel's own is not a missing Docker");
  assert.ok(words().includes("spaces are not ready"));
  assert.equal(view.groups.length, 1, "the containers read before stay");
  docker.broken = false;
  docker.rejects = new Error("command timed out after 30000 ms");
  view.refresh(f.cx, true, true);
  await f.settle();
  assert.equal(words().includes(missing), false, "a timeout is not a missing Docker");
  docker.rejects = new Error("cannot run docker: The system cannot find the path specified. (os error 3)");
  view.refresh(f.cx, true, true);
  await f.settle();
  assert.equal(words().includes(missing), false, "a folder Herdr cannot start in is not a missing Docker");
  docker.rejects = null;
  docker.psResult = failure("permission denied while trying to connect to the Docker daemon socket at unix:///var/run/docker.sock");
  view.refresh(f.cx, true, true);
  await f.settle();
  assert.equal(words().includes("Docker isn't running."), false, "a socket you may not use is not Docker down");
  assert.equal(view.groups.length, 1, "and the containers read before stay");
  assert.ok(words().includes("Docker said: permission denied while trying to connect to the Docker daemon socket at unix:///var/run/docker.sock"));
  docker.psResult = null;
  for (const text of ["cannot run docker: No such file or directory (os error 2)", "cannot run docker: The system cannot find the file specified. (os error 2)"]) {
    docker.rejects = new Error(text);
    view.refresh(f.cx, true, true);
    await f.settle();
    assert.ok(words().includes(missing), `Herdr's "${text}" is`);
  }
});

test("A read that fails after Docker was missing says what failed, not that Docker is missing", async () => {
  const { f, view, docker, words } = await openPanel({ drawn: true });
  for (const error of ["cannot run docker: No such file or directory (os error 2)", "cannot run docker: Permission denied (os error 13)"]) {
    docker.rejects = new Error(error);
    view.refresh(f.cx, true, true); await f.settle();
  }
  assert.equal(words().includes("Docker is not installed on this computer."), false);
  assert.ok(words().includes("Can't read Docker"));
});

test("Docker back after being down shows no volumes it has not listed again", async () => {
  const { f, view, docker, words } = await openPanel({ drawn: true });
  docker.down = true;
  view.refresh(f.cx, true, true); await f.settle();
  docker.down = false; docker.failing.add("volume");
  view.refresh(f.cx, true, true); await f.settle();
  assert.equal(words().includes("Show volumes"), false);
});

test("Only a stopped daemon is Docker down: a refused Windows pipe keeps the containers", async () => {
  const { f, view, docker, words } = await openPanel({ drawn: true });
  docker.psResult = failure("error during connect: open //./pipe/docker_engine: Access is denied.");
  view.refresh(f.cx, true, true); await f.settle();
  assert.equal(view.groups.length, 1);
  assert.equal(words().includes("Docker isn't running."), false);
  docker.psResult = failure("error during connect: this error may indicate that the docker daemon is not running: open //./pipe/docker_engine: The system cannot find the file specified.");
  view.refresh(f.cx, true, true); await f.settle();
  assert.ok(words().includes("Docker isn't running."), "no pipe at all is Docker down");
});

test("This computer's own reads behind Containers stop before the panel gives up on them", async () => {
  const { f } = await openPanel();
  const reads = f.state.processes.filter((p) => ["ps", "find", "lsof"].includes(p.command));
  assert.ok(reads.length > 0);
  assert.ok(reads.every((p) => p.options?.timeout < 15_000), JSON.stringify(reads.map((p) => [p.command, p.options])));
});

test("Volumes and images whose users Docker did not say are not offered for removal", async () => {
  const { words } = await openPanel({ drawn: true, failing: ["inspect"] });
  assert.equal(words().includes("Remove 1 unused volume"), false, JSON.stringify(words()));
  assert.equal(words().some((text) => text.startsWith("Remove unused images")), false);
});

test("A failure stays said until that same list is read again, and a list never read shows no count", async () => {
  const { f, view, docker, words, asked } = await openPanel({ drawn: true });
  docker.failing.add("volume");
  view.refresh(f.cx, true, true); await f.settle();
  const volumeReads = asked("volume");
  await f.advance(5000);
  assert.equal(asked("volume"), volumeReads, "the next tick does not read volumes");
  assert.ok(words().includes("Docker said: unexpected error"), "and the failure is still said");
  docker.failing.delete("volume");
  view.refresh(f.cx, true, true); await f.settle();
  assert.equal(words().includes("Docker said: unexpected error"), false, "volumes read again clear it");
  const first = await openPanel({ drawn: true, failing: ["images"] });
  assert.equal(first.words().some((text) => /^0 · /.test(text)), false, "images never listed are not counted as none");
  assert.ok(first.words().includes("Docker said: unexpected error"));
});

test("Every Docker command ends inside the view's deadline: reads, and actions that never answer free their row", async () => {
  const { f, view, docker, words } = await openPanel({ drawn: true });
  const timeouts = f.state.processes.filter((p) => p.command === "docker").map((p) => p.options?.timeout);
  assert.ok(timeouts.length > 0 && timeouts.every((ms) => ms > 0 && ms < 15_000), "Docker stops each read before the panel gives up on it");
  docker.hung = true;
  const [web] = view.groups[0].containers;
  view.containers("stop", [web], f.cx);
  assert.ok(view.busy.has(web.id));
  view.containers("stop", [web], f.cx);
  assert.equal(f.state.processes.filter((p) => p.args[0] === "stop").length, 1, "a row being changed is not asked twice");
  await f.advance(60_000);
  assert.equal(view.busy.has(web.id), false, "a stop that never answers frees its row");
  assert.ok(words().includes("stop failed: timed out"));
});

test("A first read that never answers ends in a failure with Read again inside its deadline, and Read again waits while a read runs", async () => {
  const { f, view, docker, words } = await openPanel({ hung: true, drawn: true });
  const refresh = () => find(view.render(f.cx), (el) => el.tag === "ct-refresh");
  assert.equal(calls(refresh(), "disabled").at(-1)?.[1], true, "Read again is off while the read runs");
  await f.advance(15_000);
  assert.equal(view.reading, false, "the read has ended at its deadline");
  assert.ok(words().includes("Can't read Docker"), "a failure, not a skeleton");
  assert.ok(words().includes("Read again"));
  assert.equal(calls(refresh(), "disabled").at(-1)?.[1], false, "and Read again is on");
  const press = calls(refresh(), "on_click").at(-1).at(-1);
  press({}, f.cx);
  assert.equal(calls(refresh(), "disabled").at(-1)?.[1], true, "a press turns Read again off at once");
  assert.equal(words().includes("Read again"), false, "and the failure offers no second retry");
  press({}, f.cx);
  assert.equal(view.queued, null, "a second press while it reads queues nothing");
  await f.advance(15_000);
  docker.hung = false;
  const fix = find(view.render(f.cx), (el) => el.tag === "ct-failed-fix");
  calls(fix, "on_click").at(-1).at(-1)({}, f.cx);
  await f.settle();
  assert.equal(view.groups.length, 1, "Read again reads the containers");
  assert.equal(words().includes("Can't read Docker"), false);
});

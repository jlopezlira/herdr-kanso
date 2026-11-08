// Containers: what Docker says, read into rows, and which Kanso project each is for.
import test from "node:test";
import assert from "node:assert/strict";
import { load, clone } from "./helpers.mjs";

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

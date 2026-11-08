// Containers, by jlopezlira (https://github.com/jlopezlira/herdr-kanso). Apache-2.0.
// What Docker says, read into plain rows, and which Kanso project each belongs to.

const TAB = "\t";
const label = (key) => `{{.Label "${key}"}}`;
// One line per container; tabs never appear in these fields.
export const PS_FORMAT = ["{{.ID}}", "{{.Names}}", "{{.State}}", "{{.Status}}", "{{.Image}}", "{{.Ports}}",
  label("com.docker.compose.project"), label("com.docker.compose.project.working_dir"), label("com.docker.compose.service")].join(TAB);
export const INSPECT_FORMAT = "{{.Id}}\t{{.Image}}";
export const CONTEXT_FORMAT = "{{.Name}}\t{{.Endpoints.docker.Host}}";
export const IMAGES_FORMAT = ["{{.ID}}", "{{.Repository}}", "{{.Tag}}", "{{.Size}}", "{{.CreatedSince}}"].join(TAB);
export const OTHER = "Other";

const lines = (text) => String(text ?? "").split("\n").map((l) => l.trimEnd()).filter(Boolean);
const clean = (v) => (v && v !== "<no value>" ? v : null);

// "127.0.0.1:56379->6379/tcp, :::80->80/tcp, 5432/tcp": the ports reachable from here, once each.
export function hostPorts(text) {
  const found = String(text ?? "").split(",").map((p) => /:(\d+)->(\d+)\/(\w+)/.exec(p.trim())).filter(Boolean)
    .map((m) => ({ port: Number(m[1]), inside: Number(m[2]), proto: m[3] }));
  return found.filter((p, i) => found.findIndex((q) => q.port === p.port && q.proto === p.proto) === i).toSorted((a, b) => a.port - b.port);
}

// "Exited (137) 2 days ago": the code, or null when it never exited.
export const exitCode = (status) => { const m = /^Exited \((-?\d+)\)/.exec(String(status ?? "")); return m ? Number(m[1]) : null; };

// running, paused, restarting: on; exited 0 and created: stopped; exited with an error or dead: failed.
export function health(c) {
  if (c.state === "running") return "running";
  if (c.state === "paused" || c.state === "restarting") return "busy";
  if (c.state === "dead" || (c.state === "exited" && (exitCode(c.status) ?? 0) !== 0)) return "failed";
  return "stopped";
}

export function parseContainers(text) {
  return lines(text).map((l) => l.split(TAB)).filter((f) => f.length >= 5 && f[0]).map((f) => ({
    id: f[0], name: f[1], state: f[2], status: f[3], image: f[4], ports: hostPorts(f[5]),
    compose: clean(f[6]), dir: clean(f[7]), service: clean(f[8]),
  }));
}

// "1.2GB", "58.2MB", "512kB": megabytes.
export function sizeMB(text) {
  const m = /^([\d.]+)\s*([kMGT]?B)$/i.exec(String(text ?? "").trim());
  if (!m) return 0;
  const unit = { B: 1 / 1e6, KB: 1e-3, MB: 1, GB: 1e3, TB: 1e6 }[m[2].toUpperCase()] ?? 0;
  return Number(m[1]) * unit;
}

// Its name, and what `docker rmi` takes for it: repo:tag, else its id (an untagged
// "alpine:<none>" by its repo alone would name alpine:latest).
function imageName(short, repo, tag) {
  if (repo !== "<none>" && tag && tag !== "<none>") return { name: `${repo}:${tag}`, target: `${repo}:${tag}` };
  return { name: repo !== "<none>" ? `${repo} (untagged)` : short, target: short };
}

// One row per image id: tags of the same image are one image, its size counted once.
export function parseImages(text) {
  const tagged = lines(text).map((l) => l.split(TAB)).filter((f) => f.length >= 4 && f[0]).map((f) => ({
    id: f[0].replace(/^sha256:/, ""), repo: f[1], tag: f[2], mb: sizeMB(f[3]), age: f[4] ?? "",
    ...imageName(f[0].replace(/^sha256:/, "").slice(0, 12), f[1], f[2]),
  }));
  return [...new Set(tagged.map((t) => t.id))].map((id) => {
    const tags = tagged.filter((t) => t.id === id);
    return { id, mb: tags[0].mb, age: tags[0].age, name: tags.map((t) => t.name).join(", "), tags: [...new Set(tags.map((t) => t.target))],
      refs: tags.flatMap((t) => (t.tag === "latest" ? [t.name, t.repo] : [t.name])) };
  });
}

// `docker inspect --format '{{.Id}}\t{{.Image}}'`: container id (12) -> the id of the image it runs.
export const parseImageIds = (text) => new Map(lines(text).map((l) => l.split(TAB)).filter((f) => f.length >= 2)
  .map((f) => [f[0].slice(0, 12), f[1].replace(/^sha256:/, "")]));

// The containers on an image: by the image id Docker gave each, else as `docker ps` names it.
export function imageUsedBy(image, containers) {
  return containers.filter((c) => (c.imageId ? c.imageId === image.id
    : image.refs.includes(c.image) || (c.image.length >= 12 && image.id.startsWith(c.image.replace(/^sha256:/, "")))));
}

// `docker context inspect`: "name\thost". Not a unix socket: the containers are on another machine.
export function contextOf(text) {
  const [name, host] = String(text ?? "").trim().split(TAB);
  return name ? { name, host: host ?? "", remote: Boolean(host) && !host.startsWith("unix://") && !host.startsWith("npipe://") } : null;
}

const words = (s) => String(s ?? "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

// The Kanso project a container is for, among `projects` [{ name, folder }]: the one whose folder
// holds its compose file (the deepest), else the one its compose project or its name starts with.
export function projectOf(c, projects) {
  const dir = c.dir;
  const byDir = dir ? projects.filter((p) => p.folder && (dir === p.folder || dir.startsWith(`${p.folder}/`)))
    .toSorted((a, b) => b.folder.length - a.folder.length)[0] : null;
  if (byDir) return byDir.name;
  // The project whose whole name starts the container's, the longest: kanso-api-db is kanso-api's, not kanso-web's.
  const own = words(c.compose ?? c.name);
  const byName = projects.map((p) => ({ p, w: words(p.name) }))
    .filter(({ w }) => w.length > 0 && w.length <= own.length && w.every((x, i) => own[i] === x))
    .toSorted((a, b) => b.w.length - a.w.length)[0];
  if (byName) return byName.p.name;
  return dir ? dir.split("/").filter(Boolean).at(-1) : OTHER;
}

const order = { running: 0, busy: 1, failed: 2, stopped: 3 };

// By project: the ones with something running first, then by name; Other last.
export function byProject(containers, projects) {
  const named = containers.map((c) => ({ ...c, project: projectOf(c, projects), health: health(c) }));
  const groups = [...new Set(named.map((c) => c.project))].map((project) => {
    const list = named.filter((c) => c.project === project)
      .toSorted((a, b) => order[a.health] - order[b.health] || (a.service ?? a.name).localeCompare(b.service ?? b.name));
    return { project, containers: list, running: list.filter((c) => c.health === "running").length };
  });
  return groups.toSorted((a, b) => (a.project === OTHER) - (b.project === OTHER) || (b.running > 0) - (a.running > 0) || a.project.localeCompare(b.project));
}

// Images with what uses them; one nothing uses (no container at all, running or not) can go.
export function imageRows(images, groups) {
  const all = groups.flatMap((g) => g.containers);
  return images.map((i) => {
    const users = imageUsedBy(i, all);
    return { ...i, users: users.map((c) => c.service ?? c.name), projects: [...new Set(users.map((c) => c.project))], unused: users.length === 0 };
  }).toSorted((a, b) => Number(a.unused) - Number(b.unused) || b.mb - a.mb);
}

// "Up 45 hours" -> "up 45 hours"; "Exited (0) 2 days ago" -> "stopped 2 days ago"; "Exited (1) 3 minutes ago" -> "failed (1) 3 minutes ago".
export function since(c) {
  const s = String(c.status ?? "");
  const code = exitCode(s);
  if (code !== null) return `${code === 0 ? "stopped" : `failed (${code})`} ${s.replace(/^Exited \(-?\d+\)\s*/, "")}`.trim();
  return s.replace(/^Up/, "up").replace(/^Created/, "created");
}

export const size = (mb) => (mb >= 1000 ? `${(mb / 1000).toFixed(1)} GB` : mb >= 1 ? `${Math.round(mb)} MB` : `${Math.max(1, Math.round(mb * 1000))} kB`);

// Docker answered, but its daemon is not there.
export const daemonDown = (r) => r && r.code !== 0 && /Cannot connect|Is the docker daemon running|error during connect|docker\.sock/i.test(`${r.stderr ?? ""}${r.stdout ?? ""}`);

// "170.5MiB / 3.828GiB": megabytes used.
export function memMB(text) {
  const m = /^([\d.]+)\s*([KMGT]i?B|B)/i.exec(String(text ?? "").trim());
  if (!m) return null;
  const unit = { B: 1 / 1e6, KIB: 1.024e-3, KB: 1e-3, MIB: 1.048576, MB: 1, GIB: 1073.741824, GB: 1e3 }[m[2].toUpperCase()] ?? 0;
  return Number(m[1]) * unit;
}
export const STATS_FORMAT = ["{{.ID}}", "{{.MemUsage}}"].join(TAB);
// `docker stats --no-stream`: short id -> megabytes.
export const parseStats = (text) => new Map(lines(text).map((l) => l.split(TAB)).filter((f) => f.length >= 2).map((f) => [f[0].slice(0, 12), memMB(f[1])]));

const VM = /com\.apple\.Virtualization\.VirtualMachine/;
const procs = (text) => lines(text).map((l) => /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(l)).filter(Boolean).map((m) => ({ pid: Number(m[1]), kb: Number(m[2]), comm: m[3] }));
// `ps -axo pid=,rss=,comm=`: the virtual machines running, Docker's or another app's.
export const vmPids = (text) => procs(text).filter((p) => VM.test(p.comm)).map((p) => p.pid);
// `lsof -Fpn` of those: the ones with Docker's disk or kernel open are Docker's.
export function dockerVms(text) {
  const ls = lines(text);
  const starts = ls.flatMap((l, i) => (l[0] === "p" ? [i] : []));
  return new Set(starts.filter((at, k) => ls.slice(at + 1, starts[k + 1] ?? ls.length).some((l) => l[0] === "n" && /Docker\.app\/|com\.docker\.docker/.test(l)))
    .map((at) => Number(ls[at].slice(1))));
}
// What Docker Desktop and its VM hold in this computer's memory, in MB; another app's VM is not Docker's.
export function dockerHeld(text, vms = new Set()) {
  return procs(text).filter((p) => /\/Docker\.app\/|com\.docker\./.test(p.comm) || (VM.test(p.comm) && vms.has(p.pid)))
    .reduce((t, p) => t + p.kb / 1024, 0);
}

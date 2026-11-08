// Containers, by jlopezlira (https://github.com/jlopezlira/herdr-kanso). Apache-2.0.
// What Docker says, read into plain rows, and which Kanso project each belongs to.

const TAB = "\t";
const label = (key) => `{{.Label "${key}"}}`;
// One line per container; tabs never appear in these fields.
export const PS_FORMAT = ["{{.ID}}", "{{.Names}}", "{{.State}}", "{{.Status}}", "{{.Image}}", "{{.Ports}}",
  label("com.docker.compose.project"), label("com.docker.compose.project.working_dir"), label("com.docker.compose.service"),
  label("com.docker.compose.project.config_files")].join(TAB);
// JSON for the lists: no raw tab or newline gets in, so a line is one container.
export const INSPECT_FORMAT = ["{{.Id}}", "{{.Image}}", "{{json .Mounts}}", "{{.HostConfig.RestartPolicy.Name}}", "{{json .NetworkSettings.Networks}}", "{{json .Config.Env}}", "{{.Created}}"].join("\t");
export const VOLUMES_FORMAT = "{{.Name}}\t{{.Driver}}";
export const COMPOSE_FILES = ["compose.yaml", "compose.yml", "docker-compose.yaml", "docker-compose.yml"];
// Ports a browser can open.
const WEB = new Set([80, 443, 3000, 3001, 4000, 4200, 4321, 5000, 5173, 5174, 8000, 8008, 8080, 8081, 8443, 8888, 9000]);
export const isWeb = (p) => WEB.has(p.inside) || WEB.has(p.port);
// The container's own port says whether it speaks TLS, whatever port it is published on.
export const urlOf = (p) => `${p.inside === 443 || p.inside === 8443 ? "https" : "http"}://localhost:${p.port}`;
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
    compose: clean(f[6]), dir: clean(f[7]), service: clean(f[8]), files: (clean(f[9]) ?? "").split(",").map((x) => x.trim()).filter(Boolean),
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

const json = (text, fallback) => { try { return JSON.parse(text) ?? fallback; } catch { return fallback; } };

// `docker inspect` with INSPECT_FORMAT: container id (12) -> what it runs on and with. Of its
// environment only the names are kept: values are often secrets.
export const parseInspect = (text) => new Map(lines(text).map((l) => l.split(TAB)).filter((f) => f.length >= 2).map((f) => [f[0].slice(0, 12), {
  imageId: f[1].replace(/^sha256:/, ""),
  mounts: json(f[2], []).map((m) => ({ type: m.Type, name: m.Name ?? null, source: m.Source ?? "", dest: m.Destination ?? "" })),
  restart: f[3] && f[3] !== "no" ? f[3] : null,
  networks: Object.keys(json(f[4], {})),
  env: json(f[5], []).map((e) => String(e).split("=")[0]).filter(Boolean),
  created: f[6] ?? null,
}]));
export const parseImageIds = (text) => new Map([...parseInspect(text)].map(([id, d]) => [id, d.imageId]));

// Volumes, with the containers whose mounts name them; one nobody mounts can go.
export function volumeRows(text, containers) {
  return lines(text).map((l) => l.split(TAB)).filter((f) => f[0]).map(([name, driver]) => {
    const users = containers.filter((c) => (c.mounts ?? []).some((m) => m.type === "volume" && m.name === name));
    return { name, driver: driver ?? "", users: users.map((c) => c.service ?? c.name), unused: users.length === 0, anonymous: /^[0-9a-f]{64}$/.test(name) };
  }).toSorted((a, b) => Number(a.unused) - Number(b.unused) || Number(a.anonymous) - Number(b.anonymous) || a.name.localeCompare(b.name));
}

// `docker system df --format '{{json .}}'`: what each kind could give back, in MB.
export const reclaimable = (text) => Object.fromEntries(lines(text).map((l) => json(l, null)).filter(Boolean)
  .map((r) => [r.Type, sizeMB(String(r.Reclaimable ?? "").split(" ")[0])]));

// `find` of compose files: one per folder, the one Docker Compose itself would take first.
// Folders to look in for compose files: each project folder's own two levels (find -maxdepth 2), and
// its parents up to `up` levels (find -maxdepth 1), never home, what holds it, or a top folder.
export function lookIn(folders, homeDir, up = 3) {
  const parentsOf = (f) => Array.from({ length: up }, (_, i) => f.split("/").slice(0, -(i + 1)).join("/"))
    .filter((p) => p.split("/").length > 2 && p !== homeDir && !homeDir.startsWith(`${p}/`));
  const deep = [...new Set(folders)];
  return { deep, shallow: [...new Set(deep.flatMap(parentsOf))].filter((p) => !deep.includes(p)) };
}

// Stacks Compose knows that no file search found (a file named otherwise, like dev.yaml): from the
// containers' labels and the names kept after a Down.
export function knownStacks(files, containers, names) {
  const dirs = [...new Set([...containers.filter((c) => c.dir && c.compose).map((c) => c.dir), ...names.keys()])].filter((d) => !files.some((f) => f.dir === d));
  return [...files, ...dirs.map((dir) => ({ dir, file: containers.find((c) => c.dir === dir && c.files?.length)?.files[0] ?? names.get(dir)?.[0]?.files?.[0] ?? dir, name: dir.split("/").at(-1) }))];
}

export function composeFiles(text) {
  const found = lines(text).filter((p) => COMPOSE_FILES.includes(p.split("/").at(-1)));
  const dirs = [...new Set(found.map((p) => p.slice(0, p.lastIndexOf("/"))))];
  return dirs.map((dir) => ({ dir, file: `${dir}/${COMPOSE_FILES.find((f) => found.includes(`${dir}/${f}`))}`, name: dir.split("/").at(-1) }));
}

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

const foldersOf = (p) => p.folders ?? (p.folder ? [p.folder] : []);
const within = (dir, f) => dir === f || dir.startsWith(`${f}/`) || f.startsWith(`${dir}/`);

// The Kanso project a container is for, among `projects` [{ name, folders }] (where its panes work;
// never home itself): the one with the deepest folder holding its compose folder, else the one working
// closest inside it, else the one whose whole name starts its compose project's or its own.
export function projectOf(c, projects) {
  const dir = c.dir;
  const pairs = dir ? projects.flatMap((p) => foldersOf(p).filter((f) => within(dir, f)).map((f) => ({ p, f, holds: dir === f || dir.startsWith(`${f}/`) }))) : [];
  const byDir = pairs.filter((x) => x.holds).toSorted((a, b) => b.f.length - a.f.length)[0]
    ?? pairs.filter((x) => !x.holds).toSorted((a, b) => a.f.length - b.f.length)[0];
  if (byDir) return byDir.p.name;
  // The project whose whole name starts the container's, the longest: kanso-api-db is kanso-api's, not kanso-web's.
  const own = words(c.compose ?? c.name);
  const byName = projects.map((p) => ({ p, w: words(p.name) }))
    .filter(({ w }) => w.length > 0 && w.length <= own.length && w.every((x, i) => own[i] === x))
    .toSorted((a, b) => b.w.length - a.w.length)[0];
  if (byName) return byName.p.name;
  return dir ? dir.split("/").filter(Boolean).at(-1) : OTHER;
}

const order = { running: 0, busy: 1, failed: 2, stopped: 3 };

// By project, with its compose stacks (`stacks` from composeFiles), up or not: the ones with
// something running first, then by name; Other last.
export function byProject(containers, projects, stacks = [], names = new Map()) {
  const named = containers.map((c) => ({ ...c, project: projectOf(c, projects), health: health(c) }));
  const placed = stacks.map((s) => ({ ...s, project: projectOf({ dir: s.dir, name: s.name }, projects) }));
  const groups = [...new Set([...named.map((c) => c.project), ...placed.map((s) => s.project)])].map((project) => {
    const list = named.filter((c) => c.project === project)
      .toSorted((a, b) => order[a.health] - order[b.health] || (a.service ?? a.name).localeCompare(b.service ?? b.name));
    // One row per Compose project in the folder: each keeps the name it was started under
    // (`-p` or its file's `name:`), so Down and Up reach the same containers. `names` (folder ->
    // [{ name, files }]) remembers them after Down.
    const own = placed.filter((s) => s.project === project).flatMap((s) => {
      const of = named.filter((c) => c.dir === s.dir);
      const known = names.get(s.dir) ?? [];
      const seen = [...new Set([...of.map((c) => c.compose).filter(Boolean), ...known.map((k) => k.name)])];
      return (seen.length ? seen : [null]).map((compose) => {
        const mine = of.filter((c) => (c.compose ?? null) === compose);
        // The files it was started with (-f), so Up and Rebuild keep its configuration.
        const files = mine.find((c) => c.files?.length)?.files ?? known.find((k) => k.name === compose)?.files ?? [];
        return { ...s, compose, files, total: mine.length, running: mine.filter((c) => c.health === "running").length };
      });
    });
    return { project, containers: list, stacks: own, running: list.filter((c) => c.health === "running").length };
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

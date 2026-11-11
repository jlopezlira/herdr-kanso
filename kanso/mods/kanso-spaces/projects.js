import { localPlatform, platformOn, paths } from "./platform.js";
// Kanso's projects, by jlopezlira (https://github.com/jlopezlira/herdr-kanso). Apache-2.0.
// A project is a folder you added (kdb's projects table): it stays when its last agent closes,
// and its space is only the part of it that is open now.
import { exec, home } from "herdr";

export const REGISTRY = "kanso.registry"; // shared: the projects, as the database last said
export const WORKTREES = "data/kanso/worktrees"; // under the app's folder on this computer; ~/.kanso/worktrees on another machine

export const trimmed = (path) => (String(path ?? "").length > 1 ? paths.normalize(path) : String(path ?? ""));
export const folderName = (path) => path ? paths.basename(trimmed(path)) || "~" : "~";
// Where a space or project is: its machine ("" here) and folder (home when it has none).
export const placeKey = (machine, folder) => `${machine ?? ""}:${trimmed(folder)}`;
export const keyOfSpace = (w, homeDir) => placeKey(w?.machine, w?.folder || homeDir);
export const keyOfProject = (p) => placeKey(p.machine, p.folder);

// The projects no open space stands for: each shows as a row of its own, with a way to start an agent in it.
export function closedProjects(projects, spaces, homeDir) {
  const open = new Set(spaces.map((w) => keyOfSpace(w, homeDir)));
  return projects.filter((p) => !open.has(keyOfProject(p)));
}

// Two projects of the same name show their parent folder too.
export function shownNames(projects) {
  const count = projects.reduce((m, p) => new Map([...m, [p.name, (m.get(p.name) ?? 0) + 1]]), new Map());
  return new Map(projects.map((p) => {
    const parent = paths.basename(paths.dirname(p.folder));
    return [p.id, count.get(p.name) > 1 && parent ? `${parent}/${p.name}` : p.name];
  }));
}

// The spaces open when projects came in, and the places asleep whole: those are your projects. Home is not one.
export function startingProjects(spaces, sleepKeys, homeDir) {
  const fromSpaces = spaces.filter((w) => w.folder && trimmed(w.folder) !== trimmed(homeDir))
    .map((w) => ({ name: folderName(w.folder), folder: trimmed(w.folder), machine: w.machine ?? "" }));
  const fromSleeps = sleepKeys.map((key) => ({ machine: key.slice(0, key.indexOf(":")), folder: trimmed(key.slice(key.indexOf(":") + 1)) }))
    // A space at its machine's home was kept under this computer's home folder: home is not a project, on any machine.
    .filter((p) => p.folder && p.folder !== trimmed(homeDir))
    .map((p) => ({ ...p, name: folderName(p.folder) }));
  const all = [...fromSpaces, ...fromSleeps];
  return all.filter((p, i) => all.findIndex((x) => placeKey(x.machine, x.folder) === placeKey(p.machine, p.folder)) === i);
}

// git worktree list --porcelain: the first is the main checkout.
export function parseWorktreeList(out) {
  return String(out ?? "").replace(/\r\n/g, "\n").split(/\n\n+/).map((block) => block.split("\n")).filter((lines) => lines[0]?.startsWith("worktree "))
    .map((lines, i) => {
      const field = (name) => lines.find((l) => l === name || l.startsWith(`${name} `));
      const branch = field("branch")?.slice(7).replace(/^refs\/heads\//, "") ?? null;
      return { path: paths.normalize(lines[0].slice(9)), branch, main: i === 0, detached: Boolean(field("detached")), prunable: Boolean(field("prunable")) };
    });
}

// Makes a worktree in Kanso's folder (or finds the one that branch already has) and prints its path.
// $1 the project's folder, $2 the branch, $3 the base folder (empty: ~/.kanso/worktrees, for another machine).
// { path, made } or { error }.
export async function addWorktree({ folder, machine = null, branch, base = "" }) {
  const name = String(branch ?? "").trim();
  if (!name) return { error: "Name the branch." };
  if (name.startsWith("-")) return { error: "A branch name can't start with -." };
  const host = await platformOn(machine);
  const r = await host.repositories.createWorktree(folder, name, base, base ? "" : machine ? await host.system.userHome() : home()).catch((e) => ({ code: 1, stderr: String(e?.message ?? e) }));
  const line = String(r.stdout ?? "").trim().split("\n").at(-1) ?? "";
  const [kind, path] = line.split("\t");
  if (r.code !== 0 || !path) return { error: String(r.stderr ?? "").trim().split("\n").filter(Boolean).at(-1) || "git could not make the worktree." };
  return { path, made: kind === "made" };
}

export async function worktreesOf(folder, machine = null) {
  const r = await exec("git", ["-C", folder, "worktree", "list", "--porcelain"], machine ? { on: machine } : {}).catch(() => null);
  return r?.code === 0 ? parseWorktreeList(r.stdout) : [];
}

// The local folders of these that are not there any more.
export async function missingFolders(folders) {
  if (!folders.length) return new Set();
  const existing = new Set(await localPlatform().files.existing(folders, "directory"));
  return new Set(folders.filter((folder) => !existing.has(folder)));
}

// What the sidebar may paint, and the pull a second press runs. Drawing stays next door.
export const ASLEEP_ROW = 32;

export const showPlus = (active, hovered) => Boolean(active || hovered);
export const showDots = (hovered) => Boolean(hovered);

export function projectControls({ active, hovered, place }) {
  return { plus: Boolean(place) && showPlus(active, hovered), dots: showDots(hovered) };
}

export const pullKey = (folder, on) => `pull:${on ?? ""}:${folder ?? ""}`;

export function pullLabel(n, armed) {
  const count = Number(n) || 0;
  if (count <= 0) return null;
  return armed ? `Press again to pull ${count}` : `\u2193${count}`;
}

export function pullCommand(folder, on) {
  if (!folder) return null;
  return { command: "git", args: ["-C", folder, "pull", "--ff-only"], on: on ?? null };
}

export function refusalLine(result) {
  if (!result || result.code === 0) return null;
  const line = (value) => String(value ?? "").split("\n").map((item) => item.trim()).find(Boolean) ?? null;
  return line(result.stderr) ?? line(result.stdout);
}

export function aheadOpen(count, place) {
  const n = Number(count) || 0;
  if (n <= 0 || !place?.folder) return null;
  return { panel: "pr", branch: place.branch || null, folder: place.folder, on: place.on ?? null };
}

export function gitControls(git, { folder, on, armed } = {}) {
  if (!git || !folder) return [];
  const open = Number(git.ahead) > 0 ? aheadOpen(git.ahead, { branch: git.branch, folder, on }) : null;
  const behindLabel = pullLabel(git.behind, armed);
  const ahead = open ? { kind: "ahead", label: `\u2191${git.ahead}`, open } : null;
  const behind = behindLabel ? { kind: "behind", label: behindLabel, armed: Boolean(armed), command: pullCommand(folder, on) } : null;
  return [ahead, behind].filter(Boolean);
}

export async function runPull(exec, notify, place) {
  const command = pullCommand(place?.folder, place?.on);
  if (!command) return null;
  const result = await exec(command.command, command.args, { on: command.on });
  const line = refusalLine(result);
  if (line) notify({ title: line, level: "error" });
  return result;
}

export const showAwayList = (view, collapsed) => !collapsed && (view === "spaces" || view === "agents" || view === "threads");

export function activityTone(status) {
  if (status === "blocked") return "foreground";
  if (status === "working") return "muted";
  if (status === "done" || status === "idle") return "dim";
  return "muted";
}

export const machineWordTone = (phase) => (phase === "unavailable" ? "blocked" : "dim");

export const canWake = (row) => Boolean(row?.asleep && !row.asleep.busy && !row.asleep.quiet && row.asleep.id);

export function enterOpens(row) {
  if (row?.asleep) return canWake(row) ? { wake: row.asleep.id } : null;
  if (row?.pane) return { focus: row.pane };
  if (row?.address) return { peek: row.address };
  return null;
}

export const asleepControls = (row) => (canWake(row) ? [{ id: "wake", label: "Wake" }] : []);

// A remote machine turned off from the sidebar: what to store, the hc argv, and what the row should show.

export function machineRecord(row) {
  if (!row || row.name == null || row.name === "") return null;
  return {
    name: String(row.name),
    target: String(row.target ?? ""),
    via: String(row.via ?? ""),
    session: String(row.session ?? ""),
    temporary: row.temporary === true || row.temporary === 1 || row.temporary === "1",
  };
}

// A name alone cannot be added back, so it is never removed.
export function canRestore(record) {
  return Boolean(record?.name && (record.target || record.via));
}

export function addArgs(record) {
  return ["machine", "add", ...(record.target ? [record.target] : []), "--name", record.name,
    ...(record.via ? ["--via", record.via] : []), ...(record.session ? ["--session", record.session] : []),
    ...(record.temporary ? ["--temp"] : []), "--json"];
}

export function rmArgs(name) {
  return ["machine", "rm", name];
}

export function loginLine(name) {
  return `hc machine login ${name}`;
}

export function hcError(result) {
  if (!result || result.code === 0) return null;
  const raw = String(result.stdout || result.stderr || "").trim();
  try {
    const parsed = JSON.parse(raw);
    return parsed.error ?? { message: raw };
  } catch {
    return { message: raw || "it didn't answer" };
  }
}

const LOGIN_KINDS = new Set(["login_needed", "auth_failed", "host_key"]);

export function needsLogin(error) {
  if (!error) return false;
  if (LOGIN_KINDS.has(error.kind)) return true;
  return /password|passphrase|host key|needs a login/i.test(String(error.message ?? ""));
}

// `hc machine ls --json`. A failed read is an empty list, so a saved off row stays off.
export function listedMachines(result) {
  if (!result || result.code !== 0) return [];
  try {
    const rows = JSON.parse(String(result.stdout ?? "")).machines;
    return (Array.isArray(rows) ? rows : []).filter((row) => row && !row.temporary);
  } catch {
    return [];
  }
}

export function heldNames(stored = []) {
  return new Set((stored ?? []).map((row) => row?.name).filter(Boolean));
}

export function isOff(name, stored, live) {
  if (!name) return false;
  if (!heldNames(stored).has(name)) return false;
  const row = (live ?? []).find((item) => item.name === name);
  return !row || row.state !== "connected";
}

export function namesOff(stored = [], live = []) {
  return new Set([...(stored ?? [])].map((row) => row?.name).filter((name) => isOff(name, stored, live)));
}

export function connectedNames(stored, live) {
  const on = new Set((live ?? []).filter((row) => row.state === "connected").map((row) => row.name));
  return (stored ?? []).filter((row) => on.has(row.name)).map((row) => row.name);
}

// `live` is `hc machine ls`. `layout` is Herdr's own machines() state for this name.
export function machinePhase({ name, stored, live, layout, asking, login, failed }) {
  if (!name) return layout === "loading" ? "loading" : "connected";
  const row = (live ?? []).find((item) => item.name === name) ?? null;
  const parked = heldNames(stored).has(name);
  if (login || row?.state === "needs_login") return "login";
  if (asking) return "loading";
  if (failed) return "unavailable";
  if (parked) return "off";
  if (layout === "unavailable") return "unavailable";
  if (layout === "loading") return "loading";
  if (row?.state === "connected" || layout === "ready") return "connected";
  if (row) return "unavailable";
  return "loading";
}

// The switch already says on and off. A mark is only a phase with something left to say.
export const machineMarks = {
  loading: { tip: "Loading", color: "muted", icon: "refresh" },
  unavailable: { tip: "Unavailable", color: "blocked", icon: "plug" },
  login: { tip: "Needs a login", color: "blocked", icon: "plug" },
};

export function powerId(name) {
  return name ? `machine-power-${name}` : null;
}

export function machineTitle(name, hostName) {
  return name || hostName || "This computer";
}

export function machineOf(address) {
  const text = String(address ?? "");
  const at = text.indexOf("/");
  return at < 0 ? null : text.slice(0, at);
}

export function visibleSpaces(list, off) {
  if (!off?.size) return list ?? [];
  return (list ?? []).filter((space) => !off.has(space?.machine));
}

export function visibleAgents(list, off) {
  if (!off?.size) return list ?? [];
  return (list ?? []).filter((agent) => !off.has(machineOf(agent?.address)));
}

export function pollKeys(keys, off) {
  const skip = off ?? new Set();
  if (!skip.size) return [...(keys ?? [])];
  return [...(keys ?? [])].filter((key) => {
    try { return !skip.has(JSON.parse(key)[0]); } catch { return true; }
  });
}

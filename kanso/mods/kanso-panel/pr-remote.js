// Pull-request remotes and provider replies, by jlopezlira (https://github.com/jlopezlira/herdr-kanso). Apache-2.0.
// Shared by every provider. A login and a host only: never a token.

export const FRESH_MS = 120_000;
export const SCAN_MS = 10 * 60_000;
export const LIST_CAP = 20;

const SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;

// The panel host has no URL global.
function splitScheme(raw) {
  const hit = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/\s]+@)?([^:/\s]+)(?::\d+)?(?:\/(.*))?$/i.exec(raw);
  if (!hit) return null;
  return { host: hit[1].toLowerCase(), path: (hit[2] ?? "").replace(/\/+$/, "") };
}

function place(host, path) {
  const parts = String(path ?? "").split("/").filter(Boolean);
  if (!host || parts.length < 2 || parts.some((p) => p === "." || p === ".." || /\s/.test(p))) return null;
  return { host: host.toLowerCase(), owner: parts.slice(0, -1).join("/"), name: parts.at(-1) };
}

// SSH (scp or ssh://, with a port) and HTTPS. The last segment is the repository; the rest is the owner, so a GitLab subgroup stays there.
export function parseRemote(url) {
  const raw = String(url ?? "").trim().replace(/\.git$/i, "").replace(/\/+$/, "");
  if (!raw) return null;
  if (SCHEME.test(raw)) {
    const parsed = splitScheme(raw);
    return parsed?.host ? place(parsed.host, parsed.path) : null;
  }
  const scp = /^(?:[^@\s]+@)?([^:\s]+):([^:\s].*)$/.exec(raw);
  return scp ? place(scp[1], scp[2]) : null;
}

export function parsePullRequest(url) {
  const clean = publicUrl(url);
  const parsed = splitScheme(clean);
  const parts = parsed?.path.split("/") ?? [];
  if (parts.at(-2) !== "pull" || !/^\d+$/.test(parts.at(-1) ?? "")) return null;
  const repo = place(parsed.host, parts.slice(0, -2).join("/"));
  return repo ? { ...repo, number: Number(parts.at(-1)), url: clean } : null;
}

export function urlHost(url) {
  const raw = String(url ?? "").trim();
  if (!SCHEME.test(raw)) return null;
  return splitScheme(raw)?.host ?? null;
}

// Drop userinfo so a remote that embeds a token is never stored.
export function publicUrl(url) {
  const raw = String(url ?? "").trim();
  if (!SCHEME.test(raw)) return raw;
  return raw.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^@/\s]+@/i, "$1");
}

export function parseRemotes(text) {
  const urls = String(text ?? "").split("\n").flatMap((line) => {
    const hit = /^\S+\s+(\S+)\s+\((?:fetch|push)\)$/.exec(line.trim());
    return hit ? [hit[1]] : [];
  });
  return [...new Set(urls)];
}

// `gh auth status`. The token line is skipped and nothing else is kept.
export function parseAuth(text) {
  const hosts = String(text ?? "").split("\n").reduce((acc, line) => {
    if (!line.trim() || /^\s*-?\s*Token:/i.test(line)) return acc;
    if (/^\S+$/.test(line)) return [...acc, { host: line.toLowerCase(), login: null, active: false }];
    const current = acc.at(-1);
    if (!current) return acc;
    const logged = /Logged in to \S+ account (\S+)/i.exec(line);
    const active = /Active account:\s*true/i.test(line);
    return [...acc.slice(0, -1), { ...current, login: logged?.[1] ?? current.login, active: current.active || active }];
  }, []);
  return hosts.filter((h) => h.login);
}

export function repoId(provider, host, owner, name) {
  return [provider, host, owner, name].map((s) => String(s ?? "").toLowerCase()).join("|");
}

export function projectSignature(projects) {
  return projects.map((p) => `${p.id}\t${p.folder}\t${p.machine ?? ""}`).toSorted().join("\n");
}

// Hidden: no request. A rate limit waits until retry_at even when the user asks again. Otherwise a manual refresh skips the 120s.
export function fetchDue(row, now, { force = false, shown = true } = {}) {
  if (!shown) return false;
  if (row?.retry_at != null && Number(row.retry_at) > now) return false;
  if (force) return true;
  if (row?.fetched_at == null) return true;
  return now - Number(row.fetched_at) >= FRESH_MS;
}

export function isRateLimit(text) {
  return /HTTP\/[\d.]*\s*429|\b429\b|rate limit|Retry-After:/i.test(String(text ?? ""));
}

export function rateFrom(result, now) {
  if (!result || result.code === 0) return null;
  const text = `${result.stderr ?? ""}\n${result.stdout ?? ""}`;
  if (!isRateLimit(text)) return null;
  const reset = /X-RateLimit-Reset:\s*(\d+)/i.exec(text);
  const after = /Retry-After:\s*(\d+)/i.exec(text);
  const minutes = /reset in\s+(\d+)\s+minute/i.exec(text);
  const parsed = reset ? Number(reset[1]) * 1000 : after ? now + Number(after[1]) * 1000 : minutes ? now + Number(minutes[1]) * 60_000 : now + 60_000;
  return { retryAt: parsed < now ? now + 60_000 : parsed, error: "GitHub is limiting requests" };
}

export function limitLine(retryAt) {
  const d = new Date(retryAt);
  return `GitHub is limiting requests until ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}.`;
}

export function isNew(item) {
  if (item.seenAt == null) return true;
  const at = Date.parse(item.updatedAt);
  return Number.isFinite(at) && at > Number(item.seenAt);
}

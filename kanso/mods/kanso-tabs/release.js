// Kanso, by jlopezlira (https://github.com/jlopezlira/herdr-kanso). Apache-2.0.
// Release order for the updater: a beta, then a release candidate, then the stable version. Source copy; sync:share copies it beside the updater.

const NUM = "(0|[1-9]\\d*)";
const RELEASE = new RegExp(`^v?${NUM}\\.${NUM}\\.${NUM}(?:-(beta|rc)\\.${NUM})?$`);
const RANK = { beta: 0, rc: 1 };

export const bareRelease = (tag) => String(tag ?? "").trim().replace(/^v/, "");

export function parseRelease(v) {
  const m = RELEASE.exec(String(v ?? "").trim());
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), channel: m[4] ?? null, n: m[4] ? Number(m[5]) : null };
}

// Null when either side is not X.Y.Z, X.Y.Z-beta.N or X.Y.Z-rc.N.
export function compareReleases(a, b) {
  const x = parseRelease(a), y = parseRelease(b);
  if (!x || !y) return null;
  if (x.major !== y.major) return x.major - y.major;
  if (x.minor !== y.minor) return x.minor - y.minor;
  if (x.patch !== y.patch) return x.patch - y.patch;
  const xr = x.channel ? RANK[x.channel] : 2, yr = y.channel ? RANK[y.channel] : 2;
  if (xr !== yr) return xr - yr;
  return (x.n ?? 0) - (y.n ?? 0);
}

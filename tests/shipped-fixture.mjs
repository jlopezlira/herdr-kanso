import { databaseTimer, exec, load, nativeWindow, temporary, textFiles } from "./helpers.mjs";

export const DAY = 86400000;
export const HOUR = DAY / 24;
export const iso = (ms) => new Date(ms).toISOString().replace(".000Z", "Z");

export const pullRequest = (number, created, { repo = "me/tool", base = "main", main = "main", merged = null, closed = merged } = {}) => ({
  url: `https://github.com/${repo}/pull/${number}`, number, createdAt: iso(created), baseRefName: base,
  mergedAt: merged === null ? null : iso(merged), closedAt: closed === null ? null : iso(closed),
  mergeCommit: merged === null ? null : { oid: `merge-${number}` },
  repository: { nameWithOwner: repo, owner: { login: repo.split("/")[0] }, defaultBranchRef: main === null ? null : { name: main } },
});

export const shippedHost = async (t, extra = {}) => {
  const home = await temporary(t);
  return { ...textFiles, appHome: () => home, window: nativeWindow, exec, ...extra };
};

export const shippedStore = (host, names = ["Store", "prRow"]) => load("kanso-panel/shipped-store.js", names, host);

export const openedShippedStore = async (host) => {
  const { Store } = await shippedStore(host);
  const store = new Store(databaseTimer);
  await store.open();
  return store;
};

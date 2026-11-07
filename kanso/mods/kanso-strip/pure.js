// Kanso, by jlopezlira (https://github.com/jlopezlira/herdr-kanso). Apache-2.0.
//
// Small helpers so a mod's code never reassigns a name (no let, no var):
// a loop that looks again becomes `retry`, a count becomes `range`, a value
// that may fail to parse becomes `parseOr`. kanso-spaces/pure.js is the one
// you edit (`npm run sync:share` copies it into every mod).

// 0, 1, ... n-1 (from `from`).
export const range = (n, from = 0) => Array.from({ length: Math.max(0, n) }, (_, i) => from + i);

// `fn()`, or `fallback` when it throws.
export const tryOr = (fn, fallback = null) => {
  try { return fn(); } catch { return fallback; }
};
// The same for an async `fn`.
export const tryOrAsync = async (fn, fallback = null) => {
  try { return await fn(); } catch { return fallback; }
};

// JSON text as a value, or `fallback` when it is not JSON.
export const parseOr = (text, fallback = null) => tryOr(() => JSON.parse(text), fallback);

// Up to `times` tries of `fn(k)` (k from 0), `between(k)` awaited after each
// try that is not done: the first answer `done` accepts, else the last one.
export async function retry(times, fn, { done = Boolean, between = async () => {} } = {}, k = 0) {
  const v = await fn(k);
  if (done(v) || k + 1 >= times) return v;
  await between(k);
  return retry(times, fn, { done, between }, k + 1);
}

// The first item of `list` for which async `test(item)` holds, in order, or null.
export async function findAsync(list, test, i = 0) {
  if (i >= list.length) return null;
  return (await test(list[i], i)) ? list[i] : findAsync(list, test, i + 1);
}

// Async `fn` over `list`, one at a time, in order: the answers. Halves,
// left then right, joined once each: no list is copied per item, and the
// depth is only the log of the length.
export async function mapSeries(list, fn, from = 0, to = list.length) {
  if (to - from <= 0) return [];
  if (to - from === 1) return [await fn(list[from], from)];
  const mid = from + Math.floor((to - from) / 2);
  const left = await mapSeries(list, fn, from, mid);
  return left.concat(await mapSeries(list, fn, mid, to));
}

// Async `fn(acc, item)` over `list`, one at a time: the last `acc`.
export async function reduceSeries(list, fn, acc, i = 0) {
  return i >= list.length ? acc : reduceSeries(list, fn, await fn(acc, list[i], i), i + 1);
}

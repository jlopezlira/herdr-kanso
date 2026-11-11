// Kanso, by jlopezlira (https://github.com/jlopezlira/herdr-kanso). Apache-2.0.
// This is the source copy; `npm run sync:share` copies it into every mod.

export const range = (n, from = 0) => Array.from({ length: Math.max(0, n) }, (_, i) => from + i);

export const extOf = (path) => (/\.([^./\\]+)$/.exec(String(path)) ?? [])[1]?.toLowerCase() ?? "";

export const tryOr = (fn, fallback = null) => {
  try { return fn(); } catch { return fallback; }
};
export const tryOrAsync = async (fn, fallback = null) => {
  try { return await fn(); } catch { return fallback; }
};

export const parseOr = (text, fallback = null) => tryOr(() => JSON.parse(text), fallback);

// A panel's first command waits one timer turn: Herdr can lose one started in a remounted view's init turn.
export const afterMount = (cx, start) => cx.timer.after(0, start);

// Herdr can leave a promise unsettled. The timer resolves this instead, so the caller moves on.
export const LATE = Object.freeze({ late: true, code: 1, stdout: "", stderr: "timed out" });

export function bounded(promise, timer, ms = 30_000) {
  if (!timer?.after) return promise;
  const deadline = new Promise((resolve) => { timer.after(ms, () => resolve(LATE)); });
  return Promise.race([promise, deadline]);
}

// A second start while one is out does nothing. The caller stores the state this returns; a lost read frees it after `ms`.
export function runRead(state, timer, ms, read) {
  if (state.busy) return null;
  try {
    const job = bounded(Promise.resolve(read()), timer, ms).then(
      (value) => ({ busy: false, value }),
      () => ({ busy: false }),
    );
    return { state: { busy: true }, job };
  } catch {
    return { state: { busy: false }, job: Promise.resolve({ busy: false }) };
  }
}

// `touch` throws once this build was replaced. Any other throw is one command and the loop stays.
export async function commandTurn(read, touch, act) {
  const live = () => { try { touch(); return true; } catch { return false; } };
  const onward = () => (live() ? "next" : "stop");
  const got = await Promise.resolve().then(read).then((command) => ({ command }), () => null);
  if (!got) return onward();
  if (!live()) return "stop";
  const acted = await Promise.resolve(got.command).then((command) => act(command)).then(() => true, () => false);
  if (!acted) return onward();
  return "next";
}

export async function commandLoop(read, touch, act) {
  for (;;) if (await commandTurn(read, touch, act) === "stop") return;
}

export async function retry(times, fn, { done = Boolean, between = async () => {} } = {}, k = 0) {
  const v = await fn(k);
  if (done(v) || k + 1 >= times) return v;
  await between(k);
  return retry(times, fn, { done, between }, k + 1);
}

export async function findAsync(list, test, i = 0) {
  if (i >= list.length) return null;
  return (await test(list[i], i)) ? list[i] : findAsync(list, test, i + 1);
}

// Halves joined once each, so no list is copied per item and depth stays log n.
export async function mapSeries(list, fn, from = 0, to = list.length) {
  if (to - from <= 0) return [];
  if (to - from === 1) return [await fn(list[from], from)];
  const mid = from + Math.floor((to - from) / 2);
  const left = await mapSeries(list, fn, from, mid);
  return left.concat(await mapSeries(list, fn, mid, to));
}

export async function reduceSeries(list, fn, acc, i = 0) {
  return i >= list.length ? acc : reduceSeries(list, fn, await fn(acc, list[i], i), i + 1);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad2 = (n) => String(n).padStart(2, "0");

export function clock(ms, now = Date.now()) {
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return "";
  const time = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  return new Date(now).toDateString() === d.toDateString() ? time : `${MONTHS[d.getMonth()]} ${d.getDate()} ${time}`;
}

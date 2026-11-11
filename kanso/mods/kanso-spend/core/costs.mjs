// Pricing follows pi-usage: OpenRouter catalog rates matched by model name with a vendor prefix; no price, no guess.
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { atomicWriteJson, isPlainObject } from "./util.mjs";
import { labelText } from "./labels.mjs";

export const CATALOG_URL = "https://openrouter.ai/api/v1/models";
export const CATALOG_TTL = 24 * 60 * 60 * 1000;
const FETCH_MS = 8_000;

// Rates ported from pi-usage pricing.ts.

const dash = (id) => String(id).toLowerCase().replace(/[_.]/g, "-");
const tail = (id) => {
  const name = dash(id);
  return name.slice(name.lastIndexOf("/") + 1);
};
const price = (value) => {
  const n = Number(value);
  return value !== undefined && value !== null && value !== "" && Number.isFinite(n) && n >= 0 ? n : undefined;
};

export function parseCatalog(payload) {
  const rows = payload?.data;
  if (!Array.isArray(rows)) return [];
  const rates = rows.flatMap((row) => {
    const id = typeof row?.id === "string" ? row.id : "";
    if (!id || id.includes(":") || id.startsWith("~")) return [];
    const input = price(row.pricing?.prompt);
    const output = price(row.pricing?.completion);
    if (input === undefined || output === undefined) return [];
    const cacheRead = price(row.pricing?.input_cache_read);
    const cacheWrite = price(row.pricing?.input_cache_write);
    return [{ id, input, output, ...(cacheRead !== undefined ? { cacheRead } : {}), ...(cacheWrite !== undefined ? { cacheWrite } : {}) }];
  });
  return sortRates(rates);
}

function sortRates(rates) {
  return rates.toSorted((a, b) => tail(b.id).length - tail(a.id).length);
}

export function rateFor(rates, provider, model) {
  const name = tail(model);
  const vendor = dash(provider).split("-")[0];
  const needles = vendor && !name.startsWith(`${vendor}-`) ? [name, `${vendor}-${name}`] : [name];
  // The bare name is tried against every rate before the vendor-prefixed one.
  return needles.reduce((found, needle) => found ?? rates.find((rate) => {
    const key = tail(rate.id);
    return needle === key || needle.startsWith(`${key}-`);
  }), undefined);
}

export const isFree = (provider, model) =>
  /:free$/.test(model) || model === "openrouter/free" || model === "free"
  || ["ollama", "lmstudio", "llama-cpp", "llamacpp"].includes(provider);

function estimate(tokens, rate) {
  const cacheRead = tokens.cacheRead && rate.cacheRead !== undefined ? tokens.cacheRead * rate.cacheRead : 0;
  const cacheWrite = tokens.cacheWrite && rate.cacheWrite !== undefined ? tokens.cacheWrite * rate.cacheWrite : 0;
  const unpriced = (tokens.cacheRead && rate.cacheRead === undefined ? tokens.cacheRead : 0)
    + (tokens.cacheWrite && rate.cacheWrite === undefined ? tokens.cacheWrite : 0);
  return { usd: tokens.input * rate.input + tokens.output * rate.output + cacheRead + cacheWrite, unpriced };
}

async function readCatalog(file) {
  try {
    const parsed = JSON.parse(await readFile(file, "utf8"));
    if (Array.isArray(parsed?.rates) && parsed.rates.length) return { fetchedAt: Number(parsed.fetchedAt) || 0, rates: parsed.rates };
  } catch { /* missing */ }
  return null;
}

export function catalogPath(storePath) {
  return path.join(path.dirname(storePath), "pricing.json");
}

/** Freshest catalog between ours and pi-usage's; a failed refresh keeps the last good one. */
export async function loadCatalog(storePath, { home = os.homedir(), refresh = false } = {}) {
  const own = await readCatalog(catalogPath(storePath));
  const shared = await readCatalog(path.join(home, ".prjct/pi-usage/pricing.json"));
  const cached = [own, shared].filter(Boolean).toSorted((a, b) => b.fetchedAt - a.fetchedAt)[0] ?? null;
  const fetched = refresh && (!cached || Date.now() - cached.fetchedAt > CATALOG_TTL) ? await fetchCatalog(storePath) : null;
  return fetched ?? cached ?? { fetchedAt: 0, rates: [] };
}

// Null when offline or empty; an unsavable fresh catalog is still used for this run.
async function fetchCatalog(storePath) {
  try {
    const response = await fetch(CATALOG_URL, { signal: AbortSignal.timeout(FETCH_MS), headers: { accept: "application/json" } });
    if (!response.ok) return null;
    const rates = parseCatalog(await response.json());
    if (!rates.length) return null;
    const fresh = { fetchedAt: Date.now(), rates };
    await atomicWriteJson(catalogPath(storePath), fresh).catch(() => {});
    return fresh;
  } catch {
    return null;
  }
}

/** Optional prices.json next to the store: per-model rates in USD per 1M tokens, and monthly plans. */
export async function loadOverrides(storePath) {
  try {
    const parsed = JSON.parse(await readFile(path.join(path.dirname(storePath), "prices.json"), "utf8"));
    const models = Object.fromEntries(Object.entries(isPlainObject(parsed?.models) ? parsed.models : {}).flatMap(([model, value]) => {
      const input = price(value?.input);
      const output = price(value?.output);
      if (input === undefined || output === undefined) return [];
      const cacheRead = price(value.cacheRead);
      const cacheWrite = price(value.cacheWrite);
      return [[dash(model), {
        id: `override/${model}`,
        input: input / 1e6,
        output: output / 1e6,
        ...(cacheRead !== undefined ? { cacheRead: cacheRead / 1e6 } : {}),
        ...(cacheWrite !== undefined ? { cacheWrite: cacheWrite / 1e6 } : {}),
      }]];
    }));
    const plans = (Array.isArray(parsed?.plans) ? parsed.plans : [])
      .map((plan) => ({ name: String(plan?.name ?? "Plan"), usdPerMonth: price(plan?.usdPerMonth) ?? 0 }))
      .filter((plan) => plan.usdPerMonth > 0);
    return { models, plans };
  } catch {
    return { models: {}, plans: [] };
  }
}

/** Anthropic list prices (USD per 1M tokens), winning over the catalog for Claude models: it has had wrong cache rates for some. */
const ANTHROPIC_PRICES = {
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2 },
  "claude-fable-5-1": { input: 10, output: 50, cacheRead: 0.25 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2 },
};

/** Claude Code writes its prompt cache with the 1-hour TTL. */
const ONE_HOUR_CACHE_HARNESSES = new Set(["claude"]);

function anthropicRate(model, harness) {
  const key = Object.keys(ANTHROPIC_PRICES).find((name) => dash(model) === name || dash(model).startsWith(`${name}-`));
  if (!key) return null;
  const p = ANTHROPIC_PRICES[key];
  const writeFactor = ONE_HOUR_CACHE_HARNESSES.has(harness) ? 2 : 1.25;
  return {
    id: `anthropic/${key}${writeFactor === 2 ? " (1h cache writes)" : ""}`,
    input: p.input / 1e6,
    output: p.output / 1e6,
    cacheRead: p.cacheRead / 1e6,
    cacheWrite: (p.input * writeFactor) / 1e6,
  };
}

function rateOf(catalog, overrides, provider, model, harness = "") {
  if (isFree(provider, model)) return { id: "free", input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  if (!model || model === "unknown") return null;
  return overrides.models[dash(model)]
    ?? anthropicRate(model, harness)
    ?? rateFor(catalog.rates, provider, model)
    ?? null;
}

// Each provider/model/harness rate looked up once: a catalog search per row would be slow over a long history.
function pricer(catalog, overrides, rows) {
  const keyOf = (provider, model, harness = "") => `${provider}\u0001${model}\u0001${harness}`;
  const first = new Map(rows.filter((row) => sumTokens(row.tokens ?? {})).toReversed()
    .map((row) => [keyOf(row.provider, row.model, row.harness), row]));
  const rates = new Map([...first].map(([key, row]) => [key, rateOf(catalog, overrides, row.provider, row.model, row.harness)]));
  return (provider, model, harness = "") => rates.get(keyOf(provider, model, harness)) ?? null;
}

const pad = (n) => String(n).padStart(2, "0");
const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function parseDay(day) {
  const [y, m, d] = String(day).split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** start/end are inclusive day keys; buckets are days or months. */
export function costRange(period, offset, today, firstDay) {
  const now = parseDay(today);
  const shift = Number.isInteger(offset) ? Math.min(0, offset) : 0;
  if (period === "30d") {
    const end = new Date(now); end.setDate(end.getDate() + shift * 30);
    const start = new Date(end); start.setDate(start.getDate() - 29);
    const name = shift === 0 ? "the last 30 days" : `${dayLabelShort(start)} – ${dayLabelShort(end)}`;
    return { period, start: dayKey(start), end: dayKey(end), unit: "day", label: `${dayLabelShort(start)} – ${dayLabelShort(end)}`, name, said: `in ${name}`, months: 30 / 30.44 };
  }
  if (period === "year") {
    const year = now.getFullYear() + shift;
    const name = String(year);
    return { period, start: `${year}-01-01`, end: `${year}-12-31`, unit: "month", label: name, name, said: `in ${name}`, months: 12 };
  }
  if (period === "all") {
    const first = firstDay ? parseDay(firstDay) : now;
    const start = new Date(first.getFullYear(), first.getMonth(), 1);
    const months = (now.getFullYear() - start.getFullYear()) * 12 + now.getMonth() - start.getMonth() + 1;
    const said = `since ${MONTHS_LONG[start.getMonth()]} ${start.getFullYear()}`;
    return { period, start: dayKey(start), end: today, unit: "month", label: "All time", said, months };
  }
  if (period === "day") {
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + shift);
    const date = dayLabelShort(end);
    const said = shift === 0 ? "today" : shift === -1 ? "yesterday" : `on ${date}`;
    const bare = said.replace(/^on /, "");
    return { period, start: dayKey(end), end: dayKey(end), unit: "day", label: shift === 0 ? "Today" : shift === -1 ? "Yesterday" : date, ...(bare === said ? {} : { name: bare }), said, months: 1 / 30.44 };
  }
  const first = new Date(now.getFullYear(), now.getMonth() + shift, 1);
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0);
  const name = MONTHS_LONG[first.getMonth()] + (first.getFullYear() === now.getFullYear() ? "" : ` ${first.getFullYear()}`);
  return { period: "month", start: dayKey(first), end: dayKey(last), unit: "day", label: `${MONTHS_LONG[first.getMonth()]} ${first.getFullYear()}`, name, said: `in ${name}`, months: 1 };
}

function dayLabelShort(d) {
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

export function previousRange(range, today, firstDay) {
  if (range.period === "all") return null;
  const now = parseDay(today);
  const start = parseDay(range.start);
  const offset = range.period === "year" ? start.getFullYear() - now.getFullYear() - 1
    : range.period === "month" ? (start.getFullYear() - now.getFullYear()) * 12 + start.getMonth() - now.getMonth() - 1
      : range.period === "day" ? Math.round((start - now) / 86400000) - 1
        : Math.round((parseDay(range.end) - now) / (30 * 86400000)) - 1;
  return costRange(range.period, offset, today, firstDay);
}

const unfold = (first, next, keep) => (keep(first) ? [first, ...unfold(next(first), next, keep)] : []);
// The same local time a day or a month later, without mutating a Date as setDate/setMonth would.
const dayAfter = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds());
const monthAfter = (d) => new Date(d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds());

function buckets(range) {
  const end = parseDay(range.end);
  if (range.unit === "day") {
    return unfold(parseDay(range.start), dayAfter, (d) => d <= end)
      .map((d) => ({ key: dayKey(d), label: String(d.getDate()), tip: dayLabelShort(d), usd: 0, tokens: 0 }));
  }
  return unfold(parseDay(range.start), monthAfter, (d) => d <= end)
    .map((d) => ({ key: dayKey(d).slice(0, 7), label: MONTHS[d.getMonth()], tip: `${MONTHS[d.getMonth()]} ${d.getFullYear()}`, usd: 0, tokens: 0 }));
}

// Display text is prepared here so the native render pass only lays it out.

const group3 = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
export function usdText(value, exact = false) {
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return "$0";
  if (exact) {
    const [whole, cents] = Math.abs(n).toFixed(2).split(".");
    return `${n < 0 ? "-" : ""}$${group3(Number(whole))}.${cents}`;
  }
  const abs = Math.abs(n);
  if (abs < 0.01) return "<$0.01";
  if (abs < 100) return `$${n.toFixed(2)}`;
  return `${n < 0 ? "-" : ""}$${group3(abs)}`;
}
export function compactText(value) {
  const n = Number(value) || 0;
  const unit = [[1e12, "T"], [1e9, "B"], [1e6, "M"], [1e3, "K"]].find(([d]) => n >= d * 0.9995);
  if (!unit) return String(Math.round(n));
  const [d, s] = unit;
  const v = n / d;
  return `${v >= 100 ? Math.round(v) : Number(v.toFixed(v >= 10 ? 1 : 2))}${s}`;
}
const intText = (n) => group3(Number(n) || 0);
const rateText = (n) => (n >= 1 ? String(Number(n.toFixed(2))) : String(Number(n.toPrecision(2))));
function dayText(day) {
  const d = parseDay(day);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

const sumTokens = (t) => (t.input || 0) + (t.output || 0) + (t.cacheRead || 0) + (t.cacheWrite || 0);
const projectLabel = (p) => {
  const text = String(p ?? "").replace(/[\\/]+$/, "");
  if (!text || text === "unknown") return "Unknown project";
  return text.split(/[\\/]/).at(-1) || text;
};

// Totals are summed in row order, as a running total would, so every figure comes out to the same last digit.
const sumOf = (list, value) => list.reduce((sum, item) => sum + value(item), 0);
// One pass to group and one per group: stays linear over a long history.
const groupInto = (list, key, make) => new Map([...Map.groupBy(list, key)].map(([k, items]) => [k, make(items)]));
const usdOf = (item) => item.usd;
const countOf = (item) => item.count;
const unpricedOf = (item) => item.unpriced;
const earliest = (days) => days.reduce((min, day) => (day < min ? day : min));
const latest = (days) => days.reduce((max, day) => (day > max ? day : max));

/** Sessions still being written (file changed in the last half hour): whole-session totals, ignoring period and filters. */
function liveCosts(rows, live, price, labels) {
  if (!live?.size) return [];
  const items = rows.flatMap((row) => {
    if (!live.has(row.session)) return [];
    const tokens = row.tokens ?? {};
    const count = sumTokens(tokens);
    if (!count) return [];
    const rate = price(row.provider, row.model, row.harness);
    return [{ row, tokens, count, usd: rate ? estimate(tokens, rate).usd : 0 }];
  });
  const sessions = groupInto(items, (item) => item.row.session, (group) => ({
    session: group[0].row.session,
    harness: group[0].row.harness,
    project: group[0].row.project,
    usd: sumOf(group, usdOf),
    tokens: sumOf(group, countOf),
    // A model's weight is its cost, with its tokens breaking ties between free ones.
    models: groupInto(group, (item) => item.row.model, (same) => same.reduce((sum, item) => sum + item.usd + item.count * 1e-12, 0)),
    breakdown: breakdownOf(group),
  }));
  const harnessName = HARNESS_NAMES;
  return [...sessions.values()]
    .toSorted((a, b) => (live.get(b.session) ?? 0) - (live.get(a.session) ?? 0))
    .slice(0, 5)
    .map((s) => {
      const label = labels?.sessions?.[s.session];
      const ticket = label?.tickets?.[0] ?? null;
      const model = [...s.models.entries()].toSorted((a, b) => b[1] - a[1])[0]?.[0] ?? "unknown";
      const minutes = Math.max(0, Math.round((Date.now() - (live.get(s.session) ?? Date.now())) / 60000));
      return {
        detail: breakdownDetail(s.breakdown, {
          title: cleanTitle(label?.prompt || labelText(label, s.session)), ticket, project: s.project, usd: s.usd, tokens: s.tokens,
        }),
        ticket,
        title: cleanTitle(ticket ? (label?.prompt || ticket) : labelText(label, s.session)),
        tip: label?.prompt || labelText(label, s.session),
        meta: [harnessName[s.harness] ?? s.harness, model, projectLabel(s.project), minutes < 1 ? "active now" : `${minutes} min ago`],
        usdText: usdText(s.usd),
        tokensText: `${compactText(s.tokens)} tok`,
      };
    });
}

const HARNESS_NAMES = { claude: "Claude Code", codex: "Codex", pi: "Pi", opencode: "OpenCode" };

function breakdownOf(items) {
  return {
    input: sumOf(items, (item) => item.tokens.input || 0),
    output: sumOf(items, (item) => item.tokens.output || 0),
    cacheRead: sumOf(items, (item) => item.tokens.cacheRead || 0),
    cacheWrite: sumOf(items, (item) => item.tokens.cacheWrite || 0),
    models: groupInto(items, (item) => item.row.model, (group) => ({ usd: sumOf(group, usdOf), tokens: sumOf(group, countOf) })),
    sessions: groupInto(items, (item) => item.row.session, (group) => {
      const days = group.map((item) => item.row.day);
      return { usd: sumOf(group, usdOf), tokens: sumOf(group, countOf), first: earliest(days), last: latest(days) };
    }),
    harnesses: new Set(items.map((item) => item.row.harness)),
  };
}

function breakdownDetail(b, { title, ticket, project, usd, tokens }) {
  const span = (first, last) => (first === last ? dayText(first) : `${dayText(first)} – ${dayText(last)}`);
  const sessions = [...b.sessions.entries()].toSorted((a, c) => c[1].usd - a[1].usd);
  const first = sessions.reduce((min, [, s]) => (!min || s.first < min ? s.first : min), null);
  const last = sessions.reduce((max, [, s]) => (!max || s.last > max ? s.last : max), null);
  return {
    title,
    ticket,
    project: projectLabel(project),
    projectPath: project,
    when: first ? span(first, last) : "",
    tools: [...b.harnesses].map((h) => HARNESS_NAMES[h] ?? h).join(", "),
    usdText: usdText(usd),
    usdExact: usdText(usd, true),
    tokensText: compactText(tokens),
    parts: [
      { label: "Input", value: compactText(b.input) },
      { label: "Output", value: compactText(b.output) },
      { label: "Cache read", value: compactText(b.cacheRead) },
      { label: "Cache write", value: compactText(b.cacheWrite) },
    ],
    models: [...b.models.entries()].toSorted((a, c) => c[1].usd - a[1].usd).slice(0, 6)
      .map(([name, m]) => ({ name, usdText: usdText(m.usd), tokensText: compactText(m.tokens) })),
    sessions: sessions.slice(0, 8).map(([id, s]) => ({
      name: `Session ${String(id).split(":").at(-1).slice(0, 8)}`,
      when: span(s.first, s.last),
      usdText: usdText(s.usd),
      tokensText: compactText(s.tokens),
    })),
    sessionCount: sessions.length,
  };
}

/** Pasted-image markers say nothing about the task. */
function cleanTitle(text) {
  return String(text ?? "").replace(/\[Image #\d+\]\s*/g, "").trim() || String(text ?? "");
}

export function deriveCosts(rows, { catalog, overrides, labels, options = {}, today, live = null }) {
  const price = pricer(catalog ?? { rates: [] }, overrides ?? { models: {}, plans: [] }, rows);
  const firstDay = rows.reduce((min, row) => (!min || row.day < min ? row.day : min), null);
  const range = costRange(options.period ?? "day", Number(options.offset) || 0, today, firstDay);
  const previous = previousRange(range, today, firstDay);
  const project = options.project && options.project !== "all" ? options.project : null;
  const model = options.model && options.model !== "all" ? options.model : null;

  const priced = rows.flatMap((row) => {
    const tokens = row.tokens ?? {};
    const count = sumTokens(tokens);
    if (!count) return [];
    const rate = price(row.provider, row.model, row.harness);
    const { usd, unpriced } = rate ? estimate(tokens, rate) : { usd: 0, unpriced: count };
    const inPrevious = previous && row.day >= previous.start && row.day <= previous.end;
    const inRange = row.day >= range.start && row.day <= range.end;
    return inRange || inPrevious ? [{ row, tokens, count, rate, usd, unpriced, inRange }] : [];
  });

  // Facets ignore their own filter so the menu always lists every choice.
  const projectFacet = groupInto(priced.filter((item) => item.inRange && (!model || item.row.model === model)), (item) => item.row.project,
    (group) => ({ usd: sumOf(group, usdOf), tokens: sumOf(group, countOf), unpriced: 0 }));
  const modelFacet = groupInto(priced.filter((item) => item.inRange && (!project || item.row.project === project)), (item) => item.row.model,
    (group) => ({ provider: group[0].row.provider, usd: sumOf(group, usdOf), tokens: sumOf(group, countOf), unpriced: 0 }));
  const chosen = priced.filter((item) => !((project && item.row.project !== project) || (model && item.row.model !== model)));
  const previousUsd = sumOf(chosen.filter((item) => !item.inRange), usdOf);
  const current = chosen.filter((item) => item.inRange);

  const total = {
    usd: sumOf(current, usdOf),
    tokens: sumOf(current, countOf),
    unpriced: sumOf(current, unpricedOf),
    input: sumOf(current, (item) => item.tokens.input || 0),
    output: sumOf(current, (item) => item.tokens.output || 0),
    cacheRead: sumOf(current, (item) => item.tokens.cacheRead || 0),
    cacheWrite: sumOf(current, (item) => item.tokens.cacheWrite || 0),
    sessions: new Set(current.map((item) => item.row.session)),
  };

  const perBucket = Map.groupBy(current, (item) => (range.unit === "day" ? item.row.day : item.row.day.slice(0, 7)));
  const chart = buckets(range).map((bucket) => {
    const group = perBucket.get(bucket.key) ?? [];
    return { ...bucket, usd: sumOf(group, usdOf), tokens: sumOf(group, countOf) };
  });

  const projects = groupInto(current, (item) => item.row.project, (group) => ({
    sessions: new Set(group.map((item) => item.row.session)),
    usd: sumOf(group, usdOf), tokens: sumOf(group, countOf), unpriced: sumOf(group, unpricedOf),
  }));

  const models = groupInto(current, (item) => item.row.model, (group) => ({
    model: group[0].row.model,
    providers: new Set(group.map((item) => item.row.provider)),
    rate: group.find((item) => item.rate)?.rate ?? group[0].rate,
    input: sumOf(group, (item) => item.tokens.input || 0),
    output: sumOf(group, (item) => item.tokens.output || 0),
    cacheRead: sumOf(group, (item) => item.tokens.cacheRead || 0),
    cacheWrite: sumOf(group, (item) => item.tokens.cacheWrite || 0),
    usd: sumOf(group, usdOf), tokens: sumOf(group, countOf), unpriced: sumOf(group, unpricedOf),
  }));

  const taskKey = (item) => {
    const ticket = labels?.sessions?.[item.row.session]?.tickets?.[0];
    return ticket ? `ticket:${item.row.project}:${ticket}` : item.row.session;
  };
  const tasks = groupInto(current, taskKey, (group) => {
    const { row } = group[0];
    const label = labels?.sessions?.[row.session];
    const ticket = label?.tickets?.[0];
    const days = group.map((item) => item.row.day);
    return {
      label: ticket ? (label?.name ? `${ticket} · ${label.name}` : ticket) : labelText(label, row.session),
      prompt: ticket && label?.prompt ? label.prompt : "",
      ticket: ticket ?? null,
      project: row.project,
      harness: row.harness,
      sessions: new Set(group.map((item) => item.row.session)),
      models: groupInto(group, (item) => item.row.model, (same) => sumOf(same, usdOf)),
      first: earliest(days),
      last: latest(days),
      breakdown: breakdownOf(group),
      usd: sumOf(group, usdOf), tokens: sumOf(group, countOf), unpriced: sumOf(group, unpricedOf),
    };
  });

  const share = (usd) => (total.usd > 0 ? usd / total.usd : 0);
  const byUsd = (a, b) => b.usd - a.usd || b.tokens - a.tokens;
  const sessions = total.sessions.size;
  const taskList = [...tasks.values()].toSorted(byUsd);
  const plans = overrides?.plans ?? [];
  const planMonthly = plans.reduce((sum, plan) => sum + plan.usdPerMonth, 0);
  const planUsd = planMonthly * range.months;

  const change = previous && previousUsd > 0 ? (total.usd - previousUsd) / previousUsd : null;
  const perMonth = range.months > 0 ? total.usd / range.months : total.usd;
  const longPeriod = range.period === "all" || range.period === "year";
  const maxBucket = chart.reduce((max, b) => Math.max(max, b.usd), 0);
  const labelStep = chart.length > 16 ? 5 : 1;
  const when = catalog?.fetchedAt ? new Date(catalog.fetchedAt) : null;

  const prevName = previous ? (range.period === "30d" ? "the 30 days before" : (previous.name ?? previous.said)) : null;
  const said = change !== null && Math.abs(change) >= 0.01 ? `${Math.abs(Math.round(change * 100))}% ${change > 0 ? "more" : "less"} than ${prevName}`
    : change !== null ? `About the same as ${prevName}`
      : range.period === "all" ? `${usdText(perMonth)} a month ${range.said}`
        : "";
  const note = said ? said[0].toUpperCase() + said.slice(1) : "";

  return {
    version: 3,
    live: liveCosts(rows, live, price, labels),
    hero: {
      value: usdText(total.usd),
      usd: total.usd,
      tokens: total.tokens,
      tip: `${usdText(total.usd, true)} at API list price`,
      title: range.period === "all" ? "All time" : range.period === "30d" ? "Last 30 days" : range.label,
      note,
      empty: total.tokens === 0 ? `Nothing used ${range.said}. Try another period.` : null,
      stats: [
        { value: intText(tasks.size), unit: tasks.size === 1 ? "task" : "tasks", tip: `${intText(sessions)} sessions` },
        { value: usdText(tasks.size ? total.usd / tasks.size : 0), unit: "per task", tip: "API value divided by tasks" },
        ...(longPeriod ? [{ value: usdText(perMonth), unit: "a month", tip: `Average over ${Math.round(range.months)} months` }] : []),
        {
          value: compactText(total.tokens),
          unit: "tokens",
          tip: `in ${intText(total.input)} · out ${intText(total.output)} · cache read ${intText(total.cacheRead)} · cache write ${intText(total.cacheWrite)}${total.unpriced > 0 ? ` · ${intText(total.unpriced)} without a list price` : ""}`,
        },
      ],
      plan: planMonthly > 0 ? `Your plans cost ${usdText(planUsd)} in this period, so they saved you ${usdText(total.usd - planUsd)}.` : null,
    },
    range: { period: range.period, start: range.start, end: range.end, label: range.label, unit: range.unit, offset: Number(options.offset) || 0 },
    filters: { project: project ?? "all", model: model ?? "all" },
    chart: {
      title: range.unit === "day" ? "Per day" : "Per month",
      first: chart[0]?.tip ?? "",
      last: chart[chart.length - 1]?.tip ?? "",
      peak: maxBucket > 0 ? `peak ${usdText(maxBucket)}` : "",
      bars: chart.map((b, index) => ({
        ratio: maxBucket > 0 ? b.usd / maxBucket : 0,
        peak: maxBucket > 0 && b.usd === maxBucket,
        value: maxBucket > 0 && b.usd === maxBucket ? usdText(b.usd) : "",
        label: index % labelStep === 0 ? b.label : "",
        tip: `${b.tip} · ${usdText(b.usd)} · ${compactText(b.tokens)} tokens`,
      })),
    },
    projects: [...projects.entries()].map(([value, p]) => ({
      value, name: projectLabel(value), detail: value, usd: p.usd, share: share(p.usd),
      usdText: usdText(p.usd), tokensText: compactText(p.tokens),
    })).toSorted((a, b) => b.usd - a.usd).slice(0, 30),
    projectCount: intText(projects.size),
    models: [...models.values()].toSorted(byUsd).slice(0, 30).map((m) => {
      const providers = [...m.providers].join(", ");
      const rate = m.rate;
      return {
        value: m.model,
        name: rate ? m.model : `${m.model} · unpriced`,
        detail: rate
          ? `${providers} · $${rateText(rate.input * 1e6)} in / $${rateText(rate.output * 1e6)} out${rate.cacheRead !== undefined ? ` / $${rateText(rate.cacheRead * 1e6)} cached` : ""} per 1M (${rate.id})`
          : `${providers} · no list price`,
        usd: m.usd, share: share(m.usd), usdText: usdText(m.usd), tokensText: compactText(m.tokens),
      };
    }),
    modelCount: intText(models.size),
    tasks: taskList.slice(0, 20).map((t) => {
      const days = t.first === t.last ? dayText(t.first) : `${dayText(t.first)} – ${dayText(t.last)}`;
      const top = [...t.models.entries()].toSorted((a, b) => b[1] - a[1])[0]?.[0] ?? "unknown";
      const title = cleanTitle(t.ticket ? (t.prompt || t.label.replace(`${t.ticket} · `, "")) : t.label);
      return {
        detail: breakdownDetail(t.breakdown, { title: cleanTitle(t.prompt || t.label), ticket: t.ticket, project: t.project, usd: t.usd, tokens: t.tokens }),
        ticket: t.ticket,
        title,
        tip: t.prompt || t.label,
        meta: [projectLabel(t.project), top, days, t.sessions.size > 1 ? `${t.sessions.size} sessions` : null].filter(Boolean),
        projectPath: t.project,
        usdText: usdText(t.usd),
        tokensText: `${compactText(t.tokens)} tok`,
      };
    }),
    tasksNote: `${intText(tasks.size)} in ${range.label}`,
    facets: {
      project: [...projectFacet.entries()].toSorted((a, b) => b[1].usd - a[1].usd).slice(0, 80)
        .map(([value, f]) => ({ value, label: projectLabel(value), meta: usdText(f.usd) })),
      model: [...modelFacet.entries()].toSorted((a, b) => b[1].usd - a[1].usd).slice(0, 80)
        .map(([value, f]) => ({ value, label: value, detail: f.provider, meta: usdText(f.usd) })),
    },
    footnote: [
      `Prices are OpenRouter list prices${when ? ` from ${MONTHS[when.getMonth()]} ${when.getDate()}` : ""}, the same ones pi-usage uses. Tokens with no list price are left out, not guessed.`,
      "Sessions that mention the same ticket count as one task. Set your own prices or plans in Settings or prices.json.",
    ],
  };
}

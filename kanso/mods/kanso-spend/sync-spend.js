// Adds other computers' spend to the total this one already priced. Each ledger stays whole.
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { compactText, usdText } from "./core/costs.mjs";
import { configFrom, identityFrom, identityText, mergeRows, rowFromCosts, rowsFrom, syncOn, tokensOf } from "./sync.js";
import { aliasText, machineTitle } from "./pure.js";

const read = (file) => readFile(file, "utf8").catch(() => "");

export async function attachSync(costs, storePath, options) {
  try {
    if (!costs?.hero || costs.machines) return costs;
    const dir = path.join(path.dirname(storePath), "..", "kanso-sync");
    const config = configFrom(await read(path.join(dir, "config.json")));
    if (!syncOn(config)) return costs;
    await mkdir(dir, { recursive: true });
    const idFile = path.join(dir, "identity.json");
    const identity = identityFrom(await read(idFile), () => randomUUID(), new Date().toISOString());
    if (identity.fresh) await writeFile(idFile, identityText(identity));
    const rows = rowsFrom(await read(path.join(dir, "rows.json")));
    return foldCosts({ ...costs, syncSelf: identity.id }, { self: identity.id, rows, options });
  } catch {
    return costs;
  }
}

const localOf = (costs) => costs.local ?? {
  usd: costs.hero.usd, tokens: costs.hero.tokens, value: costs.hero.value ?? "", tokensText: tokensOf(costs), month: costs.month ?? null,
};

function foldMonth(month, rows) {
  if (!month?.start) return month;
  const same = rows.filter((row) => row.body.month?.start === month.start && row.body.month.byProvider);
  const byProvider = same.reduce((acc, row) => Object.entries(row.body.month.byProvider)
    .reduce((sum, [provider, usd]) => ({ ...sum, [provider]: (sum[provider] ?? 0) + (Number(usd) || 0) }), acc), {});
  return { ...month, byProvider };
}

const dayOf = (at) => {
  const d = new Date(at);
  return Number.isNaN(d.getTime()) ? "" : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

function sameSpan(row, period, start) {
  if (period === "all" || !start) return true;
  return row.body.start ? row.body.start === start : dayOf(row.updated_at) >= start;
}

export function foldCosts(costs, { self, rows, options }) {
  const cost = options?.cost ?? {};
  const filtered = (cost.project ?? "all") !== "all" || (cost.model ?? "all") !== "all";
  if (!costs?.hero || costs.machines || !Number.isFinite(Number(costs.hero.usd))) return costs;
  const own = self ? rowFromCosts(costs, self, new Date().toISOString(), options) : null;
  const spend = mergeRows(rows ?? [], own ? [own] : []).filter((row) => row.kind === "spend" && row.body);
  if (spend.length < 2) return costs;
  const local = localOf(costs);
  const peerMonth = Boolean(costs.month?.start) && spend.some((row) => row.machine !== self && row.body.month?.start === costs.month.start);
  const base = peerMonth ? { ...costs, local, month: foldMonth(costs.month, spend) } : costs;
  if (filtered) return base;
  const period = cost.period ?? "month";
  const offset = Number(cost.offset) || 0;
  const lines = spend.filter((row) => (
    row.body.period === period && Number(row.body.offset) === offset && Number.isFinite(Number(row.body.usd))
    && sameSpan(row, period, costs.range?.start)
  ));
  if (lines.length < 2) return base;
  const usd = lines.reduce((sum, row) => sum + Number(row.body.usd), 0);
  const tokens = lines.reduce((sum, row) => sum + Number(row.body.tokens || 0), 0);
  const machines = lines.map((row) => ({
    id: row.machine,
    name: machineTitle(row.machine === self ? "" : (row.body.name || ""), row.machine === self ? "" : (row.body.name ? "" : "Another computer"), aliasText(options?.aliases, row.machine === self ? "" : (row.body.name || ""))),
    value: row.body.value ?? "",
    tokensText: row.body.tokensText ?? "",
    updated_at: row.updated_at,
  })).toSorted((a, b) => (a.id === self ? -1 : b.id === self ? 1 : a.name.localeCompare(b.name)));
  return {
    ...base,
    local,
    hero: {
      ...costs.hero,
      value: usdText(usd),
      tip: `${usdText(usd, true)} at API list price`,
      usd, tokens, note: "", empty: null,
      stats: (costs.hero.stats ?? []).map((stat) => (stat.unit === "tokens" ? { ...stat, value: compactText(tokens), tip: `${compactText(tokens)} tokens` } : stat)),
    },
    machines,
  };
}

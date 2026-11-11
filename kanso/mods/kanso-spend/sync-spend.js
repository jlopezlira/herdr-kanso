// Adds other computers' spend to the total this one already priced. Each ledger stays whole.
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { compactText, usdText } from "./core/costs.mjs";
import { configFrom, identityFrom, identityText, mergeRows, rowFromCosts, rowsFrom, syncOn } from "./sync.js";

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

export function foldCosts(costs, { self, rows, options }) {
  const cost = options?.cost ?? {};
  const filtered = (cost.project ?? "all") !== "all" || (cost.model ?? "all") !== "all";
  if (filtered || !costs?.hero || costs.machines || !Number.isFinite(Number(costs.hero.usd))) return costs;
  const own = self ? rowFromCosts(costs, self, new Date().toISOString(), options) : null;
  const period = cost.period ?? "month";
  const offset = Number(cost.offset) || 0;
  const lines = mergeRows(rows ?? [], own ? [own] : []).filter((row) => (
    row.kind === "spend" && row.body && row.body.period === period && Number(row.body.offset) === offset && Number.isFinite(Number(row.body.usd))
  ));
  if (lines.length < 2) return costs;
  const usd = lines.reduce((sum, row) => sum + Number(row.body.usd), 0);
  const tokens = lines.reduce((sum, row) => sum + Number(row.body.tokens || 0), 0);
  const machines = lines.map((row) => ({
    id: row.machine,
    name: row.machine === self ? "This computer" : (row.body.name || "Another computer"),
    value: row.body.value ?? "",
    tokensText: row.body.tokensText ?? "",
    updated_at: row.updated_at,
  })).toSorted((a, b) => (a.id === self ? -1 : b.id === self ? 1 : a.name.localeCompare(b.name)));
  return {
    ...costs,
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

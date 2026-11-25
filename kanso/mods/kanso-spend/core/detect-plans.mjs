import { readFile } from "node:fs/promises";
import path from "node:path";

const CLAUDE_TIERS = [
  { test: /max_20x/i, name: "Claude Max 20x", usdPerMonth: 200 },
  { test: /max_5x|claude_max/i, name: "Claude Max 5x", usdPerMonth: 100 },
  { test: /claude_pro|pro/i, name: "Claude Pro", usdPerMonth: 20 },
];

export function claudePlan(profile) {
  const account = profile?.oauthAccount ?? {};
  const said = `${account.organizationRateLimitTier ?? ""} ${account.organizationType ?? ""}`;
  const tier = said.trim() ? CLAUDE_TIERS.find((t) => t.test.test(said)) : null;
  return tier ? { name: tier.name, usdPerMonth: tier.usdPerMonth, providers: ["anthropic"], detected: true } : null;
}

export async function detectPlans(home) {
  const profile = await readFile(path.join(home, ".claude.json"), "utf8").then(JSON.parse).catch(() => null);
  return [claudePlan(profile)].filter(Boolean);
}

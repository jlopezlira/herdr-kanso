import { usdText } from "./costs.mjs";

const EARLY_DAYS = 7;
const FAMILIES = [
  { test: /claude|anthropic/i, providers: ["anthropic"] },
  { test: /chatgpt|openai|codex|gpt/i, providers: ["openai", "openai-codex"] },
  { test: /grok|xai|x\.ai/i, providers: ["xai"] },
];

const known = (plan) => (Array.isArray(plan.providers) && plan.providers.length
  ? plan.providers.map(String)
  : FAMILIES.find((family) => family.test.test(plan.name))?.providers ?? null);

export function planProviders(plans, byProvider) {
  const named = plans.map(known);
  const claimed = new Set(named.flat().filter(Boolean));
  const rest = Object.keys(byProvider ?? {}).filter((provider) => !claimed.has(provider));
  return named.map((providers) => providers ?? rest);
}

export function multipleText(ratio) {
  if (!(ratio > 0)) return "0×";
  if (ratio >= 10) return `${Math.round(ratio)}×`;
  return `${Number(ratio.toFixed(1))}×`;
}

const dayCount = (n) => `${n} ${n === 1 ? "day" : "days"}`;

function workOf(plans, byProvider) {
  const covers = planProviders(plans, byProvider);
  const priceOn = (provider) => plans.reduce((sum, plan, i) => sum + (covers[i].includes(provider) ? plan.usdPerMonth : 0), 0);
  return plans.map((plan, i) => covers[i].reduce((sum, provider) => {
    const usd = Number(byProvider?.[provider]) || 0;
    const price = priceOn(provider);
    return sum + (price > 0 ? usd * (plan.usdPerMonth / price) : 0);
  }, 0));
}

export function planLines(plans, month) {
  const list = (Array.isArray(plans) ? plans : []).filter((plan) => plan?.name && plan.usdPerMonth > 0);
  if (!list.length || !month) return [];
  const early = month.day < EARLY_DAYS;
  return workOf(list, month.byProvider).map((work, i) => {
    const plan = list[i];
    const ratio = work / plan.usdPerMonth;
    const under = !early && ratio < 1;
    const pace = month.day > 0 ? (work / month.day) * month.days : 0;
    return {
      name: plan.name,
      multiple: multipleText(ratio),
      unit: early ? `${plan.name} · too early to say` : plan.name,
      detail: early
        ? `on pace: ${usdText(work)} in ${dayCount(month.day)}, about ${usdText(pace)} by ${month.name} ${month.days}`
        : `${usdText(work)} of work for ${usdText(plan.usdPerMonth)}${under ? " · not paying for itself" : ""}`,
      tone: early ? "dim" : under ? "working" : "",
    };
  });
}

export function withDetected(plans, detected) {
  const own = Array.isArray(plans) ? plans : [];
  const covered = new Set(own.map(known).flat().filter(Boolean));
  return [...own, ...detected.filter((plan) => !plan.providers.some((provider) => covered.has(provider)))];
}

export const withPlans = (costs) => (costs?.month ? { ...costs, plans: planLines(costs.planList, costs.month) } : costs);

import { usdText } from "./costs.mjs";

const EARLY_DAYS = 7;
const FAMILIES = [
  { test: /claude|anthropic/i, providers: ["anthropic"] },
  { test: /chatgpt|openai|codex|gpt/i, providers: ["openai", "openai-codex"] },
  { test: /grok|xai|x\.ai/i, providers: ["xai"] },
  { test: /gemini|google/i, providers: ["google", "gemini"] },
];

const known = (plan) => (Array.isArray(plan.providers) && plan.providers.length
  ? plan.providers.map(String)
  : FAMILIES.find((family) => family.test.test(plan.name))?.providers ?? null);


export function multipleText(ratio) {
  if (!(ratio > 0)) return "0×";
  if (ratio >= 10) return `${Math.round(ratio)}×`;
  return `${Number(ratio.toFixed(1))}×`;
}

const dayCount = (n) => `${n} ${n === 1 ? "day" : "days"}`;

function workOf(plans, byProvider) {
  const covers = plans.map(known);
  const priceOn = (provider) => plans.reduce((sum, plan, i) => sum + (covers[i].includes(provider) ? plan.usdPerMonth : 0), 0);
  return plans.map((plan, i) => covers[i].reduce((sum, provider) => {
    const usd = Number(byProvider?.[provider]) || 0;
    const price = priceOn(provider);
    return sum + (price > 0 ? usd * (plan.usdPerMonth / price) : 0);
  }, 0));
}

export function planLines(plans, month) {
  const list = (Array.isArray(plans) ? plans : []).filter((plan) => plan?.name && plan.usdPerMonth > 0 && known(plan));
  if (!list.length || !month) return [];
  const early = month.day < EARLY_DAYS;
  const works = workOf(list, month.byProvider);
  const order = list.map((plan, i) => i).toSorted((a, b) => works[b] / list[b].usdPerMonth - works[a] / list[a].usdPerMonth);
  return order.map((i) => {
    const work = works[i];
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

export function savingText(plans, usd, months) {
  const monthly = (Array.isArray(plans) ? plans : []).reduce((sum, plan) => sum + (plan?.usdPerMonth > 0 ? plan.usdPerMonth : 0), 0);
  if (!(monthly > 0) || !(months > 0) || !Number.isFinite(Number(usd))) return null;
  const paid = monthly * months;
  return `Your plans cost ${usdText(paid)} in this period, so they saved you ${usdText(Number(usd) - paid)}.`;
}

export const withPlans = (costs) => (costs?.month ? {
  ...costs,
  plans: planLines(costs.planList, costs.month),
  hero: costs.hero ? { ...costs.hero, plan: savingText(costs.planList, costs.hero.usd, costs.range?.months) } : costs.hero,
} : costs);

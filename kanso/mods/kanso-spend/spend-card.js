// Spend's share card, by jlopezlira (https://github.com/jlopezlira/herdr-kanso). Apache-2.0.
// Only the unfiltered totals are shared: never a project, task or session name.
import { postText } from "./share.js";

const plain = (s) => String(s ?? "").trim();

export function spendSpec(costs) {
  const hero = costs.hero ?? {};
  const stats = [
    ...(hero.stats ?? []).map((x) => ({ value: plain(x.value), unit: plain(x.unit) })),
    ...(costs.projectCount ? [{ value: plain(costs.projectCount), unit: costs.projectCount === "1" ? "project" : "projects" }] : []),
    ...(costs.modelCount ? [{ value: plain(costs.modelCount), unit: costs.modelCount === "1" ? "model" : "models" }] : []),
  ];
  const note = plain(hero.note);
  const chart = costs.chart;
  return {
    title: "Spend",
    right: plain(costs.range?.label ?? hero.title),
    hero: { big: plain(hero.value) || "—", label: "of AI work at API list price", delta: /more/i.test(note) ? { up: true, text: note } : null }, // a brag: only a rise
    stats,
    note: hero.plan ? plain(hero.plan) : "",
    blocks: chart?.bars?.length ? [{
      kind: "bars", title: plain(chart.title), right: plain(chart.peak),
      values: chart.bars.map((b) => (Number.isFinite(b.ratio) ? b.ratio : 0)),
      ticks: [plain(chart.first), plain(chart.last)].filter(Boolean),
    }] : [],
  };
}

export function spendText(costs) {
  const hero = costs.hero ?? {};
  const when = plain(costs.range?.label ?? hero.title);
  const parts = [
    ...(hero.value ? [`${plain(hero.value)} of AI work at list price${when ? ` in ${when}` : ""}`] : []),
    ...(hero.stats ?? []).filter((x) => /^(tasks?|tokens)$/.test(plain(x.unit))).map((x) => `${plain(x.value)} ${plain(x.unit)}`),
  ];
  return postText(parts, "What my AI work is worth.");
}

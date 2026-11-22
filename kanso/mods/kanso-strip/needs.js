export const NEEDS_LABEL = "kanso.needs";

export const needsWord = (labels) => String(labels?.[NEEDS_LABEL] ?? "").trim() || null;

const waits = (status) => status !== "working" && status !== "blocked";

export const needsOf = (agent, labels, on = true) => (on && waits(agent?.status) ? needsWord(labels) : null);

export const withNeeds = (list, terms, on = true) => {
  if (!on) return list;
  const said = new Map(terms.flatMap((term) => (needsWord(term?.labels) ? [[term.address, needsWord(term.labels)]] : [])));
  if (!said.size) return list;
  return list.map((a) => (said.has(a.address) && waits(a.status) ? { ...a, status: "blocked", msg: said.get(a.address) } : a));
};

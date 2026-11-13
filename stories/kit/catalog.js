import catalog from '../catalog.json' with { type: 'json' };

const cache = new Map();
export const content = (id) => {
  if (!cache.has(id)) cache.set(id, typeof catalog.parts[id] === 'string' ? catalog.parts[id] : catalog.parts[id].map(content).join(''));
  return cache.get(id);
};
const stateKey = (id) => {
  let hash = 2166136261;
  for (const char of id) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return `state-${(hash >>> 0).toString(36)}`;
};
export const records = catalog.records;
export const featuresFor = (page) => records.filter((record) => record.page === page && (record.gap || record.design));
export const statesFor = (page) => {
  const used = new Map();
  const rank = (record) => record.source === 'tokens' || (record.source === 'kit' && record.label === 'Default') ? 0
    : record.source === 'kit' && record.label === 'Open' ? 1
    : /(?:^|, )At rest, Now$|^(Rest|Default)$/.test(record.label) ? 2 : 10;
  return records.filter((record) => record.page === page && record.markup !== undefined && !record.fragment).sort((a, b) => rank(a) - rank(b)).map((record) => {
    const label = record.label.replace(new RegExp(`^${page.split('/')[1]}[, ·]+`, 'i'), '');
    const n = (used.get(label) ?? 0) + 1;
    used.set(label, n);
    return { ...record, value: stateKey(record.id), label: n === 1 ? label : `${label} (alternate ${n})`, coverage: featuresFor(page).filter((feature) => feature.design === record.id) };
  });
};

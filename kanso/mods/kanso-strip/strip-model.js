export const paged = (cols, { n, view, at = null, opened = false }) => {
  const free = cols.flatMap((c, ci) => (c.pin ? [] : [ci]));
  const pageOf = (k) => Math.floor(k / n);
  const sizeOf = (p) => Math.min(n, free.length - p * n);
  const home = free.indexOf(at);
  const landing = home < 0 ? null : pageOf(home);
  const share = new Map(free.flatMap((ci, k) => (opened && pageOf(k) !== landing ? [] : [[ci, view / sizeOf(pageOf(k))]])));
  const page = landing === null ? null : free.slice(landing * n, landing * n + sizeOf(landing));
  return { cols: cols.map((c, ci) => (share.has(ci) ? { ...c, w: share.get(ci) } : c)), page };
};

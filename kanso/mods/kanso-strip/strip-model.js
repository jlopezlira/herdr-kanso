const pagesOf = (cols, n) => cols.reduce((pages, c, ci) => {
  if (c.pin) return pages;
  const last = pages.at(-1);
  return last && last.length < n ? pages.with(-1, [...last, ci]) : [...pages, [ci]];
}, []);

export const paged = (cols, n, opened = null) => {
  const pages = pagesOf(cols, n);
  const page = pages.find((p) => p.includes(opened)) ?? null;
  const resized = opened === null ? pages : [page ?? []];
  const share = new Map(resized.flatMap((p) => p.map((ci) => [ci, 1 / p.length])));
  return { cols: cols.map((c, ci) => (share.has(ci) ? { ...c, w: share.get(ci) } : c)), page };
};

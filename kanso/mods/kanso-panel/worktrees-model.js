import { paths } from "./platform-paths.js";

const real = (path) => paths.canonical(path);
export const inside = (dir, path) => Boolean(dir) && paths.within(real(path), real(dir));

const settled = (path) => {
  const next = real(path);
  return next === path ? path : settled(next);
};
const withoutEnd = (path) => (path.length > 1 ? path.replace(/[\\/]+$/, "") : path);
const keyOf = (path) => withoutEnd(settled(String(path ?? ""))).toLowerCase();

const ancestors = (folder) => {
  const parent = paths.dirname(folder);
  return parent === folder ? [folder] : [folder, ...ancestors(parent)];
};

export const openIn = (used) => {
  const holding = new Set(used.flatMap((folder) => ancestors(real(folder))).map(keyOf));
  return (path) => holding.has(keyOf(path)) && used.some((folder) => inside(path, folder));
};

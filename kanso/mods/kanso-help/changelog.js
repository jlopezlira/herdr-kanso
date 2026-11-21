// Kanso's CHANGELOG.md (Keep a Changelog format), parsed for the What's new page.
const VERSION = /^## \[(\d+\.\d+\.\d+)\](?: - (\S+))?/, HEADING = /^### (.+)$/, BULLET = /^- (.*)$/;
const pieces = (list, starts) => {
  const at = list.flatMap((x, i) => (starts(x) ? [i] : []));
  return at.map((i, k) => list.slice(i, at[k + 1] ?? list.length));
};
export function parseChangelog(text) {
  const lines = String(text ?? "").split(/\r?\n/).map((raw) => raw.trimEnd());
  // A bullet continues over its indented wrap lines.
  const item = ([first, ...rest]) => [BULLET.exec(first)[1], ...rest.filter((l) => l.startsWith("  ")).map((l) => l.trim())].join(" ");
  const section = ([head, ...rest]) => ({ name: HEADING.exec(head)[1].trim(), items: pieces(rest, (l) => BULLET.test(l)).map(item) });
  return pieces(lines, (l) => VERSION.test(l)).map(([head, ...rest]) => {
    const v = VERSION.exec(head);
    return { version: v[1], date: v[2] ?? null, sections: pieces(rest, (l) => HEADING.test(l)).map(section) };
  });
}

export const plain = (s) => String(s).replace(/`([^`]*)`/g, "$1").replace(/\*\*([^*]*)\*\*/g, "$1").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");

export function compare(a, b) {
  const pa = String(a).split(".").map(Number), pb = String(b).split(".").map(Number);
  const i = [0, 1, 2].find((k) => (pa[k] ?? 0) !== (pb[k] ?? 0));
  return i === undefined ? 0 : (pa[i] ?? 0) - (pb[i] ?? 0);
}

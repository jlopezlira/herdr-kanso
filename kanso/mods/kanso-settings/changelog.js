// Kanso's CHANGELOG.md, read for the What's new page: one entry per
// version, newest first, each with its date and its categories of bullets
// (Keep a Changelog: "## [X.Y.Z] - YYYY-MM-DD", "### Added", "- ...").
export function parseChangelog(text) {
  const out = [];
  let entry = null, section = null;
  for (const raw of String(text ?? "").split(/\r?\n/)) {
    const line = raw.trimEnd();
    const v = /^## \[(\d+\.\d+\.\d+)\](?: - (\S+))?/.exec(line);
    if (v) { entry = { version: v[1], date: v[2] ?? null, sections: [] }; section = null; out.push(entry); continue; }
    if (!entry) continue;
    const h = /^### (.+)$/.exec(line);
    if (h) { section = { name: h[1].trim(), items: [] }; entry.sections.push(section); continue; }
    const b = /^- (.*)$/.exec(line);
    if (b && section) { section.items.push(b[1]); continue; }
    if (line.startsWith("  ") && section?.items.length) section.items[section.items.length - 1] += " " + line.trim();
  }
  return out;
}

// Markdown's inline marks, dropped for a plain line: `code`, **bold**, [text](url).
export const plain = (s) => String(s).replace(/`([^`]*)`/g, "$1").replace(/\*\*([^*]*)\*\*/g, "$1").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");

// Semantic versions compared: negative when a < b.
export function compare(a, b) {
  const pa = String(a).split(".").map(Number), pb = String(b).split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  return 0;
}

// Kanso's layout writers, by jlopezlira (https://github.com/jlopezlira/herdr-kanso). Apache-2.0.
//
// Herdr's layout.set replaces the whole tree, and a set that has not landed
// yet still reads as the old one, so every mod that writes the layout keeps
// its piece in shared state and each write puts them all back: the strip's
// columns (`kanso.layout.strip`, written by kanso-strip many times a second
// under its own key, so it never has to read back and copy the rest), the
// open side panel and the sidebar rail (`kanso.layout`).
//
// Herdr loads a mod's files from its own folder only, so this file is kept
// byte for byte in kanso-tabs/ (the one you edit), kanso-strip/,
// kanso-spaces/, kanso-panel/ and open-with/: `npm run sync:share` copies it
// and a test fails when a copy differs.
import { layout, run, shared, setShared } from "herdr";

export const LAYOUT_INTENT = "kanso.layout";
export const STRIP_INTENT = "kanso.layout.strip";

// Right after layout.switch, layout() can still return the tree of the layout
// shown before; setting it would save that tree into kanso.json. Only Kanso's
// tree has the strip map, so only that tree is written.
export const isKansoTree = (n) => n?.id === "strip-map" || (n?.children ?? []).some(isKansoTree);

// The node with this id, anywhere under `node`.
export function walkLayout(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = walkLayout(child, id);
    if (found) return found;
  }
  return null;
}

// Where the node with this id is under `node`, as the child indices that lead
// to it (the one walkLayout finds), or null.
export function pathTo(node, id) {
  if (node?.id === id) return [];
  return (node?.children ?? []).reduce((found, child, i) => found ?? (() => {
    const rest = pathTo(child, id);
    return rest && [i, ...rest];
  })(), null);
}

// `node` with what `fn` makes of the node at `path` in place of it. Only the
// nodes on the way there are new; every other node is shared with `node`.
const changedAt = (node, path, fn, depth = 0) => (depth === path.length ? fn(node)
  : { ...node, children: node.children.with(path[depth], changedAt(node.children[path[depth]], path, fn, depth + 1)) });

// `tree` with what `fn` makes of the node with this id in place of it, or
// `tree` itself when there is none.
export function changeLayout(tree, id, fn) {
  const path = pathTo(tree, id);
  return path ? changedAt(tree, path, fn) : tree;
}

// What every writer keeps, put back onto `tree`: the strip's columns (not
// with `nodes: false`, when the strip places its own), the panel, the rail.
// The tree it is given stays as it was; the painted one is returned.
export function paintLayout(tree, { preserveSizes = true, nodes = true } = {}) {
  if (!tree) return tree;
  const intent = { ...(shared(LAYOUT_INTENT) ?? {}), ...(shared(STRIP_INTENT) ?? {}) };
  const withColumns = nodes && intent.nodes ? paintColumns(tree, intent, preserveSizes) : tree;
  const withPanel = "panel" in intent ? paintPanel(withColumns, intent.panel) : withColumns;
  const withRail = intent.rail ? paintRail(withPanel, intent.rail) : withPanel;
  return edgeBesidePanel(withRail);
}

// The strip's columns in work-body, where "main" or the strip's own were.
function paintColumns(tree, intent, preserveSizes) {
  const body = walkLayout(tree, "work-body");
  if (!body?.children) return tree;
  const mine = (n) => n.id === "main" || String(n.id).startsWith("strip-");
  const at = body.children.findIndex(mine);
  const rest = body.children.filter((n) => !mine(n));
  const i = Math.max(0, at);
  const columns = JSON.parse(JSON.stringify(intent.nodes));
  // Native dividers leave px sizes before the strip's adopt timer runs.
  // Keep those edits, but not sizes from the tree a pending strip write
  // was based on: replaying those would undo an explicit width command.
  // A node comes back as it was when neither it nor any node under it moved.
  const keepSize = (node) => {
    const before = intent.sizesBefore?.[node.id], live = walkLayout(body, node.id);
    const sized = before !== undefined && live?.size?.px !== undefined
      && JSON.stringify(live.size) !== JSON.stringify(before) ? { ...node, size: { ...live.size } } : node;
    if (!sized.children) return sized;
    const children = sized.children.map(keepSize);
    return children.some((c, k) => c !== sized.children[k]) ? { ...sized, children } : sized;
  };
  const kept = preserveSizes ? columns.map(keepSize) : columns;
  return changeLayout(tree, "work-body", (b) => ({ ...b, children: [...rest.slice(0, i), ...kept, ...rest.slice(i)] }));
}

// The side panel: its one child (or none) in panel-body, and the panel
// shown or hidden. Where and which nodes are both looked up in the tree as
// it was given: a "panel" node that was inside panel-body is gone with the
// children it had, so it is left alone.
function paintPanel(tree, panel) {
  const bodyAt = pathTo(tree, "panel-body");
  if (!bodyAt) return tree;
  const wrapAt = pathTo(tree, "panel") ?? bodyAt;
  const child = panel ? JSON.parse(JSON.stringify(panel)) : null;
  const same = wrapAt === bodyAt;
  const inside = !same && wrapAt.length > bodyAt.length && bodyAt.every((k, d) => wrapAt[d] === k);
  const withBody = changedAt(tree, bodyAt, (body) => {
    const { active: _active, ...rest } = body;
    const filled = child ? { ...body, children: [child], active: child.id } : { ...rest, children: [] };
    return same ? { ...filled, hidden: !child } : filled;
  });
  return same || inside ? withBody : changedAt(withBody, wrapAt, (wrap) => ({ ...wrap, hidden: !child }));
}

// The sidebar rail: whether the root row's edge drags, and how narrow it gets.
function paintRail(tree, rail) {
  const kids = tree.children ?? [];
  const at = kids.findIndex((n) => n.id === "sidebar");
  if (at < 0) return tree;
  return { ...tree, resizable: rail.open, children: kids.with(at, { ...kids[at], min: rail.min }) };
}

// A side panel's left border is Herdr's divider, which moves only the two
// nodes beside it, so a fixed-width neighbor pins it. While a panel shows,
// the strip's right edge rail (28 px, fixed) stands after the panel instead
// of before it, and a strip column keeps the border draggable. The tree it
// is given stays as it was; the one returned has the rail in its place.
export function edgeBesidePanel(tree) {
  const body = walkLayout(tree, "work-body"), kids = body?.children;
  const at = kids ? kids.findIndex((n) => n.id === "strip-edge-right") : -1;
  if (at < 0) return tree;
  const edge = kids[at], rest = kids.toSpliced(at, 1);
  const panel = rest[at];
  const beside = panel && (panel.id === "panel-body" || panel.id === "panel") && !panel.hidden;
  return changeLayout(tree, "work-body", (b) => ({ ...b, children: rest.toSpliced(beside ? at + 1 : at, 0, edge) }));
}

// A writer's piece, kept for every write to come.
export function rememberLayout(patch) {
  setShared(LAYOUT_INTENT, { ...(shared(LAYOUT_INTENT) ?? {}), ...patch });
}

// A writer's piece kept, then the whole tree painted and set.
export function commitLayout(patch) {
  rememberLayout(patch);
  const tree = layout();
  if (!tree) return false;
  const painted = paintLayout(tree);
  if (isKansoTree(painted)) run("layout.set", { layout: painted });
  return true;
}

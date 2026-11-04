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

// What every writer keeps, put back onto `tree`: the strip's columns (not
// with `nodes: false`, when the strip places its own), the panel, the rail.
export function paintLayout(tree, { preserveSizes = true, nodes = true } = {}) {
  if (!tree) return;
  const intent = { ...(shared(LAYOUT_INTENT) ?? {}), ...(shared(STRIP_INTENT) ?? {}) };
  if (nodes && intent.nodes) {
    const body = walkLayout(tree, "work-body");
    if (body?.children) {
      const mine = (n) => n.id === "main" || String(n.id).startsWith("strip-");
      const at = body.children.findIndex(mine);
      const rest = body.children.filter((n) => !mine(n));
      const i = Math.max(0, at);
      const columns = JSON.parse(JSON.stringify(intent.nodes));
      // Native dividers leave px sizes before the strip's adopt timer runs.
      // Keep those edits, but not sizes from the tree a pending strip write
      // was based on: replaying those would undo an explicit width command.
      const keepSize = (node) => {
        const before = intent.sizesBefore?.[node.id], live = walkLayout(body, node.id);
        if (before !== undefined && live?.size?.px !== undefined
          && JSON.stringify(live.size) !== JSON.stringify(before)) node.size = { ...live.size };
        for (const child of node.children ?? []) keepSize(child);
      };
      if (preserveSizes) columns.forEach(keepSize);
      body.children = [...rest.slice(0, i), ...columns, ...rest.slice(i)];
    }
  }
  if ("panel" in intent) {
    const body = walkLayout(tree, "panel-body");
    const wrap = walkLayout(tree, "panel") ?? body;
    if (body) {
      const child = intent.panel ? JSON.parse(JSON.stringify(intent.panel)) : null;
      body.children = child ? [child] : [];
      if (child) body.active = child.id;
      else delete body.active;
      if (wrap) wrap.hidden = !child;
    }
  }
  if (intent.rail) {
    const sidebar = (tree.children ?? []).find((n) => n.id === "sidebar");
    if (sidebar) {
      tree.resizable = intent.rail.open;
      sidebar.min = intent.rail.min;
    }
  }
  edgeBesidePanel(tree);
}

// A side panel's left border is Herdr's divider, which moves only the two
// nodes beside it, so a fixed-width neighbor pins it. While a panel shows,
// the strip's right edge rail (28 px, fixed) stands after the panel instead
// of before it, and a strip column keeps the border draggable.
export function edgeBesidePanel(tree) {
  const kids = walkLayout(tree, "work-body")?.children;
  const at = kids ? kids.findIndex((n) => n.id === "strip-edge-right") : -1;
  if (at < 0) return;
  const [edge] = kids.splice(at, 1);
  const panel = kids[at];
  const beside = panel && (panel.id === "panel-body" || panel.id === "panel") && !panel.hidden;
  kids.splice(beside ? at + 1 : at, 0, edge);
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
  paintLayout(tree);
  if (isKansoTree(tree)) run("layout.set", { layout: tree });
  return true;
}

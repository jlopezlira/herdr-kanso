// The sidebar as Layouts/Sidebar lays it out: one gutter on both sides that the toolbar, the rows and the footer share,
// a computer opening its own group, and the keyboard walking the rows in the order they are drawn.
import test from "node:test";
import assert from "node:assert/strict";
import { load, chain, gpuiHost, clone } from "./helpers.mjs";
import { loadSidebar, mountedState } from "./sidebar-fixtures.mjs";

// The drawn tree, each element with its calls and children, so where it sits can be measured.
const host = () => ({ ...gpuiHost(), svg: (path) => { const el = chain("svg"); el.calls.push(["svg", path]); return el; }, Popover: { new: (id) => chain(id) } });

// A computer with two projects, one of them with a session, its sub-session and a tab asleep (open), and a remote computer with one project.
const tabs = [{ id: "tb0", name: "Main", index: 0, active: true }, { id: "tb", name: "Notes", index: 1, settled: true, settled_at: 1 }];
const SPACES = [
  { id: "sp1", name: "fury", folder: "/Users/me/fury", machine: null, active: true, tabs },
  { id: "sp2", name: "shield", folder: "/Users/me/shield", machine: null, active: false, tabs: [{ id: "tb2", name: "Main", index: 0 }] },
  { id: "sp3", name: "ops", folder: "/srv/ops", machine: "dark", active: false, tabs: [{ id: "tb3", name: "Main", index: 0 }] },
];
const shell = (address, resume, name) => ({ address, state: "live", program: { shell: true }, labels: { "kanso.resume": resume, "kanso.name": name } });
const AGENTS = [
  { address: "t0", pane: "p0", tab: "tb0", space: "sp1", space_name: "fury", status: "working", name: "Atlas", seq: 1 },
  { address: "t9", pane: "p9", tab: "tb0", space: "sp1", space_name: "fury", status: "idle", name: "Juno", seq: 2 },
];
const PANES = [
  { pane: "p0", tab: "tb0", terminal: "t0", cwd: "/Users/me/fury" }, { pane: "p9", tab: "tb0", terminal: "t9", cwd: "/Users/me/fury" },
  { pane: "p1", tab: "tb", terminal: "t1", cwd: "/Users/me/fury" },
];
const TERMINALS = [
  { address: "t0", state: "live", program: { agent: true }, labels: {} }, { address: "t9", state: "live", program: { agent: true }, labels: {}, parent: "t0" },
  shell("t1", "00000000-0000-4000-8000-000000000001", "Ada"),
];
const dark = { name: "dark", target: "dark.example", via: "", session: "", temporary: false, state: "connected" };

async function sidebar({ kbd = false, navKey = null } = {}) {
  const { Spaces } = await loadSidebar(host(), {
    spaces: () => SPACES, agents: () => AGENTS, panes: () => PANES, terminals: () => TERMINALS,
    machines: () => [{ name: null, layout: "ready" }, { name: "dark", layout: "ready" }],
  });
  const view = Object.assign(new Spaces(), mountedState({
    shown: new Set(SPACES.map((w) => w.id)), machines: [dark], asleepOpen: new Set(["sleep:tb"]),
    kbd, navKey, handle: { is_focused: () => kbd, focus() {} },
  }));
  return { view, root: view.render() };
}

const SIDES = {
  left: { margin: ["m", "mx", "ml"], pad: ["p", "px", "pl"], border: ["border_1", "border_2", "border_l_1"] },
  right: { margin: ["m", "mx", "mr"], pad: ["p", "px", "pr"], border: ["border_1", "border_2", "border_r_1"] },
};
const WIDTH = { border_1: 1, border_2: 2, border_l_1: 1, border_r_1: 1 };
// The last call that sets this side, as later calls override earlier ones.
const last = (el, names, width = (call) => call[1]) => el.calls.filter((call) => names.includes(call[0])).map(width).at(-1) ?? 0;
const pathOf = (el) => (el.parent ? [...pathOf(el.parent), el] : [el]);
const own = (el, side, part) => last(el, SIDES[side][part], part === "border" ? (call) => WIDTH[call[0]] : undefined);
// How far in from the sidebar's side an element's box, and its content, are drawn.
const content = (el, side) => pathOf(el).reduce((sum, node) => sum + own(node, side, "margin") + own(node, side, "border") + own(node, side, "pad"), 0);
const box = (el, side) => (el.parent ? content(el.parent, side) : 0) + own(el, side, "margin");
// Every element drawn, a Popover's trigger and content too, each knowing what holds it.
const nodes = (el) => [el, ...[...el.kids, ...el.calls.flatMap((call) => call.slice(1)).filter((arg) => arg?.calls && !el.kids.includes(arg))]
  .flatMap((kid) => { if (!kid.parent) kid.parent = el; return nodes(kid); })];
// Its id, or the id a Button is made with.
const PLAIN = new Set(["div", "h_flex", "v_flex", "svg", undefined]);
const idOf = (el) => el.calls.find((call) => call[0] === "id")?.[1] ?? (PLAIN.has(el.tag) ? null : el.tag);
const byId = (root, id) => nodes(root).find((el) => idOf(el) === id);
const svgOf = (el) => el.calls.find((call) => call[0] === "svg")?.[1] ?? "";
// An icon button's glyph sits in the middle of its box.
const glyphIn = (button, side) => {
  const glyph = button.kids.find((kid) => svgOf(kid));
  return box(button, side) + (last(button, ["w", "size"]) - last(glyph, ["size"])) / 2;
};
// The icon button that draws `icon`, in the toolbar.
const toolbarButton = (root, icon) => nodes(root).find((el) => el.kids.some((kid) => svgOf(kid).endsWith(`/${icon}.svg`)) && last(el, ["w", "size"]));
// The rows in a list: each reaches out past its parent by its own padding (mx) and keeps a ring clear at rest (border_2).
const listOf = (root) => nodes(root).find((el) => String(idOf(el)).startsWith("spaces-list-"));
const rowsIn = (el) => nodes(el).filter((kid) => kid.calls.some((call) => call[0] === "border_2") && kid.calls.some((call) => call[0] === "mx"));
const rowsOf = (root) => rowsIn(listOf(root));
// Where rows' content starts and ends, each pair once.
const edges = (rows) => [...new Set(rows.map((row) => `${content(row, "left")}/${content(row, "right")}`))];
const px = (value) => Math.round(value);

test("the toolbar, every row and the footer share one gutter, the same on both sides", async () => {
  const { G, H, ICON_CHROME, SIDEBAR } = await load("kanso-panel/ui.js", ["G", "H", "ICON_CHROME", "SIDEBAR"], {});
  const { root } = await sidebar();
  const rows = rowsOf(root);
  assert.ok(rows.length >= 8, "computers, projects, sessions, a sub-session and asleep rows are drawn");
  const add = toolbarButton(root, "plus"), hide = toolbarButton(root, "panel-left");
  const top = rows.filter((row) => /^(machine|space)-[\w]+$/.test(idOf(row)));
  const insets = {
    toolbar: [px(glyphIn(add, "left")), px(glyphIn(hide, "right"))],
    left: [...new Set(top.map((row) => content(row, "left")))],
    right: [...new Set(rows.map((row) => content(row, "right")))],
  };
  assert.equal(insets.left.length, 1, "computers and projects start on one edge; a session's icon steps in from it by its depth");
  assert.equal(insets.right.length, 1, "every row's last mark or tool ends on one edge: sessions, sub-sessions and asleep rows too");
  assert.deepEqual(insets.toolbar, [...insets.left, ...insets.right], "+ draws its icon on the rows' left edge and Hide sidebar on their right edge, to the pixel");
  assert.deepEqual(insets.left, insets.right, "one gutter, the same on both sides");
  assert.deepEqual(insets.left, [SIDEBAR.gutter], "that gutter is the token");
  assert.equal(SIDEBAR.gutter, G.lg, "the Storybook's: the sidebar's sp-2 and the row's own sp-2");
  assert.equal(px(G.sm + (H.line - ICON_CHROME) / 2), SIDEBAR.gutter, "the toolbar's icon buttons stay where the Storybook puts them");
  // A row's ground reaches out past the gutter by its own padding; the current project's pill is drawn where that ground is.
  const pill = byId(root, "pill-space"), project = byId(root, "space-sp1");
  assert.deepEqual([last(pill, ["left"]), last(pill, ["right"])], [box(project, "left"), box(project, "right")]);
});

test("the footer's rows sit on the same gutter", async () => {
  const { G, H, ICON_CHROME, tokens } = await load("kanso-panel/ui.js", ["G", "H", "ICON_CHROME", "tokens"], {});
  const { sidebarFooter } = await load("kanso-chrome/footer.js", ["sidebarFooter"], host());
  const { ROW } = await load("kanso-chrome/footer-model.js", ["ROW"], host());
  const settings = { open: false, onOpenChange() {}, items: [] };
  const drawn = sidebarFooter(tokens({ foreground: "#ffffff", background: "#000000" }), { collapsed: false, rows: [{ key: ROW.update, icon: "refresh-cw", name: "Update kansō" }, { key: ROW.settings, icon: "settings", name: "Settings" }], settings });
  const rows = rowsIn(drawn);
  assert.equal(rows.length, 2, "Update kansō and Settings");
  const toolbar = px(G.sm + (H.line - ICON_CHROME) / 2);
  assert.deepEqual(edges(rows), [`${toolbar}/${toolbar}`], "on the edges the toolbar's icons are on");
});

// The room above each row in the list: the spacers since the row before it (the list's top for the first); every row is also the list's 1 px gap apart.
const roomAbove = (root) => {
  const list = listOf(root);
  const flow = list.kids.filter((el) => !el.calls.some((call) => call[0] === "absolute"));
  let above = last(list, ["pt"]);
  return Object.fromEntries(flow.flatMap((el) => {
    if (!idOf(el) && !el.kids.length) { above += last(el, ["h"]); return []; }
    const found = [[idOf(el), above]];
    above = 0;
    return found;
  }));
};

test("a computer opens its own group: the space above it, the first one too, is wider than between projects", async () => {
  const { SIDEBAR } = await load("kanso-panel/ui.js", ["SIDEBAR"], {});
  const { root } = await sidebar();
  const above = roomAbove(root);
  const computers = ["machine-local", "machine-dark"].map((id) => above[id]);
  assert.ok(Math.min(...computers) > above["space-sp2"], "a computer stands further apart than a project");
  assert.equal(new Set(computers).size, 1, "the same above every computer, the first one under the toolbar too");
  assert.deepEqual([computers[0], above["space-sp2"]], [SIDEBAR.computerGap, SIDEBAR.groupGap], "from the tokens");
  assert.deepEqual(["space-sp1", "space-sp3"].map((id) => above[id]), [0, 0], "its first project sits right under it");
});

test("a computer heads its group: its name in the label type, not a project's", async () => {
  const { T } = await load("kanso-panel/ui.js", ["T"], {});
  const { root } = await sidebar();
  const nameOf = (rowId) => nodes(byId(root, rowId)).find((el) => el.calls.some((call) => call[0] === "truncate"));
  const look = (rowId) => [last(nameOf(rowId), ["text_size"]) || null, nameOf(rowId).calls.some((call) => call[0] === "font_semibold")];
  assert.deepEqual(look("machine-dark"), [T.body, true], "a computer: the label type, strong");
  assert.deepEqual(look("space-sp3"), [null, true], "a project: the row's own type, strong");
  const ink = (rowId) => last(nameOf(rowId), ["text_color"]);
  assert.notEqual(ink("machine-dark"), ink("space-sp3"), "a computer's name is muted, a project's is not");
});

test("j walks computers, projects, sessions, sub-sessions and asleep rows in the order they are drawn", async () => {
  const { view, root } = await sidebar({ kbd: true, navKey: "machine:local" });
  const ROW = { machine: (m) => `machine-${m}`, space: (id) => `space-${id}`, agent: (a) => `space-agent-${a}`, asleep: (id) => `asleep-group-${id}` };
  const rowOf = (key) => { const [kind, ...rest] = key.split(":"); return ROW[kind]?.(rest.join(":")) ?? null; };
  const drawnOrder = nodes(root).map(idOf).filter(Boolean);
  const walked = clone(view.nav.map((n) => rowOf(n.key)).filter(Boolean));
  assert.deepEqual(walked, ["machine-local", "space-sp1", "space-agent-t0", "space-agent-t9", "asleep-group-sleep:tb", "space-agent-zz:t1", "space-sp2", "machine-dark", "space-sp3"]);
  assert.deepEqual(walked, drawnOrder.filter((id) => walked.includes(id)), "the keyboard's path is the screen's order");
  const cx = { stop_propagation() {}, notify() {} };
  const seen = [view.navKey];
  for (let i = 1; i < view.nav.length; i++) { view.listKeyDown({ key: "j", modifiers: {} }, cx); seen.push(view.navKey); }
  assert.deepEqual(seen, clone(view.nav.map((n) => n.key)), "j goes down that path one row at a time");
});

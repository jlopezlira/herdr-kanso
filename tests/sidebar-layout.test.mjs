// The sidebar as Layouts/Sidebar lays it out: one gutter on both sides that the toolbar, the rows and the footer share,
// a computer opening its own group, and the keyboard walking the rows in the order they are drawn.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { load, chain, gpuiHost, clone } from "./helpers.mjs";
import { loadSidebar, mountedState, shell, SIDEBAR_THEME, world } from "./sidebar-fixtures.mjs";

// The drawn tree, each element with its calls and children, so where it sits can be measured.
const host = () => ({ ...gpuiHost(), svg: (path) => { const el = chain("svg"); el.calls.push(["svg", path]); return el; }, Popover: { new: (id) => chain(id) } });

// A computer with two projects, one of them with a session, its sub-session and a tab asleep (open), and a remote computer with one project.
const tabs = [{ id: "tb0", name: "Main", index: 0, active: true }, { id: "tb", name: "Notes", index: 1, settled: true, settled_at: 1 }];
const SPACES = [
  { id: "sp1", name: "fury", folder: "/Users/me/fury", machine: null, active: true, tabs },
  { id: "sp2", name: "shield", folder: "/Users/me/shield", machine: null, active: false, tabs: [{ id: "tb2", name: "Main", index: 0 }] },
  { id: "sp3", name: "ops", folder: "/srv/ops", machine: "dark", active: false, tabs: [{ id: "tb3", name: "Main", index: 0 }] },
];
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
const cold = { name: "cold", target: "cold.example", via: "", session: "", temporary: false };

async function sidebar({ kbd = false, navKey = null, hoverSpace = null, hoverMachine = null, before = () => {} } = {}) {
  const { Spaces } = await loadSidebar(host(), {
    ...world(SPACES, AGENTS, PANES, TERMINALS),
    machines: () => [{ name: null, layout: "ready" }, { name: "dark", layout: "ready" }, { name: "cold", layout: "ready" }],
  });
  const view = Object.assign(new Spaces(), mountedState({
    shown: new Set(SPACES.map((w) => w.id)), machines: [dark], parked: [cold], asleepOpen: new Set(["sleep:tb"]),
    kbd, navKey, hoverSpace, hoverMachine, handle: { is_focused: () => kbd, focus() {} },
  }));
  before(view);
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
// How far in from the side of the sidebar's block an element's box, and its content, are drawn.
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
const iconButtons = (el) => nodes(el).filter((kid) => kid.kids.some((k) => svgOf(k)) && last(kid, ["w", "size"]));
const glyphIn = (button, side) => {
  const glyph = button.kids.find((kid) => svgOf(kid));
  return box(button, side) + (last(button, ["w", "size"]) - last(glyph, ["size"])) / 2;
};
// The icon button that draws `icon`, in the toolbar.
const toolbarButton = (root, icon) => iconButtons(root).find((el) => el.kids.some((kid) => svgOf(kid).endsWith(`/${icon}.svg`)));
// The rows in a list: each reaches out past its parent by its own padding (mx) and keeps a ring clear at rest (border_2).
const listOf = (root) => nodes(root).find((el) => String(idOf(el)).startsWith("spaces-list-"));
const rowsIn = (el) => nodes(el).filter((kid) => kid.calls.some((call) => call[0] === "border_2") && kid.calls.some((call) => call[0] === "mx"));
const rowsOf = (root) => rowsIn(listOf(root));
// The row's one line: what it draws from its icon or name to its last mark or tool.
const lineOf = (row) => nodes(row).find((el) => el !== row && el.tag === "h_flex" && el.calls.some((call) => call[0] === "gap"));
// What the row draws last, and the right edge of its glyph when it is an icon button.
const lastDrawn = (row) => { let el = lineOf(row); while (el.kids.length && !svgOf(el.kids.at(-1)) && !last(el, ["w", "size"])) el = el.kids.at(-1); return el; };
const trailingGlyph = (row) => {
  const end = lastDrawn(row), tool = iconButtons(end).at(-1) ?? end;
  return iconButtons(row).at(-1) === tool ? glyphIn(tool, "right") : content(row, "right");
};

// Herdr's work column pads its left by k-pane-gap in the sidebar's chrome, so the sidebar is seen to end that far past its block.
const workPad = () => JSON.parse(readFileSync(new URL("../kanso/layouts/kanso.json", import.meta.url), "utf8")).children.find((node) => node.id === "work").padding;
const seenFrom = (PANE) => ({ left: (x) => x, right: (x) => x + PANE.gap });

test("one gutter from both sides seen: toolbar, rows, the current project's hover tools and pill, a computer's last tool, the footer", async () => {
  const { G, H, ICON_CHROME, SIDEBAR, PANE, tokens } = await load("kanso-panel/ui.js", ["G", "H", "ICON_CHROME", "SIDEBAR", "PANE", "tokens"], {});
  assert.equal(workPad(), PANE.gap, "the work column's padding, which shows past the sidebar's block, is k-pane-gap");
  const seen = seenFrom(PANE);
  const { root } = await sidebar({ hoverSpace: "sp1", hoverMachine: "dark" });
  const rows = rowsOf(root);
  assert.ok(rows.length >= 9, "computers, projects, sessions, a sub-session and asleep rows are drawn");
  const top = rows.filter((row) => /^(machine|space)-[\w]+$/.test(idOf(row)));
  const at = (side) => [...new Set(top.map((row) => seen[side](content(row, side))))];
  assert.deepEqual([at("left"), at("right")], [[SIDEBAR.gutter], [SIDEBAR.gutter]], "computers and projects draw from the gutter to the gutter, from each side seen");
  assert.deepEqual([...new Set(rows.map((row) => seen.right(content(row, "right"))))], [SIDEBAR.gutter], "every row's content ends on it: sessions, sub-sessions and asleep rows too");

  // The current project under the pointer: its name on the gutter, its last hover tool's glyph (…) on the gutter, its ground and pill 8 in.
  const project = byId(root, "space-sp1"), pill = byId(root, "pill-space");
  const tools = iconButtons(project);
  assert.ok(tools.length >= 2, "under the pointer, the current project shows its tools");
  assert.equal(content(project, "left"), SIDEBAR.gutter, "the name starts on the gutter");
  assert.equal(seen.right(trailingGlyph(project)), SIDEBAR.gutter, "its last tool's glyph ends on the gutter, not its button's box");
  const ground = SIDEBAR.gutter - G.sm;
  assert.deepEqual([box(project, "left"), seen.right(box(project, "right"))], [ground, ground], "the row's ground: as far in from both sides seen");
  assert.deepEqual([last(pill, ["left"]), seen.right(last(pill, ["right"]))], [ground, ground], "the pill is where that ground is");

  // A computer's last tool, under the pointer (dark) and always out (cold, off: Turn on).
  for (const id of ["machine-dark", "machine-cold"]) {
    const computer = byId(root, id);
    assert.ok(iconButtons(computer).length, `${id} draws a tool`);
    assert.equal(seen.right(trailingGlyph(computer)), SIDEBAR.gutter, `${id}: its last tool's glyph ends on the gutter`);
  }

  const toolbar = G.sm + (H.line - ICON_CHROME) / 2;
  const add = toolbarButton(root, "plus"), hide = toolbarButton(root, "panel-left");
  assert.deepEqual([glyphIn(add, "left"), seen.right(glyphIn(hide, "right"))], [toolbar, toolbar], "+ and Hide sidebar, to the half pixel");

  // The footer's rows: the gutter from both sides seen.
  const { sidebarFooter } = await load("kanso-chrome/sidebar-footer.js", ["sidebarFooter"], host());
  const c = tokens({ foreground: "#ffffff", background: "#000000" });
  for (const footer of [sidebarFooter({ update: "Update kansō" }), sidebarFooter({ update: "Update kansō", refused: { text: "kansō didn't update", source: "offline" } })]) {
    const drawn = rowsIn(footer("f", c, {}));
    assert.equal(drawn.length, 2, "Update kansō and Settings");
    assert.deepEqual([...new Set(drawn.flatMap((row) => [content(row, "left"), seen.right(content(row, "right"))]))], [SIDEBAR.gutter]);
  }

  const { activity } = await load("kanso-spaces/activity.js", ["activity"], host());
  const away = activity({ events: Array(6).fill({ icon: "e-done", subject: "Kylo-ren", fact: "finished", age: "4m" }) })("since-left", c, {});
  assert.deepEqual([...new Set(rowsIn(away).map((row) => content(row, "left")))], [SIDEBAR.gutter], "While you were away: its heading and rows start on the gutter, as Settings does");
  const more = nodes(away).find((el) => el.calls.some((call) => call[0] === "self_start"));
  assert.equal(content(more, "left"), SIDEBAR.gutter, "+N more: its label starts on the gutter, its ground reaching out as a row's does");

  const finding = await sidebar({ before: (view) => view.openFind({ notify() {} }) });
  const search = nodes(byId(finding.root, "spaces-find")).find((el) => svgOf(el).endsWith("/search.svg"));
  assert.ok(search, "Find draws its search icon");
  assert.equal(box(search, "left"), SIDEBAR.gutter, "Find: its search icon starts on the gutter");
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

test("a computer after the first opens its own group, wider apart than the projects in it; the first sits right under the switch", async () => {
  const { SIDEBAR } = await load("kanso-panel/ui.js", ["SIDEBAR"], {});
  const { root } = await sidebar();
  const above = roomAbove(root);
  assert.equal(above["machine-local"], 0, "the first computer has no room above it");
  assert.ok(above["machine-dark"] > above["space-sp2"], "another computer stands further apart than a project");
  assert.deepEqual([above["machine-dark"], above["space-sp2"]], [SIDEBAR.computerGap, SIDEBAR.groupGap], "from the tokens");
  assert.deepEqual(["space-sp1", "space-sp3"].map((id) => above[id]), [0, 0], "its first project sits right under it");
});

test("a computer heads its group: its name strong, in the foreground, at the name size as a project's is", async () => {
  const { T } = await load("kanso-panel/ui.js", ["T"], {});
  const { root } = await sidebar();
  const nameOf = (rowId) => nodes(byId(root, rowId)).find((el) => el.calls.some((call) => call[0] === "truncate"));
  const size = (rowId) => last(nameOf(rowId), ["text_size"]) || last(byId(root, rowId), ["text_size"]);
  const strong = (rowId) => nameOf(rowId).calls.some((call) => call[0] === "font_semibold");
  const ink = (rowId) => last(nameOf(rowId), ["text_color"]);
  assert.deepEqual([size("machine-dark"), size("space-sp3")], [T.card, T.card], "a computer and a project, both at the name size");
  assert.deepEqual([strong("machine-dark"), strong("space-sp3")], [true, true], "both strong");
  assert.equal(ink("machine-dark"), SIDEBAR_THEME.foreground, "a computer's name in the foreground");
  assert.equal(ink("machine-dark"), ink("space-sp3"), "as a project's is");
});

test("j walks computers, projects, sessions, sub-sessions and asleep rows in the order they are drawn", async () => {
  const { view, root } = await sidebar({ kbd: true, navKey: "machine:local" });
  const ROW = { machine: (m) => `machine-${m}`, space: (id) => `space-${id}`, agent: (a) => `space-agent-${a}`, asleep: (id) => `asleep-group-${id}` };
  const rowOf = (key) => { const [kind, ...rest] = key.split(":"); return ROW[kind]?.(rest.join(":")) ?? null; };
  const drawnOrder = nodes(root).map(idOf).filter(Boolean);
  const walked = clone(view.nav.map((n) => rowOf(n.key)).filter(Boolean));
  assert.deepEqual(walked, ["machine-local", "space-sp1", "space-agent-t0", "space-agent-t9", "asleep-group-sleep:tb", "space-agent-zz:t1", "space-sp2", "machine-cold", "machine-dark", "space-sp3"]);
  assert.deepEqual(walked, drawnOrder.filter((id) => walked.includes(id)), "the keyboard's path is the screen's order");
  const cx = { stop_propagation() {}, notify() {} };
  const seen = [view.navKey];
  for (let i = 1; i < view.nav.length; i++) { view.listKeyDown({ key: "j", modifiers: {} }, cx); seen.push(view.navKey); }
  assert.deepEqual(seen, clone(view.nav.map((n) => n.key)), "j goes down that path one row at a time");
});

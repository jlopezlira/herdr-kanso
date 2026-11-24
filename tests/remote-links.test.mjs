import assert from "node:assert/strict";
import test from "node:test";
import { clone, layoutHost, load, repoText } from "./helpers.mjs";

const source = { terminal: "term-1", machine: "light", cwd: "/repo/", pane: null, tab: null, space: null };
const file = (raw, path = null, position = {}) => ({ kind: "file", raw, path, ...position });
const url = (raw) => ({ kind: "url", raw, url: raw });

const clickLink = async (link, from = source, withPanel = true) => {
  const panel = { id: "panel-body", type: "stack", hidden: true, children: [] };
  const tree = { id: "root", children: [{ id: "strip-map" }, ...(withPanel ? [panel] : [])] };
  const reads = [], writes = [];
  const host = layoutHost({}, () => {
    reads.push(tree);
    return tree;
  }, (command, args) => writes.push([command, clone(args)]));
  const { handleLink } = await load("open-with/link.js", ["handleLink"], host);
  return { result: await handleLink({ link, source: from }), reads, writes };
};

const image = "/repo/chart.png";
const document = "/repo/notes.md";
const previews = [
  ["Clicking an absolute path opens the image from the other computer.", file(image, image), image],
  ["Clicking a file URI opens the image with its decoded name.", file("file://light/repo/sales%20chart.png", "/repo/sales chart.png"), "/repo/sales chart.png"],
  ["Clicking a path with a line number opens the file without the line suffix.", file(document + ":12", document, { line: 12 }), document],
  ["Clicking a path with a line and column opens the file without either suffix.", file(document + ":12:3", document, { line: 12, column: 3 }), document],
  ["Clicking a relative path opens the file from the terminal's working directory.", file("./chart.png"), image],
];

for (const [name, link, path] of previews) {
  test(name, async () => {
    const { result, reads, writes } = await clickLink(link);
    assert.equal(result, "handled");
    assert.ok(reads.length > 0);
    assert.deepEqual(writes.map(([command]) => command), ["layout.set"]);
    const { layout } = writes[0][1];
    const panel = layout.children.find(({ id }) => id === "panel-body");
    assert.equal(panel.hidden, false);
    const content = { mod: "kanso-panel", props: { panel: "preview", path, on: source.machine } };
    assert.deepEqual(panel.children.map((child) => child.content), [content]);
  });
}

const passes = [
  ["Clicking a file in a local terminal leaves it to the usual opener.", file(image, image), { machine: null }],
  ["Clicking a web link in a remote terminal leaves it to the usual opener.", url("https://example.test/chart.png")],
  ["Clicking a remote path starting with a tilde does not open the preview.", file("~/chart.png")],
  ["Clicking a relative path without a working directory does not open the preview.", file("chart.png"), { cwd: null }],
  ["Clicking a remote file without a preview panel in the layout does not open the preview.", file(image, image), {}, false],
];

for (const [name, link, overrides, withPanel] of passes) {
  test(name, async () => {
    const { result, writes } = await clickLink(link, { ...source, ...overrides }, withPanel);
    assert.equal(result, "pass");
    assert.deepEqual(writes, []);
  });
}

test("Only previewable text and image extensions are registered for file clicks.", async () => {
  const { link_handlers: rules } = JSON.parse(repoText("kanso/mods/open-with/mod.json"));
  assert.equal(rules?.length, 1);
  const [{ kind, pattern }] = rules;
  assert.equal(kind, "file");
  const { TEXT, KINDS } = await load("kanso-panel/kinds.js", ["TEXT", "KINDS"]);
  const extensions = [...new Set([...TEXT, ...KINDS.image])].toSorted();
  const choices = /^\(\?i\)\\\.\(([\w|]+)\)\$$/.exec(pattern)?.[1].split("|");
  assert.deepEqual(choices?.toSorted(), extensions);
  const matches = new RegExp(pattern.slice("(?i)".length), "i");
  for (const extension of extensions) {
    const path = "report." + extension;
    assert.ok(matches.test(path), path);
  }
  for (const path of ["photo.heic", "README"]) {
    assert.ok(!matches.test(path), path);
  }
});

test("The kansō layout sends terminal link clicks to Open with.", () => {
  const { link_handlers: handlers } = JSON.parse(repoText("kanso/layouts/kanso.json"));
  assert.ok(handlers?.includes("open-with"));
});

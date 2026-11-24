import assert from "node:assert/strict";
import test from "node:test";
import { cp, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { clone, exec, layoutHost, load, repoText, temporary } from "./helpers.mjs";

const source = { terminal: "term-1", machine: "light", cwd: "/repo/", pane: null, tab: null, space: null };
const file = (raw, path = null, position = {}) => ({ kind: "file", raw, path, ...position });
const url = (raw) => ({ kind: "url", raw, url: raw });
const previewContent = (path) => ({ mod: "kanso-panel", props: { panel: "preview", path, on: source.machine } });

const clickLink = async (link, from = source, withPanel = true) => {
  const panel = { id: "panel-body", type: "stack", hidden: true, children: [] };
  const tree = { id: "root", children: [{ id: "strip-map" }, ...(withPanel ? [panel] : [])] };
  const reads = [], writes = [];
  const host = layoutHost({}, () => {
    reads.push(tree);
    return tree;
  }, (command, args) => writes.push([command, clone(args)]));
  const { handleLink } = await load("kanso-panel/link.js", ["handleLink"], host);
  return { result: await handleLink({ link, source: from }), reads, writes };
};

const image = "/repo/chart.png";
const document = "/repo/notes.md";
const previews = [
  ["Clicking an absolute path opens the image from the other computer.", file(image, image), image],
  ["Clicking a localhost file URI opens the image with its decoded name.", file("file://localhost/repo/sales%20chart.png"), "/repo/sales chart.png"],
  ["Clicking a file URI with a fragment opens the image without the fragment.", file(`file://${image}#preview`), image],
  ["Clicking a file URI with a query opens the image without the query.", file(`file://${image}?view=preview`), image],
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
    assert.deepEqual(panel.children.map((child) => child.content), [previewContent(path)]);
  });
}

test("Clicking a remote image opens a preview tab when the layout has no preview panel.", async () => {
  const { result, writes } = await clickLink(file(image, image), source, false);
  assert.equal(result, "handled");
  assert.deepEqual(writes, [["tab.new", previewContent(image)]]);
});

const passes = [
  ["Clicking a file in a local terminal leaves it to the usual opener.", file(image, image), { machine: null }],
  ["Clicking a web link in a remote terminal leaves it to the usual opener.", url("https://example.test/chart.png")],
  ["Clicking a remote path starting with a tilde does not open the preview.", file("~/chart.png")],
  ["Clicking a relative path without a working directory does not open the preview.", file("chart.png"), { cwd: null }],
  ["Clicking a file URI for another host does not open a preview.", file(`file://other${image}`)],
  ["Clicking a file URI with only one slash does not open a preview.", file(`file:${image}`)],
  ["Clicking a file URI with a malformed escape does not open a preview or throw.", file("file:///repo/loss%FF.png")],
  ["Clicking an unsupported remote file does not open a preview.", file("/repo/photo.heic")],
];

for (const [name, link, overrides] of passes) {
  test(name, async () => {
    const { result, writes } = await clickLink(link, { ...source, ...overrides });
    assert.equal(result, "pass");
    assert.deepEqual(writes, []);
  });
}

test("The build check accepts the generated file link rule and rejects an edited rule.", async (t) => {
  const repo = fileURLToPath(new URL("..", import.meta.url));
  const script = "scripts/build-link-rules.mjs";
  const check = (cwd) => exec(process.execPath, [script, "--check"], { cwd });
  const shipped = await check(repo);
  assert.equal(shipped.code, 0, shipped.stderr);

  const scratch = await temporary(t);
  const panel = "kanso/mods/kanso-panel";
  for (const file of [script, "scripts/cli.mjs", "package.json", `${panel}/kinds.js`, `${panel}/pure.js`]) {
    const target = join(scratch, file);
    await mkdir(dirname(target), { recursive: true });
    await cp(join(repo, file), target);
  }
  const manifestPath = `${panel}/mod.json`;
  const manifest = JSON.parse(repoText(manifestPath));
  const [rule] = manifest.link_handlers;
  const edited = { ...manifest, link_handlers: [{ ...rule, pattern: ".*" }] };
  await writeFile(join(scratch, manifestPath), `${JSON.stringify(edited)}\n`);
  const changed = await check(scratch);
  assert.equal(changed.code, 1);
  assert.match(changed.stderr, /mod\.json differs from the preview's file kinds/);
});

test("The kansō layout sends terminal link clicks to the preview panel.", () => {
  const { link_handlers: handlers } = JSON.parse(repoText("kanso/layouts/kanso.json"));
  assert.deepEqual(handlers, ["kanso-panel"]);
});

test("A remote path starting with a tilde is left to Herdr, so a file found on this computer still opens.", () => {
  const [{ pattern }] = JSON.parse(repoText("kanso/mods/kanso-panel/mod.json")).link_handlers;
  const claims = new RegExp(pattern.replace("(?i)", ""), "i");
  assert.deepEqual(["~/shot.png", "/tmp/shot.png", "shot.png"].map((path) => claims.test(path)), [false, true, true]);
});

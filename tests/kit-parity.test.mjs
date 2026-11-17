// The app kit against the Storybook kit: same pieces, same prop names, and the committed gap may only shrink.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { load, gpuiHost } from "./helpers.mjs";
import * as storybookKit from "../stories/kit/pieces.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const STORYBOOK = "stories/kit/pieces.js";
const LIST = "tests/kit-parity.json";
const PANEL = "kanso/mods/kanso-panel/";
// Exports of the Storybook kit that draw no piece of their own: they escape text, join children or words, or push siblings apart.
const HELPERS = new Set(["escape", "list", "phrase", "grow"]);

const read = (path) => readFileSync(`${root}${path}`, "utf8");
const appFiles = () => [...readdirSync(`${root}${PANEL}`).filter((name) => /^ui(-[\w-]+)?\.js$/.test(name)).sort(), "marks.js"];

// The index of the quote that ends the string opening at `start`.
const stringEnd = (text, start) => {
  let i = start + 1;
  for (; i < text.length && text[i] !== text[start]; i++) if (text[i] === "\\") i++;
  return i;
};

// Where the string starting at i ends, or i when none starts there.
const pastString = (text, i) => ("\"'`".includes(text[i]) ? stringEnd(text, i) : i);

// The index of the bracket that closes the one at `start`, skipping strings.
const closing = (text, start) => {
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    i = pastString(text, i);
    if ("([{".includes(text[i])) depth++;
    else if (")]}".includes(text[i]) && --depth === 0) return i;
  }
  throw new Error(`No closing bracket for ${text.slice(start, start + 40)}`);
};

const topLevel = (text) => {
  const parts = [];
  let from = 0;
  for (let i = 0; i < text.length; i++) {
    i = pastString(text, i);
    if ("([{".includes(text[i])) i = closing(text, i);
    else if (text[i] === ",") { parts.push(text.slice(from, i)); from = i + 1; }
  }
  return [...parts, text.slice(from)].map((part) => part.trim()).filter(Boolean);
};

// The option names a function takes: the keys of its last destructured object parameter.
const optionsOf = (source, open) => {
  const object = topLevel(source.slice(open + 1, closing(source, open))).filter((param) => param.startsWith("{")).at(-1);
  if (!object) return { props: [], rest: false };
  const entries = topLevel(object.slice(1, closing(object, 0)));
  return {
    props: entries.filter((entry) => !entry.startsWith("...")).map((entry) => entry.match(/^\w+/)[0]).sort(),
    rest: entries.some((entry) => entry.startsWith("...")),
  };
};

// Every export a kit source declares: functions with their options, aliases, classes and data.
const exportsOf = (source) => {
  const found = new Map();
  for (const m of source.matchAll(/^export\s+(?:(?:async\s+)?function\s+(\w+)\s*(\()|class\s+(\w+)|const\s+(\w+)\s*=\s*)/gm)) {
    const [, fn, , klass, name] = m;
    const after = m.index + m[0].length;
    if (fn) found.set(fn, { kind: "function", ...optionsOf(source, after - 1) });
    else if (klass) found.set(klass, { kind: "class", props: [], rest: false });
    else {
      const rest = source.slice(after);
      const alias = rest.match(/^(\w+)\s*;/);
      if (alias) found.set(name, { kind: "alias", target: alias[1] });
      else if (/^(?:async\s*)?\(/.test(rest)) found.set(name, { kind: "function", ...optionsOf(source, after + rest.indexOf("(")) });
      else if (/^(?:async\s+)?\w+\s*=>/.test(rest)) found.set(name, { kind: "function", props: [], rest: false });
      else found.set(name, { kind: "data" });
    }
  }
  for (const m of source.matchAll(/^export\s*\{([^}]*)\}/gm)) {
    for (const spec of topLevel(m[1])) {
      const [target, name = target] = spec.split(/\s+as\s+/).map((part) => part.trim());
      if (!found.has(name)) found.set(name, { kind: "alias", target });
    }
  }
  return found;
};

// One kit from its files: each drawing export by name, aliases resolved to the function they name.
const kitOf = (sources) => {
  const all = new Map(sources.flatMap((source) => [...exportsOf(source)]).sort(([, a], [, b]) => (b.kind === "alias") - (a.kind === "alias")));
  const kit = new Map();
  for (const [name, entry] of all) {
    let resolved = entry;
    for (let hops = 0; resolved?.kind === "alias" && hops < 8; hops++) resolved = all.get(resolved.target);
    if (resolved && resolved.kind !== "data" && resolved.kind !== "alias") kit.set(name, resolved);
  }
  return kit;
};

const storybookPieces = (source) => new Map([...kitOf([source])].filter(([name, piece]) => piece.kind === "function" && !HELPERS.has(name)));

const minus = (a, b) => a.filter((item) => !b.includes(item));
const factsOf = (list) => [
  ...(list.missing ?? []).map((name) => ({ kind: "missing", name, text: `"${name}" in missing` })),
  ...Object.entries(list.renamed ?? {}).map(([name, as]) => ({ kind: "renamed", name, text: `"${name}" renamed to "${as}"` })),
  ...Object.entries(list.props ?? {}).flatMap(([name, sides]) => ["storybook", "app"].flatMap((side) => (sides[side] ?? []).map((prop) => ({ kind: "props", name, side, prop, text: `${name} prop "${prop}" only in the ${side}` })))),
];

// What the app kit lacks, and every way the committed list disagrees with the two kits or grew since `base`.
const compare = ({ storybook, app, list, base = null }) => {
  const errors = [];
  const missing = list.missing ?? [], renamed = list.renamed ?? {}, props = list.props ?? {};
  const gap = [], differences = {};
  for (const name of new Set(missing.filter((name, i) => missing.indexOf(name) !== i))) errors.push(`"${name}" is in missing twice`);
  for (const name of new Set([...missing, ...Object.keys(renamed), ...Object.keys(props)])) {
    if (!storybook.has(name)) errors.push(`"${name}" is listed, but it is not a Storybook piece`);
  }
  for (const [name, piece] of storybook) {
    const as = renamed[name];
    if (app.has(name)) {
      if (missing.includes(name)) errors.push(`${name} is in the app kit now: take it off missing`);
      if (as) errors.push(`${name} is in the app kit under its own name now: take it off renamed`);
    } else if (as && !app.has(as)) errors.push(`${name} is listed as the app's ${as}, which the app kit does not have`);
    const other = app.get(name) ?? (as ? app.get(as) : undefined);
    if (!other) {
      gap.push(name);
      if (!missing.includes(name)) errors.push(`${name} is a Storybook piece the app kit lacks, and it is not in missing`);
      if (props[name]) errors.push(`${name} is not in the app kit, so it has no props to list`);
      continue;
    }
    if (missing.includes(name) && !app.has(name)) errors.push(`${name} is in the app kit as ${as}: take it off missing`);
    const actual = { storybook: minus(piece.props, other.props), app: minus(other.props, piece.props) };
    if (actual.storybook.length || actual.app.length) differences[name] = actual;
    for (const side of ["storybook", "app"]) {
      const listed = props[name]?.[side] ?? [];
      for (const prop of minus(actual[side], listed)) errors.push(`${name}: prop "${prop}" is only in the ${side} kit, and it is not listed`);
      for (const prop of minus(listed, actual[side])) errors.push(`${name}: prop "${prop}" no longer differs: take it off props`);
    }
  }
  if (base?.list) {
    const before = new Set(factsOf(base.list).map((fact) => fact.text));
    for (const fact of factsOf(list).filter((fact) => !before.has(fact.text))) {
      const was = base.storybook.get(fact.name);
      const arrived = fact.kind !== "missing" && (base.list.missing ?? []).includes(fact.name);
      const storybookChanged = fact.kind === "props" && was && (fact.side === "storybook" ? !was.props.includes(fact.prop) : was.props.includes(fact.prop));
      if (was && !arrived && !storybookChanged) errors.push(`${fact.text} was added to the list, but ${fact.name} is not new in the Storybook`);
    }
  }
  return { gap, differences, errors };
};

const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
const shown = (commit, path) => { try { return git("show", `${commit}:${path}`); } catch { return null; } };
// The list and the Storybook where this branch left develop: a name added since then must be new in the Storybook.
const baseline = () => {
  const commit = ["origin/develop", "develop", "HEAD"].map((ref) => { try { return git("merge-base", "HEAD", ref).trim(); } catch { return null; } }).find(Boolean);
  assert.ok(commit, "git finds no commit to compare the list with");
  const list = shown(commit, LIST), source = shown(commit, STORYBOOK);
  return { commit, list: list && JSON.parse(list), storybook: source ? storybookPieces(source) : new Map() };
};

const kits = () => ({
  storybook: storybookPieces(read(STORYBOOK)),
  app: kitOf(appFiles().map((name) => read(`${PANEL}${name}`))),
  list: JSON.parse(read(LIST)),
});

test("The app kit has every Storybook piece with the same prop names, except the committed list, which only shrinks", (t) => {
  const { storybook, app, list } = kits();
  const base = baseline();
  const { gap, differences, errors } = compare({ storybook, app, list, base });
  t.diagnostic(`Storybook pieces (${storybook.size}), app kit files: ${appFiles().join(", ")}, compared with ${base.commit.slice(0, 7)}`);
  t.diagnostic(`Missing from the app kit (${gap.length}): ${gap.join(", ")}`);
  t.diagnostic(`Named differently: ${Object.entries(list.renamed ?? {}).map(([name, as]) => `${name} → ${as}`).join(", ")}`);
  for (const [name, sides] of Object.entries(differences)) t.diagnostic(`${name} props, Storybook only: ${sides.storybook.join(", ") || "none"}; app only: ${sides.app.join(", ") || "none"}`);
  assert.deepEqual(errors, []);
});

test("The source reader finds the same Storybook pieces the module exports", () => {
  const exported = Object.entries(storybookKit).filter(([name, value]) => typeof value === "function" && !HELPERS.has(name)).map(([name]) => name).sort();
  assert.deepEqual([...storybookPieces(read(STORYBOOK)).keys()].sort(), exported);
});

test("The source reader finds only functions and classes in the app kit", async () => {
  for (const name of appFiles()) {
    const drawn = [...kitOf([read(`${PANEL}${name}`)]).keys()];
    const loaded = await load(`kanso-panel/${name}`, drawn, gpuiHost());
    for (const key of drawn) assert.equal(typeof loaded[key], "function", `${name} ${key}`);
  }
});

test("Prop names come from the destructured options, first or trailing, and an alias or a re-export from a split kit file takes its function's", () => {
  const kit = kitOf([
    "export const row = ({ name, chip: count, depth = 0, ...flags }, ...children) => '';\n",
    "export { tab, field as input } from \"./ui-tab.js\";\nexport const segmented = tab;\nexport const SIZES = { sm: 1 };\nexport class Armed {}\n",
    "export function tab(id, items, c, { size = \"lg\", track = { on: true } } = {}) {}\nexport const field = (id, text, c, { label = \"a, b\" } = {}) => {};\n",
  ]);
  assert.deepEqual(kit.get("row"), { kind: "function", props: ["chip", "depth", "name"], rest: true });
  assert.deepEqual(kit.get("tab").props, ["size", "track"]);
  assert.deepEqual(kit.get("segmented").props, ["size", "track"]);
  assert.deepEqual(kit.get("input").props, ["label"]);
  assert.equal(kit.has("SIZES"), false);
  assert.equal(kit.get("Armed").kind, "class");
});

const storybookOf = (...lines) => storybookPieces(lines.join("\n"));
const appOf = (...lines) => kitOf([lines.join("\n")]);
const sbButton = "export const button = ({ label, kind }) => '';";
const sbAvatar = "export const avatar = ({ initial, size }) => '';";
const appButton = "export function button(id, c, { label, kind } = {}) {}";

test("A piece only the Storybook has appears in the missing list, and fails when the list leaves it out", () => {
  const storybook = storybookOf(sbButton, sbAvatar), app = appOf(appButton);
  assert.deepEqual(compare({ storybook, app, list: { missing: ["avatar"] } }), { gap: ["avatar"], differences: {}, errors: [] });
  assert.deepEqual(compare({ storybook, app, list: {} }).errors, ["avatar is a Storybook piece the app kit lacks, and it is not in missing"]);
});

test("A prop name that differs between the two kits fails and names the piece and the prop", () => {
  const storybook = storybookOf(sbButton), app = appOf("export function button(id, c, { label, small } = {}) {}");
  assert.deepEqual(compare({ storybook, app, list: {} }).errors, [
    "button: prop \"kind\" is only in the storybook kit, and it is not listed",
    "button: prop \"small\" is only in the app kit, and it is not listed",
  ]);
  assert.deepEqual(compare({ storybook, app, list: { props: { button: { storybook: ["kind"], app: ["small"] } } } }).errors, []);
});

test("A piece named differently is a difference to close, and its props are compared through the listed name", () => {
  const storybook = storybookOf("export const tabs = ({ items, size }) => '';"), app = appOf("export function tab(id, c, { items, track } = {}) {}");
  assert.deepEqual(compare({ storybook, app, list: { renamed: { tabs: "tab" }, props: { tabs: { storybook: ["size"], app: ["track"] } } } }).errors, []);
  assert.deepEqual(compare({ storybook, app: appOf("export function tabs(id, c, { items, track } = {}) {}"), list: { renamed: { tabs: "tab" }, props: { tabs: { storybook: ["size"], app: ["track"] } } } }).errors,
    ["tabs is in the app kit under its own name now: take it off renamed"]);
});

test("A new name added to the missing list fails, unless the piece is new in the Storybook", () => {
  const base = { list: { missing: ["avatar"] }, storybook: storybookOf(sbButton, sbAvatar) };
  const storybook = storybookOf(sbButton, sbAvatar, "export const chip = ({ label }) => '';");
  assert.deepEqual(compare({ storybook, app: appOf(appButton), list: { missing: ["avatar", "chip"] }, base }).errors, []);
  assert.deepEqual(compare({ storybook: base.storybook, app: appOf("export const other = () => {};"), list: { missing: ["avatar", "button"] }, base }).errors,
    ["\"button\" in missing was added to the list, but button is not new in the Storybook"]);
  assert.deepEqual(compare({ storybook: base.storybook, app: appOf(appButton), list: { missing: ["avatar", "toast"] }, base }).errors,
    ["\"toast\" is listed, but it is not a Storybook piece"]);
  assert.deepEqual(compare({ storybook: base.storybook, app: appOf("export function button(id, c, { label, kind, small } = {}) {}"), list: { missing: ["avatar"], props: { button: { app: ["small"] } } }, base }).errors,
    ["button prop \"small\" only in the app was added to the list, but button is not new in the Storybook"]);
});

test("A piece added to the app kit with the same name and props leaves the missing list, and the test still passes", () => {
  const storybook = storybookOf(sbButton, sbAvatar), base = { list: { missing: ["avatar"] }, storybook };
  const app = appOf(appButton, "export function avatar(id, c, { initial, size } = {}) {}");
  assert.deepEqual(compare({ storybook, app, list: { missing: [] }, base }), { gap: [], differences: {}, errors: [] });
  assert.deepEqual(compare({ storybook, app, list: { missing: ["avatar"] }, base }).errors, ["avatar is in the app kit now: take it off missing"]);
});

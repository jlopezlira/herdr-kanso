// A mod loads in Herdr's runtime. An import or a global it does not provide fails here.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { bannedGlobals, fixtureDrift, loadDeclarations, parseDeclarations } from "../scripts/herdr-api.mjs";
import { globalUses, importsOf, issuesIn, repositoryAudit, resolveSpec } from "../scripts/check-imports.mjs";
import { SKIPPED, checkMods } from "../scripts/check-mods.mjs";
import { MOD_BANNED_GLOBALS, bindHerdrModules, modSandbox } from "./helpers.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const api = JSON.parse(readFileSync(new URL("./herdr-api.json", import.meta.url), "utf8"));
const read = (files) => (file) => {
  if (!Object.hasOwn(files, file)) throw new Error("missing");
  return files[file];
};

// Bare uses of a global Herdr does not declare.
const UNDECLARED_GLOBAL_USES = [];

test("Declarations keep value exports and drop types", () => {
  const gpui = `
    declare module "gpui-kit" {
      export type Length = number;
      export abstract class View {}
      export function div(): void;
      export interface Context { ready(): void; }
    }
    declare module "gpui" { export * from "gpui-kit"; }
    declare module "fs/promises" {
      export function readFile(path: string): Promise<string>;
      export function readFile(path: string, encoding: "utf8"): Promise<string>;
    }
    declare module "net" { export function connect(): void; export default connect; }
    declare const console: Console;
    declare function fetch(url: string): Promise<unknown>;
    declare const process: typeof import("process").default;
  `;
  const parsed = parseDeclarations(gpui, "export interface ExecResult { code: number; }\nexport function exec(): void;\n");
  assert.deepEqual(parsed.modules["gpui-kit"], ["View", "div"]);
  assert.deepEqual(parsed.modules.gpui, ["View", "div"]);
  assert.deepEqual(parsed.modules["fs/promises"], ["readFile"]);
  assert.deepEqual(parsed.modules.net, ["connect", "default"]);
  assert.deepEqual(parsed.modules.herdr, ["exec"]);
  assert.deepEqual(parsed.globals, ["console", "fetch", "process"]);
});

test("A missing Herdr export names the file, the line and the export", () => {
  const text = "import { exists, stat } from \"fs/promises\";\n";
  assert.deepEqual(issuesIn("kanso/mods/kanso-panel/remote-file.js", text, read({}), api, "kanso/mods/kanso-panel"), [
    "kanso/mods/kanso-panel/remote-file.js:1: no export 'stat' in 'fs/promises'",
  ]);
  const multiline = "import {\n  missing,\n} from \"./other.js\";\n";
  const files = { "mods/m/other.js": "export const present = 1;\nexport default class Panel {}\n" };
  assert.deepEqual(issuesIn("mods/m/main.js", multiline, read(files), api, "mods/m"), [
    "mods/m/main.js:2: no export 'missing' in './other.js'",
  ]);
  assert.deepEqual(issuesIn("mods/m/main.js", "import Panel from \"./other.js\";\n", read(files), api, "mods/m"), []);
  assert.deepEqual(issuesIn("mods/m/main.js", "import { gone } from \"./gone.js\";\n", read({}), api, "mods/m"), [
    "mods/m/main.js:1: './gone.js' does not resolve",
  ]);
  assert.deepEqual(issuesIn("mods/m/main.js", "import { stat } from \"node:fs\";\n", read({}), api, "mods/m"), [
    "mods/m/main.js:1: no export 'stat' in 'node:fs'",
  ]);
});

test("Imports survive a string, a comment and a template, and a rename keeps the original name", () => {
  const source = [
    "import net from \"net\";",
    "import { mkdir, writeFile as save } from \"fs/promises\";",
    "import { WebSocket } from \"websocket\";",
    "const code = `ObjC.import(\"AppKit\") ${name}`;",
    "import { locate } from \"./find.js\";",
    "",
  ].join("\n");
  const items = importsOf(source);
  assert.deepEqual(items.map((item) => item.from), ["net", "fs/promises", "websocket", "./find.js"]);
  assert.deepEqual(items[0].specs, [{ imported: "default", line: 1 }]);
  assert.deepEqual(items[1].specs.map((spec) => spec.imported), ["mkdir", "writeFile"]);
  assert.equal(resolveSpec("kanso/mods/kanso-panel/main.js", "./find-view.js"), "kanso/mods/kanso-panel/find-view.js");
  const clip = readFileSync(new URL("../kanso/mods/kanso-panel/platform-clipboard.js", import.meta.url), "utf8");
  assert.deepEqual(importsOf(clip).map((item) => item.from), ["./platform-command.js"]);
  const view = readFileSync(new URL("../kanso/mods/kanso-panel/find-view.js", import.meta.url), "utf8");
  const found = importsOf(view).find((item) => item.from === "./find.js");
  assert.equal(found.specs.find((spec) => spec.imported === "locateConversation").line, 10);
});

test("A bare global the runtime does not provide is reported, and a binding or a comment is not", () => {
  const source = [
    "import { URL } from \"url\";",
    "const url = new URL(href);",
    "obj.URL;",
    "obj?.URL;",
    "const kept = { URL: 1 };",
    "// new URL(href)",
    "const text = \"new URL\";",
    "const pattern = /URL/;",
    "const URL = 1;",
    "function Buffer() {}",
  ].join("\n");
  assert.deepEqual(globalUses("sample.js", source, MOD_BANNED_GLOBALS), [
    { file: "sample.js", line: 2, name: "URL" },
  ]);
});

test("The sandbox throws for a global Herdr does not declare, including one a fixture passed in", () => {
  for (const name of ["URL", "setTimeout", "structuredClone", "crypto", "TextDecoder", "atob", "Buffer"]) assert.ok(MOD_BANNED_GLOBALS.includes(name), name);
  for (const name of ["process", "fetch", "console", "Object", "Intl"]) assert.equal(MOD_BANNED_GLOBALS.includes(name), false, name);
  assert.deepEqual(bannedGlobals(["Object", "console", "URL", "queueMicrotask"], ["console", "fetch", "process"]), ["Buffer", "TextDecoder", "URL", "atob", "crypto", "queueMicrotask", "setTimeout", "structuredClone"]);
  const sandbox = modSandbox({ URL, setTimeout, structuredClone, crypto, TextDecoder, atob, Buffer });
  assert.throws(() => vm.runInContext("new URL('https://example.test')", sandbox), /URL is not available to a mod/);
  assert.throws(() => vm.runInContext("setTimeout(() => {}, 0)", sandbox), /setTimeout is not available to a mod/);
  assert.throws(() => vm.runInContext("structuredClone(1)", sandbox), /structuredClone is not available to a mod/);
  assert.throws(() => vm.runInContext("crypto.randomUUID()", sandbox), /crypto is not available to a mod/);
  assert.throws(() => vm.runInContext("new TextDecoder()", sandbox), /TextDecoder is not available to a mod/);
  assert.throws(() => vm.runInContext("atob('YQ==')", sandbox), /atob is not available to a mod/);
  assert.throws(() => vm.runInContext("Buffer.from('a')", sandbox), /Buffer is not available to a mod/);
  assert.equal(vm.runInContext("typeof console", sandbox), "object");
  assert.equal(vm.runInContext("Array.isArray([])", sandbox), true);
  assert.equal(vm.runInContext("typeof fetch === 'undefined' || fetch.name !== 'banned'", sandbox), true);
  assert.equal(vm.runInContext("typeof process === 'undefined' || process.name !== 'banned'", sandbox), true);
  assert.throws(() => bindHerdrModules("import { stat } from \"herdr\";\n"), /Could not find export 'stat' in module 'herdr'/);
});

test("Every mod imports only names Herdr declares, and no file uses a global it does not", () => {
  const { issues, uses, files } = repositoryAudit(root, api, MOD_BANNED_GLOBALS);
  assert.deepEqual(issues, []);
  const byPos = (a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.name.localeCompare(b.name);
  assert.deepEqual(uses.sort(byPos), [...UNDECLARED_GLOBAL_USES].sort(byPos));
  for (const file of ["kanso/mods/kanso-sim/ios.js", "kanso/mods/kanso-prompt/main.js", "kanso/mods/kanso-panel/find-view.js"]) assert.ok(files.includes(file), file);
});

test("The vendored names match this machine when Herdr is installed, and a missing install is skipped", () => {
  assert.equal(loadDeclarations(fileURLToPath(new URL("./no-such-herdr/", import.meta.url))), null);
  assert.equal(fixtureDrift(null, api), null);
  assert.match(fixtureDrift({ globals: [], modules: { herdr: ["exec"] } }, api), /herdr-api\.json/);
  assert.equal(fixtureDrift(api, api), null);
  const live = loadDeclarations();
  if (!live) return;
  assert.equal(fixtureDrift(live, api), null);
});

test("herdr-app check runs for every mod and says when the app is absent", () => {
  assert.equal(SKIPPED, "skipped: Herdr app not found");
  assert.deepEqual(checkMods(["kanso/mods/kanso-panel"], () => ({ error: { code: "ENOENT" } })), { skipped: true, failures: [] });
  const ran = [];
  assert.deepEqual(checkMods(["a", "b"], (dir) => { ran.push(dir); return { status: 0 }; }), { skipped: false, failures: [] });
  assert.deepEqual(ran, ["a", "b"]);
  assert.deepEqual(checkMods(["a", "b"], (dir) => ({ status: dir === "b" ? 1 : 0 })).failures, ["b"]);
});

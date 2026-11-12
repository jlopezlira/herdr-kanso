// One period, one confirm, one word, one Esc, and colours from the kit.
import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { load } from "./helpers.mjs";
import { costRange, deriveCosts, previousRange } from "../kanso/mods/kanso-spend/core/costs.mjs";
import { SPEND_PERIODS, spendPeriod } from "../kanso/mods/kanso-spend/period.js";
import { leaveShowAll } from "../kanso/mods/kanso-guard/model.js";
import { describe } from "../kanso/mods/kanso-help/keymap.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const text = (path) => readFile(join(root, path), "utf8");

test("Spend opens on today, and a chosen period is the one it accepts next time", () => {
  assert.equal(spendPeriod(undefined), "day");
  assert.equal(spendPeriod("nope"), "day");
  assert.equal(spendPeriod("month"), "month");
  assert.equal(spendPeriod("year"), "year");
  assert.deepEqual(SPEND_PERIODS.map((period) => period.label), ["Today", "Month", "30 days", "Year", "All time"]);
  const today = costRange("day", 0, "2026-11-11");
  assert.deepEqual([today.start, today.end, today.label, today.unit], ["2026-11-11", "2026-11-11", "Today", "day"]);
  assert.equal(previousRange(today, "2026-11-11").label, "Yesterday");
  assert.equal(previousRange(today, "2026-11-11").start, "2026-11-10");
  assert.equal(costRange("day", -2, "2026-11-11").label, "Nov 9");
  assert.equal(costRange("day", 0, "2026-11-11").said, "today");
  assert.equal(costRange("day", -1, "2026-11-11").said, "yesterday");
  assert.equal(costRange("day", -2, "2026-11-11").said, "on Nov 9");
  assert.equal(costRange("month", 0, "2026-11-11").said, "in November");
  assert.equal(costRange("year", 0, "2026-11-11").said, "in 2026");
  assert.equal(costRange("month", 0, "2026-11-11").period, "month");
  const derived = deriveCosts([], { today: "2026-11-11" });
  assert.equal(derived.range.period, "day");
  assert.equal(derived.hero.title, "Today");
  assert.equal(derived.hero.empty, "Nothing used today. Try another period.");
  assert.equal(deriveCosts([], { options: { period: "day", offset: -2 }, today: "2026-11-11" }).hero.empty, "Nothing used on Nov 9. Try another period.");
  assert.equal(deriveCosts([], { options: { period: "30d" }, today: "2026-11-11" }).range.period, "30d");
});

test("a second press within four seconds confirms, and after that it arms again", async () => {
  const { Armed, ARM_MS } = await load("kanso-panel/ui.js", ["Armed", "ARM_MS"], { Date });
  const armed = new Armed();
  const ran = [];
  const timers = [];
  const cx = { notify() {}, timer: { after(_ms, fn) { timers.push(fn); } } };
  armed.press("remove", cx, () => ran.push("remove"));
  assert.equal(armed.is("remove"), true);
  assert.deepEqual(ran, []);
  armed.press("remove", cx, () => ran.push("remove"));
  assert.deepEqual(ran, ["remove"]);
  assert.equal(armed.is("remove"), false);

  const started = Date.now();
  armed.press("close", cx, () => ran.push("close"));
  const real = Date.now;
  Date.now = () => started + ARM_MS + 60;
  try {
    assert.equal(armed.is("close"), false);
    timers.at(-1)(cx);
    assert.equal(armed.key, null);
    armed.press("close", cx, () => ran.push("close"));
    assert.deepEqual(ran, ["remove"]);
    assert.equal(armed.is("close"), true);
  } finally {
    Date.now = real;
  }
});

test("the sidebar and settings confirm through Armed", async () => {
  const spaces = await text("kanso/mods/kanso-spaces/main.js");
  assert.equal(spaces.includes("confirmClose"), false);
  assert.match(spaces, /this\.armed\.press\("remove"/);
  assert.match(spaces, /this\.armed\.press\("close"/);
  assert.match(spaces, /verb: w \? `remove it and close its/);
  assert.match(spaces, /verb: "close it"/);
  const settings = await text("kanso/mods/kanso-settings/main.js");
  assert.match(settings, /new Armed\(\)/);
  assert.match(settings, /pressAgain\("take it"\)/);
  assert.equal(settings.includes("Press it again"), false);
});
test("memory's Esc leaves the full list only while that list is open", async () => {
  assert.equal(leaveShowAll(true), false);
  assert.equal(leaveShowAll(false), null);
  const guard = await text("kanso/mods/kanso-guard/main.js");
  assert.match(guard, /leaveShowAll\(this\.showAll\)/);
  assert.doesNotMatch(guard, /name === "back"[\s\S]{0,160}armed\.clear/);
  const actions = await text("kanso/mods/kanso-settings/actions.js");
  assert.match(actions, /\{ action: "kanso-guard\.back", label: "Show fewer" \}/);
});

test("armed ink comes from the kit token", async () => {
  for (const file of [
    "kanso/mods/kanso-panel/ports.js",
    "kanso/mods/kanso-panel/worktrees.js",
  ]) {
    const source = await text(file);
    assert.equal(source.includes("#ffffff"), false, file);
    assert.match(source, /this\.armed\.button\("[\w-]+"/, file);
  }
  assert.match(await text("kanso/mods/kanso-panel/ui.js"), /filled\(c\.accent, c\.accentText, c\)/);
});

test("one armed wording: only the kit says Press again, and only as Press again to <verb>", async () => {
  const dirs = ["kanso/mods", "open-with/mods", "markdown-panel/mods"].map((dir) => join(root, dir));
  const all = async (dir) => (await readdir(dir, { recursive: true })).filter((name) => /\.m?js$/.test(name)).map((name) => join(dir, name));
  const files = (await Promise.all(dirs.map(all))).flat().filter((file) => !file.endsWith("/ui.js"));
  const found = [];
  for (const file of files) {
    for (const line of (await readFile(file, "utf8")).split("\n")) {
      if (/\b(?:Press|Click|Tap)\b[^\n]{0,24}\bagain\b|Press again:/.test(line)) found.push(`${file}: ${line.trim().slice(0, 120)}`);
    }
  }
  assert.deepEqual(found, []);
  assert.match(await text("kanso/mods/kanso-panel/ui.js"), /export const pressAgain = \(verb\) => `Press again to \$\{verb\}`;/);
});
test("the teaching footers are gone and a scan time can still be said", async () => {
  assert.equal((await text("kanso/mods/kanso-panel/ports.js")).includes("Programs of yours listening"), false);
  assert.equal((await text("kanso/mods/kanso-containers/main.js")).includes("grouped by the Kanso project"), false);
  assert.equal((await text("kanso/mods/kanso-panel/shipped.js")).includes("Statistics only, kept in"), false);
  const worktrees = await text("kanso/mods/kanso-panel/worktrees.js");
  assert.equal(worktrees.includes("then asks each repository"), false);
  assert.match(worktrees, /Scanned \$\{new Date\(this\.scannedAt\)/);
});

test("help names a project, and a panel list keeps the name PR", async () => {
  assert.equal(describe("space.new"), "New project");
  assert.equal(describe("space.next"), "Next project");
  assert.equal(describe("space.prev"), "Previous project");
  assert.equal(describe("kanso-spaces.space-3"), "Project 3");
  assert.equal(describe("space.select:2"), "Project 2");
  assert.equal(describe("mod.open:picker"), "Search projects, tabs and agents");
  assert.match(await text("kanso/mods/kanso-help/guide.js"), /Files, PR, Ports/);
});

const SKIP_DIR = new Set(["kanso-strip"]);
const skipFile = (name) => name === "pr.js" || name.startsWith("pr-");

async function sources(dir, acc = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIR.has(entry.name)) await sources(path, acc);
    } else if (/\.m?js$/.test(entry.name) && !skipFile(entry.name)) acc.push(path);
  }
  return acc;
}

// A "/" after one of these starts a regular expression, whose quotes are not text.
const REGEX_WORD = new Set(["return", "typeof", "case", "void", "delete", "in", "of", "instanceof", "throw", "new", "await", "yield", "else", "do"]);

function skipRegex(source, i) {
  const limit = source.indexOf("\n", i);
  const end = limit < 0 ? source.length : limit;
  let n = i + 1;
  let klass = false;
  while (n < end) {
    const c = source[n];
    if (c === "\\") { n += 2; continue; }
    if (c === "[" && !klass) klass = true;
    else if (c === "]" && klass) klass = false;
    else if (c === "/" && !klass) {
      n += 1;
      while (n < source.length && /[dgimsuyv]/.test(source[n])) n += 1;
      return n;
    }
    n += 1;
  }
  return i + 1;
}

function literals(source) {
  const found = [];
  let i = 0;
  let value = false;
  while (i < source.length) {
    const c = source[i];
    if (c === " " || c === "\t" || c === "\n" || c === "\r") { i += 1; continue; }
    if (c === "/" && source[i + 1] === "/") {
      const next = source.indexOf("\n", i);
      i = next < 0 ? source.length : next + 1;
      continue;
    }
    if (c === "/" && source[i + 1] === "*") {
      const next = source.indexOf("*/", i + 2);
      i = next < 0 ? source.length : next + 2;
      continue;
    }
    if (c === "/" && source[i + 1] !== "=" && !value) {
      const next = skipRegex(source, i);
      if (next > i + 1) { i = next; value = true; continue; }
    }
    if (c === "'" || c === '"' || c === "`") {
      const quote = c;
      let j = i + 1;
      while (j < source.length) {
        if (source[j] === "\\") { j += 2; continue; }
        if (quote === "`" && source[j] === "$" && source[j + 1] === "{") {
          j += 2;
          let depth = 1;
          while (j < source.length && depth > 0) {
            if (source[j] === "{") depth += 1;
            else if (source[j] === "}") depth -= 1;
            j += 1;
          }
          continue;
        }
        if (source[j] === quote) break;
        j += 1;
      }
      found.push(source.slice(i, Math.min(source.length, j + 1)));
      i = j + 1;
      value = true;
      continue;
    }
    if (/[A-Za-z_$]/.test(c)) {
      const start = i;
      i += 1;
      while (i < source.length && /[A-Za-z0-9_$]/.test(source[i])) i += 1;
      value = !REGEX_WORD.has(source.slice(start, i));
      continue;
    }
    if (/[0-9]/.test(c)) {
      i += 1;
      while (i < source.length && /[0-9A-Za-z_.]/.test(source[i])) i += 1;
      value = true;
      continue;
    }
    if (c === ")" || c === "]") { value = true; i += 1; continue; }
    if ((c === "+" || c === "-") && source[i + 1] === c) { i += 2; continue; }
    if (c === ">" && source[i - 1] === "=") { value = false; i += 1; continue; }
    value = false;
    i += 1;
  }
  return found;
}

const BANNED = [
  [/New space/, "New space"],
  [/Next space/, "Next space"],
  [/Previous space/, "Previous space"],
  [/Search spaces/, "Search spaces"],
  [/your spaces/, "your spaces"],
  [/any space\b/, "any space"],
  [/This space is/, "This space is"],
  [/Space \$\{/, "Space ${"],
  [/this Mac/, "this Mac"],
  [/Wake now/, "Wake now"],
  [/Add machine/, "Add machine"],
  [/this machine/i, "this machine"],
  [/another machine/i, "another machine"],
  [/other machines/i, "other machines"],
  [/machine names/, "machine names"],
  [/\bMachines\b/, "Machines"],
  [/machine low/, "machine low"],
  [/\} machine\b/, "} machine"],
  [/Press it again/, "Press it again"],
  [/Click again/, "Click again"],
  [/Pull request/, "Pull request"],
];

const retired = (literal) => {
  const body = literal.slice(1);
  if (/^\s*(SELECT|INSERT|UPDATE|DELETE|CREATE|WITH|ALTER)\b/i.test(body)) return [];
  if (/hc machine|\["machine"|'machine'/.test(literal)) return [];
  if (/^["'`]PR["'`]$/.test(literal)) return [];
  const hits = BANNED.filter(([re]) => re.test(literal)).map(([, name]) => name);
  const prose = literal.replace(/PR #(?:\d+|\$\{[^}]*\})/g, "").replace("Files, PR, Ports", "Files, Ports");
  if (/\bPR\b/.test(prose)) hits.push("PR");
  return hits;
};

test("a comment beside a regular expression is not text a person reads", () => {
  const sample = "export const exhausted = (e) => /out of memory|\\bNull\\b\\s*[\"'“]?null/i.test(String(e));\n// A server, not a second \"+\": the rail already has one for New space.\n.when(!hidden().has(\"footer.machine\"), el => el.child(\"Add computer\"));\n";
  const read = literals(sample);
  assert.equal(read.some((literal) => literal.includes("New space")), false);
  assert.equal(read.some((literal) => literal.includes("Add computer")), true);
});

test("retired words stay out of the words a person reads", async () => {
  const dirs = ["kanso/mods", "open-with/mods", "markdown-panel/mods"].map((dir) => join(root, dir));
  const files = (await Promise.all(dirs.map((dir) => sources(dir)))).flat();
  const found = [];
  for (const file of files) {
    const source = await readFile(file, "utf8");
    for (const literal of literals(source)) {
      const hits = retired(literal);
      if (hits.length) found.push(`${file}: ${hits.join(", ")} in ${literal.slice(0, 140)}`);
    }
  }
  assert.deepEqual(found, []);
});

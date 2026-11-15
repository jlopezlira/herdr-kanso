// Usage: npm run check:dupes [-- --report <file.md>] [-- --write]
// Finds every block of code repeated in the mods, stories, scripts and site; fails on one the baseline does not list.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { SHARED } from "./sync-share.mjs";

const ROOT = new URL("../", import.meta.url);
const BASELINE_NAME = "kanso/dupes-baseline.json";
const BASELINE = new URL(BASELINE_NAME, ROOT);
const FOLDERS = ["kanso/mods", "stories", "scripts", "site"];
const CODE = /\.(?:m?js|jsx|css|html|mdx|sh|ps1)$/;
const COMMENT = /^(?:\/\/|\/\*|\*|<!--|# )/;
const IMPORT = /^import\s[^;]*?(?:from\s*)?["'][^"']+["'];?/gm;
export const MIN_CHARS = 80;

const hash = (text) => createHash("sha1").update(text).digest("hex").slice(0, 12);
const placeOf = (lines, file, from, to) => ({ file, start: lines[from].line, end: lines[to].line });

// The lines that carry code, trimmed, with their line numbers: blank, comment, import and bracket-only lines do not count.
export const significantLines = (text) => text.replace(IMPORT, (statement) => statement.replace(/[^\n]/g, "")).split(/\r?\n/)
  .map((line, index) => ({ line: index + 1, text: line.trim().replace(/\s+/g, " ") }))
  .filter(({ text }) => /\w/.test(text) && !COMMENT.test(text));

// From each line, the fewest lines that reach MIN_CHARS of code: the same code always makes the same window.
const windowsOf = (file, lines) => {
  const reach = lines.reduce((sums, { text }) => [...sums, sums.at(-1) + text.length], [0]);
  return lines.flatMap((_, index) => {
    const end = reach.findIndex((sum, at) => at > index && sum - reach[index] >= MIN_CHARS) - 1;
    if (end < 0) return [];
    const key = hash(lines.slice(index, end + 1).map(({ text }) => text).join("\n"));
    return [{ ...placeOf(lines, file, index, end), index, last: end, key }];
  });
};

export const scan = (files) => {
  const lines = new Map(Object.entries(files).map(([file, text]) => [file, significantLines(text)]));
  const windows = [...lines].flatMap(([file, fileLines]) => windowsOf(file, fileLines));
  return { lines, windows };
};

// Every window that appears more than once, by its hash, with how often it appears in each file.
export const repeatedWindows = (windows) => Object.fromEntries([...Map.groupBy(windows, ({ key }) => key)]
  .filter(([, found]) => found.length > 1)
  .map(([key, found]) => [key, Object.fromEntries([...Map.groupBy(found, ({ file }) => file)].map(([file, inFile]) => [file, inFile.length]))]));

const countWhile = (holds, count = 0) => holds(count) ? countWhile(holds, count + 1) : count;
const pairsOf = (found) => found.flatMap((first, at) => found.slice(at + 1).map((second) => [first, second]));

// Where a repeat that starts at two places ends in each: shared windows, then shared lines, never overlapping itself.
const runEnds = (windowAt, lines, [first, second]) => {
  const apart = (index) => first.file !== second.file || index < second.index;
  const windows = countWhile((offset) => {
    const one = windowAt(first.file, first.index + offset);
    const other = windowAt(second.file, second.index + offset);
    return Boolean(one && other) && one.key === other.key && apart(one.last);
  });
  if (!windows) return null;
  const [one, other] = [first, second].map(({ file, index }) => windowAt(file, index + windows - 1).last);
  const tail = countWhile((offset) => {
    const line = lines.get(first.file)[one + 1 + offset];
    return Boolean(line) && line.text === lines.get(second.file)[other + 1 + offset]?.text && apart(one + 1 + offset);
  });
  return [one + tail, other + tail];
};

// Repeated blocks, grouped by their text: each group lists every place the block appears.
export const duplicateGroups = ({ lines, windows }) => {
  const byPlace = new Map(windows.map((window) => [`${window.file}\0${window.index}`, window]));
  const windowAt = (file, index) => byPlace.get(`${file}\0${index}`);
  const before = ({ file, index }) => windowAt(file, index - 1);
  const startsRun = ([first, second]) => !before(first) || before(first).key !== before(second)?.key;
  const blocks = [...Map.groupBy(windows, ({ key }) => key).values()].filter((found) => found.length > 1).flatMap(pairsOf)
    .filter(startsRun)
    .map((pair) => ({ pair, ends: runEnds(windowAt, lines, pair) }))
    .filter(({ ends }) => ends)
    .map(({ pair, ends }) => ({
      text: lines.get(pair[0].file).slice(pair[0].index, ends[0] + 1).map(({ text }) => text),
      places: pair.map(({ file, index }, at) => placeOf(lines.get(file), file, index, ends[at])),
    }));
  return [...Map.groupBy(blocks, ({ text }) => text.join("\n")).values()]
    .map((same) => ({
      text: same[0].text,
      places: [...new Map(same.flatMap(({ places }) => places).map((place) => [`${place.file}:${place.start}`, place])).values()]
        .toSorted((a, b) => a.file.localeCompare(b.file) || a.start - b.start),
    }))
    .toSorted((a, b) => b.text.join("").length * b.places.length - a.text.join("").length * a.places.length
      || a.places[0].file.localeCompare(b.places[0].file) || a.places[0].start - b.places[0].start);
};

const listed = (table) => Object.entries(table).flatMap(([key, files]) => Object.entries(files).map(([file, count]) => ({ key, file, count })));
const countIn = (table, { key, file }) => table[key]?.[file] ?? 0;

// The windows a file repeats more often than the baseline lists, and listed repeats that are gone.
export const compare = (windows, baseline) => {
  const repeated = repeatedWindows(windows);
  return {
    added: windows.filter((window) => countIn(repeated, window) > countIn(baseline, window)),
    gone: listed(baseline).filter((entry) => countIn(repeated, entry) < entry.count),
  };
};

const overlaps = (place, window) => place.file === window.file && place.start <= window.end && window.start <= place.end;

export const report = (groups) => [
  `# Repeated code\n\n${groups.length} repeated blocks of at least ${MIN_CHARS} characters of code.\n`,
  ...groups.map(({ text, places }, at) => [
    `## ${at + 1}. ${text.length} lines, ${places.length} places`,
    "",
    ...places.map(({ file, start, end }) => `- ${file}:${start}-${end}`),
    "",
    `    ${text[0]}`,
    "",
  ].join("\n")),
].join("\n");

export const scannedFiles = async () => {
  const copies = new Set(SHARED.flatMap(({ copies }) => copies));
  const paths = execFileSync("git", ["ls-files", "-z", "--", ...FOLDERS], { cwd: ROOT, encoding: "utf8" }).split("\0")
    .filter((path) => CODE.test(path) && !copies.has(path));
  return Object.fromEntries(await Promise.all(paths.map(async (path) => [path, await readFile(new URL(path, ROOT), "utf8")])));
};

const option = (name) => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined;

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const scanned = scan(await scannedFiles());
  const groups = duplicateGroups(scanned);
  const reportPath = option("--report");
  if (reportPath) await writeFile(reportPath, report(groups));
  console.log(`${groups.length} repeated blocks`);
  if (process.argv.includes("--write")) await writeFile(BASELINE, `${JSON.stringify(repeatedWindows(scanned.windows), null, 1)}\n`);
  else {
    const { added, gone } = compare(scanned.windows, JSON.parse(await readFile(BASELINE, "utf8")));
    const offending = groups.filter(({ places }) => places.some((place) => added.some((window) => overlaps(place, window))));
    const errors = [
      ...(added.length ? [`New repeated code: make it one component, state or primitive.\n\n${report(offending)}`] : []),
      ...[...new Set(gone.map(({ file }) => file))].map((file) => `${BASELINE_NAME} lists repeated code in ${file} that is gone: run npm run check:dupes -- --write`),
    ];
    if (errors.length) {
      console.error(errors.join("\n"));
      process.exit(1);
    }
  }
}

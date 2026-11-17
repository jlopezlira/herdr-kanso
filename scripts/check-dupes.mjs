// Usage: [KANSO_BASE=origin/develop] npm run check:dupes [-- --report <file.md>] [-- --write]
// Finds every block of code repeated in the repository's code, skipping copies and built files; fails on one the baseline does not list, or a baseline that grew.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { SHARED } from "./sync-share.mjs";
import { BUILT } from "./build-site.mjs";
import { OUT as SITE_TOKENS } from "./build-site-tokens.mjs";

const ROOT = new URL("../", import.meta.url);
const BASELINE_NAME = "kanso/dupes-baseline.json";
const BASELINE = new URL(BASELINE_NAME, ROOT);
export const FOLDERS = ["kanso/mods", "stories", "scripts", "site", "tests", ".github"];
const CODE = /\.(?:m?js|jsx|css|html|mdx|sh|ps1|ya?ml)$/;
const COMMENT = /^(?:\/\/|\/\*|\*(?:\s(?!\{)|\/|$)|<!--|# )/;
const IMPORT = /^import\s[^;]*?(?:from\s*)?["'][^"']+["'];?/gm;
export const MIN_LINE = 80;
export const MIN_RUN = 50;

const hash = (text) => createHash("sha1").update(text).digest("hex").slice(0, 12);
const placeOf = (lines, file, from, to) => ({ file, start: lines[from].line, end: lines[to].line });
const byFileAndStart = (a, b) => a.file.localeCompare(b.file) || a.start - b.start;
const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;

// How many offsets in a row, from 0 and below limit, hold.
const countWhile = (holds, limit) => {
  const stop = Array.from({ length: limit }, (_, offset) => offset).findIndex((offset) => !holds(offset));
  return stop < 0 ? limit : stop;
};

// The lines that carry code, trimmed, with their line numbers: blank, comment, import and bracket-only lines do not count.
export const significantLines = (text) => text.replace(IMPORT, (statement) => statement.replace(/[^\n]/g, "")).split(/\r?\n/)
  .map((line, index) => ({ line: index + 1, text: line.trim().replace(/\s+/g, " ") }))
  .filter(({ text }) => /\w/.test(text) && !COMMENT.test(text));

// Where the window from a line ends: the line alone from MIN_LINE characters, else the fewest lines reaching MIN_RUN.
const windowEnd = (lines, index, reach) => lines[index].text.length >= MIN_LINE
  ? index
  : reach.findIndex((sum, at) => at > index + 1 && sum - reach[index] >= MIN_RUN) - 1;

// The same code always makes the same window, wherever it sits.
const windowsOf = (file, lines) => {
  const reach = lines.reduce((sums, { text }) => [...sums, sums.at(-1) + text.length], [0]);
  return lines.flatMap((_, index) => {
    const last = windowEnd(lines, index, reach);
    if (last < 0) return [];
    const key = hash(lines.slice(index, last + 1).map(({ text }) => text).join("\n"));
    return [{ ...placeOf(lines, file, index, last), index, last, key }];
  });
};

export const scan = (files) => {
  const lines = new Map(Object.entries(files).map(([file, text]) => [file, significantLines(text)]));
  const windows = [...lines].flatMap(([file, fileLines]) => windowsOf(file, fileLines));
  return { lines, windows };
};

const countsByFile = (found) => Object.fromEntries([...Map.groupBy(found, ({ file }) => file)].map(([file, inFile]) => [file, inFile.length]));

// Every window that appears more than once, by its hash, with how often it appears in each file.
export const repeatedWindows = (windows) => Object.fromEntries([...Map.groupBy(windows, ({ key }) => key)]
  .filter(([, found]) => found.length > 1)
  .map(([key, found]) => [key, countsByFile(found)]));

const pairsOf = (found) => found.flatMap((first, at) => found.slice(at + 1).map((second) => [first, second]));

// Where a repeat starting at two places ends in each: shared windows, then shared lines, never overlapping itself.
const runEnds = ({ lines, windowAt }, [first, second]) => {
  const apart = (index) => first.file !== second.file || index < second.index;
  const windows = countWhile((offset) => {
    const one = windowAt(first.file, first.index + offset);
    const other = windowAt(second.file, second.index + offset);
    return Boolean(one && other) && one.key === other.key && apart(one.last);
  }, lines.get(first.file).length - first.index);
  if (!windows) return null;
  const [one, other] = [first, second].map(({ file, index }) => windowAt(file, index + windows - 1).last);
  const tail = countWhile((offset) => {
    const line = lines.get(first.file)[one + 1 + offset];
    return line.text === lines.get(second.file)[other + 1 + offset]?.text && apart(one + 1 + offset);
  }, lines.get(first.file).length - one - 1);
  return [one + tail, other + tail];
};

// Each pair of places where a repeat starts, as the block of lines they share.
const blocksOf = ({ lines, windows }) => {
  const byPlace = new Map(windows.map((window) => [`${window.file}\0${window.index}`, window]));
  const windowAt = (file, index) => byPlace.get(`${file}\0${index}`);
  const before = ({ file, index }) => windowAt(file, index - 1);
  const startsRun = ([first, second]) => !before(first) || before(first).key !== before(second)?.key;
  return [...Map.groupBy(windows, ({ key }) => key).values()]
    .flatMap(pairsOf)
    .filter(startsRun)
    .map((pair) => ({ pair, ends: runEnds({ lines, windowAt }, pair) }))
    .filter(({ ends }) => ends)
    .map(({ pair, ends }) => ({
      text: lines.get(pair[0].file).slice(pair[0].index, ends[0] + 1).map(({ text }) => text),
      places: pair.map(({ file, index }, at) => placeOf(lines.get(file), file, index, ends[at])),
    }));
};

const uniquePlaces = (places) => [...new Map(places.map((place) => [`${place.file}:${place.start}`, place])).values()].toSorted(byFileAndStart);
const weight = ({ text, places }) => text.join("").length * places.length;

// Repeated blocks, grouped by their text, largest first: each group lists every place the block appears.
export const duplicateGroups = (scanned) => [...Map.groupBy(blocksOf(scanned), ({ text }) => text.join("\n")).values()]
  .map((same) => ({ text: same[0].text, places: uniquePlaces(same.flatMap(({ places }) => places)) }))
  .toSorted((a, b) => weight(b) - weight(a) || byFileAndStart(a.places[0], b.places[0]));

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

// What a baseline lists beyond the base branch's: it may only shrink.
export const grown = (baseline, base) => listed(baseline).filter((entry) => entry.count > countIn(base, entry));

const overlaps = (place, window) => place.file === window.file && place.start <= window.end && window.start <= place.end;

export const report = (groups) => [
  `# Repeated code\n\n${plural(groups.length, "repeated block")}: one line from ${MIN_LINE} characters of code, or lines in a row from ${MIN_RUN}.\n`,
  ...groups.map(({ text, places }, at) => [
    `## ${at + 1}. ${plural(text.length, "line")}, ${plural(places.length, "place")}`,
    "",
    ...places.map(({ file, start, end }) => `- ${file}:${start}-${end}`),
    "",
    `    ${text[0]}`,
    "",
  ].join("\n")),
].join("\n");

const git = (...args) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });

export const scannedFiles = async () => {
  const made = new Set([...SHARED.flatMap(({ copies }) => copies), ...BUILT, SITE_TOKENS]);
  const paths = git("ls-files", "-z", "--", ...FOLDERS).split("\0").filter((path) => CODE.test(path) && !made.has(path));
  return Object.fromEntries(await Promise.all(paths.map(async (path) => [path, await readFile(new URL(path, ROOT), "utf8")])));
};

// The base branch's baseline, or null before it had one; a missing branch throws.
const baseBaseline = (ref) => {
  git("rev-parse", "--verify", `${ref}^{commit}`);
  try {
    return JSON.parse(git("show", `${ref}:${BASELINE_NAME}`));
  } catch {
    return null;
  }
};

const errorsOf = (scanned, groups, baseline, base) => {
  const { added, gone } = compare(scanned.windows, baseline);
  const offending = groups.filter(({ places }) => places.some((place) => added.some((window) => overlaps(place, window))));
  const files = (entries) => [...new Set(entries.map(({ file }) => file))];
  return [
    ...(added.length ? [`New repeated code: make it one component, state or primitive.\n\n${report(offending)}`] : []),
    ...files(gone).map((file) => `${BASELINE_NAME} lists repeated code in ${file} that is gone: run npm run check:dupes -- --write`),
    ...(base ? files(grown(baseline, base)).map((file) => `${BASELINE_NAME} lists more repeated code in ${file} than the base branch: remove the repeat instead`) : []),
  ];
};

const option = (name) => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined;

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const scanned = scan(await scannedFiles());
  const groups = duplicateGroups(scanned);
  const reportPath = option("--report");
  if (reportPath) await writeFile(reportPath, report(groups));
  console.log(plural(groups.length, "repeated block"));
  if (process.argv.includes("--write")) await writeFile(BASELINE, `${JSON.stringify(repeatedWindows(scanned.windows), null, 1)}\n`);
  else {
    const base = process.env.KANSO_BASE ? baseBaseline(process.env.KANSO_BASE) : null;
    const errors = errorsOf(scanned, groups, JSON.parse(await readFile(BASELINE, "utf8")), base);
    if (errors.length) {
      console.error(errors.join("\n"));
      process.exit(1);
    }
  }
}

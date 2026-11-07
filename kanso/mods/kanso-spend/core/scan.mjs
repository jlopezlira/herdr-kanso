import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { open, readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { pipeline as pipe } from "node:stream";
import { pipeline } from "node:stream/promises";
import * as zlib from "node:zlib";
import { mapSeries, parseOr, reduceSeries, tryOr } from "../pure.js";
import { closeParserState, openParserState, parseAdapterRecord } from "./adapters.mjs";
import { PMap } from "./pmap.mjs";
import {
  MAX_LINE_BYTES,
  expandHome,
  isPlainObject,
  localDay,
} from "./util.mjs";
import {
  addTask,
  addUsage,
  closeStore,
  dedupKeyFor,
  fileKey,
  newFileEntry,
  openStore,
  putEntry,
  removeLatestFallbackTaskForSession,
  resetFileEntry,
  rowCount,
  taskKeyFor,
} from "./store.mjs";

const CHUNK_BYTES = 256 * 1024;
const MAX_WARNINGS = 50;
const MAX_TRAVERSAL_ENTRIES = 250_000;
const PARSER_VERSIONS = { pi: 3, codex: 5, claude: 2 };

// A scan is a fold over the files found, one after another, and within each
// file over its lines. What it carries is new at every step, never changed:
// the working store (store.mjs), the file's parser state (adapters.mjs), and
// the tally below.

// ---------------------------------------------------------------------------
// Tally: the totals, the counts per source, the warnings to show and the
// files already seen. Each function answers a new tally.

function newTally(sources) {
  return {
    stats: {
      files: 0,
      filesRead: 0,
      bytesRead: 0,
      unchangedFiles: 0,
      errors: 0,
    },
    sources: Object.fromEntries(sources.map((source) => [source.id, {
      enabled: source.enabled,
      rootCount: source.roots.length,
      rootsAvailable: 0,
      files: 0,
      filesRead: 0,
      bytesRead: 0,
      errors: 0,
    }])),
    warnings: [],
    hidden: 0,
    reportedHidden: false,
    seenPaths: PMap.over(),
    seenInodes: PMap.over(),
  };
}

function tallyWarn(tally, message, sourceId) {
  const source = sourceId ? tally.sources[sourceId] : undefined;
  const room = tally.warnings.length < MAX_WARNINGS;
  return {
    ...tally,
    stats: { ...tally.stats, errors: tally.stats.errors + 1 },
    sources: source ? { ...tally.sources, [sourceId]: { ...source, errors: source.errors + 1 } } : tally.sources,
    warnings: room ? [...tally.warnings, message] : tally.warnings,
    hidden: room ? tally.hidden : tally.hidden + 1,
  };
}

function tallyNote(tally, message) {
  return tally.warnings.length < MAX_WARNINGS ? { ...tally, warnings: [...tally.warnings, message] } : tally;
}

function tallyFinish(tally) {
  if (tally.hidden <= 0 || tally.reportedHidden) return tally;
  return { ...tally, reportedHidden: true, warnings: [...tally.warnings, `${tally.hidden} additional scan warnings were not shown.`] };
}

// `n` added to one total.
function count(tally, field, n = 1) {
  return { ...tally, stats: { ...tally.stats, [field]: tally.stats[field] + n } };
}

// `n` added to one count of one source.
function countFor(tally, sourceId, field, n = 1) {
  const source = tally.sources[sourceId];
  return { ...tally, sources: { ...tally.sources, [sourceId]: { ...source, [field]: source[field] + n } } };
}

// A file is scanned once per path and once per inode (a hard link or a
// second root reaching the same file counts once). The answer of firstSight
// is the tally that has seen it, or null when it was seen already.
function seenPath(tally, file) {
  return tally.seenPaths.has(file);
}

function firstSight(tally, file, inode) {
  if (tally.seenInodes.has(inode)) return null;
  return { ...tally, seenPaths: tally.seenPaths.with(file, true), seenInodes: tally.seenInodes.with(inode, true) };
}

// A warning of one source, its id in front.
function sourceWarn(tally, source, message) {
  return tallyWarn(tally, `[${source.id}] ${message}`, source.id);
}

function isEligible(adapter, filePath) {
  if (adapter === "opencode") return path.basename(filePath) === "opencode.db";
  if (adapter === "codex") {
    return filePath.endsWith(".jsonl") || filePath.endsWith(".jsonl.zst");
  }
  return filePath.endsWith(".jsonl");
}

async function walkRoot(root, adapter) {
  const start = await realpath(root)
    .then(async (canonical) => ({ canonical, file: (await stat(canonical)).isFile() }))
    .catch((error) => ({ failed: true, error }));
  if (start.failed) {
    const { error } = start;
    if (error?.code === "ENOENT") return { files: [], sortBase: root, unavailable: true };
    return { files: [], sortBase: root, fatal: error };
  }
  const { canonical } = start;
  if (start.file) {
    return { files: isEligible(adapter, canonical) ? [canonical] : [], sortBase: root };
  }
  const walked = await walkDir(canonical, root, adapter, { traversed: 0, fatal: null, stopped: false });
  return { files: walked.files.flat(Infinity), sortBase: canonical, unavailable: false, fatal: walked.fatal };
}

// One directory and everything under it, depth first: its own files, then
// its subdirectories from the last name to the first. Every entry seen counts
// toward the traversal cap; at the cap the walk stops where it is. `seen`
// carries the count, the first read error and whether the walk stopped;
// `files` comes back nested, one list per directory.
async function walkDir(dir, root, adapter, seen) {
  const listed = await readdir(dir, { withFileTypes: true }).then((entries) => ({ entries }), (error) => ({ error }));
  if (!listed.entries) {
    if (listed.error?.code === "ENOENT") return { ...seen, files: [] };
    return { ...seen, fatal: seen.fatal ?? listed.error, files: [] };
  }
  const entries = listed.entries.toSorted((a, b) => a.name.localeCompare(b.name));
  const room = Math.max(0, MAX_TRAVERSAL_ENTRIES - seen.traversed);
  const counted = entries.slice(0, room);
  const stopped = entries.length > room;
  const here = {
    traversed: seen.traversed + counted.length + (stopped ? 1 : 0),
    fatal: stopped ? new Error(`root ${root} exceeds ${MAX_TRAVERSAL_ENTRIES} entries`) : seen.fatal,
    stopped,
  };
  const own = await Promise.all(counted.map(async (entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return [];
    if (entry.isFile() && isEligible(adapter, entry.name)) return [full];
    if (!entry.isSymbolicLink()) return [];
    // Do not follow directory symlinks (loops); a symlinked file is harmless.
    // Broken links are simply not transcript files.
    const linkStat = await stat(full).catch(() => null);
    return linkStat?.isFile() && isEligible(adapter, full) ? [full] : [];
  }));
  if (stopped) return { ...here, files: own };
  const subdirs = counted.filter((entry) => entry.isDirectory()).map((entry) => path.join(dir, entry.name)).toReversed();
  return reduceSeries(subdirs, async (walked, sub) => {
    if (walked.stopped) return walked;
    const inner = await walkDir(sub, root, adapter, walked);
    return { ...inner, files: [...walked.files, inner.files] };
  }, { ...here, files: own });
}

// Every eligible file of every enabled root, in order, and the tally with
// what each root reported: { files, tally }.
export async function discoverFiles(config, home, tally) {
  // Every root of every enabled source, in config order.
  const roots = config.sources.flatMap((source, sourceIndex) => (source.enabled
    ? source.roots.map((rootText, rootIndex) => ({ source, sourceIndex, rootIndex, rootText, root: expandHome(rootText, home) }))
      .filter((job) => job.root)
    : []));
  const walked = await mapSeries(roots, async (job) => ({ job, result: await walkRoot(job.root, job.source.adapter) }));
  const reported = walked.reduce((current, { job: { source, rootText }, result }) => {
    if (result.unavailable) {
      return tallyNote(current, `[${source.id}] source ${source.id}: root ${rootText} is not available.`);
    }
    if (result.fatal) {
      return tallyWarn(
        current,
        `[${source.id}] source ${source.id}: cannot read root ${rootText}: ${result.fatal.message}`,
        source.id,
      );
    }
    return countFor(current, source.id, "rootsAvailable");
  }, tally);
  const files = walked.flatMap(({ job: { source, sourceIndex, rootIndex }, result }) => result.files.map((file) => ({
    source,
    sourceIndex,
    rootIndex,
    file,
    sortBase: result.sortBase,
  })));
  return {
    files: files.toSorted(
      (a, b) =>
        a.sourceIndex - b.sourceIndex ||
        a.rootIndex - b.rootIndex ||
        a.file.localeCompare(b.file),
    ),
    tally: reported,
  };
}

function hashBytes(buffer) {
  return createHash("sha256").update(buffer).digest("hex").slice(0, 24);
}

// The byte offsets of every newline in `buffer`.
function newlinesIn(buffer) {
  return [...buffer.toString("latin1").matchAll(/\n/g)].map((match) => match.index);
}

// ---------------------------------------------------------------------------
// Lines: a byte stream split into JSON lines, chunk by chunk. A run is
// { lines, acc }: `lines` is where the reading is (the last complete line's
// end, the line count, a part line waiting in `pending` for its newline),
// `acc` what the lines have made so far. Each step answers the next run;
// `onLine(acc, record, info)` answers the next acc.

function startLines({ offset = 0, lineNo = 0, discarding = false } = {}) {
  return {
    pending: [],
    pendingLength: 0,
    discarding: Boolean(discarding),
    lineNo,
    offset,
    skippedLargeLine: false,
    // Bytes fed so far.
    fed: 0,
  };
}

function processLine(run, onLine, buffer, absoluteEnd, complete) {
  const end = buffer.length > 0 && buffer[buffer.length - 1] === 13 ? buffer.length - 1 : buffer.length;
  const lines = { ...run.lines, lineNo: run.lines.lineNo + 1, offset: absoluteEnd };
  if (end === 0) return { lines, acc: run.acc };
  const line = buffer.subarray(0, end);
  const parsed = tryOr(() => ({ value: JSON.parse(line.toString("utf8")) }), null);
  if (!parsed) {
    if (!complete) return { lines, acc: run.acc };
    return { lines, acc: onLine(run.acc, null, { lineNo: lines.lineNo, hash: hashBytes(line), parseError: true }) };
  }
  return {
    lines,
    acc: onLine(run.acc, parsed.value, {
      lineNo: lines.lineNo,
      hash: hashBytes(line),
      parseError: false,
    }),
  };
}

// A line too long to keep: counted and stepped over.
function skipLine(run, absoluteEnd) {
  return { ...run, lines: { ...run.lines, lineNo: run.lines.lineNo + 1, offset: absoluteEnd, skippedLargeLine: true } };
}

// The line of `buffer` from `start` to the newline at `newline`.
function lineAt(run, onLine, buffer, start, newline, chunkStart) {
  const absoluteEnd = chunkStart + newline + 1;
  if (run.lines.discarding) {
    return { ...run, lines: { ...run.lines, lineNo: run.lines.lineNo + 1, offset: absoluteEnd, discarding: false } };
  }
  const piece = buffer.subarray(start, newline);
  if (run.lines.pendingLength > 0) {
    const whole = Buffer.concat([...run.lines.pending, piece], run.lines.pendingLength + piece.length);
    const emptied = { ...run, lines: { ...run.lines, pending: [], pendingLength: 0 } };
    return whole.length > MAX_LINE_BYTES ? skipLine(emptied, absoluteEnd) : processLine(emptied, onLine, whole, absoluteEnd, true);
  }
  return piece.length > MAX_LINE_BYTES ? skipLine(run, absoluteEnd) : processLine(run, onLine, piece, absoluteEnd, true);
}

// The end of a chunk with no newline yet: kept for the next chunk, or
// dropped once the line outgrows the limit.
function keepPartial(run, remainder, chunkEnd) {
  const lines = run.lines;
  const kept = lines.discarding ? lines
    : lines.pendingLength + remainder.length > MAX_LINE_BYTES
      ? { ...lines, pending: [], pendingLength: 0, discarding: true, skippedLargeLine: true }
      : remainder.length > 0
        ? { ...lines, pending: [...lines.pending, Buffer.from(remainder)], pendingLength: lines.pendingLength + remainder.length }
        : lines;
  return { ...run, lines: kept.discarding ? { ...kept, offset: chunkEnd } : kept };
}

function feedAt(run, onLine, buffer, chunkStart) {
  const fed = { ...run, lines: { ...run.lines, fed: run.lines.fed + buffer.length } };
  const newlines = newlinesIn(buffer);
  const read = newlines.reduce(
    (current, newline, index) => lineAt(current, onLine, buffer, index === 0 ? 0 : newlines[index - 1] + 1, newline, chunkStart),
    fed,
  );
  const tail = newlines.length > 0 ? newlines.at(-1) + 1 : 0;
  return tail < buffer.length ? keepPartial(read, buffer.subarray(tail), chunkStart + buffer.length) : read;
}

function finishLines(run, onLine, fileSize) {
  const emptied = { ...run, lines: { ...run.lines, pending: [], pendingLength: 0 } };
  if (run.lines.discarding) return emptied;
  if (run.lines.pendingLength === 0) return run;
  const whole = Buffer.concat(run.lines.pending, run.lines.pendingLength);
  if (whole.length > MAX_LINE_BYTES) return emptied;
  // A trailing partial line is deliberately not persisted. offset stays at
  // the last complete newline and the next scan rereads the tail from disk.
  const parses = tryOr(() => {
    JSON.parse(whole.toString("utf8"));
    return true;
  }, false);
  return parses ? processLine(emptied, onLine, whole, fileSize, true) : emptied;
}

// `step(value, chunk, position)` over the bytes of `filePath` from `start`
// to `end` (or EOF): { value } with what the chunks made, and `error` too
// when a read failed part way (the value then covers the chunks before it).
async function streamRange(filePath, start, end, step, initial) {
  const opened = await open(filePath, "r").then((handle) => ({ handle }), (error) => ({ error }));
  if (opened.error) return { value: initial, error: opened.error };
  const { handle } = opened;
  // One chunk at `position`, then the rest after it, until `end` or EOF.
  const readFrom = async (position, value) => {
    if (position >= end) return { value };
    const toRead = Math.min(CHUNK_BYTES, end - position);
    const buffer = Buffer.allocUnsafe(toRead);
    const read = await handle.read(buffer, 0, toRead, position).then((result) => ({ result }), (error) => ({ error }));
    if (read.error) return { value, error: read.error };
    const { bytesRead } = read.result;
    if (bytesRead <= 0) return { value };
    return readFrom(position + bytesRead, step(value, buffer.subarray(0, bytesRead), position));
  };
  const streamed = await readFrom(start, initial);
  // A failed close is the error that counts, as it would be from a finally.
  const closeError = await handle.close().then(() => null, (error) => error);
  return closeError ? { value: streamed.value, error: closeError } : streamed;
}

function hasZstdSupport() {
  return typeof zlib.createZstdDecompress === "function";
}

// What one file's lines can do to the scan, for the adapters (ctx in
// adapters.mjs): each takes the line acc ({ work, state, tally }) and
// answers the next.
function lineContext(entry, source) {
  return {
    file: entry,
    source,
    lineHash: "",
    warn(acc, message) {
      return { ...acc, tally: sourceWarn(acc.tally, source, `${source.adapter} ${entry.path}: ${message}`) };
    },
    addUsage(acc, meta, tokens, key) {
      const added = addUsage(acc.work, entry.id, meta, tokens, key);
      return { acc: { ...acc, work: added.work }, result: added };
    },
    addTask(acc, fileId, rowIdx, key, durationMs, session, exact) {
      return {
        ...acc,
        work: addTask(
          acc.work,
          fileId,
          rowIdx,
          key,
          durationMs,
          session,
          exact,
          entry.id,
        ),
      };
    },
    removeLatestFallback(acc, session) {
      const taken = removeLatestFallbackTaskForSession(acc.work, session);
      return { acc: { ...acc, work: taken.work }, removed: taken.removed };
    },
  };
}

// What a line does: a JSON object goes to the source's parser, with the
// line's hash for records that carry no id. A record that throws counts for
// nothing and is reported.
function lineHandler(entry, source) {
  const context = lineContext(entry, source);
  const where = `${source.adapter} ${entry.path}`;
  return (acc, record, info) => {
    if (info.parseError) {
      return { ...acc, tally: sourceWarn(acc.tally, source, `${where}: line ${info.lineNo} is not valid JSON; skipped.`) };
    }
    if (!isPlainObject(record)) return acc;
    const parsed = (() => {
      try {
        return { acc: parseAdapterRecord(source.adapter, record, { ...context, lineHash: info.hash }, acc) };
      } catch (error) {
        return { acc, error };
      }
    })();
    const error = parsed.error ?? parsed.acc.lineError;
    if (!error) return parsed.acc;
    const kept = withoutKey(parsed.acc, "lineError");
    return { ...kept, tally: sourceWarn(kept.tally, source, `${where}: line ${info.lineNo} could not be parsed: ${error.message}`) };
  };
}

// A run over the file's lines from `lines`, its acc the scan's work and
// tally with the entry's parser state.
function startRun(work, tally, entry, lines) {
  return { lines: startLines(lines), acc: { work, state: openParserState(entry.state), tally } };
}

// `object` without `key`, the order of the rest kept.
function withoutKey(object, key) {
  if (!Object.hasOwn(object, key)) return object;
  const { [key]: _dropped, ...rest } = object;
  return rest;
}

async function scanPlainFile(work, tally, key, entry, source, filePath, fileStat) {
  const adapter = source.adapter;
  const start = entry.offset;
  if (fileStat.size <= start) return { work, tally, entry, dirty: false };

  const onLine = lineHandler(entry, source);
  const streamed = await streamRange(
    filePath,
    start,
    fileStat.size,
    (run, chunk, chunkStart) => feedAt(run, onLine, chunk, chunkStart),
    startRun(work, tally, entry, {
      offset: start,
      lineNo: entry.lineNo ?? 0,
      discarding: entry.state.discardingLargeLine,
    }),
  );
  // Keep the accepted complete prefix and its parser state together. The
  // unfinished suffix is retried even if the file metadata is unchanged.
  const run = streamed.error ? streamed.value : finishLines(streamed.value, onLine, start + streamed.value.lines.fed);
  const parsed = closeParserState(run.acc.state);
  const read = streamed.error ? { ...parsed, readFailed: true } : withoutKey(parsed, "readFailed");
  const failedRead = streamed.error
    ? sourceWarn(run.acc.tally, source, `${adapter} ${entry.path}: read failed; accepted prefix retained: ${streamed.error.message}`)
    : run.acc.tally;
  const counted = run.lines.fed > 0
    ? count(count(failedRead, "bytesRead", run.lines.fed), "filesRead")
    : count(failedRead, "bytesRead", run.lines.fed);
  const warned = run.lines.skippedLargeLine
    ? sourceWarn(counted, source, `${adapter} ${entry.path}: a line larger than ${MAX_LINE_BYTES} bytes was skipped.`)
    : counted;
  const next = {
    ...entry,
    offset: run.lines.offset,
    lineNo: run.lines.lineNo,
    state: run.lines.discarding ? { ...read, discardingLargeLine: true } : withoutKey(read, "discardingLargeLine"),
  };
  return { work: putEntry(run.acc.work, key, next), tally: warned, entry: next, dirty: true };
}

async function verifyZstd(filePath) {
  try {
    await pipeline(
      createReadStream(filePath),
      zlib.createZstdDecompress(),
      async (chunks) => {
        for await (const chunk of chunks) void chunk;
      },
    );
    return null;
  } catch (error) {
    return error;
  }
}

// `step(value, chunk)` over the decompressed bytes of an archive: { value },
// and `error` too when the stream failed part way.
async function streamArchive(filePath, step, initial) {
  const chunks = pipe(createReadStream(filePath), zlib.createZstdDecompress(), () => {});
  const iterator = chunks[Symbol.asyncIterator]();
  const readOn = async (value) => {
    const next = await iterator.next().then((item) => ({ item }), (error) => ({ error }));
    if (next.error) return { value, error: next.error };
    if (next.item.done) return { value };
    return readOn(step(value, next.item.value));
  };
  return readOn(initial);
}

async function scanCompressedFile(work, tally, key, entry, source, filePath, fileStat) {
  if (!hasZstdSupport()) {
    const next = {
      ...entry,
      size: fileStat.size,
      mtimeMs: fileStat.mtimeMs,
      offset: fileStat.size,
      state: { ...entry.state, unsupported: "zstd" },
    };
    return {
      work: putEntry(work, key, next),
      tally: sourceWarn(tally, source, `${source.adapter} ${entry.path}: .jsonl.zst needs Node's zstd API (Node 22.15+); skipped.`),
      entry: next,
      ok: true,
      dirty: true,
    };
  }
  // Raw transcript bytes are never retained: the line reader is bounded.
  const fresh = entry.offset || rowCount(work, entry.id) || Object.keys(entry.state).length
    ? resetFileEntry(work, key, entry)
    : { work, entry };
  const onLine = lineHandler(fresh.entry, source);
  const streamed = await streamArchive(
    filePath,
    (run, chunk) => feedAt(run, onLine, chunk, run.lines.fed),
    startRun(fresh.work, tally, fresh.entry, { offset: 0, lineNo: fresh.entry.lineNo ?? 0 }),
  );
  if (streamed.error) {
    // The archive verified before this read, so it changed underneath us.
    // Drop this file's partial contribution and retry it on the next scan.
    const dropped = resetFileEntry(streamed.value.acc.work, key, fresh.entry);
    const next = { ...dropped.entry, state: { ...dropped.entry.state, readFailed: true } };
    return {
      work: putEntry(dropped.work, key, next),
      tally: sourceWarn(
        streamed.value.acc.tally,
        source,
        `${source.adapter} ${entry.path}: zstd file could not be decompressed: ${streamed.error.message}`,
      ),
      entry: next,
      ok: false,
      dirty: true,
    };
  }
  const run = finishLines(streamed.value, onLine, streamed.value.lines.fed);
  const warned = run.lines.skippedLargeLine
    ? sourceWarn(run.acc.tally, source, `${source.adapter} ${entry.path}: a line larger than ${MAX_LINE_BYTES} bytes was skipped.`)
    : run.acc.tally;
  const counted = fileStat.size > 0
    ? count(count(warned, "bytesRead", fileStat.size), "filesRead")
    : count(warned, "bytesRead", fileStat.size);
  const next = {
    ...fresh.entry,
    offset: fileStat.size,
    lineNo: run.lines.lineNo,
    state: closeParserState(run.acc.state),
  };
  return { work: putEntry(run.acc.work, key, next), tally: counted, entry: next, ok: true, dirty: true };
}

function openCodeString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "unknown";
}

function openCodeInt(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

// One OpenCode message row: its usage (and its time as a task) go into the
// store. The answer is the working store and 1 for a malformed row, else 0.
function openCodeMessage(work, entry, source, record) {
  const data = parseOr(record.data, null);
  if (!isPlainObject(data)) return { work, malformed: 1 };
  if (data.role !== "assistant") return { work, malformed: 0 };
  if (!isPlainObject(data.tokens)) return { work, malformed: 1 };
  const reported = [data.tokens.input, data.tokens.output, data.tokens.reasoning, data.tokens.cache?.read, data.tokens.cache?.write];
  if (reported.some((value) => value !== undefined && (typeof value !== "number" || !Number.isFinite(value) || value < 0))) {
    return { work, malformed: 1 };
  }
  const tokens = {
    input: openCodeInt(data.tokens.input),
    output: openCodeInt(data.tokens.output),
    cacheRead: openCodeInt(data.tokens.cache?.read),
    cacheWrite: openCodeInt(data.tokens.cache?.write),
    reasoning: openCodeInt(data.tokens.reasoning),
  };
  if (tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite <= 0) return { work, malformed: 0 };
  const created = openCodeInt(data.time?.created) || openCodeInt(record.time_created);
  if (created <= 0 || !Number.isFinite(new Date(created).getTime())) return { work, malformed: 1 };
  const session = String(record.session_id ?? "unknown");
  const result = addUsage(work, entry.id, {
    day: localDay(created),
    session,
    harness: source.id,
    provider: openCodeString(data.providerID),
    model: openCodeString(data.modelID),
    project: typeof data.path?.cwd === "string" ? data.path.cwd : "",
  }, tokens, dedupKeyFor("opencode", "message", String(record.id)));
  const completed = openCodeInt(data.time?.completed);
  if (completed <= created) return { work: result.work, malformed: 0 };
  return {
    work: addTask(
      result.work,
      result.fileId,
      result.rowIdx,
      taskKeyFor("opencode", "message", String(record.id)),
      completed - created,
      session,
      true,
    ),
    malformed: 0,
  };
}

// Every message of an OpenCode database read again into a fresh entry:
// { work, entry, malformedRows }. A failure part way throws, and the caller
// keeps the working store it had before.
function readOpenCodeMessages(sqlite, filePath, work, key, entry, source) {
  // Never open an external source writable, including on recovery errors.
  const db = new sqlite.DatabaseSync(filePath, { readOnly: true });
  try {
    const records = db.prepare("SELECT session_id, id, time_created, data FROM message").iterate();
    const reset = resetFileEntry(work, key, entry);
    const cleared = { ...reset.entry, state: withoutKey(reset.entry.state, "unsupported") };
    // The rows are read one at a time, never all in memory at once.
    const read = Iterator.from(records).reduce((done, record) => {
      const one = openCodeMessage(done.work, cleared, source, record);
      return { work: one.work, malformed: done.malformed + one.malformed };
    }, { work: putEntry(reset.work, key, cleared), malformed: 0 });
    return { work: read.work, entry: cleared, malformedRows: read.malformed };
  } finally {
    try { db.close(); } catch { /* close is best-effort */ }
  }
}

/**
 * OpenCode stores sessions in one SQLite database. Messages are immutable
 * once completed and each assistant row carries canonical tokens, so a full
 * re-read through the max-upsert dedup is exact. The WAL file changes on
 * every write while the main database may not, so the checkpoint fingerprint
 * covers both files.
 */
async function scanOpenCodeDb(work, tally, source, filePath) {
  const statted = await stat(filePath).then((found) => ({ found }), (error) => ({ error }));
  if (statted.error) {
    const warned = statted.error?.code !== "ENOENT"
      ? sourceWarn(tally, source, `opencode ${filePath}: cannot stat file: ${statted.error.message}`)
      : tally;
    return { work, tally: warned, dirty: false };
  }
  const dbStat = statted.found;
  if (!dbStat.isFile()) return { work, tally, dirty: false };
  // No WAL right now is fine.
  const walStat = await stat(`${filePath}-wal`).catch(() => null);
  const fingerprint = `${dbStat.mtimeMs}:${dbStat.size}:${walStat?.mtimeMs ?? 0}:${walStat?.size ?? 0}`;

  const key = fileKey(source.id, filePath);
  const known = work.files.get(key);
  const isNew = !known;
  const made = known ? { work, entry: known } : newFileEntry(work, {
    sourceId: source.id,
    adapter: source.adapter,
    path: filePath,
    dev: String(dbStat.dev),
    ino: String(dbStat.ino),
    size: 0,
    mtimeMs: 0,
    compressed: false,
  });
  const { entry } = made;
  if (entry.state.opencodeParserVersion === 2 && entry.state.opencodeFingerprint === fingerprint) {
    const warned = entry.state.opencodeMalformedRows
      ? sourceWarn(tally, source, `opencode ${filePath}: ${entry.state.opencodeMalformedRows} malformed message rows were skipped.`)
      : tally;
    return { work: made.work, tally: count(warned, "unchangedFiles"), dirty: isNew };
  }

  const sqlite = await import("node:sqlite").catch(() => null);
  if (!sqlite) {
    const flagged = entry.state.unsupported !== "sqlite";
    const next = flagged ? { ...entry, state: { ...entry.state, unsupported: "sqlite" } } : entry;
    const warned = flagged
      ? sourceWarn(tally, source, `opencode ${filePath}: node:sqlite is unavailable in this Node runtime; skipped.`)
      : tally;
    return { work: flagged ? putEntry(made.work, key, next) : made.work, tally: count(warned, "unchangedFiles"), dirty: isNew || flagged };
  }

  const read = (() => {
    try {
      return readOpenCodeMessages(sqlite, filePath, made.work, key, entry, source);
    } catch (error) {
      return { failed: true, error };
    }
  })();
  if (read.failed) {
    return { work: made.work, tally: sourceWarn(tally, source, `opencode ${filePath}: scan failed: ${read.error.message}`), dirty: isNew };
  }
  const { malformedRows } = read;
  const next = {
    ...read.entry,
    dev: String(dbStat.dev),
    ino: String(dbStat.ino),
    size: dbStat.size,
    mtimeMs: dbStat.mtimeMs,
    state: {
      ...read.entry.state,
      opencodeFingerprint: fingerprint,
      opencodeParserVersion: 2,
      opencodeMalformedRows: malformedRows,
    },
  };
  const warned = malformedRows
    ? sourceWarn(tally, source, `opencode ${filePath}: ${malformedRows} malformed message rows were skipped.`)
    : tally;
  return {
    work: putEntry(read.work, key, next),
    tally: count(count(warned, "filesRead"), "bytesRead", dbStat.size + (walStat?.size ?? 0)),
    dirty: true,
  };
}

// One file against the working store: { work, tally, dirty }.
async function scanOneFile(work, tally, source, filePath) {
  if (source.adapter === "opencode") {
    return scanOpenCodeDb(work, tally, source, filePath);
  }
  const statted = await stat(filePath).then((found) => ({ found }), (error) => ({ error }));
  if (statted.error) {
    const warned = statted.error?.code !== "ENOENT"
      ? sourceWarn(tally, source, `${source.adapter} ${filePath}: cannot stat file: ${statted.error.message}`)
      : tally;
    return { work, tally: warned, dirty: false };
  }
  const fileStat = statted.found;
  if (!fileStat.isFile()) return { work, tally, dirty: false };

  const key = fileKey(source.id, filePath);
  const known = work.files.get(key);
  const isNew = !known;
  const made = known ? { work, entry: known } : newFileEntry(work, {
    sourceId: source.id,
    adapter: source.adapter,
    path: filePath,
    dev: String(fileStat.dev),
    ino: String(fileStat.ino),
    size: 0,
    mtimeMs: 0,
    compressed: filePath.endsWith(".jsonl.zst"),
  });
  const { entry } = made;

  const dev = String(fileStat.dev);
  const ino = String(fileStat.ino);
  const parserVersion = PARSER_VERSIONS[entry.adapter];
  const parserKey = `${entry.adapter}ParserVersion`;
  const parserCurrent = (!parserVersion || entry.state[parserKey] === parserVersion)
    && !(entry.state.unsupported === "zstd" && hasZstdSupport());
  if (parserCurrent && !entry.state.readFailed && entry.dev === dev && entry.ino === ino
    && entry.size === fileStat.size && entry.mtimeMs === fileStat.mtimeMs) {
    return { work: made.work, tally: count(tally, "unchangedFiles"), dirty: isNew };
  }
  // Verify a changed archive decompresses before migrations/truncation reset
  // anything, so a bad archive leaves the store as it was.
  if (entry.compressed && hasZstdSupport() && filePath.endsWith(".jsonl.zst")) {
    const failure = await verifyZstd(filePath);
    if (failure) {
      return {
        work: made.work,
        tally: sourceWarn(tally, source, `${source.adapter} ${filePath}: zstd file could not be decompressed: ${failure.message}`),
        dirty: isNew,
      };
    }
  }
  // Each of these reads the file again from the start. They are checked in
  // turn: a reset clears the state the next one looks at.
  // Migrate existing history once for accounting fixes. New files own no
  // metadata and must never trigger a global ownership cleanup scan.
  const migrated = Boolean(!isNew && parserVersion && entry.state[parserKey] !== parserVersion);
  const afterMigration = migrated ? resetFileEntry(made.work, key, entry) : made;
  const zstdBack =
    afterMigration.entry.state.unsupported === "zstd" &&
    hasZstdSupport() &&
    filePath.endsWith(".jsonl.zst");
  const afterZstd = zstdBack ? resetFileEntry(afterMigration.work, key, afterMigration.entry) : afterMigration;
  const current = afterZstd.entry;
  const replaced =
    current.dev !== dev ||
    current.ino !== ino ||
    fileStat.size < current.size ||
    fileStat.size < current.offset;
  const afterReplace = replaced
    ? (() => {
      const reset = resetFileEntry(afterZstd.work, key, current);
      const next = { ...reset.entry, dev, ino };
      return { work: putEntry(reset.work, key, next), entry: next };
    })()
    : afterZstd;
  const forceRead = migrated || zstdBack || replaced;
  const dirtyBefore = isNew || forceRead;
  const ready = afterReplace.entry;

  if (
    !forceRead &&
    !ready.state.readFailed &&
    ready.size === fileStat.size &&
    ready.mtimeMs === fileStat.mtimeMs
  ) {
    return { work: afterReplace.work, tally: count(tally, "unchangedFiles"), dirty: dirtyBefore };
  }

  const scanned = filePath.endsWith(".jsonl.zst")
    ? await scanCompressedFile(afterReplace.work, tally, key, ready, source, filePath, fileStat)
    : await scanPlainFile(afterReplace.work, tally, key, ready, source, filePath, fileStat);
  if (scanned.ok === false) return { work: scanned.work, tally: scanned.tally, dirty: dirtyBefore };
  const done = {
    ...scanned.entry,
    size: fileStat.size,
    mtimeMs: fileStat.mtimeMs,
    path: filePath,
    state: parserVersion ? { ...scanned.entry.state, [parserKey]: parserVersion } : scanned.entry.state,
  };
  return { work: putEntry(scanned.work, key, done), tally: scanned.tally, dirty: scanned.dirty || dirtyBefore };
}

// Every source scanned into `store`: the new store, with the stats,
// warnings and per-source counts, and whether anything changed.
export async function scanSources(store, { home, onProgress, deadline } = {}) {
  const discovered = await discoverFiles(store.config, home, newTally(store.config.sources));
  const total = discovered.files.length;

  // File by file, in order. `stoppedAt` is how many were processed when the
  // time budget ran out (null while it lasts).
  const run = await reduceSeries(discovered.files, async (done, found, processed) => {
    if (done.stoppedAt !== null) return done;
    // Time budget: the host kills the collector after a fixed limit, and the
    // store is only saved when the scan settles. Stop between files so every
    // run persists its progress and the next refresh continues from there.
    if (Number.isFinite(deadline) && processed > 0 && Date.now() >= deadline) {
      return { ...done, stoppedAt: processed };
    }
    onProgress?.({ processed, total, file: found.file });
    if (seenPath(done.tally, found.file)) return done;
    const statted = await stat(found.file).then((fileStat) => ({ fileStat }), (error) => ({ error }));
    if (statted.error) {
      if (statted.error?.code === "ENOENT") return done;
      return {
        ...done,
        tally: sourceWarn(done.tally, found.source, `${found.source.adapter} ${found.file}: cannot stat file: ${statted.error.message}`),
      };
    }
    const { fileStat } = statted;
    if (!fileStat.isFile()) return done;
    const sighted = firstSight(done.tally, found.file, `${fileStat.dev}:${fileStat.ino}`);
    if (!sighted) return done;
    const before = countFor(count(sighted, "files"), found.source.id, "files");
    const scanned = await scanOneFile(done.work, before, found.source, found.file).catch((error) => ({
      work: done.work,
      tally: sourceWarn(before, found.source, `${found.source.adapter} ${found.file}: scan failed: ${error.message}`),
      dirty: false,
    }));
    const read = countFor(scanned.tally, found.source.id, "filesRead", scanned.tally.stats.filesRead - before.stats.filesRead);
    return {
      ...done,
      work: scanned.work,
      tally: countFor(read, found.source.id, "bytesRead", scanned.tally.stats.bytesRead - before.stats.bytesRead),
      dirty: scanned.dirty || done.dirty,
    };
  }, { dirty: false, stoppedAt: null, work: openStore(store), tally: discovered.tally });

  const sourceStats = Object.fromEntries(store.config.sources.map((source) => {
    const state = run.tally.sources[source.id];
    const status = !state.enabled ? "disabled"
      : state.errors > 0 ? "error"
        : state.rootCount > 0 && state.rootsAvailable === 0 ? "missing"
          : state.files === 0 ? "empty"
            : "ok";
    return [source.id, {
      status,
      files: state.files,
      filesRead: state.filesRead,
      bytesRead: state.bytesRead,
      errors: state.errors,
    }];
  }));

  const partial = run.stoppedAt !== null;
  const stats = {
    ...run.tally.stats,
    ...(partial ? { partial: true, processed: run.stoppedAt, total } : {}),
  };
  return {
    stats,
    warnings: tallyFinish(run.tally).warnings,
    dirty: run.dirty,
    sourceStats,
    store: closeStore(run.work),
  };
}

export async function rebuildScan(store, { home }) {
  return scanSources(store, { home });
}

export { scanOneFile, walkRoot };

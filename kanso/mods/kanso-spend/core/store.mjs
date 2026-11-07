import { chmod, readFile, rename, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { defaultConfig, migrateLoadedConfig, normalizeConfig } from "./config.mjs";
import { PList, PMap } from "./pmap.mjs";
import {
  STORE_VERSION,
  backupCorruptStore,
  ensureParent,
  hashKey,
  isPlainObject,
  sessionHash,
  toNonNegInt,
  tokenTotal,
} from "./util.mjs";

// The store is a plain object, read from spend.db and written back. A scan
// never changes it: it opens it as a working store (openStore), whose
// collections are persistent maps over the stored ones (pmap.mjs), threads
// that through every file and line, and makes a new plain store of it once,
// at the end (closeStore). Every function here answers a new working store
// and leaves the one it was given as it was.
//
// A working store holds:
//   store      the plain store it was opened from (version, config, ...)
//   nextFileId the id the next new file entry gets
//   files      file key -> entry; an entry's rows and tasks are the stored
//              ones until `rows` or `lists` holds a newer version
//   byId       file id -> file key
//   rows       file id -> the rows of a file changed in this scan
//   lists      file id -> the task keys of a file changed in this scan
//   dedup      usage key -> dedup entry
//   tasks      task key -> task entry
//   fallbacks  session hash -> its fallback task keys, oldest first; built
//              when first needed, dropped when a task stops being one

export function fileKey(sourceId, filePath) {
  return `${sourceId}\u0000${filePath}`;
}

// `store` with `fields` set, its hidden fields (the saved state, the
// read-only mark) kept: a new object, the old one as it was.
export function storeWith(store, fields) {
  return Object.create(Object.getPrototypeOf(store), {
    ...Object.getOwnPropertyDescriptors(store),
    ...Object.getOwnPropertyDescriptors(fields),
  });
}

// `store` with `values` as fields that JSON and the database never see.
function withHidden(store, values) {
  return Object.create(Object.getPrototypeOf(store), {
    ...Object.getOwnPropertyDescriptors(store),
    ...Object.fromEntries(Object.entries(values).map(([key, value]) => [
      key, { value, enumerable: false, writable: true, configurable: true },
    ])),
  });
}

export function emptyStore(config = defaultConfig()) {
  return {
    version: STORE_VERSION,
    config,
    nextFileId: 1,
    files: {},
    dedup: {},
    tasks: {},
    lastScanAt: null,
  };
}

// The store with every file, usage key and task dropped. What was saved
// stays known, so the next save deletes it from the database.
export function clearCollectedData(store) {
  return storeWith(store, { files: {}, dedup: {}, tasks: {}, nextFileId: 1 });
}

export function openStore(store) {
  return {
    store,
    nextFileId: store.nextFileId,
    files: PMap.over(store.files),
    byId: PMap.over(new Map(Object.entries(store.files)
      .filter(([, entry]) => entry && Number.isInteger(entry.id))
      .map(([key, entry]) => [entry.id, key]))),
    rows: PMap.over(),
    lists: PMap.over(),
    dedup: PMap.over(store.dedup),
    tasks: PMap.over(store.tasks),
    fallbacks: null,
  };
}

// The plain store a working store comes to: the one it was opened from when
// nothing changed.
export function closeStore(work) {
  const { store } = work;
  const touched = work.rows.changed || work.lists.changed;
  if (!touched && !work.files.changed && !work.dedup.changed && !work.tasks.changed
    && work.nextFileId === store.nextFileId) {
    return store;
  }
  const files = !touched && !work.files.changed ? store.files
    : Object.fromEntries(work.files.entries().map(([key, entry]) => [key, finalEntry(work, entry)]));
  return storeWith(store, {
    nextFileId: work.nextFileId,
    files,
    dedup: work.dedup.toObject(),
    tasks: work.tasks.toObject(),
  });
}

function finalEntry(work, entry) {
  const rows = isPlainObject(entry) ? work.rows.get(entry.id) : undefined;
  const list = isPlainObject(entry) ? work.lists.get(entry.id) : undefined;
  if (!rows && !list) return entry;
  return {
    ...entry,
    ...(rows ? { rows: rows.list.toArray() } : {}),
    ...(list ? { tasks: taskKeys(list) } : {}),
  };
}

export function fileById(work, id) {
  const key = work.byId.get(id);
  return key === undefined ? null : (work.files.get(key) ?? null);
}

// The working store with `entry` stored under `key`.
export function putEntry(work, key, entry) {
  return { ...work, files: work.files.with(key, entry) };
}

export function newFileEntry(work, values) {
  const id = work.nextFileId;
  const entry = {
    id,
    ...values,
    offset: 0,
    lineNo: 0,
    rows: [],
    tasks: [],
    state: {},
  };
  const key = fileKey(entry.sourceId, entry.path);
  return {
    work: { ...work, nextFileId: id + 1, files: work.files.with(key, entry), byId: work.byId.with(id, key) },
    entry,
  };
}

// The file's own usage rows and task keys dropped, ready to be read again
// from the start.
export function resetFileEntry(work, key, entry) {
  const cleaned = removeOwnedMetadata(work, entry.id);
  const reset = { ...entry, offset: 0, lineNo: 0, rows: [], tasks: [], state: {} };
  return {
    work: {
      ...cleaned,
      files: cleaned.files.with(key, reset),
      rows: cleaned.rows.without(entry.id),
      lists: cleaned.lists.without(entry.id),
    },
    entry: reset,
  };
}

// ---------------------------------------------------------------------------
// Rows

function newRow(meta) {
  return {
    day: meta.day,
    session: meta.session,
    harness: meta.harness,
    provider: meta.provider,
    model: meta.model,
    project: meta.project,
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    reasoning: 0,
    messages: 0,
  };
}

// A file's rows while a scan changes them, and the bucket index over them:
// each key at the first row that has it. The index is built when first
// needed and again after a row's key changed.
function rowsFrom(array) {
  return { list: PList.of(array), index: null };
}

// The rows of file `id`, or null when there is no such file.
function rowsOf(work, id) {
  const changed = work.rows.get(id);
  if (changed) return changed;
  const file = fileById(work, id);
  return file ? rowsFrom(Array.isArray(file.rows) ? file.rows : []) : null;
}

// How many rows file `id` has now.
export function rowCount(work, id) {
  return rowsOf(work, id)?.list.length ?? 0;
}

function rowIndex(rows) {
  if (rows.index) return rows.index;
  return PMap.over(new Map(rows.list.toArray().map((row, index) => [rowKey(row), index]).toReversed()));
}

// OpenCode puts the entire history in one file: a linear search here would
// make a cold scan quadratic in the number of session/model buckets.
function getOrCreateRow(rows, meta) {
  const index = rowIndex(rows);
  const key = rowKey(meta);
  const existing = index.get(key);
  if (existing !== undefined) return { rows: index === rows.index ? rows : { ...rows, index }, rowIdx: existing };
  const rowIdx = rows.list.length;
  return { rows: { list: rows.list.plus(newRow(meta)), index: index.with(key, rowIdx) }, rowIdx };
}

function addRowTokens(row, tokens) {
  return {
    ...row,
    input: toNonNegInt(row.input + tokens.input),
    output: toNonNegInt(row.output + tokens.output),
    cacheRead: toNonNegInt(row.cacheRead + tokens.cacheRead),
    cacheWrite: toNonNegInt(row.cacheWrite + tokens.cacheWrite),
    reasoning: toNonNegInt(row.reasoning + tokens.reasoning),
  };
}

// The working store with row `rowIdx` of file `id` replaced by `row`.
function putRow(work, id, rows, rowIdx, row) {
  return { ...work, rows: work.rows.with(id, { ...rows, list: rows.list.with(rowIdx, row) }) };
}

// ---------------------------------------------------------------------------
// Task lists

// A file's task keys while a scan changes them: the stored list, then each
// key added or taken out since, in order, read back once at the end.
function taskList(base) {
  return { base, log: PList.of([]) };
}

function listOf(work, id) {
  const changed = work.lists.get(id);
  if (changed) return changed;
  const file = fileById(work, id);
  return file && Array.isArray(file.tasks) ? taskList(file.tasks) : null;
}

// What filter and append would have left: each key added and not taken out
// later, in order.
function taskKeys(list) {
  const ops = [...list.base.map((key) => ({ key, gone: false })), ...list.log.toArray()];
  const lastGone = new Map(ops.flatMap((op, index) => (op.gone ? [[op.key, index]] : [])));
  return ops.filter((op, index) => !op.gone && !(lastGone.get(op.key) > index)).map((op) => op.key);
}

// ---------------------------------------------------------------------------
// Dedup and tasks

const TOKEN_FIELDS = ["input", "output", "cacheRead", "cacheWrite", "reasoning"];
const DEDUP_AUX_INDEX = 7;
const TASK_AUX_INDEX = 5;

function rowMeta(row) {
  return {
    day: row.day,
    session: row.session,
    harness: row.harness,
    provider: row.provider,
    model: row.model,
    project: row.project,
  };
}

function validAuxMeta(meta) {
  return (
    isPlainObject(meta) &&
    ["day", "session", "harness", "provider", "model", "project"].every(
      (field) => typeof meta[field] === "string",
    )
  );
}

// `entry` with `value` at `index`, even one past its end.
function setAt(entry, index, value) {
  return index < entry.length ? entry.with(index, value)
    : Array.from({ length: index + 1 }, (_, at) => (at === index ? value : entry[at]));
}

function auxFor(entry, index, row) {
  const found = isPlainObject(entry[index]) ? entry[index] : {};
  return {
    ...found,
    copies: Array.isArray(found.copies) ? found.copies : [],
    meta: validAuxMeta(found.meta) ? found.meta : rowMeta(row),
  };
}

// A copy list holds the few other files that carry the same record.
function recordCopyCandidate(entry, index, row, fileId) {
  const aux = auxFor(entry, index, row);
  return setAt(entry, index, aux.copies.includes(fileId) ? aux : { ...aux, copies: [...aux.copies, fileId] });
}

function dropCopyCandidate(entry, index, fileId) {
  const aux = entry[index];
  if (!isPlainObject(aux) || !Array.isArray(aux.copies) || !aux.copies.includes(fileId)) return entry;
  return entry.with(index, { ...aux, copies: aux.copies.filter((id) => id !== fileId) });
}

// The first copy whose file still exists, and the copies after it.
function takeCandidate(work, aux) {
  const at = aux.copies.findIndex((candidateId) => fileById(work, candidateId));
  return at < 0 ? null : { candidate: fileById(work, aux.copies[at]), rest: aux.copies.slice(at + 1) };
}

// A usage key owned by a file that goes: its first remaining copy takes it
// over, with the tokens. Null when no copy is left.
function transferDedupOwnership(work, entry) {
  const aux = entry[DEDUP_AUX_INDEX];
  if (!isPlainObject(aux) || !Array.isArray(aux.copies) || !validAuxMeta(aux.meta)) return null;
  const taken = takeCandidate(work, aux);
  if (!taken) return null;
  const { rows, rowIdx } = getOrCreateRow(rowsOf(work, taken.candidate.id), aux.meta);
  const row = rows.list.at(rowIdx);
  const grown = addRowTokens(row, {
    input: entry[2],
    output: entry[3],
    cacheRead: entry[4],
    cacheWrite: entry[5],
    reasoning: entry[6],
  });
  return {
    work: putRow(work, taken.candidate.id, rows, rowIdx, { ...grown, messages: toNonNegInt(row.messages + 1) }),
    entry: entry.with(0, taken.candidate.id).with(1, rowIdx).with(DEDUP_AUX_INDEX, { ...aux, copies: taken.rest }),
  };
}

function transferTaskOwnership(work, entry) {
  const aux = entry[TASK_AUX_INDEX];
  if (!isPlainObject(aux) || !Array.isArray(aux.copies) || !validAuxMeta(aux.meta)) return null;
  const taken = takeCandidate(work, aux);
  if (!taken) return null;
  const { rows, rowIdx } = getOrCreateRow(rowsOf(work, taken.candidate.id), aux.meta);
  return {
    work: { ...work, rows: work.rows.with(taken.candidate.id, rows) },
    entry: entry.with(0, taken.candidate.id).with(1, rowIdx).with(TASK_AUX_INDEX, { ...aux, copies: taken.rest }),
  };
}

// Every usage key and task of `collection` with `fileId` dropped from its
// copies; those the file owned pass to a copy or go. In stored order: a
// transfer can add a row to the file that takes it over.
function releaseOwned(work, collection, auxIndex, transfer, fileId) {
  return work[collection].entries().reduce((current, [key, value]) => {
    if (!Array.isArray(value)) return current;
    const dropped = dropCopyCandidate(value, auxIndex, fileId);
    if (dropped[0] !== fileId) {
      return dropped === value ? current : { ...current, [collection]: current[collection].with(key, dropped) };
    }
    const moved = transfer(current, dropped);
    if (moved) return { ...moved.work, [collection]: moved.work[collection].with(key, moved.entry) };
    return { ...current, [collection]: current[collection].without(key) };
  }, work);
}

export function removeOwnedMetadata(work, fileId) {
  const released = releaseOwned(work, "dedup", DEDUP_AUX_INDEX, transferDedupOwnership, fileId);
  return { ...releaseOwned(released, "tasks", TASK_AUX_INDEX, transferTaskOwnership, fileId), fallbacks: null };
}

// Usage dedup is a max-upsert: Claude streams the same message.id repeatedly
// and revises its numbers upward. One message, maximum numeric value per
// field. The answer is the working store and where the usage went.
export function addUsage(work, fileId, meta, tokens, dedupKey) {
  const entry = work.dedup.get(dedupKey);
  if (Array.isArray(entry)) {
    const ownerRows = rowsOf(work, entry[0]);
    const row = ownerRows?.list.at(entry[1]);
    if (ownerRows && row) {
      // A row first seen without a provider takes the concrete one; its
      // bucket key changed, so the index is built again when next needed.
      const refreshed = row.provider === "unknown" &&
        typeof meta.provider === "string" &&
        meta.provider.length > 0 &&
        meta.provider !== "unknown";
      const aux = entry[DEDUP_AUX_INDEX];
      const known = refreshed && isPlainObject(aux) && validAuxMeta(aux.meta)
        ? entry.with(DEDUP_AUX_INDEX, { ...aux, meta: { ...aux.meta, provider: meta.provider } })
        : entry;
      // Each field grows by what this copy reports above the known maximum.
      const grew = TOKEN_FIELDS.filter((field, index) => tokens[field] > toNonNegInt(known[index + 2]));
      const grown = grew.length === 0 && !refreshed ? row : {
        ...row,
        ...(refreshed ? { provider: meta.provider } : {}),
        ...Object.fromEntries(grew.map((field) => [
          field, toNonNegInt(row[field] + (tokens[field] - toNonNegInt(known[TOKEN_FIELDS.indexOf(field) + 2]))),
        ])),
      };
      const raised = grew.reduce((list, field) => list.with(TOKEN_FIELDS.indexOf(field) + 2, tokens[field]), known);
      const noted = entry[0] !== fileId ? recordCopyCandidate(raised, DEDUP_AUX_INDEX, grown, fileId) : raised;
      const ownerId = entry[0];
      const placed = grown === row ? work : {
        ...work,
        rows: work.rows.with(ownerId, {
          list: ownerRows.list.with(entry[1], grown),
          index: refreshed ? null : ownerRows.index,
        }),
      };
      return {
        work: noted === entry ? placed : { ...placed, dedup: placed.dedup.with(dedupKey, noted) },
        fileId: ownerId,
        rowIdx: entry[1],
      };
    }
  }

  // New, or its owner's row is gone: counted here, and the key (taken out
  // first when it was stale) goes after every other.
  const fresh = Array.isArray(entry) ? work.dedup.without(dedupKey) : work.dedup;
  const { rows, rowIdx } = getOrCreateRow(rowsOf(work, fileId), meta);
  const row = rows.list.at(rowIdx);
  const counted = { ...addRowTokens(row, tokens), messages: toNonNegInt(row.messages + 1) };
  const placed = putRow(work, fileId, rows, rowIdx, counted);
  return {
    work: {
      ...placed,
      dedup: fresh.with(dedupKey, [
        fileId,
        rowIdx,
        tokens.input,
        tokens.output,
        tokens.cacheRead,
        tokens.cacheWrite,
        tokens.reasoning,
      ]),
    },
    fileId,
    rowIdx,
  };
}

// The fallback (estimated) task keys of every session, oldest first, from
// the tasks as they are now.
function fallbackIndex(tasks) {
  const found = tasks.entries()
    .filter(([, entry]) => Array.isArray(entry) && entry[3] === 0)
    .map(([key, entry]) => ({ key, sHash: entry[4] }));
  return PMap.over(new Map([...Map.groupBy(found, (task) => task.sHash)]
    .map(([sHash, list]) => [sHash, PList.of(list.map((task) => task.key))])));
}

export function addTask(
  work,
  fileId,
  rowIdx,
  taskKey,
  durationMs,
  session,
  exact,
  candidateFileId = fileId,
) {
  const ms = toNonNegInt(durationMs);
  const row = rowsOf(work, fileId)?.list.at(rowIdx);
  if (!row) return work;
  const existing = work.tasks.get(taskKey);
  if (Array.isArray(existing)) {
    const existingRow = existing[0] !== candidateFileId ? rowsOf(work, existing[0])?.list.at(existing[1]) : undefined;
    const noted = existingRow ? recordCopyCandidate(existing, TASK_AUX_INDEX, existingRow, candidateFileId) : existing;
    const ownHint = existing[0] === fileId && existing[3] === 0;
    // An exact time replaces an estimate; a longer estimate replaces a
    // shorter one. An estimate made exact leaves the fallback index.
    const timed = ownHint && exact ? noted.with(2, ms).with(3, 1)
      : ownHint && !exact && ms > existing[2] ? noted.with(2, ms)
        : noted;
    if (timed === existing) return work;
    return { ...work, tasks: work.tasks.with(taskKey, timed), fallbacks: ownHint && exact ? null : work.fallbacks };
  }
  const sHash = sessionHash(session);
  const list = listOf(work, fileId) ?? taskList([]);
  return {
    ...work,
    tasks: work.tasks.with(taskKey, [fileId, rowIdx, ms, exact ? 1 : 0, sHash]),
    lists: work.lists.with(fileId, { ...list, log: list.log.plus({ key: taskKey, gone: false }) }),
    fallbacks: !exact && work.fallbacks
      ? work.fallbacks.with(sHash, (work.fallbacks.get(sHash) ?? PList.of([])).plus(taskKey))
      : work.fallbacks,
  };
}

// The newest fallback task of `session` taken out of the store, as
// { work, removed }; removed is null when there is none.
export function removeLatestFallbackTaskForSession(work, session) {
  const sHash = sessionHash(session);
  const fallbacks = work.fallbacks ?? fallbackIndex(work.tasks);
  const stack = fallbacks.get(sHash);
  const key = stack && stack.length > 0 ? stack.at(stack.length - 1) : undefined;
  if (key === undefined) return { work: { ...work, fallbacks }, removed: null };
  const entry = work.tasks.get(key);
  if (!(Array.isArray(entry) && entry[3] === 0 && entry[4] === sHash)) {
    // The index keeps only live fallback tasks; one that is not means it was
    // kept past a change, so it is built again from the tasks.
    if (work.fallbacks) return removeLatestFallbackTaskForSession({ ...work, fallbacks: null }, session);
    throw new Error("fallback task index is out of step with the tasks");
  }
  const list = listOf(work, entry[0]);
  return {
    work: {
      ...work,
      tasks: work.tasks.without(key),
      lists: list ? work.lists.with(entry[0], { ...list, log: list.log.plus({ key, gone: true }) }) : work.lists,
      fallbacks: fallbacks.with(sHash, stack.less()),
    },
    removed: {
      key,
      fileId: entry[0],
      rowIdx: entry[1],
      milliseconds: entry[2],
    },
  };
}

function emptyAggregate(meta) {
  return {
    day: meta.day,
    session: meta.session,
    harness: meta.harness,
    provider: meta.provider,
    model: meta.model,
    project: meta.project,
    tokens: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      reasoning: 0,
      total: 0,
    },
    messages: 0,
    activeMs: 0,
    longestTaskMs: 0,
  };
}

export function snapshotRows(store) {
  // One pass to group every file's rows by bucket, one to group the task time.
  const rows = Map.groupBy(Object.values(store.files).flatMap((file) => file.rows ?? []), rowKey);
  const byId = new Map(Object.values(store.files)
    .filter((entry) => entry && Number.isInteger(entry.id))
    .map((entry) => [entry.id, entry]));
  const taskTime = Map.groupBy(Object.values(store.tasks).flatMap((entry) => {
    if (!Array.isArray(entry)) return [];
    const file = byId.get(entry[0]);
    const row = file?.rows?.[entry[1]];
    return row ? [{ key: rowKey(row), ms: toNonNegInt(entry[2]) }] : [];
  }), (task) => task.key);
  const total = (list, field) => list.reduce((sum, row) => sum + toNonNegInt(row[field]), 0);

  return [...rows].map(([key, group]) => {
    const tokens = {
      input: total(group, "input"),
      output: total(group, "output"),
      cacheRead: total(group, "cacheRead"),
      cacheWrite: total(group, "cacheWrite"),
      reasoning: total(group, "reasoning"),
    };
    const tasks = taskTime.get(key) ?? [];
    return {
      ...emptyAggregate(group[0]),
      tokens: { ...tokens, total: tokenTotal(tokens) },
      messages: total(group, "messages"),
      activeMs: tasks.reduce((sum, task) => sum + task.ms, 0),
      longestTaskMs: tasks.reduce((longest, task) => (task.ms > longest ? task.ms : longest), 0),
    };
  }).toSorted((a, b) => {
    return (
      a.day.localeCompare(b.day) ||
      a.session.localeCompare(b.session) ||
      a.harness.localeCompare(b.harness) ||
      a.provider.localeCompare(b.provider) ||
      a.model.localeCompare(b.model) ||
      a.project.localeCompare(b.project)
    );
  });
}

function rowKey(row) {
  return JSON.stringify([
    row.day,
    row.session,
    row.harness,
    row.provider,
    row.model,
    row.project,
  ]);
}

function validRow(row) {
  return (
    isPlainObject(row) &&
    typeof row.day === "string" &&
    typeof row.session === "string" &&
    typeof row.harness === "string" &&
    typeof row.provider === "string" &&
    typeof row.model === "string" &&
    typeof row.project === "string" &&
    Number.isFinite(row.input) &&
    Number.isFinite(row.output) &&
    Number.isFinite(row.cacheRead) &&
    Number.isFinite(row.cacheWrite) &&
    Number.isFinite(row.reasoning) &&
    Number.isFinite(row.messages) &&
    row.input >= 0 &&
    row.output >= 0 &&
    row.cacheRead >= 0 &&
    row.cacheWrite >= 0 &&
    row.reasoning >= 0 &&
    row.messages >= 0
  );
}

// The store as read, checked, with its config normalized: { store, migrated }.
function validateLoadedStore(raw) {
  if (!isPlainObject(raw) || raw.version !== STORE_VERSION) {
    throw new Error("unsupported store version");
  }
  const configMigration = migrateLoadedConfig(normalizeConfig(raw.config));
  const store = { ...raw, config: configMigration.config };
  if (!isPlainObject(store.files) || !isPlainObject(store.dedup) || !isPlainObject(store.tasks)) {
    throw new Error("store collections are malformed");
  }
  if (!Number.isInteger(store.nextFileId) || store.nextFileId < 1) {
    throw new Error("store nextFileId is malformed");
  }
  const files = Object.entries(store.files);
  // Where each id is first used, to name the first entry that repeats one.
  const firstWithId = new Map(files.map(([, entry], index) => [entry?.id, index]).toReversed());
  files.forEach(([key, entry], index) => {
    if (!isPlainObject(entry)) throw new Error(`file entry ${key} is malformed`);
    if (!Number.isInteger(entry.id) || entry.id < 1) {
      throw new Error(`file entry ${key} has a bad id`);
    }
    if (firstWithId.get(entry.id) !== index) throw new Error(`duplicate file id ${entry.id}`);
    if (
      typeof entry.sourceId !== "string" ||
      typeof entry.path !== "string" ||
      typeof entry.adapter !== "string" ||
      !Number.isFinite(entry.size) ||
      entry.size < 0 ||
      !Number.isFinite(entry.mtimeMs) ||
      !Number.isFinite(entry.offset) ||
      entry.offset < 0 ||
      !Number.isFinite(entry.lineNo) ||
      entry.lineNo < 0
    ) {
      throw new Error(`file entry ${key} is malformed`);
    }
    if (!Array.isArray(entry.rows) || !entry.rows.every(validRow)) {
      throw new Error(`file entry ${key} has malformed rows`);
    }
    if (!Array.isArray(entry.tasks) || !entry.tasks.every((task) => typeof task === "string")) {
      throw new Error(`file entry ${key} has malformed tasks`);
    }
    if (!isPlainObject(entry.state)) {
      throw new Error(`file entry ${key} has malformed state`);
    }
  });
  const maxId = files.reduce((max, [, entry]) => Math.max(max, entry.id), 0);
  if (store.nextFileId <= maxId) {
    throw new Error("store nextFileId is behind existing files");
  }
  for (const [key, value] of Object.entries(store.dedup)) {
    const validAux =
      Array.isArray(value) &&
      (value.length === 7 ||
        (value.length === 8 &&
          isPlainObject(value[7]) &&
          Array.isArray(value[7].copies) &&
          value[7].copies.every((id) => Number.isInteger(id)) &&
          validAuxMeta(value[7].meta)));
    if (
      !Array.isArray(value) ||
      !validAux ||
      !Number.isInteger(value[0]) ||
      !Number.isInteger(value[1]) ||
      !value.slice(2, 7).every((number) => Number.isFinite(number) && number >= 0)
    ) {
      throw new Error(`dedup entry ${key} is malformed`);
    }
  }
  for (const [key, value] of Object.entries(store.tasks)) {
    const validAux =
      Array.isArray(value) &&
      (value.length === 5 ||
        (value.length === 6 &&
          isPlainObject(value[5]) &&
          Array.isArray(value[5].copies) &&
          value[5].copies.every((id) => Number.isInteger(id)) &&
          validAuxMeta(value[5].meta)));
    if (
      !Array.isArray(value) ||
      !validAux ||
      !Number.isInteger(value[0]) ||
      !Number.isInteger(value[1]) ||
      !Number.isFinite(value[2]) ||
      value[2] < 0 ||
      (value[3] !== 0 && value[3] !== 1) ||
      typeof value[4] !== "string"
    ) {
      throw new Error(`task entry ${key} is malformed`);
    }
  }
  return { store, migrated: configMigration.migrated };
}

// The store lives in SQLite (spend.db, next to where store.json was): one
// row per scanned file, usage key and task, so a scan writes only what it
// changed instead of rewriting every byte. A store.json from before is moved
// in once, by the first writer, and kept as store.json.migrated.
export function dbPathFor(storePath) {
  return path.join(path.dirname(storePath), "spend.db");
}

// node:sqlite still announces itself as experimental on Node 22; the panel
// runs Node with --disable-warning=ExperimentalWarning (main.js), so that
// notice stays out of its stderr. A module already imported comes back from
// the loader's own cache.
function sqliteModule() {
  return import("node:sqlite");
}

const COLLECTIONS = ["files", "dedup", "tasks"];
// Keys are kept as JSON strings: file keys hold a NUL, which SQLite text
// would cut short.
const SCHEMA = `
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
  CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS files (key TEXT PRIMARY KEY, v TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS dedup (key TEXT PRIMARY KEY, v TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS tasks (key TEXT PRIMARY KEY, v TEXT NOT NULL);
`;

async function openDb(dbPath, { readOnly = false } = {}) {
  const { DatabaseSync } = await sqliteModule();
  const db = new DatabaseSync(dbPath, readOnly ? { readOnly: true } : {});
  db.exec("PRAGMA busy_timeout = 5000;");
  if (!readOnly) {
    db.exec(SCHEMA);
    await chmod(dbPath, 0o600).catch(() => {});
  }
  return db;
}

// What was last written, entry by entry, so a save skips what did not change.
function remember(store, saved) {
  return withHidden(store, { _saved: saved });
}

function readDb(db, { skipDedup = false } = {}) {
  const meta = Object.fromEntries(db.prepare("SELECT k, v FROM meta").all().map((r) => [r.k, r.v]));
  if (!meta.version) throw new Error("spend.db has no store in it");
  // Each collection as [key, stored JSON] pairs, in table order.
  const rows = Object.fromEntries(COLLECTIONS.map((name) => [name, name === "dedup" && skipDedup ? []
    : db.prepare(`SELECT key, v FROM ${name}`).all().map((row) => [JSON.parse(row.key), row.v])]));
  const parsed = (name) => Object.fromEntries(rows[name].map(([key, json]) => [key, JSON.parse(json)]));
  const store = {
    version: Number(meta.version),
    config: JSON.parse(meta.config ?? "null"),
    nextFileId: Number(meta.nextFileId),
    files: parsed("files"),
    dedup: parsed("dedup"),
    tasks: parsed("tasks"),
    lastScanAt: meta.lastScanAt ? JSON.parse(meta.lastScanAt) : null,
  };
  const saved = Object.fromEntries(COLLECTIONS.map((name) => [name, new Map(rows[name])]));
  return { store, saved };
}

function writeDb(db, store, saved) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const setMeta = db.prepare("INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v");
    setMeta.run("version", String(store.version));
    setMeta.run("config", JSON.stringify(store.config));
    setMeta.run("nextFileId", String(store.nextFileId));
    setMeta.run("lastScanAt", JSON.stringify(store.lastScanAt ?? null));
    const next = Object.fromEntries(COLLECTIONS.map((name) => {
      const before = saved?.[name] ?? new Map();
      const put = db.prepare(`INSERT INTO ${name} (key, v) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET v = excluded.v`);
      const drop = db.prepare(`DELETE FROM ${name} WHERE key = ?`);
      const after = new Map(Object.entries(store[name]).map(([key, value]) => [key, JSON.stringify(value)]));
      after.forEach((json, key) => {
        if (before.get(key) !== json) put.run(JSON.stringify(key), json);
      });
      before.forEach((_, key) => {
        if (!after.has(key)) drop.run(JSON.stringify(key));
      });
      return [name, after];
    }));
    db.exec("COMMIT");
    return next;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

async function readLegacy(storePath) {
  const read = await readFile(storePath, "utf8").then((text) => ({ text }), (error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
  return read && JSON.parse(read.text);
}

async function moveAside(file) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const target = `${file}.corrupt-${stamp}`;
  await rename(file, target);
  for (const suffix of ["-wal", "-shm"]) await rename(`${file}${suffix}`, `${target}${suffix}`).catch(() => {});
  return target;
}

// Runs `preserve` (it keeps a corrupt store aside) and answers where it went,
// or fails with both reasons when even that does not work.
async function preserved(error, preserve) {
  try {
    return await preserve();
  } catch (backupError) {
    throw new Error(
      `spend store is corrupt and could not be preserved: ${error.message}; ${backupError.message}`,
      { cause: backupError },
    );
  }
}

// A fresh store in place of a corrupt one that was kept at `backup`.
function restarted(backup, error) {
  return {
    store: emptyStore(),
    warnings: [`Store was corrupt and has been preserved at ${backup}; a fresh store was started (${error.message}).`],
    errors: 1,
    exists: true,
    corruptBackup: backup,
    dirty: true,
  };
}

// The store in spend.db, checked and indexed; the database is closed again
// whether or not it reads.
async function readStoreDb(dbPath, readOnly) {
  const db = await openDb(dbPath, { readOnly });
  try {
    // A read for the panel needs no dedup keys: only scans consult them.
    const read = readDb(db, { skipDedup: readOnly });
    const { store, migrated } = validateLoadedStore(read.store);
    const kept = remember(store, readOnly ? null : read.saved);
    return { store: readOnly ? withHidden(kept, { _readOnly: true }) : kept, migrated };
  } finally {
    try { db.close(); } catch { /* already closed */ }
  }
}

export async function loadStore(storePath, { readOnly = false } = {}) {
  const dbPath = dbPathFor(storePath);
  if (!readOnly) await ensureParent(storePath);
  const hasDb = Boolean(await fileStatOrNull(dbPath));

  if (!hasDb) {
    // Nothing in SQLite yet: a store.json from before, or nothing at all.
    try {
      const raw = await readLegacy(storePath);
      if (raw) {
        const { store: legacy, migrated } = validateLoadedStore(raw);
        if (readOnly) return { store: legacy, warnings: [], errors: 0, exists: true, dirty: migrated };
        const db = await openDb(dbPath);
        const written = (() => {
          try {
            return remember(legacy, writeDb(db, legacy, null));
          } finally {
            db.close();
          }
        })();
        await rename(storePath, `${storePath}.migrated`);
        return { store: written, warnings: [], errors: 0, exists: true, dirty: migrated };
      }
    } catch (error) {
      if (readOnly) throw new Error("Spend store is corrupt; refresh to preserve and rebuild it.", { cause: error });
      const backup = await preserved(error, async () => {
        const kept = await backupCorruptStore(storePath);
        await unlink(storePath).catch(() => {});
        return kept;
      });
      return restarted(backup, error);
    }
    return { store: emptyStore(), warnings: [], errors: 0, exists: false, dirty: true };
  }

  try {
    const { store, migrated } = await readStoreDb(dbPath, readOnly);
    return { store, warnings: [], errors: 0, exists: true, dirty: migrated };
  } catch (error) {
    if (readOnly) throw new Error("Spend store is corrupt; refresh to preserve and rebuild it.", { cause: error });
    return restarted(await preserved(error, () => moveAside(dbPath)), error);
  }
}

// Writes `store` stamped with the time; the answer is the store as saved.
export async function saveStore(storePath, store) {
  if (store._readOnly) throw new Error("a store read for display cannot be saved");
  const stamped = storeWith(store, { lastScanAt: new Date().toISOString() });
  await ensureParent(storePath);
  const db = await openDb(dbPathFor(storePath));
  try {
    return remember(stamped, writeDb(db, stamped, stamped._saved ?? null));
  } finally {
    db.close();
  }
}

export async function fileStatOrNull(file) {
  try {
    return await stat(file);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

export async function removeStoreFile(storePath) {
  const dbPath = dbPathFor(storePath);
  for (const file of [storePath, dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
    await unlink(file).catch((error) => {
      if (error?.code !== "ENOENT") throw error;
    });
  }
}

export function dedupKeyFor(harness, ...parts) {
  return hashKey("usage", harness, ...parts);
}

export function taskKeyFor(harness, ...parts) {
  return hashKey("task", harness, ...parts);
}

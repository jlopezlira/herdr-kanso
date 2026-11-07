import { PMap } from "./pmap.mjs";
import {
  MAX_TURN_MS,
  asString,
  hashKey,
  isPlainObject,
  localDay,
  normalizeTokens,
  parseTimestamp,
  toNonNegInt,
} from "./util.mjs";
import {
  taskKeyFor as makeTaskKey,
  dedupKeyFor as makeDedupKey,
  taskKeyFor,
} from "./store.mjs";

// Parser contract: (record, ctx, acc) -> next acc, nothing changed in place; acc.state is the file's own state.
// ctx.addUsage and ctx.removeLatestFallback answer { acc, ... }; ctx.addTask and ctx.warn answer the next acc.
// State parts that grow with the file are persistent maps while reading (openParserState), so a record copies only its own path.

const GROWING = ["sessions", "turns", "modernObserved", "responseKeys"];

export function openParserState(state) {
  if (!GROWING.some((key) => isPlainObject(state[key]))) return state;
  return Object.fromEntries(Object.entries(state).map(([key, value]) => [
    key, GROWING.includes(key) && isPlainObject(value) ? PMap.over(value) : value,
  ]));
}

export function closeParserState(state) {
  if (!GROWING.some((key) => state[key] instanceof PMap)) return state;
  return Object.fromEntries(Object.entries(state).map(([key, value]) => [
    key, value instanceof PMap ? value.toObject() : value,
  ]));
}

function put(acc, fields) {
  return { ...acc, state: { ...acc.state, ...fields } };
}

function mapOf(state, key) {
  return state[key] instanceof PMap ? state[key] : PMap.over();
}

// A step that failed part way: work done so far stays; the error is reported like a throwing record.
function failed(acc, error) {
  return { ...acc, lineError: error };
}

function attempt(fn) {
  try {
    return { value: fn() };
  } catch (error) {
    return { error };
  }
}

function metaFor(harness, session, timestamp, project, provider, model) {
  return {
    day: localDay(timestamp),
    session,
    harness,
    provider: asString(provider),
    model: asString(model),
    project: asString(project),
  };
}

function spanMs(start, end) {
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 0;
  return Math.min(end - start, MAX_TURN_MS);
}

function historyFor(acc, session) {
  const sessions = mapOf(acc.state, "sessions");
  const known = sessions.get(session);
  if (isPlainObject(known)) {
    return { acc: sessions === acc.state.sessions ? acc : put(acc, { sessions }), history: known };
  }
  const history = {
    turnStart: null,
    turnFirst: null,
    lastRow: null,
  };
  return { acc: put(acc, { sessions: sessions.with(session, history) }), history };
}

function setHistory(acc, session, history) {
  return put(acc, { sessions: mapOf(acc.state, "sessions").with(session, history) });
}

function rowOf(result) {
  return { fileId: result.fileId, rowIdx: result.rowIdx };
}

function emitTask(ctx, acc, history, session, key, duration, exact) {
  if (!history?.lastRow || !Number.isFinite(duration) || duration <= 0) return acc;
  return ctx.addTask(
    acc,
    history.lastRow.fileId,
    history.lastRow.rowIdx,
    key,
    duration,
    session,
    exact,
  );
}

function assistantTurn(acc, session, timestamp, counted, final) {
  const opened = historyFor(acc, session);
  const first = opened.history.turnFirst ? opened.history : { ...opened.history, turnFirst: timestamp };
  const started = first === opened.history ? opened.acc : setHistory(opened.acc, session, first);
  const usage = counted ? counted(started) : null;
  const timed = usage ? setHistory(usage.acc, session, { ...first, lastRow: rowOf(usage.result) }) : started;
  return final ? final(timed) : timed;
}

function piMainSession(state, ctx) {
  if (state.header?.id) return `pi:${state.header.id}`;
  return `pi-file:${ctx.file.path}`;
}

function piSubagentSession(record, ctx) {
  const runId = asString(record.runId, "");
  const childIndex = Number.isInteger(record.childIndex) ? record.childIndex : 0;
  if (runId) return `pi-sub:${runId}:${childIndex}`;
  return `pi-file:${ctx.file.path}`;
}

function piUsageCarrier(record, ctx, acc) {
  const usage = isPlainObject(record.usage) ? record.usage : null;
  if (!usage) return acc;
  const state = acc.state;
  const session = piMainSession(state, ctx);
  const timestamp = parseTimestamp(
    record.timestamp ?? state.header?.timestamp,
  );
  if (timestamp === null) {
    return ctx.warn(acc, `Pi ${record.type} record has no usable timestamp; skipped`);
  }
  const tokens = normalizeTokens({
    input: usage.input,
    output: usage.output,
    cacheRead: usage.cacheRead,
    cacheWrite: usage.cacheWrite,
    reasoning: usage.reasoning,
  });
  if (!tokens.nonzero) return acc;
  const identity = record.id ?? `line:${ctx.lineHash}`;
  return ctx.addUsage(
    acc,
    metaFor(
      "pi",
      session,
      timestamp,
      asString(state.header?.cwd, "unknown"),
      record.provider,
      record.model,
    ),
    tokens,
    makeDedupKey("pi", record.type, identity, timestamp),
  ).acc;
}

function piTiming(record, ctx, acc, session, timestamp, isFinal, finalIdentity) {
  const { acc: opened, history } = historyFor(acc, session);
  if (record.role === "user") {
    return setHistory(opened, session, { ...history, turnStart: timestamp, turnFirst: null, lastRow: null });
  }
  if (record.role !== "assistant") return opened;
  const first = history.turnFirst ? history : { ...history, turnFirst: timestamp };
  if (!isFinal) return first === history ? opened : setHistory(opened, session, first);
  const start = first.turnStart ?? first.turnFirst;
  const tasked = emitTask(
    ctx,
    setHistory(opened, session, first),
    first,
    session,
    taskKeyFor("pi", "span", finalIdentity),
    spanMs(start, timestamp),
    false,
  );
  return setHistory(tasked, session, { ...first, turnStart: null, turnFirst: null });
}

function piAssistant(ctx, acc, { session, timestamp, project, provider, model, usage, identity, final }) {
  const tokens = usage ? normalizeTokens({
    input: usage.input,
    output: usage.output,
    cacheRead: usage.cacheRead,
    cacheWrite: usage.cacheWrite,
    reasoning: usage.reasoning,
  }) : null;
  return assistantTurn(
    acc,
    session,
    timestamp,
    tokens?.nonzero ? (current) => ctx.addUsage(
      current,
      metaFor("pi", session, timestamp, project, provider, model),
      tokens,
      makeDedupKey("pi", identity, timestamp, provider, model),
    ) : null,
    final ? (current) => piTiming(
      { role: "assistant" },
      ctx,
      current,
      session,
      timestamp,
      true,
      hashKey("pi-final", identity, timestamp, provider, model),
    ) : null,
  );
}

function parsePi(record, ctx, acc) {
  if (!isPlainObject(record)) return acc;
  const state = acc.state;

  if (record.type === "session") {
    return put(acc, {
      header: {
        id: asString(record.id, ""),
        cwd: asString(record.cwd, ""),
        timestamp: record.timestamp,
        parentSession: asString(record.parentSession, ""),
      },
      headerTimestamp: parseTimestamp(record.timestamp),
    });
  }

  // Cache warming, compaction and branch-summary records carry usage that counts toward Pi's session totals.
  if (
    record.type === "usage" ||
    record.type === "compaction" ||
    record.type === "branch_summary"
  ) {
    return piUsageCarrier(record, ctx, acc);
  }

  if (record.type === "message" && isPlainObject(record.message)) {
    const message = record.message;
    const role = asString(message.role, "");
    const session = piMainSession(state, ctx);
    const timestamp = parseTimestamp(
      record.timestamp ?? message.timestamp ?? state.header?.timestamp,
    );
    const project = asString(state.header?.cwd, "unknown");
    const provider = asString(message.provider);
    const model = asString(message.model);
    const stopReason = asString(message.stopReason, "");
    const failedReply =
      stopReason === "error" ||
      stopReason === "aborted" ||
      Boolean(message.errorMessage);
    const final = stopReason === "stop" && !failedReply;
    const identity =
      record.id ??
      message.responseId ??
      `line:${session}:${ctx.lineHash}`;

    if (role === "user") {
      return timestamp !== null ? piTiming({ role }, ctx, acc, session, timestamp, false, "") : acc;
    }
    if (role === "toolResult") {
      // Tool extensions may report nested-model usage; count it without touching the surrounding turn.
      return piUsageCarrier({
        type: "toolResult", usage: message.usage,
        id: record.id ?? message.toolCallId ?? message.responseId,
        timestamp: record.timestamp ?? message.timestamp,
        provider: message.provider, model: message.model,
      }, ctx, acc);
    }
    if (role !== "assistant") return acc;
    if (timestamp === null) {
      return ctx.warn(acc, "Pi assistant record has no usable timestamp; skipped");
    }
    return piAssistant(ctx, acc, {
      session, timestamp, project, provider, model,
      usage: isPlainObject(message.usage) ? message.usage : null,
      identity, final,
    });
  }

  // Pi sub-agent transcripts: same JSONL root, but usage and role at top level and no session header.
  if (record.recordType === "message" && record.role !== undefined) {
    const role = asString(record.role, "");
    const session = piSubagentSession(record, ctx);
    const timestamp = parseTimestamp(record.timestamp ?? record.ts);
    const project = asString(record.cwd, "unknown");
    const provider = asString(
      record.provider ?? record.message?.provider,
      "unknown",
    );
    const model = asString(record.model ?? record.message?.model, "unknown");
    const stopReason = asString(record.stopReason, "");
    const failedReply =
      stopReason === "error" ||
      stopReason === "aborted" ||
      Boolean(record.errorMessage);
    const final = stopReason === "stop" && !failedReply;
    const identity =
      record.message?.responseId ??
      record.responseId ??
      `line:${session}:${ctx.lineHash}`;

    if (role === "user") {
      return timestamp !== null ? piTiming({ role }, ctx, acc, session, timestamp, false, "") : acc;
    }
    if (role !== "assistant") return acc;
    if (timestamp === null) {
      return ctx.warn(acc, "Pi sub-agent assistant record has no usable timestamp; skipped");
    }
    return piAssistant(ctx, acc, {
      session, timestamp, project, provider, model,
      usage: isPlainObject(record.usage) ? record.usage : null,
      identity, final,
    });
  }
  return acc;
}

function claudeSession(record, ctx) {
  const id = asString(record.sessionId ?? record.session_id, "");
  if (id) return `claude:${id}`;
  return `claude-file:${ctx.file.path}`;
}

function claudePrompt(record) {
  return (
    record.type === "user" &&
    !record.sourceToolUseID &&
    !record.toolUseResult &&
    !record.isMeta
  );
}

function claudeReasoning(usage) {
  const details = usage.output_tokens_details;
  if (isPlainObject(details) && Number.isFinite(details.thinking_tokens)) {
    return toNonNegInt(details.thinking_tokens);
  }
  return 0;
}

function claudeCacheWrite(usage) {
  if (Number.isFinite(usage.cache_creation_input_tokens)) {
    return toNonNegInt(usage.cache_creation_input_tokens);
  }
  if (isPlainObject(usage.cache_creation)) {
    return toNonNegInt(Object.values(usage.cache_creation)
      .filter((value) => Number.isFinite(value) && value > 0)
      .reduce((sum, value) => sum + value, 0));
  }
  return 0;
}

function parseClaude(record, ctx, acc) {
  if (!isPlainObject(record)) return acc;
  const session = claudeSession(record, ctx);
  const timestamp = parseTimestamp(record.timestamp) ?? acc.state.fallbackTimestamp ?? null;
  const dated = timestamp !== null && acc.state.fallbackTimestamp === undefined
    ? put(acc, { fallbackTimestamp: timestamp })
    : acc;
  const { acc: opened, history } = historyFor(dated, session);

  if (claudePrompt(record)) {
    if (timestamp === null) return opened;
    return setHistory(opened, session, { ...history, turnStart: timestamp, turnFirst: null, lastRow: null });
  }

  if (record.type === "system" && record.subtype === "turn_duration") {
    const duration = Number.isFinite(record.durationMs)
      ? toNonNegInt(record.durationMs)
      : 0;
    if (duration <= 0) return opened;
    const taken = ctx.removeLatestFallback(opened, session);
    const linked = !history.lastRow && taken.removed
      ? { ...history, lastRow: { fileId: taken.removed.fileId, rowIdx: taken.removed.rowIdx } }
      : history;
    const noted = linked === history ? taken.acc : setHistory(taken.acc, session, linked);
    // No id and no time means no task key, but the removed fallback stays removed.
    const key = attempt(() => taskKeyFor(
      "claude",
      "turn-duration",
      record.parentUuid ?? record.uuid ?? record.timestamp,
    ));
    if (key.error) return failed(noted, key.error);
    return emitTask(ctx, noted, linked, session, key.value, duration, true);
  }

  if (record.type !== "assistant" || !isPlainObject(record.message)) return opened;
  if (timestamp === null) {
    return ctx.warn(opened, "Claude assistant record has no usable timestamp; skipped");
  }
  const message = record.message;
  const usage = isPlainObject(message.usage) ? message.usage : null;
  const model = asString(message.model);
  const provider = asString(message.provider, "anthropic");
  const project = asString(record.cwd, "unknown");
  const identity = message.id ?? record.uuid ?? `line:${session}:${ctx.lineHash}`;
  const tokens = usage ? normalizeTokens({
    input: usage.input_tokens,
    output: usage.output_tokens,
    cacheRead: usage.cache_read_input_tokens,
    cacheWrite: claudeCacheWrite(usage),
    reasoning: claudeReasoning(usage),
  }) : null;

  const stop = asString(message.stop_reason, "");
  const failedReply =
    Boolean(record.isApiErrorMessage) ||
    Boolean(record.error) ||
    Number.isFinite(record.apiErrorStatus) ||
    stop === "error";
  const final =
    !failedReply && ["end_turn", "stop_sequence", "max_tokens", "stop"].includes(stop);
  return assistantTurn(
    opened,
    session,
    timestamp,
    tokens?.nonzero ? (current) => ctx.addUsage(
      current,
      metaFor("claude", session, timestamp, project, provider, model),
      tokens,
      makeDedupKey("claude", identity),
    ) : null,
    final ? (current) => {
      const { acc: timed, history: now } = historyFor(current, session);
      return emitTask(
        ctx,
        timed,
        now,
        session,
        taskKeyFor("claude", "span", identity),
        spanMs(now.turnStart ?? now.turnFirst, timestamp),
        false,
      );
    } : null,
  );
}

function codexSession(state, ctx) {
  if (state.session) return `codex:${state.session}`;
  return `codex-file:${ctx.file.path}`;
}

function codexRecordSession(state, ctx, payload) {
  const threadId = asString(
    payload.thread_id ??
      payload.session_id ??
      payload.threadId ??
      payload.sessionId,
    "",
  );
  if (threadId) return `codex:${threadId}`;
  return codexSession(state, ctx);
}

function codexContext(acc, turnId) {
  const turns = mapOf(acc.state, "turns");
  const made = turns === acc.state.turns ? acc : put(acc, { turns });
  const known = turnId ? turns.get(turnId) : undefined;
  if (turnId && isPlainObject(known)) return { acc: made, context: known };
  const state = made.state;
  return {
    acc: made,
    context: {
      model: state.model,
      provider: state.provider,
      project: state.project,
      lastRow: state.lastRow ?? null,
    },
  };
}

function codexNormalized(raw) {
  const inputRaw = toNonNegInt(raw.input_tokens);
  const cached = toNonNegInt(raw.cached_input_tokens);
  const cacheWrite = toNonNegInt(raw.cache_write_input_tokens);
  return normalizeTokens({
    input: Math.max(0, inputRaw - cached - cacheWrite),
    output: raw.output_tokens,
    cacheRead: cached,
    cacheWrite,
    reasoning: raw.reasoning_output_tokens,
  });
}

const CODEX_TOKEN_FIELDS = ["input", "output", "cacheRead", "cacheWrite", "reasoning"];
const CODEX_TWIN_WINDOW_MS = 5 * 60 * 1000;

function codexZeroTokens() {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 };
}

function codexTokenVector(tokens) {
  return CODEX_TOKEN_FIELDS.map((field) => toNonNegInt(tokens[field]));
}

function codexSameTokens(left, right) {
  return (
    Array.isArray(left) &&
    Array.isArray(right) &&
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function codexCloseInTime(left, right) {
  if (!Number.isFinite(left) || !Number.isFinite(right)) return true;
  return Math.abs(left - right) <= CODEX_TWIN_WINDOW_MS;
}

function codexPendingTokens(acc) {
  const pending = isPlainObject(acc.state.modernPending) ? acc.state.modernPending : codexZeroTokens();
  const whole = { ...pending, ...Object.fromEntries(CODEX_TOKEN_FIELDS.map((field) => [field, toNonNegInt(pending[field])])) };
  return { acc: put(acc, { modernPending: whole }), pending: whole };
}

function codexAddPending(acc, tokens) {
  const { acc: kept, pending } = codexPendingTokens(acc);
  return put(kept, {
    modernPending: { ...pending, ...Object.fromEntries(CODEX_TOKEN_FIELDS.map((field) => [field, toNonNegInt(pending[field] + tokens[field])])) },
  });
}

// Per-file state: global dedup reports zero for a copied file, but the legacy cumulative counter must subtract everything this file observed.
function codexObserveModern(acc, key, tokens) {
  const observed = mapOf(acc.state, "modernObserved");
  const known = observed.get(key);
  const previous = Array.isArray(known) ? known : [];
  const vector = codexTokenVector(tokens);
  const next = vector.map((value, index) =>
    Math.max(value, toNonNegInt(previous[index])),
  );
  const added = Object.fromEntries(CODEX_TOKEN_FIELDS.map((field, index) => [field, toNonNegInt(next[index] - toNonNegInt(previous[index]))]));
  return { acc: put(acc, { modernObserved: observed.with(key, next) }), added };
}

function codexCumulativeVector(raw) {
  return isPlainObject(raw) ? codexTokenVector(codexNormalized(raw)) : null;
}

function codexKnownCumulative(entry) {
  if (Array.isArray(entry.thread)) return entry.thread;
  if (Array.isArray(entry.turn)) return entry.turn;
  return null;
}

// Cumulative counters are the strong twin identity; vector/time matching is only for older payloads that lack them.
function codexCumulativeTwin(entry, cumulative) {
  const known = codexKnownCumulative(entry);
  if (!Array.isArray(known) || !Array.isArray(cumulative)) return true;
  return codexSameTokens(known, cumulative);
}

function codexPendingTwinKey(
  pending,
  tokens,
  timestamp,
  cumulative,
  responseId,
  turnId,
) {
  if (
    !isPlainObject(pending) ||
    typeof pending.key !== "string" ||
    !codexSameTokens(pending.tokens, codexTokenVector(tokens)) ||
    !codexCloseInTime(pending.timestamp, timestamp)
  ) {
    return null;
  }
  if (responseId && pending.responseId && responseId !== pending.responseId) {
    return null;
  }
  if (
    Array.isArray(pending.cumulative) &&
    Array.isArray(cumulative) &&
    !codexSameTokens(pending.cumulative, cumulative)
  ) {
    return null;
  }
  if (turnId && pending.turnId && turnId !== pending.turnId) return null;
  return pending.key;
}

function codexSubtract(tokens, represented) {
  const left = Object.fromEntries(CODEX_TOKEN_FIELDS.map((field) => [field, Math.max(0, tokens[field] - toNonNegInt(represented[field]))]));
  return { ...tokens, ...left, nonzero: CODEX_TOKEN_FIELDS.some((field) => left[field] > 0) };
}

function codexRememberModern(acc, key, tokens, timestamp, identity) {
  const recent = [...(Array.isArray(acc.state.modernRecent) ? acc.state.modernRecent : []), {
    key,
    tokens: codexTokenVector(tokens),
    timestamp,
    thread: identity.thread,
    turn: identity.turn,
    responseId: identity.responseId,
    turnId: identity.turnId,
  }];
  return put(acc, { modernRecent: recent.length > 8 ? recent.slice(1) : recent });
}

function codexTakeModernTwin(
  acc,
  tokens,
  timestamp,
  cumulative,
  responseId,
  turnId,
) {
  const recent = acc.state.modernRecent;
  if (!Array.isArray(recent)) return { acc, key: null };
  const vector = codexTokenVector(tokens);
  const index = recent.findLastIndex((candidate) => (
    isPlainObject(candidate) &&
    typeof candidate.key === "string" &&
    codexSameTokens(candidate.tokens, vector) &&
    codexCloseInTime(candidate.timestamp, timestamp) &&
    codexCumulativeTwin(candidate, cumulative) &&
    (!responseId || !candidate.responseId || responseId === candidate.responseId) &&
    (!turnId || !candidate.turnId || turnId === candidate.turnId)
  ));
  if (index < 0) return { acc, key: null };
  return { acc: put(acc, { modernRecent: recent.toSpliced(index, 1) }), key: recent[index].key };
}

function codexFromTotals(acc, totals, record, ctx) {
  const current = {
    input_tokens: toNonNegInt(totals.input_tokens),
    cached_input_tokens: toNonNegInt(totals.cached_input_tokens),
    cache_write_input_tokens: toNonNegInt(totals.cache_write_input_tokens),
    output_tokens: toNonNegInt(totals.output_tokens),
    reasoning_output_tokens: toNonNegInt(totals.reasoning_output_tokens),
  };
  const previous = isPlainObject(acc.state.legacyTotals)
    ? acc.state.legacyTotals
    : null;
  // A reset applies to the whole vector: other fields may already exceed their old values on restart.
  const reset = Boolean(previous && Object.keys(current).some((key) => current[key] < toNonNegInt(previous[key])));
  const raw = Object.fromEntries(Object.keys(current).map((key) => [key, !previous || reset ? current[key] : current[key] - toNonNegInt(previous[key])]));
  return {
    acc: put(acc, { legacyTotals: current }),
    legacy: {
      raw,
      reset,
      identityTail: [
        "legacy",
        record.timestamp ?? ctx.lineHash,
        current.input_tokens,
        current.cached_input_tokens,
        current.cache_write_input_tokens,
        current.output_tokens,
        current.reasoning_output_tokens,
      ],
    },
  };
}

function codexFromLast(raw, record, ctx) {
  return {
    raw,
    reset: false,
    identityTail: [
      "legacy-last",
      record.timestamp ?? ctx.lineHash,
      raw.input_tokens,
      raw.cached_input_tokens,
      raw.cache_write_input_tokens,
      raw.output_tokens,
      raw.reasoning_output_tokens,
    ],
  };
}

function codexTurnRow(acc, turnId, context, lastRow) {
  const turns = mapOf(acc.state, "turns");
  return put(acc, { turns: turns.with(turnId, { ...(turns.get(turnId) ?? context), lastRow }) });
}

function codexSessionMeta(record, acc, payload) {
  const threadId = asString(
    payload.id ?? payload.session_id ?? payload.thread_id,
    "",
  );
  const firstHeader = !acc.state.session;
  const named = threadId && firstHeader ? put(acc, { session: threadId }) : acc;
  const placed = firstHeader || !named.state.project
    ? put(named, { project: asString(payload.cwd, named.state.project ?? "unknown") })
    : named;
  const provided = firstHeader || !placed.state.provider
    ? put(placed, { provider: asString(payload.model_provider, placed.state.provider ?? "unknown") })
    : placed;
  const dated = firstHeader || provided.state.timestamp === undefined
    ? put(provided, { timestamp: parseTimestamp(payload.timestamp ?? record.timestamp) })
    : provided;
  return dated.state.model ? dated : put(dated, { model: "unknown" });
}

function codexTurnContext(acc, payload) {
  const turnId = asString(payload.turn_id ?? payload.root_turn_id, "");
  const turns = mapOf(acc.state, "turns");
  const made = turns === acc.state.turns ? acc : put(acc, { turns });
  const state = made.state;
  const previous = turnId ? turns.get(turnId) : null;
  const context = {
    model: asString(payload.model, state.model ?? "unknown"),
    provider: asString(state.provider),
    project: asString(payload.cwd, state.project ?? "unknown"),
    lastRow: previous?.lastRow ? previous.lastRow : null,
  };
  const placed = turnId ? put(made, { turns: turns.with(turnId, context) }) : made;
  return put(placed, { model: context.model, project: context.project });
}

function codexUsageRecord(record, ctx, acc, payload, timestamp) {
  const marked = put(acc, { modern: true });
  if (timestamp === null) {
    return ctx.warn(marked, "Codex token usage record has no usable timestamp; skipped");
  }
  const turnId = asString(payload.turn_id ?? payload.root_turn_id, "");
  const { acc: opened, context } = codexContext(marked, turnId);
  const state = opened.state;
  const session = codexRecordSession(state, ctx, payload);
  const usage = isPlainObject(payload.usage) ? payload.usage : null;
  if (!usage) return opened;
  const tokens = codexNormalized(usage);
  if (!tokens.nonzero) return opened;
  const responseId = asString(payload.response_id, "");
  const thread = codexCumulativeVector(payload.thread_token_usage);
  const turn = codexCumulativeVector(payload.turn_token_usage);
  const cumulative = thread ?? turn;
  const identity = responseId
    ? ["response", responseId]
    : [
        "turn",
        session,
        turnId,
        record.timestamp ?? ctx.lineHash,
        tokens.input,
        tokens.output,
        tokens.cacheRead,
        tokens.cacheWrite,
        tokens.reasoning,
      ];
  const twinKey = codexPendingTwinKey(
    state.pendingTwin,
    tokens,
    timestamp,
    cumulative,
    responseId,
    turnId,
  );
  const responseKeys = state.responseKeys instanceof PMap ? state.responseKeys : null;
  const knownResponse = Boolean(
    responseId &&
    responseKeys &&
    typeof responseKeys.get(responseId) === "string",
  );
  // A token_count twin can precede its token_usage_record; reuse its contribution instead of counting the turn twice.
  const dedupKey = knownResponse ? responseKeys.get(responseId)
    : twinKey ? twinKey
      : makeDedupKey("codex", ...identity);
  const mergedTwin = knownResponse || Boolean(twinKey);
  const keyed = !knownResponse && twinKey && responseId
    ? put(opened, { responseKeys: mapOf(state, "responseKeys").with(responseId, dedupKey) })
    : opened;
  const counted = ctx.addUsage(
    keyed,
    metaFor(
      "codex",
      session,
      timestamp,
      context.project,
      context.provider,
      context.model,
    ),
    tokens,
    dedupKey,
  );
  const observed = codexObserveModern(counted.acc, dedupKey, tokens);
  const pending = twinKey ? observed.acc : codexAddPending(observed.acc, observed.added);
  const remembered = codexRememberModern(put(pending, { pendingTwin: null }), dedupKey, tokens, timestamp, {
    thread,
    turn,
    responseId,
    turnId,
  });
  const turned = turnId ? codexTurnRow(remembered, turnId, context, rowOf(counted.result)) : remembered;
  const placed = put(turned, { lastRow: rowOf(counted.result) });
  return mergedTwin ? put(placed, { modern: true }) : placed;
}

function codexTokenCount(record, ctx, acc, payload, timestamp) {
  if (timestamp === null) return acc;
  const cleared = put(acc, { pendingTwin: null });
  const info = isPlainObject(payload.info) ? payload.info : {};
  const totals = isPlainObject(info.total_token_usage)
    ? info.total_token_usage
    : null;
  const session = codexRecordSession(cleared.state, ctx, payload);
  const { acc: opened, context } = codexContext(cleared, asString(payload.turn_id, ""));
  const read = totals ? codexFromTotals(opened, totals, record, ctx)
    : isPlainObject(info.last_token_usage) ? { acc: opened, legacy: codexFromLast(info.last_token_usage, record, ctx) }
      : null;
  if (!read) return opened;
  const { raw, identityTail, reset } = read.legacy;

  const normalized = codexNormalized(raw);
  const cumulative = totals ? codexCumulativeVector(totals) : null;
  const pending = totals ? codexPendingTokens(read.acc) : { acc: read.acc, pending: null };
  const tokens = totals && !reset ? codexSubtract(normalized, pending.pending) : normalized;
  const zeroed = totals ? put(pending.acc, { modernPending: codexZeroTokens() }) : pending.acc;
  if (!tokens.nonzero) return zeroed;

  const twin = reset ? { acc: zeroed, key: null } : codexTakeModernTwin(
    zeroed,
    tokens,
    timestamp,
    cumulative,
    asString(payload.response_id, ""),
    asString(payload.turn_id ?? payload.root_turn_id, ""),
  );
  const usedModernTwin = Boolean(twin.key);
  const dedupKey = usedModernTwin ? twin.key : makeDedupKey("codex", session, ...identityTail);
  const counted = ctx.addUsage(
    twin.acc,
    metaFor(
      "codex",
      session,
      timestamp,
      context.project,
      context.provider,
      context.model,
    ),
    tokens,
    dedupKey,
  );
  const lastRow = rowOf(counted.result);
  // Keep this contribution available for a token_usage_record that arrives right after.
  const placed = put(put(counted.acc, { lastRow }), {
    pendingTwin: usedModernTwin ? null : {
      key: dedupKey,
      tokens: codexTokenVector(tokens),
      timestamp,
      cumulative,
      responseId: asString(payload.response_id, ""),
      turnId: asString(payload.turn_id ?? payload.root_turn_id, ""),
    },
  });
  // The turn id as the property key it would be (a number becomes text).
  return payload.turn_id ? codexTurnRow(placed, String(payload.turn_id), context, lastRow) : placed;
}

function codexTaskComplete(record, ctx, acc, payload) {
  const turnId = asString(payload.turn_id ?? payload.root_turn_id, "");
  const { acc: opened, context } = codexContext(acc, turnId);
  const reported = Number.isFinite(payload.duration_ms)
    ? toNonNegInt(payload.duration_ms)
    : 0;
  const started = Number(payload.started_at);
  const completed = Number(payload.completed_at);
  const duration = reported || (Number.isFinite(started) && Number.isFinite(completed) && completed >= started
    ? toNonNegInt((completed - started) * 1000)
    : 0);
  if (duration <= 0) return opened;
  const target = context.lastRow ?? opened.state.lastRow;
  if (!target) return opened;
  const session = codexRecordSession(opened.state, ctx, payload);
  return ctx.addTask(
    opened,
    target.fileId,
    target.rowIdx,
    taskKeyFor(
      "codex",
      "task",
      session,
      turnId || record.timestamp || payload.completed_at || duration,
    ),
    duration,
    session,
    true,
  );
}

function parseCodex(record, ctx, acc) {
  if (!isPlainObject(record)) return acc;
  const payload = isPlainObject(record.payload) ? record.payload : {};
  const timestamp =
    parseTimestamp(record.timestamp) ?? acc.state.timestamp ?? null;

  if (record.type === "session_meta") return codexSessionMeta(record, acc, payload);
  if (record.type === "turn_context") return codexTurnContext(acc, payload);
  if (record.type === "token_usage_record") return codexUsageRecord(record, ctx, acc, payload, timestamp);
  if (record.type === "event_msg" && payload.type === "token_count") {
    return codexTokenCount(record, ctx, acc, payload, timestamp);
  }
  if (record.type === "event_msg" && payload.type === "task_complete") {
    return codexTaskComplete(record, ctx, acc, payload);
  }
  return acc;
}

export function getPath(object, path) {
  if (typeof path !== "string" || !path) return undefined;
  return path.split(".").reduce((current, part) => {
    if (current === null || current === undefined) return undefined;
    if (Array.isArray(current)) return /^\d+$/.test(part) ? current[Number(part)] : undefined;
    if (isPlainObject(current)) return Object.hasOwn(current, part) ? current[part] : undefined;
    return undefined;
  }, object);
}

function resolveField(spec, record, fallback) {
  if (!spec) return fallback;
  if (Object.hasOwn(spec, "literal")) return spec.literal;
  const value = getPath(record, spec.path);
  if (value === undefined || value === null) {
    return Object.hasOwn(spec, "default") ? spec.default : fallback;
  }
  return value;
}

function customIncludes(mapping, record) {
  if (!Array.isArray(mapping.include)) return true;
  return mapping.include.every((condition) => {
    const value = getPath(record, condition.path);
    if (Object.hasOwn(condition, "exists")) return condition.exists ? value !== undefined : value === undefined;
    return value === condition.equals;
  });
}

function customString(value, fallback = "unknown") {
  if (typeof value === "string" && value.length > 0) return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return fallback;
}

function parseCustom(record, ctx, acc) {
  if (!isPlainObject(record)) return acc;
  const mapping = ctx.source.mapping;
  if (!customIncludes(mapping, record)) return acc;

  if (mapping.roles) {
    const role = customString(resolveField(mapping.role, record), "");
    if (!mapping.roles.includes(role)) return acc;
  }

  const rawSession = customString(resolveField(mapping.session, record), "");
  const session = rawSession
    ? `custom:${ctx.source.id}:${rawSession}`
    : `custom:${ctx.source.id}:file:${ctx.file.path}`;
  const timestamp = parseTimestamp(resolveField(mapping.timestamp, record));
  if (timestamp === null) {
    return ctx.warn(acc, `custom source ${ctx.source.id}: record has no usable timestamp; skipped`);
  }
  const project = customString(resolveField(mapping.project, record));
  const provider = customString(resolveField(mapping.provider, record));
  const model = customString(resolveField(mapping.model, record));
  const harness = mapping.harness ?? ctx.source.id;

  const tokens = normalizeTokens(Object.fromEntries(["input", "output", "cacheRead", "cacheWrite", "reasoning"]
    .filter((key) => mapping.usage[key])
    .map((key) => [key, resolveField(mapping.usage[key], record, 0)])));
  if (!tokens.nonzero) return acc;

  const messageValue = resolveField(mapping.messageId, record);
  const messageId = customString(messageValue, "");
  const identity = messageId
    ? ["message", messageId]
    : ["line", session, timestamp, ctx.lineHash];
  const dedupKey = makeDedupKey(harness, ...identity);
  const counted = ctx.addUsage(
    acc,
    metaFor(harness, session, timestamp, project, provider, model),
    tokens,
    dedupKey,
  );

  if (!mapping.taskDurationMs) return counted.acc;
  const durationValue = resolveField(mapping.taskDurationMs, record);
  if (typeof durationValue !== "number" || !Number.isFinite(durationValue)) return counted.acc;
  const duration = toNonNegInt(durationValue);
  if (duration <= 0) return counted.acc;
  return ctx.addTask(
    counted.acc,
    counted.result.fileId,
    counted.result.rowIdx,
    makeTaskKey(harness, "custom-task", dedupKey),
    duration,
    session,
    true,
  );
}

export const ADAPTER_PARSERS = {
  pi: parsePi,
  claude: parseClaude,
  codex: parseCodex,
  custom: parseCustom,
};

export function parseAdapterRecord(adapter, record, ctx, acc) {
  const parser = ADAPTER_PARSERS[adapter];
  if (!parser) throw new Error(`unknown adapter ${adapter}`);
  return parser(record, ctx, acc);
}

// Keep lint honest about the public helpers that tests may import.
export { metaFor, piMainSession, claudeSession, codexSession, resolveField };
export { hashKey };

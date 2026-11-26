export const atOf = (stamp) => {
  if (typeof stamp === "number" && Number.isFinite(stamp)) return stamp;
  const n = Date.parse(stamp);
  return Number.isNaN(n) ? null : n;
};

export function textOf(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.flatMap((p) => {
    if (typeof p === "string") return [p];
    if (!p || typeof p !== "object") return [];
    if (String(p.type ?? "").toLowerCase().includes("image")) return [];
    return typeof p.text === "string" ? [p.text] : [];
  }).join("\n");
}

export function toolName(command) {
  const word = String(command ?? "").trim().split(/\s+/)[0] ?? "";
  const base = word.split(/[/\\]/).filter(Boolean).at(-1) || "tool";
  return base.slice(0, 24);
}

const NONE = Object.freeze({ format: null, events: Object.freeze([]) });
const shown = (p) => p && typeof p === "object" && p.type !== "thinking" && !String(p.type ?? "").toLowerCase().includes("image");

function claudeTalk(obj) {
  if (obj.isMeta || obj.isSidechain) return [];
  const at = atOf(obj.timestamp);
  const role = obj.type === "user" ? "user" : "assistant";
  const human = !obj.origin || obj.origin.kind === "human";
  const content = obj.message?.content;
  if (typeof content === "string") return [{ kind: "say", role, text: content, at, human }];
  if (!Array.isArray(content)) return [];
  const parts = content.filter(shown);
  const text = parts.filter((p) => p.type !== "tool_use" && p.type !== "tool_result" && typeof p.text === "string").map((p) => p.text).join("\n");
  const said = text.trim() ? [{ kind: "say", role, text, at, human }] : [];
  return [...said, ...parts.flatMap((p) => {
    if (p.type === "tool_use" && p.id) return [{ kind: "call", id: p.id, name: p.name, input: p.input ?? {}, at }];
    if (p.type === "tool_result") return [{ kind: "result", id: p.tool_use_id, error: Boolean(p.is_error), text: textOf(p.content), at }];
    return [];
  })];
}

function claudeAside(obj) {
  if (obj.isSidechain) return [];
  const at = atOf(obj.timestamp);
  if (obj.type === "system" && obj.subtype === "turn_duration") return [{ kind: "end", at, ms: Number(obj.durationMs) || null, stopped: false }];
  if (obj.type === "attachment" && obj.attachment?.type === "queued_command") {
    const origin = obj.attachment.origin ?? obj.origin;
    return [{ kind: "queued", text: textOf(obj.attachment.prompt), at, human: !origin || origin.kind === "human" }];
  }
  return [];
}

const outputOf = (value) => (typeof value === "string" ? value : textOf(value));

function modernTalk(item, at) {
  if (item.type === "UserMessage" || item.type === "AgentMessage") return [{ kind: "say", role: item.type === "UserMessage" ? "user" : "assistant", text: textOf(item.content), at, human: true }];
  if (item.type === "CommandExecution") return [{ kind: "command", name: toolName(item.command), text: outputOf(item.aggregated_output), at }];
  if (item.type === "FileChange") {
    const text = [item.stdout, item.stderr].filter((s) => typeof s === "string").join("\n");
    return [{ kind: "files", paths: Object.keys(item.changes ?? {}), ok: !item.status || item.status === "completed", text, at }];
  }
  return [];
}

const TURN = { task_started: "start", task_complete: "end", turn_aborted: "end" };

function codexEvent(obj, at) {
  const p = obj.payload ?? {};
  if (p.type === "item_completed") return { format: "modern", events: modernTalk(p.item ?? {}, at) };
  if (TURN[p.type]) return { format: "codex", events: [{ kind: TURN[p.type], at, ms: Number(p.duration_ms) || null, stopped: p.type === "turn_aborted" }] };
  if (p.type !== "user_message" && p.type !== "agent_message") return NONE;
  return { format: "legacy", events: [{ kind: "say", role: p.type === "user_message" ? "user" : "assistant", text: outputOf(p.message), at, from: "event", human: true }] };
}

function legacyItem(obj, at) {
  const item = obj.type === "response_item" ? (obj.payload ?? {}) : obj;
  const kind = obj.type === "response_item" ? item.type : obj.type;
  if (kind === "message") {
    const talk = item.role === "user" || item.role === "assistant";
    return { format: "legacy", events: talk ? [{ kind: "say", role: item.role, text: textOf(item.content), at, from: "response", human: true }] : [] };
  }
  if (kind === "custom_tool_call" || kind === "function_call") return { format: "legacy", events: [{ kind: "call", id: item.call_id, name: item.name, input: item.input ?? item.arguments ?? "", at }] };
  if (kind === "custom_tool_call_output" || kind === "function_call_output") return { format: "legacy", events: [{ kind: "result", id: item.call_id, error: false, text: outputOf(item.output), at }] };
  return NONE;
}

export function eventsOf(obj) {
  if (!obj || typeof obj !== "object") return NONE;
  if (obj.type === "user" || obj.type === "assistant") return { format: "claude", events: claudeTalk(obj) };
  if (obj.type === "system" || obj.type === "attachment") {
    const events = claudeAside(obj);
    return events.length ? { format: "claude", events } : NONE;
  }
  const at = atOf(obj.timestamp);
  return obj.type === "event_msg" ? codexEvent(obj, at) : legacyItem(obj, at);
}

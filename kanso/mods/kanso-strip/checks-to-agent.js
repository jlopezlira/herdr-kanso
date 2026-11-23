import { checkState, jobLabel } from "./ghchecks.js";
import { NEEDS_LABEL, needsWord } from "./needs.js";

export const SENT_LABEL = "kanso.checks";
export const PR_LABEL = "kanso.pr";
export const CHECKS_FAILED = "checks failed";
export const POLL_MS = 30_000;
export const EMPTY_POLLS = 4;
export const HISTORY_LINES = 3000;

const cancelled = (check) => String(check?.conclusion ?? check?.state ?? "").toUpperCase() === "CANCELLED";
const linkOf = (check) => check?.detailsUrl ?? check?.targetUrl ?? null;
const nameOfCheck = (check) => (check?.name ? jobLabel(check) : check?.context || jobLabel(check));
const once = (list) => list.filter((item, i) => list.findIndex((other) => other.name === item.name && other.url === item.url) === i);

export function checksOutcome(rollup) {
  const checks = Array.isArray(rollup) ? rollup.filter((check) => check && typeof check === "object") : [];
  if (!checks.length) return { result: "none", failed: [] };
  const states = checks.map(checkState);
  if (states.some((state) => state === "pending" || state === "unknown")) return null;
  const failed = once(checks.filter((check, i) => states[i] === "fail" && !cancelled(check)).map((check) => ({ name: nameOfCheck(check), url: linkOf(check) })));
  if (failed.length) return { result: "failed", failed };
  return { result: checks.some(cancelled) ? "cancelled" : "passed", failed: [] };
}

export function checksMessage({ number, url }, outcome) {
  const named = `pull request #${number}${url ? ` (${url})` : ""}`;
  if (outcome.result === "passed") return `The checks on ${named} passed.`;
  return [`The checks on ${named} failed:`, ...outcome.failed.map(({ name, url: link }) => `- ${name}${link ? `: ${link}` : ""}`)].join("\n");
}

export const DELIVERIES = "kanso.checks.deliveries";
const CREATED = /\bgh\s+pr\s+create\b|create_pull_request/;
const escaped = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const opened = (history, { url }) => {
  const text = String(history ?? "");
  return Boolean(url) && CREATED.test(text) && new RegExp(`${escaped(url)}(?![0-9])`).test(text);
};

const deliveryKey = (terminal, head) => `${terminal}\u0000${head}`;
export const deliveryOf = (store, terminal, head) => (store && typeof store === "object" ? store[deliveryKey(terminal, head)] ?? null : null);
export const reserve = (store, terminal, head, state) => {
  const kept = Object.fromEntries(Object.entries(store && typeof store === "object" ? store : {}).filter(([key]) => key !== deliveryKey(terminal, head)));
  return state ? { ...kept, [deliveryKey(terminal, head)]: state } : kept;
};

const waiting = (status) => status === "done" || status === "idle";
const ours = (labels) => needsWord(labels) === CHECKS_FAILED;
const clear = (labels) => (ours(labels) ? [`${NEEDS_LABEL}=`] : []);
const only = (pairs) => (pairs.length ? { act: "label", labels: pairs } : { act: "none" });

export function checksStep({ pr, labels = {}, status = null, on = true, opener = true, empties = 0 }) {
  if (!on) return { act: "none" };
  if (!pr?.head) return only(clear(labels));
  const pushed = labels[SENT_LABEL] && labels[SENT_LABEL] !== pr.head ? clear(labels) : [];
  if (!opener) return only(pushed);
  if (!pr.run) return { act: "poll", labels: pushed };
  if (pr.run.result === "none") return empties < EMPTY_POLLS ? { act: "poll", labels: pushed, empty: true } : only(pushed);
  if (labels[SENT_LABEL] === pr.head || pr.run.result === "cancelled") return only(pushed);
  if (!waiting(status)) return { act: "wait", labels: pushed };
  const failed = pr.run.result === "failed";
  return { act: "send", text: checksMessage(pr, pr.run), labels: [`${SENT_LABEL}=${pr.head}`, `${NEEDS_LABEL}=${failed ? CHECKS_FAILED : ""}`] };
}

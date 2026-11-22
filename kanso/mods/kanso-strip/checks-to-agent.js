import { onePerJob, checkState, jobLabel } from "./ghchecks.js";
import { NEEDS_LABEL, needsWord } from "./needs.js";

export const SENT_LABEL = "kanso.checks";
export const CHECKS_FAILED = "checks failed";
export const POLL_MS = 30_000;

const cancelled = (check) => String(check?.conclusion ?? check?.state ?? "").toUpperCase() === "CANCELLED";
const linkOf = (check) => check?.detailsUrl ?? check?.targetUrl ?? null;
const nameOfCheck = (check) => (check?.name ? jobLabel(check) : check?.context || jobLabel(check));

export function checksOutcome(rollup) {
  const jobs = onePerJob(rollup);
  if (!jobs.length) return null;
  const states = jobs.map(checkState);
  if (states.some((state) => state === "pending" || state === "unknown")) return null;
  const failed = jobs.filter((check, i) => states[i] === "fail" && !cancelled(check));
  if (failed.length) return { result: "failed", failed: failed.map((check) => ({ name: nameOfCheck(check), url: linkOf(check) })) };
  return { result: jobs.some(cancelled) ? "cancelled" : "passed", failed: [] };
}

export function checksMessage({ number, url }, outcome) {
  const named = `pull request #${number}${url ? ` (${url})` : ""}`;
  if (outcome.result === "passed") return `The checks on ${named} passed.`;
  return [`The checks on ${named} failed:`, ...outcome.failed.map(({ name, url: link }) => `- ${name}${link ? `: ${link}` : ""}`)].join("\n");
}

const waiting = (status) => status === "done" || status === "idle";
const ours = (labels) => needsWord(labels) === CHECKS_FAILED;
const clear = (labels) => (ours(labels) ? [`${NEEDS_LABEL}=`] : []);

export function checksStep({ pr, labels = {}, status = null, on = true }) {
  if (!on) return { act: "none" };
  if (!pr?.head) return clear(labels).length ? { act: "label", labels: clear(labels) } : { act: "none" };
  const pushed = labels[SENT_LABEL] && labels[SENT_LABEL] !== pr.head ? clear(labels) : [];
  if (!pr.run) return { act: "poll", labels: pushed };
  if (labels[SENT_LABEL] === pr.head || pr.run.result === "cancelled") return pushed.length ? { act: "label", labels: pushed } : { act: "none" };
  if (!waiting(status)) return { act: "wait", labels: pushed };
  const failed = pr.run.result === "failed";
  return { act: "send", text: checksMessage(pr, pr.run), labels: [`${SENT_LABEL}=${pr.head}`, `${NEEDS_LABEL}=${failed ? CHECKS_FAILED : ""}`] };
}

import { resumeArgv, isSessionId } from "./resume.js";
import { limitOf, resumeArmed, resetWords, limitedProviders, limitWords } from "./limits-model.js";
import { snoozedUntil } from "./agents.js";

const waits = (status) => status === "done" || status === "idle";

export function resumeCommand(app, argv, conversation) {
  if (!isSessionId(conversation)) return [];
  if (app === "claude-code") {
    const back = resumeArgv(argv, conversation);
    return back ? [...back, "continue"] : [];
  }
  return app === "codex" ? ["codex", "resume", conversation, "continue"] : [];
}

export function limitLines({ labels, status, now, atReset, snooze, snoozed }) {
  const limit = limitOf(labels);
  if (!limit?.until || !waits(status)) return [];
  return [
    { act: "resume-at-reset", does: atReset, checked: resumeArmed(labels) },
    ...(snoozed ? [] : [{ act: "snooze-reset", does: snooze, hint: resetWords(limit.until, now) }]),
  ];
}

export const shownNow = (now) => (a) => !(a.status === "limited" && snoozedUntil(a.labels) > now);

export function providerLimits(list, now) {
  const by = limitedProviders(list, now);
  return (key) => (Object.hasOwn(by, key) ? limitWords(by[key], now) : null);
}

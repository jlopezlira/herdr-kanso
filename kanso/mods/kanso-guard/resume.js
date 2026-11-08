// Sleep, Memory and Arrangements, by jlopezlira (https://github.com/jlopezlira/herdr-kanso). Apache-2.0.
// Shared source: npm run sync:share copies it, and a test fails when a copy differs.
// How a Claude Code command starts again on a conversation. Pure: Sleep runs it
// in Herdr, the guard under Node, so it imports nothing.

// Resume without repeating the first prompt or forking the conversation: only options known to carry over are kept.
export const KEEP_VALUE = new Set(["--model", "--permission-mode", "--settings", "--agent", "--effort", "--fallback-model", "--append-system-prompt", "--system-prompt", "--plugin-dir", "--setting-sources", "--name"]);
// These take every word after them up to the next option: those words are theirs, not a prompt.
export const KEEP_MANY = new Set(["--add-dir", "--mcp-config", "--allowedTools", "--allowed-tools", "--disallowedTools", "--disallowed-tools"]);
export const KEEP_FLAG = new Set(["--dangerously-skip-permissions", "--allow-dangerously-skip-permissions", "--verbose", "--chrome", "--no-chrome", "--ide", "--strict-mcp-config", "--brief", "--debug"]);
// The conversation a command was on: a resume names its own, a fresh start none.
export const DROP_VALUE = new Set(["--resume", "-r", "--session-id"]);
export const DROP_FLAG = new Set(["--continue", "-c", "--fork-session"]);

const program = (s) => String(s ?? "").split("/").at(-1).replace(/^-/, "");
export const isClaude = (argv) => Array.isArray(argv) && argv.length > 0 && program(argv[0]) === "claude";

const split = (a) => {
  const eq = a.startsWith("--") ? a.indexOf("=") : -1;
  return { flag: eq > 0 ? a.slice(0, eq) : a, inline: eq > 0 };
};

// How many words from `a` pick the conversation (0: not such an option). A bare
// --resume opens the picker, so the word after it is its id only when it is not an option.
export function sessionWords(a, next) {
  const { flag, inline } = split(String(a));
  if (DROP_FLAG.has(flag)) return 1;
  if (!DROP_VALUE.has(flag)) return 0;
  return !inline && next !== undefined && !String(next).startsWith("-") ? 2 : 1;
}

// The command that resumes conversation `session`, or null when an option in it can't carry over.
export function resumeArgv(argv, session) {
  if (!isClaude(argv) || !session) return null;
  const words = argv.map(String);
  // { kept, next } for an option at word i, { end } at the first prompt, null when it can't carry over.
  const option = (i) => {
    const a = words[i];
    if (!a.startsWith("-")) return { end: true };
    const { flag, inline } = split(a);
    if (KEEP_FLAG.has(flag) && !inline) return { kept: [a], next: i + 1 };
    if (KEEP_MANY.has(flag)) {
      if (inline) return { kept: [a], next: i + 1 };
      const end = words.findIndex((v, j) => j > i && v.startsWith("-"));
      const vals = words.slice(i + 1, end < 0 ? words.length : end);
      return vals.length ? { kept: [a, ...vals], next: i + 1 + vals.length } : null;
    }
    if (KEEP_VALUE.has(flag)) {
      if (inline) return { kept: [a], next: i + 1 };
      return i + 1 < words.length ? { kept: [a, words[i + 1]], next: i + 2 } : null;
    }
    const drop = sessionWords(a, words[i + 1]);
    return drop ? { kept: [], next: i + drop } : null;
  };
  const walked = words.reduce((st, _, i) => {
    if (i < 1 || st.stop || i !== st.next) return st;
    const o = option(i);
    if (!o) return { ...st, stop: true, failed: true };
    if (o.end) return { ...st, stop: true };
    return { ...st, next: o.next, parts: [...st.parts, o.kept] };
  }, { next: 1, parts: [], stop: false, failed: false });
  return walked.failed ? null : [argv[0], ...walked.parts.flat(), "--resume", session];
}

// False when no prompt box shows: a screen it can't read must stop /exit.
export function promptEmpty(screen) {
  const lines = String(screen ?? "").split("\n");
  const rule = (l) => /^\s*─{8,}/.test(l ?? "");
  // The last "❯" under a rule (never the first line), to the rule that closes the box.
  const i = lines.findLastIndex((l, k) => k > 0 && /^\s*[❯>]/.test(l) && rule(lines[k - 1]));
  if (i < 0) return false;
  const end = lines.findIndex((l, j) => j > i && rule(l));
  const box = [lines[i].replace(/^\s*[❯>]/, ""), ...lines.slice(i + 1, end < 0 ? lines.length : end)];
  return box.every((l) => !l.trim());
}

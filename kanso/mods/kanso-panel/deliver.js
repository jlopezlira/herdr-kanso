// Kanso, by jlopezlira (https://github.com/jlopezlira/herdr-kanso). Apache-2.0.
// Kept byte for byte in kanso-send/ and kanso-panel/ (`npm run sync:share`): edit kanso-send/deliver.js.
// Text for an agent, the same from Send and from Look.
import { hc } from "herdr";

// Cmd+Enter (Ctrl+Enter off macOS) sends.
export const sendKey = (e) => e?.key === "enter" && Boolean(e.modifiers?.platform || e.modifiers?.control);

// An agent asking its own question would take the text as its answer.
export const waitingNote = (names) => names.length === 1
  ? `${names[0]} is waiting on its own question. Answer it first, then send.`
  : `${names.join(", ")} are waiting on their own question. Answer it first, then send.`;

// Pasted into its terminal and sent with Enter, as if typed there, then marked unread and from whom.
export async function deliver(terminal, text, from) {
  const r = await hc(["send", terminal, text]).catch((e) => ({ code: 1, stderr: String(e?.message ?? e) }));
  if (r.code === 0) await hc(["label", terminal, "kanso.unread=1", `kanso.from=${from}`]).catch(() => null);
  return r;
}

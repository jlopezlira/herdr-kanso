// Kanso, by jlopezlira (https://github.com/jlopezlira/herdr-kanso). Apache-2.0.
// Kept byte for byte in kanso-send/ and kanso-panel/ (`npm run sync:share`): edit kanso-send/deliver.js.
// Text for an agent, the same from Send and from Look.
import { hc } from "herdr";
import { bounded } from "./pure.js";

// Only an agent takes text: it reports a status or Herdr knows its program as one. A shell would run the text.
// `infos`: the terminal and its pane, either may be missing.
export const isAgent = (...infos) => infos.some((x) => Boolean(x?.status || x?.program?.agent));

// Cmd+Enter (Ctrl+Enter off macOS) sends.
export const sendKey = (e) => e?.key === "enter" && Boolean(e.modifiers?.platform || e.modifiers?.control);

// An agent asking its own question would take the text as its answer.
export const waitingNote = (names) => names.length === 1
  ? `${names[0]} is waiting on its own question. Answer it first, then send.`
  : `${names.join(", ")} are waiting on their own question. Answer it first, then send.`;

export const SEND_MS = 31_000;
export const NOT_CONFIRMED = "Not confirmed";
export const MAY_HAVE_ARRIVED = "it may have arrived, so look at the agent before sending again";

const refused = (reason) => ({ code: 1, stdout: "", stderr: reason });
const unconfirmed = (reason) => ({ ...refused(reason), unconfirmed: true });
const outcomeOf = (error) => {
  const reason = String(error?.message ?? error);
  return /^cannot run /.test(reason) ? refused(reason) : unconfirmed(reason);
};

export async function deliver(timer, terminal, text, from) {
  if (!timer?.after) throw new TypeError("deliver needs a timer for its deadline");
  const sent = await bounded(hc(["send", terminal, text]).catch(outcomeOf), timer, SEND_MS);
  if (sent?.late) return unconfirmed(`no answer in ${SEND_MS / 1000} s`);
  if (sent.code === 0) void bounded(hc(["label", terminal, "kanso.unread=1", `kanso.from=${from}`]).catch(() => null), timer, SEND_MS);
  return sent;
}

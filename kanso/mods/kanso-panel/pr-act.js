export const ACTS = Object.freeze({
  approve: Object.freeze({ label: "Approve", pending: "Approving…", done: "Approved", refused: "Couldn’t approve" }),
  changes: Object.freeze({ label: "Request changes", pending: "Requesting changes…", done: "Changes requested", refused: "Couldn’t request changes" }),
  comment: Object.freeze({ label: "Comment", pending: "Commenting…", done: "Commented", refused: "Comment not posted" }),
  reply: Object.freeze({ label: "Reply", pending: "Replying…", done: "Replied", refused: "Reply not posted" }),
  rerun: Object.freeze({ label: "Re-run", pending: "Re-running…", done: "Running again", refused: "Couldn’t re-run" }),
  merge: Object.freeze({ label: "Squash and merge", pending: "Merging…", done: "Merged", refused: "Merge failed" }),
  close: Object.freeze({ label: "Close", pending: "Closing…", done: "Closed", refused: "Couldn’t close" }),
  ready: Object.freeze({ label: "Ready for review", pending: "Marking ready…", done: "Ready for review", refused: "Couldn’t mark it ready" }),
  create: Object.freeze({ label: "Create pull request", pending: "Opening…", done: "Opened", refused: "Could not create it" }),
});

const UNDO = {
  approve: ({ id }, { o, r, number }) => [["api", "-X", "PUT", `repos/${o}/${r}/pulls/${number}/reviews/${id}/dismissals`, "-f", "message=Undone from kansō", "-f", "event=DISMISS"]],
  comment: ({ id }, { o, r }) => [["api", "-X", "DELETE", `repos/${o}/${r}/issues/comments/${id}`]],
  reply: ({ id }, { o, r }) => [["api", "-X", "DELETE", `repos/${o}/${r}/pulls/comments/${id}`]],
  rerun: ({ id }, { o, r }) => [id].flat().map((run) => ["run", "cancel", String(run), "-R", `${o}/${r}`]),
  close: ({ id }) => [["pr", "reopen", id]],
  ready: ({ id }) => [["pr", "ready", id, "--undo"]],
  create: ({ id }) => [["pr", "close", id]],
};
const UNDO_OF = { ...UNDO, changes: UNDO.approve };

export const undoCalls = (outcome, pull) => UNDO_OF[outcome.kind]?.(outcome, pull) ?? [];

export const pendingOf = (kind, at = null) => ({ kind, state: "pending", at });
export const doneOf = (kind, id, at = null) => ({ kind, state: "done", id, at });
export const refusedOf = (kind, error, at = null) => ({ kind, state: "refused", error, at });
export const partlyOf = (outcome, partial) => (partial ? { ...outcome, partial } : outcome);
export const undoneOf = ({ undoError, partial, ...outcome }) => ({ ...outcome, state: "undone" });
export const undoRefusedOf = (outcome, error) => ({ ...outcome, undoError: error });
export const canUndo = (outcome) => outcome?.state === "done" && outcome.id != null && Boolean(UNDO_OF[outcome.kind]);

export const saidOf = (outcome) => {
  if (outcome.state === "pending") return ACTS[outcome.kind].pending;
  if (outcome.state === "done") return ACTS[outcome.kind].done;
  if (outcome.state === "undone") return "Undone";
  return String(outcome.error ?? "").split("\n")[0];
};

export const refusedTitle = (outcome) => ACTS[outcome.kind].refused;

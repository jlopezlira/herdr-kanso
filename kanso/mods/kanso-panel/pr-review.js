const EVENT = { approve: "APPROVE", changes: "REQUEST_CHANGES" };
const PENDING = { approve: "Approving…", changes: "Requesting changes…", comment: "Commenting…" };

export const REVIEWS = Object.freeze({
  approve: Object.freeze({ label: "Approve", done: "Approved", needsBody: false }),
  changes: Object.freeze({ label: "Request changes", done: "Changes requested", needsBody: true }),
  comment: Object.freeze({ label: "Comment", done: "Commented", needsBody: true }),
});

const reviewPath = (kind, { o, r, number }) => (kind === "comment"
  ? `repos/${o}/${r}/issues/${number}/comments`
  : `repos/${o}/${r}/pulls/${number}/reviews`);

export const reviewArgs = (kind, pull) => (kind === "comment"
  ? ["api", "-X", "POST", reviewPath(kind, pull), "-f", `body=${pull.body}`]
  : ["api", "-X", "POST", reviewPath(kind, pull), "-f", `event=${EVENT[kind]}`, "-f", `body=${pull.body}`]);

export const undoArgs = ({ kind, id }, { o, r, number }) => (kind === "comment"
  ? ["api", "-X", "DELETE", `repos/${o}/${r}/issues/comments/${id}`]
  : ["api", "-X", "PUT", `repos/${o}/${r}/pulls/${number}/reviews/${id}/dismissals`, "-f", "message=Undone from kansō", "-f", "event=DISMISS"]);

export const createdId = (stdout) => {
  try {
    const id = JSON.parse(stdout)?.id;
    return Number.isInteger(id) ? id : null;
  } catch {
    return null;
  }
};

const loginOf = (pr) => String(pr?.author?.login ?? "").toLowerCase();

export const reviewable = (pr, viewer) => {
  const open = pr?.state === "OPEN";
  const other = Boolean(viewer) && String(viewer).toLowerCase() !== loginOf(pr);
  return { approve: open && other, changes: open && other, comment: Boolean(open) };
};

export const ready = (kind, body) => !REVIEWS[kind]?.needsBody || String(body ?? "").trim() !== "";

export const pendingOf = (kind) => ({ kind, state: "pending" });
export const doneOf = (kind, id) => ({ kind, state: "done", id });
export const refusedOf = (kind, error) => ({ kind, state: "refused", error });
export const undoneOf = (outcome) => ({ ...outcome, state: "undone" });
export const canUndo = (outcome) => outcome?.state === "done" && outcome.id != null;

export const saidOf = (outcome) => {
  if (outcome.state === "pending") return PENDING[outcome.kind];
  if (outcome.state === "done") return REVIEWS[outcome.kind].done;
  if (outcome.state === "undone") return "Undone";
  return String(outcome.error ?? "").split("\n")[0];
};

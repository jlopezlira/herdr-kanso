const EVENT = { approve: "APPROVE", changes: "REQUEST_CHANGES" };

export const REVIEWS = Object.freeze({
  approve: Object.freeze({ label: "Approve", needsBody: false }),
  changes: Object.freeze({ label: "Request changes", needsBody: true }),
  comment: Object.freeze({ label: "Comment", needsBody: true }),
});

const reviewPath = (kind, { o, r, number }) => (kind === "comment"
  ? `repos/${o}/${r}/issues/${number}/comments`
  : `repos/${o}/${r}/pulls/${number}/reviews`);

export const reviewArgs = (kind, pull) => (kind === "comment"
  ? ["api", "-X", "POST", reviewPath(kind, pull), "-f", `body=${pull.body}`]
  : ["api", "-X", "POST", reviewPath(kind, pull), "-f", `event=${EVENT[kind]}`, "-f", `body=${pull.body}`]);

export const replyArgs = ({ o, r, number, comment, body }) => ["api", "-X", "POST", `repos/${o}/${r}/pulls/${number}/comments/${comment}/replies`, "-f", `body=${body}`];

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

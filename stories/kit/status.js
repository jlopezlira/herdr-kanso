// Derive each page's one status from references.json and the catalog.
export const STATUSES = ["Ready", "In review", "Proposal", "Old look"];
export const STATUS_PROMPT = {
  Ready: "Follow the approved reference drawings and guidelines below. Additional states are Proposed.",
  "In review": "This design is In review and needs approval.",
  Proposal: "This design is a Proposal and needs approval.",
  "Old look": "This page shows the app's current look; it is not redesigned yet.",
};

export function statusOf(page, records, references) {
  const reference = references.find((item) => item.page === page);
  const drawn = (ids) => records.filter((record) => ids(record) && (record.markup ?? record.html) !== undefined && !record.fragment);
  if (reference) {
    if (reference.status !== "Proposed") return "Ready";
    const wanted = new Set(reference.records);
    return drawn((record) => wanted.has(record.id)).every((record) => record.source === "coverage") ? "Old look" : "Proposal";
  }
  const states = drawn((record) => record.page === page);
  if (!states.length) return "Ready";
  const approved = new Set(references.flatMap((item) => item.approvedRecords ?? []));
  if (states.some((record) => approved.has(record.id))) return "Ready";
  return states.every((record) => record.source === "coverage") ? "Old look" : "In review";
}

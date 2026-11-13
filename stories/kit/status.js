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
  const wanted = reference ? new Set(reference.records) : null;
  const shown = records.filter((record) => (wanted?.has(record.id) || ((!reference || reference.existing) && record.page === page)) && (record.markup ?? record.html) !== undefined && !record.fragment);
  if (shown.some((record) => record.source === "coverage")) return "Old look";
  if (reference) return reference.status === "Proposed" ? "Proposal" : "Ready";
  if (!shown.length) return "Ready";
  const approved = new Set(references.flatMap((item) => item.approvedRecords ?? []));
  return shown.some((record) => approved.has(record.id)) ? "Ready" : "In review";
}

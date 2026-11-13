// Resolve named feature pages to the original component states.
import references from "../references.json" with { type: "json" };
import { records, statesFor } from "./catalog.js";
import { statusOf } from "./status.js";

export const referencePages = references.pages;
export const referenceFor = (page) => referencePages.find((reference) => reference.page === page);
export const statusFor = (page) => statusOf(page, records, referencePages);
export const referenceStates = (page) => {
  const reference = referenceFor(page);
  if (!reference) return [];
  const wanted = new Set(reference.records);
  return [...new Set(reference.components)].flatMap(statesFor).filter((state) => wanted.has(state.id));
};

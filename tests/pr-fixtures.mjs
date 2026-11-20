// Shared by the pull request panel tests: a panel with nothing open, and a second read of it.
import assert from "node:assert/strict";

export const SIGNED_OUT = "You are not logged into any GitHub hosts. To log in, run: gh auth login";
export const PASSED = [{ __typename: "CheckRun", status: "COMPLETED", conclusion: "SUCCESS", name: "ci" }];

export const blankPanel = (PullRequest, db, state = {}) => {
  const panel = new PullRequest(db);
  Object.assign(panel.session, { expanded: {}, openPrs: [], selected: null, threads: [], ...state });
  return panel;
};

export const refreshAgain = async (panel, cx, drain) => {
  panel.session.loading = false;
  panel.refresh(cx);
  await drain();
};

// The inbox stays closed until asked, then opens.
export const openInbox = (panel) => {
  assert.equal(panel.session.inboxOpen, false);
  panel.session.inboxOpen = true;
};

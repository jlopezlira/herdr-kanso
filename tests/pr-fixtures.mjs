// Shared by the pull request panel tests: a panel with nothing open, and a second read of it.
import assert from "node:assert/strict";

export const SIGNED_OUT = "You are not logged into any GitHub hosts. To log in, run: gh auth login";
export const PASSED = [{ __typename: "CheckRun", status: "COMPLETED", conclusion: "SUCCESS", name: "ci" }];

export const blankPanel = (PullRequest, db, state = {}) => Object.assign(new PullRequest(db), { expanded: {}, openPrs: [], selected: null, threads: [], ...state });

export const refreshAgain = async (panel, cx, drain) => {
  panel.loading = false;
  panel.refresh(cx);
  await drain();
};

// The inbox stays closed until asked, then opens.
export const openInbox = (panel) => {
  assert.equal(panel.inboxOpen, false);
  panel.inboxOpen = true;
};

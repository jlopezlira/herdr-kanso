// Shared by the pull request panel tests: a panel with nothing open, and a second read of it.
import assert from "node:assert/strict";
import { databaseTimer, load } from "./helpers.mjs";
import { loadPanelKdb, loadPullRequest } from "./mod-fixtures.mjs";

export const SIGNED_OUT = "You are not logged into any GitHub hosts. To log in, run: gh auth login";
export const PASSED = [{ __typename: "CheckRun", status: "COMPLETED", conclusion: "SUCCESS", name: "ci" }];

export const blankPanel = (PullRequest, db, state = {}) => {
  const panel = new PullRequest(db);
  Object.assign(panel.session, { expanded: {}, openPrs: [], selected: null, threads: [], ...state });
  return panel;
};

export const recorder = () => {
  const texts = [];
  const ids = [];
  const node = () => {
    const api = new Proxy({}, {
      get(_target, prop) {
        if (prop === "child") return (child) => {
          if (typeof child === "string" || typeof child === "number") texts.push(String(child));
          return api;
        };
        if (prop === "children") return (list) => {
          for (const child of list ?? []) if (typeof child === "string") texts.push(child);
          return api;
        };
        if (prop === "when") return (cond, fn) => (cond ? fn(api) : api);
        return () => api;
      },
    });
    return api;
  };
  return {
    texts, ids, div: node, svg: node, v_flex: node, h_flex: node,
    Button: { new: (id) => { ids.push(id); return node(); } },
    Popover: { new: () => node() },
    Input: { new: () => node() },
    InputState: { new: () => ({}) },
    TextView: { markdown: () => node() },
  };
};

export const openedPanel = async (host, state) => {
  const { PullRequest } = await loadPullRequest(host);
  const { Kdb } = await loadPanelKdb(host);
  return blankPanel(PullRequest, new Kdb(databaseTimer), state);
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

export const SIGNED_IN = { status: "ok", login: "jj", hosts: [{ host: "github.com", login: "jj", active: true }] };

export const drawOpenBoard = async (panel, colours) => {
  const { boardOf } = await load("kanso-panel/pr-board.js", ["boardOf"], {});
  panel.session.boardOpen = boardOf(panel.session.inbox, panel.session.scope).map((block) => block.key);
  panel.inboxPage(colours);
};

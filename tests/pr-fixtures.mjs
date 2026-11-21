// Shared by the pull request panel tests: a panel with nothing open, and a second read of it.
import assert from "node:assert/strict";
import { databaseTimer } from "./helpers.mjs";
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
  const clicks = new Map();
  const node = (id) => {
    const api = new Proxy({}, {
      get(_target, prop) {
        if (prop === "on_click") return (fn) => { if (id) clicks.set(id, fn); return api; };
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
    texts, ids, clicks, div: () => node(), svg: () => node(), v_flex: () => node(), h_flex: () => node(),
    Button: { new: (id) => { ids.push(id); return node(id); } },
    Popover: { new: () => node() },
    Input: { new: () => node() },
    InputState: { new: () => ({}) },
    TextView: { markdown: () => node() },
  };
};

export const fieldState = () => {
  let text = "";
  const handlers = {};
  return {
    value: () => text,
    set_value(next) { text = String(next ?? ""); },
    set_auto_grow() {},
    set_selected_range() {},
    on(event, fn) { handlers[event] = fn; return this; },
    focus() {},
    release() {},
    type(next, cx) { text = String(next ?? ""); handlers.change?.({}, cx); },
  };
};

export const textFields = () => ({ InputState: { new: fieldState }, TextareaState: { new: fieldState } });

export const reviewFields = (ui) => ({
  Textarea: { new: () => ui.div() },
  TextareaState: { new: fieldState },
  InputState: { new: fieldState },
  ScrollHandle: { new: () => ({ scroll_to_item() {} }) },
});

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

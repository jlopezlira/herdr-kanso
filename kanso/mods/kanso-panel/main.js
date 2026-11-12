// Kanso's side panels, by jlopezlira (https://github.com/jlopezlira/herdr-kanso). Apache-2.0.
// Herdr lets a mod import its own files, not another's, so the panels live in one mod.
import { View, div } from "gpui-kit";
import { props, spaces, home, theme } from "herdr";
import { tokens, EASE } from "./ui.js";
import { Files } from "./files.js";
import { PullRequest } from "./pr.js";
import { Preview } from "./preview.js";
import { Shipped } from "./shipped.js";
import { Worktrees } from "./worktrees.js";
import { Ports } from "./ports.js";
import { Look } from "./look.js";
import { Find } from "./find-view.js";
import { Kdb, projectKey } from "./kdb.js";
import { takeState, giveState, stateWithin, LATE } from "./panel-state.js";
import { afterMount } from "./pure.js";

const PANELS = { files: Files, pr: PullRequest, preview: Preview, shipped: Shipped, worktrees: Worktrees, ports: Ports, look: Look, find: Find };

const projectNow = () => { try { return projectKey(spaces().find((s) => s.active), home()); } catch { return null; } };

export default class Panel extends View {
  init(_props, cx) {
    const p = props() ?? {};
    const id = typeof p.panel === "string" ? p.panel : "files";
    const Impl = PANELS[id] ?? Files;
    this.id = id;
    this.db = new Kdb(undefined, null, cx.timer);
    this.panel = new Impl(this.db);
    this.project = projectNow();
    this.ready = false;
    this.saved = undefined;
    const fresh = Boolean(p.url) || p.path != null && p.path !== "";
    // Read this project's state before the panel starts, then write it when it changes.
    afterMount(cx, (cx) => cx.spawn(async (cx) => {
      if (!fresh && this.project && typeof this.panel.restoreState === "function") {
        try {
          const state = await stateWithin(this.db.panelState(this.project, this.id), cx.timer);
          if (state === LATE) this.db.abandon();
          else if (state && !(await giveState(this.panel, state, cx))) this.db.clearPanelState(this.project, this.id).catch(() => {});
        } catch { /* opens empty */ }
      }
      this.panel.init(cx, p);
      this.ready = true;
      this.saved = JSON.stringify(takeState(this.panel));
      cx.notify();
    }));
    this.shown = false;
    cx.timer.after(16, (cx) => { this.shown = true; cx.notify(); });
  }

  keep() {
    if (!this.ready || !this.project || typeof this.panel.saveState !== "function") return;
    const state = takeState(this.panel);
    if (state === undefined) return;
    const json = JSON.stringify(state);
    if (json === this.saved) return;
    this.saved = json;
    const write = state == null ? this.db.clearPanelState(this.project, this.id) : this.db.savePanelState(this.project, this.id, state);
    write.catch(() => {});
  }

  render(cx) {
    this.keep();
    const body = this.ready && this.panel ? this.panel.render(cx) : this.panel ? this.panel.bones(tokens(theme()), true) : div().size_full();
    return div().w_full().when(!this.panel?.constructor?.fits, (el) => el.size_full()).opacity(this.shown ? 1 : 0).transition("opacity", EASE).child(body);
  }
}

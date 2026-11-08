// Kanso's side panels, by jlopezlira (https://github.com/jlopezlira/herdr-kanso). Apache-2.0.
// Herdr lets a mod import its own files, not another's, so the panels live in one mod.
import { View, div } from "gpui-kit";
import { props } from "herdr";
import { Files } from "./files.js";
import { PullRequest } from "./pr.js";
import { Preview } from "./preview.js";
import { Shipped } from "./shipped.js";
import { Worktrees } from "./worktrees.js";
import { Ports } from "./ports.js";
import { Look } from "./look.js";

const PANELS = { files: Files, pr: PullRequest, preview: Preview, shipped: Shipped, worktrees: Worktrees, ports: Ports, look: Look };

export default class Panel extends View {
  init(_props, cx) {
    const p = props() ?? {};
    const Impl = PANELS[p.panel] ?? Files;
    this.panel = new Impl();
    this.panel.init(cx, p);
    // The opacity must change between frames for GPUI to ease the fade.
    this.shown = false;
    cx.timer.after(16, (cx) => { this.shown = true; cx.notify(); });
  }

  render(cx) {
    return div().size_full().opacity(this.shown ? 1 : 0).transition("opacity", { duration: 180, easing: "ease-out" }).child(this.panel.render(cx));
  }
}

import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { run, theme, shared } from "herdr";
import { G, tokens } from "./ui.js";
import { sizedPage, listBones } from "./ui-page.js";
import { row } from "./ui-row.js";
import { iconButton } from "./ui-button.js";
import { aliasText, machineTitle } from "./pure.js";
import { EVERY_MS, LOW } from "./caffeine-model.js";

const LOOKS = "kanso.caffeine";
const turn = (key, on) => () => run(`kanso-spaces.caffeine-${on ? "on" : "off"}:${key}`);
const readAll = () => run("kanso-spaces.caffeine-read");

export const caffeineWord = ({ on, busy, want, battery, read, setup }) => {
  if (busy) return want ? "Turning on…" : "Turning off…";
  if (setup) return "Waiting for the password in its tab";
  if (!read) return "Not read yet";
  if (on) return "On";
  return battery ? `Off: battery at ${LOW}%` : "Off";
};

export const caffeineVerbs = (key, look) => {
  if (look.busy) return [];
  if (!look.read && !look.setup) return [{ label: "Read again", onClick: readAll }];
  return [{ label: look.on ? "Turn off" : "Turn on", onClick: turn(key, !look.on) }];
};

export class Caffeine {
  init(cx) {
    this.width = 368;
    readAll();
    cx.timer.every(EVERY_MS, () => readAll());
  }

  computers() {
    const looks = shared(LOOKS) ?? {};
    const alias = shared("kanso.alias");
    return Object.entries(looks).map(([key, look]) => ({ key, look, title: machineTitle(key, "", aliasText(alias, key)) }))
      .toSorted((a, b) => (a.key === "" ? -1 : b.key === "" ? 1 : a.title.localeCompare(b.title)));
  }

  skeleton(c) { return listBones(c); }

  render() {
    const c = tokens(theme()), narrow = (this.width || 368) < 560;
    const list = this.computers();
    const header = h_flex().w_full().items_center().justify_between().gap(G.md)
      .child(div().text_size(narrow ? 17 : 20).text_color(c.text).child("Caffeine"))
      .child(iconButton("cf-refresh", "refresh-cw", "Read again", readAll, c));
    const body = list.length
      ? v_flex().w_full().gap(G.hair).children(list.map(({ key, look, title }) => row(`cf-${key || "here"}`, c, {
        name: title, detail: caffeineWord(look), verbs: caffeineVerbs(key, look), pending: look.busy,
      })))
      : this.skeleton(c);
    return sizedPage.call(this, v_flex().id("kanso-caffeine").size_full().min_h(0).bg(c.canvas).text_color(c.text).overflow_y_scrollbar(), narrow, (column) => column
      .child(header)
      .child(body));
  }
}

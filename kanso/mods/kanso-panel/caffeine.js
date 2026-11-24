import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { run, theme, shared } from "herdr";
import { G, T, tokens } from "./ui.js";
import { scrollPage, listBones, heroStack, heroHeading } from "./ui-page.js";
import { row } from "./ui-row.js";
import { iconButton } from "./ui-button.js";
import { toggleSwitch } from "./ui-toggle.js";
import { metric } from "./kit.js";
import { section } from "./ui-section.js";
import { aliasText, machineTitle } from "./pure.js";
import { EVERY_MS, LOW } from "./caffeine-model.js";

const LOOKS = "kanso.caffeine";
const turn = (key, on) => run(`kanso-spaces.caffeine-${on ? "on" : "off"}:${key}`);
const readAll = () => run("kanso-spaces.caffeine-read");

export const caffeineWord = ({ on, busy, want, battery, read, setup }) => {
  if (busy) return want ? "Turning on…" : "Turning off…";
  if (setup) return "Waiting for the password in its tab";
  if (!read) return "Not read yet";
  if (on) return "Kept awake";
  return battery ? `Off: battery reached ${LOW}%` : "Sleeps as usual";
};

const toneOf = ({ on, busy, battery, read }) => (busy || !read ? null : on ? "done" : battery ? "blocked" : null);

export const caffeineVerbs = (look) => (!look.busy && !look.read && !look.setup ? [{ label: "Read again", onClick: readAll }] : []);

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

  hero(c, list) {
    const awake = list.filter(({ look }) => look.read && look.on).length;
    const unread = list.filter(({ look }) => !look.read && !look.busy).length;
    const facts = [unread ? `${unread} not read yet` : "", "Lid closed too on macOS and Linux", `Off by itself at ${LOW}% on battery`, "Off after a restart"];
    return heroStack(heroHeading()
      .child(div().text_size(T.title).text_color(c.muted).child("Kept awake"))
      .child(metric({ value: unread === list.length ? "–" : String(awake), unit: `of ${list.length} ${list.length === 1 ? "computer" : "computers"}`, tone: awake ? "done" : "", facts: facts.filter(Boolean).join(" | ") })("cf-metric", c)));
  }

  computer(c, { key, look, title }) {
    const id = `cf-${key || "here"}`;
    return row(id, c, {
      icon: key ? "server" : "monitor", name: title, names: true,
      detail: { text: caffeineWord(look), tone: toneOf(look) },
      verbs: caffeineVerbs(look), pending: look.busy,
      tools: [toggleSwitch(`${id}-switch`, look.busy ? look.want : look.read && look.on, (next) => turn(key, next), c, { label: `Caffeine on ${title}`, disabled: look.busy || (!look.read && !look.setup) })],
    });
  }

  skeleton(c) { return listBones(c); }

  render() {
    const c = tokens(theme()), narrow = (this.width || 368) < 560;
    const list = this.computers();
    const header = h_flex().w_full().items_center().justify_between().gap(G.md)
      .child(div().text_size(narrow ? 17 : 20).text_color(c.text).child("Caffeine"))
      .child(iconButton("cf-refresh", "refresh-cw", "Read again", readAll, c));
    return scrollPage.call(this, "kanso-caffeine", c, narrow, (column) => column
      .child(header)
      .when(!list.length, (el) => el.child(this.skeleton(c)))
      .when(list.length > 0, (el) => el
        .child(this.hero(c, list))
        .child(v_flex().w_full().gap(G.hair).child(section(c, "Computers", "")).children(list.map((computer) => this.computer(c, computer))))));
  }
}

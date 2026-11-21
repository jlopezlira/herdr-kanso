import { div } from "gpui-kit";
import { v_flex } from "gpui-base";
import { appHome } from "herdr";
import { localService } from "./platform-host.js";
import { paths } from "./platform-paths.js";
import { imageApi } from "./platform-images.js";
import { G, T } from "./ui.js";
import { avatar, tile } from "./ui-avatar.js";
import { row } from "./ui-row.js";
import { tryOrAsync } from "./pure.js";

const REPO = "https://github.com/jlopezlira/herdr-kanso";
const PLACES = [
  { id: "herdr", name: "Herdr", note: "The app kansō runs in", url: "https://herdr.dev" },
  { id: "kanso", name: "kansō", note: "Source, releases and issues", url: REPO },
  { id: "lucide", name: "Lucide", note: "Toolbar icons (ISC)", url: "https://lucide.dev" },
];
const PEOPLE = [
  { login: "jlopezlira", name: "JJ" },
  { login: "icampana", name: "Iván Campaña" },
  { login: "leangseu", name: "Leangseu Kim" },
  { login: "h0ru5", name: "Johannes Hund" },
];
const AVATARS_DIR = "data/kanso-settings/avatars";

export async function readAvatars() {
  const r = await tryOrAsync(() => localService(imageApi).avatars(paths.join(appHome(), AVATARS_DIR), PEOPLE.map((p) => p.login)));
  return new Set((r?.stdout ?? "").split("\n").filter(Boolean));
}

export function creditsPage(c, avatars) {
  const link = (id, start, title, note, url) => row(`credit-${id}`, c, {
    start, name: title, second: note, meta: url.replace(/^https:\/\//, ""), flag: "external-link", onClick: (cx) => cx.open_url(url),
  });
  const heading = (text) => row(`credits-${text}`, c, { name: text, heading: true }).mt(G.lg);
  return v_flex().w_full()
    .child(div().text_size(T.value).line_height(1.5).text_color(c.muted).child("kansō is a layout for Herdr, made in the open."))
    .child(heading("Where it comes from"))
    .children(PLACES.map((p) => link(p.id, [tile(c, { initial: p.name, image: p.id === "herdr" ? "frame/welcome/herdr.png" : null, size: "lg" })], p.name, p.note, p.url)))
    .child(heading("Made by"))
    .children(PEOPLE.map((p) => link(p.login, [avatar(c, { initial: p.name, image: avatars?.has(p.login) ? `${AVATARS_DIR}/${p.login}.jpg` : null, size: "lg" })],
      p.name, `@${p.login} on GitHub`, `https://github.com/${p.login}`)));
}

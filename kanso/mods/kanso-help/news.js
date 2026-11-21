import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { appHome, readTextFile, writeTextFile } from "herdr";
import { localService } from "./platform-host.js";
import { paths } from "./platform-paths.js";
import { fileApi } from "./platform-files.js";
import { G, T, TINT, alpha } from "./ui.js";
import { dot } from "./ui-dot.js";
import { skeletonOf } from "./kit.js";
import { parseChangelog, plain } from "./changelog.js";
import { compareReleases } from "./release.js";
import { tryOrAsync } from "./pure.js";

const CHANGELOG_URL = "https://raw.githubusercontent.com/jlopezlira/herdr-kanso/main/CHANGELOG.md";
const CACHE_DIR = ["data", "kanso-settings"];

export const NEWS_LOADING = { entries: null, error: null, from: null };

export async function readNews() {
  const dir = paths.join(appHome(), ...CACHE_DIR), cache = paths.join(dir, "CHANGELOG.md");
  const fresh = await tryOrAsync(async () => { const r = await fetch(CHANGELOG_URL); return r.ok ? await r.text() : null; });
  if (fresh) await tryOrAsync(async () => { await localService(fileApi).mkdir(dir); await writeTextFile(cache, fresh, await readTextFile(cache)); });
  const kept = fresh ? null : await tryOrAsync(() => readTextFile(cache));
  const text = fresh || kept, from = fresh ? "github" : kept ? "cache" : null;
  return text ? { entries: parseChangelog(text), error: null, from } : { entries: [], error: "GitHub could not be reached, and nothing was kept from before.", from: null };
}

const releaseTag = (c, rel) => div().px(6).h(18).rounded_full().bg(alpha(rel === 0 ? c.green : c.accent, TINT.soft)).flex().items_center()
  .text_size(T.micro).font_medium().text_color(rel === 0 ? c.green : c.accent).child(rel === 0 ? "installed" : "newer than yours");

const release = (c, e, have) => {
  const rel = have ? compareReleases(e.version, have) : null;
  return v_flex().id(`news-${e.version}`).w_full().pt(G.lg).gap(G.xs)
    .child(h_flex().w_full().gap(G.sm).items_baseline()
      .child(div().text_size(T.title).font_medium().text_color(c.text).child(e.version))
      .when(Boolean(e.date), (el) => el.child(div().text_size(T.body).text_color(c.dim).child(e.date)))
      .when(rel !== null && rel >= 0, (el) => el.child(releaseTag(c, rel))))
    .children(e.sections.map((s) => v_flex().w_full().pt(G.xs).gap(G.xs)
      .child(div().text_size(T.body).text_color(c.dim).child(s.name))
      .children(s.items.map((item) => h_flex().w_full().gap(G.sm).items_start()
        .child(dot(c, "dim", "sm").mt(G.sm))
        .child(div().flex_1().min_w(0).text_size(T.value).line_height(1.5).text_color(c.muted).child(plain(item)))))));
};

export const newsPage = (c, { entries, error, from }, have) => v_flex().w_full()
  .when(entries === null, (el) => el.child(skeletonOf({ shape: "line", count: 4 })("kanso-skeleton", c)))
  .when(Boolean(error), (el) => el.child(div().text_size(T.value).text_color(c.red).child(error)))
  .when(from === "cache", (el) => el.child(div().text_size(T.body).text_color(c.dim).child("GitHub could not be reached; this is the last copy read.")))
  .children((entries ?? []).map((e) => release(c, e, have)));

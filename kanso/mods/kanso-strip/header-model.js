// The pane header's pure model: what folds as the pane narrows, which tools are out, what ⋯ holds and which place is news.
import { G, H, T, W, ICON, ICON_ROW, ICON_INLINE } from "./ui.js";
import { ACTIONS, ORDER, wordsOf } from "./context-menu.js";

// A step is shown until the header folds that far; the order lives only here.
export const FOLDS = ["nothing", "folder", "branch", "tools into ⋯", "commits", "files", "verdict word", "PR", "close into ⋯"];
export const shownAt = (fold, step) => fold < FOLDS.indexOf(step);
export const NAME_LIMIT = 40;

// An average glyph is about this share of its font size, so a header folds before its words would overlap.
const GLYPH = 0.6;
export const textWidth = (text, size) => Math.ceil(String(text ?? "").length * size * GLYPH);

// The least fold whose shown steps fit `room`: `base` never folds, `widths` holds each step's width. Past the last, the name truncates.
export const foldFor = (room, base, widths) => {
  const need = (fold) => base + FOLDS.slice(fold + 1).reduce((sum, step) => sum + (widths[step] ?? 0), 0);
  const fits = FOLDS.findIndex((_step, fold) => need(fold) <= room);
  return fits < 0 ? FOLDS.length - 1 : fits;
};

const segment = (inner) => (inner ? G.sm + G.xs * 2 + inner : 0);
const words = (...parts) => parts.filter(Boolean).reduce((sum, text, i) => sum + (i ? G.sm : 0) + textWidth(text, T.body), 0);
const place = (text) => (text ? ICON_INLINE + G.sm + Math.min(textWidth(text, T.value), W.paneSegment) : 0);
const tool = H.icon + G.hair;

/** What the header needs at each fold. `out`: Sleep and Send resting out; `hover`: the tools are up. */
export function headerWidths({ name, place: where = {}, digest = [], pinned = false, out = 0, hover = false, mark = false }) {
  const part = (kind) => digest.find((seg) => seg.kind === kind);
  const files = part("files"), commits = part("commits"), pr = part("pr"), failure = part("failure");
  // The failure line never folds: the mark, our words and Refresh.
  const failed = failure ? G.sm + ICON_ROW + G.sm + textWidth(failure.text, T.value) + G.sm + G.sm * 2 + textWidth("Refresh", T.body) : 0;
  const base = G.hair * 2 + G.md + G.sm + ICON + G.sm + Math.min(textWidth(name, T.value), W.paneName) + failed
    + (pinned ? G.sm + ICON_INLINE : 0) + out * tool + (hover ? G.sm + tool : 0) + (mark ? G.sm + ICON_ROW : 0);
  return {
    base,
    widths: {
      folder: segment(place(where.folder)),
      branch: segment(place(where.branch)),
      "tools into ⋯": hover ? tool * 2 : 0,
      commits: segment(commits && words(commits.count)),
      files: segment(files && words(files.count, files.diff)),
      "verdict word": pr?.verdict ? G.sm + words(`· ${pr.verdict}`) : 0,
      PR: segment(pr && words(pr.number)),
      "close into ⋯": hover ? tool : 0,
    },
  };
}

/** Sleep and Send rest out on a focused agent that finished or idles; otherwise they wait in ⋯, and a blocked one has no Send. */
export function headerTools({ focused, status, canSend, canSleep }) {
  const out = Boolean(focused) && (status === "done" || status === "idle");
  const where = (can) => (can ? (out ? "out" : "menu") : "hidden");
  return { sleep: where(canSleep), send: where(canSend && status !== "blocked") };
}

/** The tools under the pointer at this fold: split right and wider or narrower in the strip, then close. ⋯ always follows. */
export function hoverTools({ fold, strip }) {
  return [
    ...(shownAt(fold, "tools into ⋯") ? ["split-right", ...(strip ? ["width"] : [])] : []),
    ...(shownAt(fold, "close into ⋯") ? ["close"] : []),
  ];
}

export const PIECE_LINES = ["needed", "hide", "settings"];

const ACT = { sleep: "sleep-agent", close: "close-pane" };
export const actOf = (key) => ACT[key] ?? key;
const byAction = (a, b) => ORDER.indexOf(actOf(a)) - ORDER.indexOf(actOf(b));

/** What ⋯ holds: what is not out and the tools folded away, in every menu's order, then the piece lines. */
export function menuEntries({ strip, pinned, zoomed, tools, fold, canOpen }) {
  const out = hoverTools({ fold, strip });
  const folded = hoverTools({ fold: 0, strip }).filter((key) => !out.includes(key));
  const acts = [
    ...(strip ? [pinned ? "unpin" : "pin"] : []),
    ...(tools.sleep === "menu" ? ["sleep"] : []),
    ...(tools.send === "menu" ? ["send"] : []),
    ...(canOpen ? ["open-with"] : []),
    "split-down",
    zoomed ? "unzoom" : "zoom",
    ...folded,
  ];
  return [...acts.sort(byAction), "separator", ...PIECE_LINES];
}

const bare = (path) => String(path ?? "").replace(/\/+$/, "");

/** The folder and branch, each only when it differs from the tab's project; a project with no folder starts at home. */
export function placeOf({ cwd, branch }, project, home) {
  const root = bare(project?.folder) || bare(home);
  return {
    folder: cwd && bare(cwd) !== root ? cwd : null,
    branch: branch && branch !== project?.branch ? branch : null,
  };
}

/** A pane with no agent and no project is a Terminal; any other keeps the name it has. */
export const paneLabel = ({ agent, cwd, given, name }) => given || (agent || cwd ? name : "Terminal");

/** Each tool and ⋯ entry: its icon in kanso-chrome's icons and its words. */
const toolLook = (key) => [ACTIONS[actOf(key)].icon, wordsOf(actOf(key))];
export const ENTRIES = {
  ...Object.fromEntries(["pin", "unpin", "sleep", "send", "open-with", "split-down", "zoom", "unzoom", "split-right", "width", "close"].map((key) => [key, toolLook(key)])),
  needed: ["check", "Only when needed"], hide: ["eye-off", "Hide this"], settings: ["sliders-vertical", "Settings for this…"],
};

// The piece lines in ⋯ act on what the header reads, together; Settings opens the header's group.
export const DIGEST_PIECES = ["header.digest", "header.pr"];
export const PIECE_GROUP = "Pane header";

const MARKS = { working: "working", blocked: "blocked", done: "done" };
/** Working, waiting and done are their marks; a computer out of reach shows none. */
export const headerMark = (status, away) => (away ? null : MARKS[status] ?? null);

/** The pull request's tooltip keeps what the header folded away: commits, files, then its verdict. */
export function prTitle(digest, fold) {
  const part = (kind) => digest.find((seg) => seg.kind === kind);
  return [!shownAt(fold, "commits") && part("commits")?.count, !shownAt(fold, "files") && part("files")?.count, part("pr")?.tip].filter(Boolean).join(" · ");
}

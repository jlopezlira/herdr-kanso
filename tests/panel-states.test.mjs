import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { JSDOM } from "jsdom";
import { panelPages } from "../stories/kit/panel-states.js";

const drawn = (page, view) => {
  assert.ok(panelPages[page].states.some(({ label }) => label === view), `${page} has no state named ${view}`);
  return new JSDOM(panelPages[page].markup({ view })).window.document;
};
const eachSpend = (views, check) => Object.entries(views).forEach(([view, expected]) => check(drawn("Panels/Spend", view), expected, view));
const texts = (document, selector) => [...document.querySelectorAll(selector)].map((node) => node.textContent);

test("Spend draws every period selected, with that period's total and rows", () => {
  const periods = {
    "Pointer on today": ["Today", "$41.20", "$28.40"],
    Month: ["Month", "$824.00", "$568.00"],
    "30 days": ["30 days", "$1,236.00", "$852.00"],
    Year: ["Year", "$9,888.00", "$6,816.00"],
    "All time": ["All time", "$14,832.00", "$10,224.00"],
  };
  eachSpend(periods, (document, [segment, total, project], view) => {
    assert.deepEqual(texts(document, ".kanso-tabs__tab--on"), [segment], view);
    assert.deepEqual(texts(document, ".kanso-metric--sm .kanso-metric__value"), [total], view);
    assert.equal(texts(document, ".kanso-row").find((row) => row.startsWith("acme-shop")), `acme-shop${project}`, view);
  });
});

test("Spend history says what each day cost, on the whole panel, a project and a task", () => {
  const scopes = {
    "History open": ["Nov 5 · $45.00 · 1,080,000 tokens", "$45.00"],
    "A project’s History": ["Nov 5 · $30.00 · 720,000 tokens", "$30.00"],
    "A task’s History": ["Nov 5 · $20.00 · 480,000 tokens", "$20.00"],
    "History, nothing that period": ["Nov 5 · $0.00 · 0 tokens", null],
  };
  eachSpend(scopes, (document, [peakDay, peak], view) => {
    const days = [...document.querySelectorAll(".kanso-bars__slot")];
    assert.equal(document.querySelector(".kanso-bars__plot").getAttribute("aria-label"), "API value per day", view);
    assert.equal(days.length, 13, view);
    assert.equal(days[4].getAttribute("aria-label"), peakDay, view);
    assert.equal(days[2].getAttribute("aria-label"), "Nov 3 · $0.00 · 0 tokens", view);
    assert.ok(days.every((day) => day.querySelector("title").textContent === day.getAttribute("aria-label")), view);
    assert.equal(document.querySelector(".kanso-bars__label")?.textContent ?? null, peak, view);
  });
});

test("New worktree offers what opens in it, Claude, Codex or Terminal, after the path", () => {
  const dialog = drawn("Panels/Worktrees", "New worktree from here").querySelector(".kanso-dialog");
  assert.deepEqual(texts(dialog, ".kanso-tabs__tab"), ["Claude", "Codex", "Terminal"]);
  assert.deepEqual(texts(dialog, ".kanso-tabs__tab--on"), ["Claude"]);
  assert.match(dialog.textContent, /rate-limit-v2~\/\.kanso\/worktrees\/acme-shop\/rate-limit-v2ClaudeCodexTerminalCancelCreate$/);
});

test("A refused new worktree keeps its dialog: the branch, git's words, the launch choice and Create", () => {
  const dialog = drawn("Panels/Worktrees", "New worktree refused, in git’s words").querySelector(".kanso-dialog");
  assert.equal(dialog.querySelector(".kanso-field--invalid").textContent, "cart-retry");
  assert.deepEqual(texts(dialog, ".kanso-sentence--blocked"), ["'cart-retry' is already checked out at ~/acme-shop-cart"]);
  assert.deepEqual(texts(dialog, ".kanso-tabs__tab, .kanso-button"), ["Claude", "Codex", "Terminal", "Cancel", "Create"]);
});

test("Credits draws its avatars loading apart from its avatars unavailable", () => {
  const people = ["JJ@jlopezlira on GitHub", "Iván Campaña@icampana on GitHub", "Leangseu Kim@leangseu on GitHub", "Johannes Hund@h0ru5 on GitHub"];
  const faces = (view) => [...drawn("Panels/Settings", view).querySelectorAll(".kanso-row:has(.kanso-avatar)")];
  const pending = faces("Credits, avatars loading");
  const unavailable = faces("Credits, avatars unavailable");
  assert.deepEqual(pending.map((row) => row.textContent), people);
  assert.ok(pending.every((row) => row.querySelector('.kanso-avatar.kanso-skeleton.kanso-skeleton--breathing[aria-label="Avatar loading"]')));
  assert.deepEqual(unavailable.map((row) => row.textContent), people.map((person) => `${person[0]}${person}`));
  assert.equal(unavailable.filter((row) => row.querySelector(".kanso-skeleton")).length, 0);
});

test("Find says the conversation was cleared when it searches again, and not on the first read", () => {
  const again = drawn("Panels/Find", "Conversation cleared, searching again");
  assert.equal(again.querySelector(".kanso-field__editor").textContent, "Retry-After");
  assert.deepEqual(texts(again, ".kanso-sentence"), ["Conversation cleared · searching again…"]);
  assert.ok(again.querySelector('.kanso-skeleton--breathing[role="status"]'));
  assert.deepEqual(texts(again, '.kanso-button--icon[aria-disabled="true"]').length, 2);
  assert.doesNotMatch(drawn("Panels/Find", "Reading the conversation").body.textContent, /cleared/);
});

test("Each state develop drew that had no drawing of its own says what set it apart", () => {
  const said = (document) => `${document.body.textContent} ${[...document.querySelectorAll("[aria-label],[title]")].map((node) => node.getAttribute("aria-label") ?? node.getAttribute("title")).join(" ")}`;
  const restored = [
    ["Panels/Ports", "Every computer, each under its name", /All computers.*dark.*:6006.*light1:5174docs.*Go to docs/],
    ["Panels/Ports", "A computer out of reach, on one line", /light · unreachablebuild · lsof is not installed/],
    ["Panels/Ports", "Force stop, armed", /Force stopPress again to force stop/],
    ["Panels/Memory", "Restarting the window refused", /Couldn’t restart the windowThe window did not stop; it was not reopened\.Restart windowExplain to checkout/],
    ["Panels/Memory", "Guard paused", /3 restarts in the last hour\. Automatic restarts are paused for an hour\./],
    ["Panels/Memory", "Its memory over time", /Memory rising from 420 MB to 980 MB/],
    ["Panels/Preview", "Markdown, a new block at the end", /docs · Edited.*Rollout/],
    ["Panels/Shipped", "No records yet", /No records yet/],
    ["Panels/Shipped", "The streak, clicked", /4 contributions on Mon, week 1/],
    ["Panels/Shipped", "When you ship and Computers, open", /Commits per hour.*15:00 · 50 commits/],
    ["Panels/Simulator", "The picture stalled", /as of 12s ago·emulator not answering.*Reconnect/],
    ["Panels/Simulator", "A URL with no scheme", /Enter a URL with a scheme, such as acme-shop:\/\/checkout\./],
    ["Panels/Spend", "History, nothing that period", /HistoryNo usage this period/],
  ];
  for (const [page, view, words] of restored) assert.match(said(drawn(page, view)), words, view);
  assert.ok(drawn("Panels/Preview", "Markdown, a new block at the end").querySelector(".kanso-markdown > :last-child[class*='--editing'], .kanso-markdown > :last-child [contenteditable]"));
  assert.ok(drawn("Panels/Simulator", "A URL with no scheme").querySelector(".kanso-field--invalid"));
});

test("Three notes keep the chosen point and Clear, the disk split its five verdicts, the calendar both streaks", () => {
  const notes = drawn("Panels/Pins", "Three notes: one under the pointer, one chosen");
  assert.deepEqual(texts(notes, ".kanso-annotation__layer .kanso-annotation"), ["1", "2", "3"]);
  assert.deepEqual(texts(notes, ".kanso-annotation__layer .kanso-annotation--hover, .kanso-annotation__layer .kanso-annotation--selected"), ["2", "3"]);
  assert.match(notes.querySelector(".kanso-row--selected").textContent, /^3/);
  assert.deepEqual(texts(notes, ".kanso-button--solid, .kanso-button--quiet"), ["Send to checkout", "Clear 3 pins"]);
  const split = texts(drawn("Panels/Worktrees", "Where the space is: every verdict"), ".kanso-row").filter((row) => row.includes("%"));
  assert.deepEqual(split, ["Can go, losing nothing · 31.1 GB · 45%", "Need a look · 2380 MB · 16%", "In use or open · 2310 MB · 13%", "Left behind · 1520 MB · 21%", "Still checking · 1120 MB · 5%"]);
  const streak = drawn("Panels/Shipped", "The streak, clicked");
  assert.match(streak.body.textContent, /Streaklongest 28 days12days in a row/);
  assert.ok(streak.querySelector(".kanso-metric + .kanso-days, .kanso-row--heading ~ .kanso-days"));
});

test("Every state the map names on a panel page is a kit state there", () => {
  const plans = JSON.parse(readFileSync(new URL("../scripts/storybook-overlaps.json", import.meta.url), "utf8"));
  const named = Object.values(plans).flatMap(({ states }) => Object.values(states)).map((target) => target.split("/"))
    .filter(([source, group, page]) => source === "kit" && panelPages[`${group}/${page}`]);
  const missing = named.filter(([, group, page, ...label]) => !panelPages[`${group}/${page}`].states.some((state) => state.label === label.join("/")));
  assert.ok(named.length > 150, `${named.length} named`);
  assert.deepEqual(missing.map((parts) => parts.join("/")), []);
});

test("Ports opened from the status bar selects the row and puts focus on Stop, before any stop", () => {
  const document = drawn("Panels/Ports", "From the status bar: the row is selected and Stop has focus");
  assert.deepEqual(texts(document, ".kanso-status-bar__item--open"), [":6006 no pane"]);
  assert.match(document.querySelector(".kanso-row.kanso-control--selected").textContent, /^:6006/);
  assert.deepEqual(texts(document, ".kanso-control--focus"), ["Stop"]);
  assert.equal(document.querySelector(".kanso-state-block"), null);
  assert.doesNotMatch(document.body.textContent, /Force stop|Couldn’t stop/);
});

test("A rotated or narrow device is sized after the upright default, so its own size wins", () => {
  const css = readFileSync(new URL("../stories/primitives.css", import.meta.url), "utf8");
  const upright = css.indexOf(".kanso-simulator__screen:has(>.kanso-simulator__app)");
  const column = css.indexOf(".kanso-simulator__app>.kanso-simulator__lines{flex-direction:column}");
  assert.ok(upright > 0 && column > 0);
  for (const later of [".kanso-simulator--narrow .kanso-simulator__screen{", ".kanso-simulator--rotated .kanso-simulator__screen{", ".kanso-simulator--rotated .kanso-simulator__lines{"]) {
    assert.ok(css.indexOf(later) > Math.max(upright, column), later);
  }
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { JSDOM } from "jsdom";
import { panelPages } from "../stories/kit/panel-states.js";

const drawn = (page, view) => {
  assert.ok(panelPages[page].states.some(({ label }) => label === view), `${page} has no state named ${view}`);
  return new JSDOM(panelPages[page].markup({ view })).window.document;
};
const texts = (document, selector) => [...document.querySelectorAll(selector)].map((node) => node.textContent);

test("Spend draws every period selected, with that period's total and rows", () => {
  const periods = {
    "Pointer on today": ["Today", "$41.20", "$28.40"],
    Month: ["Month", "$824.00", "$568.00"],
    "30 days": ["30 days", "$1,236.00", "$852.00"],
    Year: ["Year", "$9,888.00", "$6,816.00"],
    "All time": ["All time", "$14,832.00", "$10,224.00"],
  };
  for (const [view, [segment, total, project]] of Object.entries(periods)) {
    const document = drawn("Panels/Spend", view);
    assert.deepEqual(texts(document, ".kanso-tabs__tab--on"), [segment], view);
    assert.deepEqual(texts(document, ".kanso-metric--sm .kanso-metric__value"), [total], view);
    assert.equal(texts(document, ".kanso-row").find((row) => row.startsWith("acme-shop")), `acme-shop${project}`, view);
  }
});

test("Spend history says what each day cost, on the whole panel, a project and a task", () => {
  const scopes = {
    "History open": ["Nov 5 · $45.00 · 1,080,000 tokens", "$45.00"],
    "A project’s History": ["Nov 5 · $30.00 · 720,000 tokens", "$30.00"],
    "A task’s History": ["Nov 5 · $20.00 · 480,000 tokens", "$20.00"],
    "History, nothing that period": ["Nov 5 · $0.00 · 0 tokens", null],
  };
  for (const [view, [peakDay, peak]] of Object.entries(scopes)) {
    const document = drawn("Panels/Spend", view);
    const days = [...document.querySelectorAll(".kanso-bars__slot")];
    assert.equal(document.querySelector(".kanso-bars__plot").getAttribute("aria-label"), "API value per day", view);
    assert.equal(days.length, 13, view);
    assert.equal(days[4].getAttribute("aria-label"), peakDay, view);
    assert.equal(days[2].getAttribute("aria-label"), "Nov 3 · $0.00 · 0 tokens", view);
    assert.ok(days.every((day) => day.querySelector("title").textContent === day.getAttribute("aria-label")), view);
    assert.equal(document.querySelector(".kanso-bars__label")?.textContent ?? null, peak, view);
  }
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

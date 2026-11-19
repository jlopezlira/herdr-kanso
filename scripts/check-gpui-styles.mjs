#!/usr/bin/env node
import { chromium } from "playwright";
import { compile, read, SHEETS } from "./css-to-gpui.mjs";
import { viewOf, stylesFor, unsupportedFor } from "../kanso/mods/kanso-panel/ui-match.js";
import { toHtml } from "../stories/kit/tree.js";

const PROPS = {
  w: ["width", (v) => `${v}px`], h: ["height", (v) => `${v}px`], gap: ["column-gap", (v) => `${v}px`],
  px: [["padding-left", "padding-right"], (v) => `${v}px`], py: [["padding-top", "padding-bottom"], (v) => `${v}px`],
  pl: ["padding-left", (v) => `${v}px`], pr: ["padding-right", (v) => `${v}px`], pt: ["padding-top", (v) => `${v}px`], pb: ["padding-bottom", (v) => `${v}px`],
  mx: [["margin-left", "margin-right"], (v) => `${v}px`], my: [["margin-top", "margin-bottom"], (v) => `${v}px`],
  ml: ["margin-left", (v) => `${v}px`], mr: ["margin-right", (v) => `${v}px`], mt: ["margin-top", (v) => `${v}px`], mb: ["margin-bottom", (v) => `${v}px`],
  rounded: ["border-top-left-radius", (v) => `${v}px`], text_size: ["font-size", (v) => `${v}px`], font_weight: ["font-weight", String],
  min_w: ["min-width", (v) => `${v}px`], max_w: ["max-width", (v) => `${v}px`],
};

const hex = (rgb) => {
  const srgb = rgb.match(/color\(srgb ([\d.]+) ([\d.]+) ([\d.]+)(?: \/ ([\d.]+))?\)/);
  if (srgb) rgb = `rgba(${srgb[1] * 255}, ${srgb[2] * 255}, ${srgb[3] * 255}, ${srgb[4] ?? 1})`;
  const m = rgb.match(/rgba?\(([\d.]+),?\s*([\d.]+),?\s*([\d.]+)(?:,?\s*\/?\s*([\d.]+))?/);
  if (!m) return rgb;
  const a = m[4] === undefined ? "" : Math.round(Number(m[4]) * 255).toString(16).padStart(2, "0");
  return `#${[m[1], m[2], m[3]].map((n) => Math.round(Number(n)).toString(16).padStart(2, "0")).join("")}${a === "ff" ? "" : a}`;
};
const close = (a, b) => {
  const parts = (h) => [1, 3, 5, 7].map((i) => parseInt(h.slice(i, i + 2) || "ff", 16));
  return parts(a).every((v, i) => Math.abs(v - parts(b)[i]) <= 2);
};
const inherited = (node, rules, op) => {
  for (let at = node; at; at = at.parent) {
    const found = stylesFor(at, rules).filter(([name]) => name === op).pop();
    if (found) return found[1];
  }
  return op === "text_color" ? { colour: "text" } : undefined;
};

const expected = (ops) => {
  const out = {};
  for (const [op, value] of ops) {
    if (op === "w_auto") { delete out.width; continue; }
    const entry = PROPS[op];
    if (!entry || typeof value !== "number") continue;
    for (const prop of [entry[0]].flat()) out[prop] = entry[1](value);
  }
  return out;
};

export const checkPiece = async (tree, c) => {
  const { rules, skipped } = compile(SHEETS.map(read).join("\n"));
  const html = toHtml(tree);
  const nodes = [];
  const walk = (list) => { for (const node of list) if (node.tag !== "#text") { nodes.push(node); walk(node.children); } };
  walk(viewOf(tree));
  const untranslated = nodes.flatMap((node) => unsupportedFor(node, skipped).map((miss) => ({ element: `${node.tag}.${node.classes.join(".")}`, ...miss })));
  if (untranslated.length) return { untranslated };
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const css = ["site/tokens.css", ...SHEETS].map(read).join("\n");
  await page.setContent(`<!doctype html><html data-theme="dark"><head><style>${css}</style></head><body><div class="kanso-story__theme"><div class="kanso-sidebar" style="width:256px;padding:0 8px">${html}</div></div></body></html>`);
  const computed = await page.evaluate(() => [...document.querySelectorAll(".kanso-sidebar *")].filter((el) => el.tagName.toLowerCase() !== "use").map((el) => {
    const s = getComputedStyle(el);
    return Object.fromEntries([...s].map((name) => [name, s.getPropertyValue(name)]));
  }));
  await browser.close();
  const real = nodes.filter((node) => node.tag !== "use");
  const differences = [];
  real.forEach((node, i) => {
    const want = expected(stylesFor(node, rules));
    const colourOf = (value) => (value?.colour === undefined ? value : value.colour === null ? "#00000000" : value.share === undefined ? c[value.colour] : `${c[value.colour].slice(0, 7)}${Math.round(value.share * 255).toString(16).padStart(2, "0")}`);
    if (node.tag !== "svg") {
      const ink = colourOf(inherited(node, rules, "text_color"));
      if (!close(ink, hex(computed[i].color))) differences.push({ element: `${node.tag}.${node.classes.join(".")}`, prop: "color", app: ink, storybook: hex(computed[i].color) });
      const size = inherited(node, rules, "text_size");
      if (size !== undefined && `${size}px` !== computed[i]["font-size"]) differences.push({ element: `${node.tag}.${node.classes.join(".")}`, prop: "font-size", app: `${size}px`, storybook: computed[i]["font-size"] });
    }
    const ground = stylesFor(node, rules).filter(([name]) => name === "bg").pop();
    const sbGround = hex(computed[i]["background-color"]);
    const appGround = ground ? colourOf(ground[1]) : "#00000000";
    if (!(appGround === "#00000000" && /00$/.test(sbGround)) && !close(appGround, sbGround)) differences.push({ element: `${node.tag}.${node.classes.join(".")}`, prop: "background", app: appGround, storybook: sbGround });
    for (const [prop, value] of Object.entries(want)) {
      if (computed[i][prop] !== value) differences.push({ element: `${node.tag}.${node.classes.join(".")}`, prop, app: value, storybook: computed[i][prop] });
    }
  });
  return { differences };
};

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const { rowTree } = await import("../stories/kit/row-tree.js");
  const { kansoColours } = await import("../tests/helpers.mjs");
  const c = await kansoColours();
  const project = { icon: "lu-folder", name: "kansō", detail: ["herdr-kanso", { icon: "lu-git-branch", text: "29a4feb" }], actions: [{ icon: "lu-plus", label: "New" }, { icon: "lu-ellipsis", label: "More" }] };
  const CASES = {
    "at rest": project,
    "under the pointer": { ...project, hover: true },
    "the current project": { ...project, current: true },
    "current, under the pointer": { ...project, current: true, hover: true },
    "keyboard on it": { ...project, focus: true },
    "a session with its mark and age": { icon: "lu-bot", name: "Fury", meta: "3m", mark: "working", depth: 1 },
    "dimmed": { ...project, dimmed: true },
  };
  let failed = false;
  for (const [name, props] of Object.entries(CASES)) {
    const result = await checkPiece(rowTree(props), c);
    if (result.untranslated) { failed = true; console.log(`row, ${name}: untranslated`, result.untranslated); continue; }
    if (result.differences.length) { failed = true; console.log(`row, ${name}:`, result.differences); continue; }
    console.log(`row, ${name}: every element matches the Storybook`);
  }
  const { statusItemTree, needsItemTree, failureLineTree, paletteDoorTree, computerItemTree } = await import("../stories/kit/status-bar-tree.js");
  const status = {
    "an item": () => statusItemTree({ icon: "lu-monitor", text: "devbox" }),
    "who needs you": () => needsItemTree({ name: "cart-ui", question: "Which layout?", more: 1 }),
    "layout paused": () => failureLineTree({ text: "Layout paused", fix: "Resume", detail: "layout write refused 3 times" }),
    "a computer you cannot reach": () => computerItemTree({ name: "devbox", state: "unreachable" }),
    "this computer": () => computerItemTree({ name: "This computer", remote: false }),
    "the command palette": () => paletteDoorTree(),
  };
  for (const [name, tree] of Object.entries(status)) {
    const result = await checkPiece(tree(), c);
    if (result.untranslated) { failed = true; console.log(`status, ${name}: untranslated`, result.untranslated); continue; }
    if (result.differences.length) { failed = true; console.log(`status, ${name}:`, result.differences); continue; }
    console.log(`status, ${name}: every element matches the Storybook`);
  }
  const { tabBarTree, tabsTree } = await import("../stories/kit/tab-bar-tree.js");
  const views = [{ key: "spaces", label: "Projects", icon: "lu-folder" }, { key: "agents", label: "Status", icon: "lu-activity", dot: true }, { key: "threads", label: "Threads", icon: "lu-message-square" }];
  const primitive = {
    "on a track, large": { items: views, value: "spaces", size: "lg", track: true, label: true },
    "small, with icons": { items: views, value: "spaces", size: "sm", icon: true, label: true },
    "icons alone, a dot on one": { items: views, value: "spaces", icon: true },
    "off": { items: views, value: "spaces", disabled: true, label: true },
  };
  for (const [name, props] of Object.entries(primitive)) {
    const result = await checkPiece(tabsTree(props), c);
    if (result.untranslated) { failed = true; console.log(`tab, ${name}: untranslated`, result.untranslated); continue; }
    if (result.differences.length) { failed = true; console.log(`tab, ${name}:`, result.differences); continue; }
    console.log(`tab, ${name}: every element matches the Storybook`);
  }
  const doors = [{ key: "files", label: "Files", icon: "lu-file" }, { key: "pr", label: "PR", icon: "lu-git-pull-request" }];
  const tabs = [{ key: "checkout", label: "checkout" }, { key: "cart-ui", label: "cart-ui", mark: "blocked" }, { key: "tests", label: "tests" }];
  const bar = {
    "at rest": { items: tabs, value: "checkout", panels: doors, help: true },
    "panel open": { items: tabs, value: "checkout", panels: doors, panel: "pr" },
    "close armed": { items: [{ ...tabs[0], armed: true }, ...tabs.slice(1)], value: "checkout", panels: doors },
    "renamed, waiting": { items: [{ ...tabs[0], label: "api-limits", pending: true }, ...tabs.slice(1)], value: "checkout", panels: doors },
    "dragging": { items: [tabs[0], { ...tabs[1], drop: true }, { ...tabs[2], held: true }], value: "checkout", panels: doors },
    "folded": { items: tabs, value: "checkout", folded: Array.from({ length: 5 }, (_, i) => ({ label: `f${i}` })), panels: doors },
    "unreachable": { items: tabs, value: "checkout", state: "unreachable" },
    "windows and linux": { items: tabs, value: "checkout", panels: doors, windows: true },
    "dragging a door": { items: tabs, value: "checkout", panels: [{ ...doors[0], drop: true }, { ...doors[1], held: true }] },
    "kansō help, keyboard": { items: tabs, value: "checkout", panels: doors, help: true, focus: "kansō help" },
  };
  for (const [name, props] of Object.entries(bar)) {
    const result = await checkPiece(tabBarTree(props), c);
    if (result.untranslated) { failed = true; console.log(`tab bar, ${name}: untranslated`, result.untranslated); continue; }
    if (result.differences.length) { failed = true; console.log(`tab bar, ${name}:`, result.differences); continue; }
    console.log(`tab bar, ${name}: every element matches the Storybook`);
  }
  if (failed) process.exit(1);
}

#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { chromium } from "playwright";
import { SHEETS } from "./css-to-gpui.mjs";
import { toHtml } from "../stories/kit/tree.js";
import { rowTree } from "../stories/kit/row-tree.js";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const { CASES } = await import(process.argv[2]);
const out = process.argv[3];
const font = process.argv[4] ?? "Geist";
const css = ["site/tokens.css", ...SHEETS].map(read).join("\n");
const rows = CASES.map(([, props]) => `<div style="display:flex;flex-direction:column">${toHtml(rowTree(props))}</div>`).join("");
const sprite = read("stories/proto-sprite.svg");
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 820 }, deviceScaleFactor: 1 });
await page.setContent(`<!doctype html><html data-theme="dark"><head><style>${css} :root{--ui:"${font}",system-ui} body{margin:0;background:var(--surface-0)}</style></head><body>${sprite}<div class="kanso-story__theme" style="padding-top:48px"><div style="width:240px;padding:0 8px;display:flex;flex-direction:column;gap:16px">${rows}</div></div></body></html>`);
await page.waitForTimeout(600);
await page.screenshot({ path: out });
await browser.close();
console.log(out);

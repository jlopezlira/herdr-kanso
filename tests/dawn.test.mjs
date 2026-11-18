import test from "node:test";
import assert from "node:assert/strict";
import { load, nodes, calls, arg, KIT_NIGHT, popoverHost as host, themed, repoText } from "./helpers.mjs";
import { dawnMotion, dawnLayers, DAWN_LAYERS } from "../scripts/build-ui-tokens.mjs";
import { loadTokens } from "../scripts/tokens.mjs";

const kit = async () => themed({
  ...await load("kanso-chrome/header.js", ["header"], host()),
  ...await load("kanso-panel/ui.js", ["tokens", "DAWN", "DAWN_H", "DAWN_W", "DAWN_MOTION"], host()),
}, KIT_NIGHT);
const layerOf = (el, name) => nodes(el).find((kid) => (arg(kid, "image") ?? "").endsWith(`-${name}.svg`)) ?? null;

test("The sky's motion is the Storybook's keyframes, read from its CSS, and its layers are its art", () => {
  const css = repoText("stories/primitives.css"), tokens = loadTokens();
  assert.ok(repoText("kanso/mods/kanso-panel/ui.js").includes(dawnMotion(tokens, css)), "npm run build:ui-tokens leaves the motion as the CSS says");
  const motion = JSON.parse(dawnMotion(tokens, css).replace(/^export const DAWN_MOTION = |;$/g, ""));
  assert.deepEqual(motion.night.opacity, { from: 0.92, to: 0 }, "dwNight");
  assert.deepEqual(motion.sun.top, { from: 17, to: 0 }, "dwSun rises by --k-dawn-rise");
  assert.deepEqual([motion.sun.duration, motion.sun.delay, motion.glow.delay, motion.clouds.delay, motion.horizon.opacity.to], [2600, 200, 500, 1500, 0.55]);
  for (const theme of ["dark", "light"]) {
    const layers = dawnLayers(tokens, theme, css);
    assert.deepEqual(Object.keys(layers), DAWN_LAYERS);
    for (const [layer, art] of Object.entries(layers)) assert.equal(repoText(`kanso/mods/kanso-chrome/dawn-${theme}-${layer}.svg`), art, `${theme} ${layer} is built`);
    assert.doesNotMatch(layers.night.slice(layers.night.indexOf("</defs>")), / opacity=/, "the night carries no still opacity: its motion sets it");
  }
});

test("The sky starts at night and rises to the Storybook's last frame, with its timing", async () => {
  const { header, c, DAWN_H, DAWN_MOTION } = await kit();
  const sky = (state) => header({ dawn: true })("h", { ...c, dawn: { ...c.dawn, sky: { width: 256, run: 1, ...state } } });
  const night = sky({ rising: false, ring: 0 });
  assert.equal(arg(layerOf(night, "night"), "opacity"), DAWN_MOTION.night.opacity.from, "it starts at night");
  assert.equal(arg(layerOf(night, "sun"), "top"), DAWN_MOTION.sun.top.from, "the sun below the horizon");
  const day = sky({ rising: true, ring: 12 });
  assert.equal(arg(layerOf(day, "night"), "opacity"), 0);
  assert.equal(arg(layerOf(day, "sun"), "top"), 0);
  assert.deepEqual(JSON.parse(JSON.stringify(calls(layerOf(day, "sun"), "transition")[0].slice(1))), ["top", { duration: 2600, delay: 200, easing: DAWN_MOTION.sun.easing }]);
  assert.ok(layerOf(day, "ring-12"), "the ring's dash has gone round");
  const wide = header({ dawn: true })("h", { ...c, dawn: { ...c.dawn, sky: { width: 512, run: 1, rising: true, ring: 12 } } });
  assert.equal(arg(layerOf(wide, "sky"), "w"), 512, "the sky fills a wider sidebar");
  assert.equal(arg(layerOf(wide, "sky"), "h"), DAWN_H * 2, "scaled as the Storybook's slice: its top kept, the rest cut");
});

test("Pressing the Dawn Mode pill replays the sunrise; Tab reaches it", async () => {
  const { header, c } = await kit();
  let replays = 0;
  const drawn = header({ dawn: true })("h", c, { presses: { "Dawn Mode": () => { replays += 1; } } });
  const pill = nodes(drawn).find((kid) => calls(kid, "on_click").length && calls(kid, "tooltip").some((call) => call[1] === "Replay the sunrise"));
  assert.ok(pill, "the pill is a button that says what it does");
  calls(pill, "on_click")[0][1]({}, {});
  assert.equal(replays, 1);
});

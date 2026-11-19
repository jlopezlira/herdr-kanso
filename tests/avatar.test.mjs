// The avatar: a round initial on a wash at three token sizes, a picture over it, and a host's hue.
import test from "node:test";
import assert from "node:assert/strict";
import { load, chain, gpuiHost, numberArguments, calls, one, themed } from "./helpers.mjs";

const host = () => ({ ...gpuiHost(), image: (path) => { const el = chain("image"); el.calls.push(["image", path]); return el; } });
const kit = async () => themed({
  ...await load("kanso-panel/ui.js", ["tokens", "mix", "G", "H", "T"], host()),
  ...await load("kanso-panel/ui-avatar.js", ["avatar", "AVATAR_SIZES"], host()),
}, night);

const night = { foreground: "#d8d4cb", background: "#1b1b19", dim: "#6b6862", muted: "#949086", blocked: "#ca938b", working: "#c4b07e", done: "#98ad8f", ansi4: "#93a3b5", ansi5: "#ad9cab" };

test("Small, medium and large are 16, 20 and 32 from the tokens, with the meta size, and the name size when large", async () => {
  const { avatar, AVATAR_SIZES, G, H, T, c } = await kit();
  assert.deepEqual(Object.keys(AVATAR_SIZES), ["sm", "md", "lg"]);
  const expected = { sm: [G.lg, T.body], md: [H.badge, T.body], lg: [H.line, T.card] };
  assert.deepEqual([G.lg, H.badge, H.line], [16, 20, 32]);
  for (const [size, [side, text]] of Object.entries(expected)) {
    const el = avatar(c, { initial: "S", size });
    assert.equal(one(el, "size"), side, size);
    assert.equal(one(el, "text_size"), text, size);
  }
  assert.equal(one(avatar(c, { initial: "S" }), "size"), H.badge, "medium by default");
});

test("An avatar is round, on the 12% wash, and draws the first letter of its initial in the muted colour", async () => {
  const { avatar, c } = await kit();
  const el = avatar(c, { initial: "Sara" });
  assert.equal(calls(el, "rounded_full").length, 1);
  assert.equal(calls(el, "overflow_hidden").length, 1);
  assert.equal(one(el, "bg"), c.w12);
  assert.equal(one(el, "text_color"), c.muted);
  assert.deepEqual(el.kids, []);
  assert.equal(one(el, "child"), "S");
});

test("With an image, the picture covers the initial, which stays beneath it", async () => {
  const { avatar, c } = await kit();
  const el = avatar(c, { initial: "S", image: "avatars/sara.png" });
  assert.deepEqual(calls(el, "child").map((call) => typeof call[1] === "string" ? call[1] : "picture"), ["S", "picture"]);
  const picture = el.kids[0];
  assert.equal(one(picture, "image"), "avatars/sara.png");
  for (const name of ["absolute", "inset_0", "size_full", "rounded_full"]) assert.equal(calls(picture, name).length, 1, name);
});

test("Each host tone colours the letter", async () => {
  const { avatar, mix, c } = await kit();
  const hues = { teal: mix(night.ansi4, night.done, 0.5), yellow: night.working, blue: night.ansi4, violet: night.ansi5, green: night.done, red: night.blocked };
  for (const [tone, color] of Object.entries(hues)) assert.equal(one(avatar(c, { initial: "S", tone }), "text_color"), color, tone);
});

test("The avatar's code has no number of pixels: every size comes from the tokens", () => {
  assert.deepEqual(numberArguments("kanso-panel/ui-avatar.js"), []);
});

import { loadHachiPixels } from "./mod-fixtures.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { clone } from "./helpers.mjs";

const MOODS = ["calm", "glad", "sweat", "sleep"];
const pixels = async () => (await loadHachiPixels()).hachiPixels;

test("every mood of Hachi is a map 16 wide and 15 high", async () => {
  const hachiPixels = await pixels();
  for (const mood of MOODS) {
    const map = hachiPixels(mood);
    assert.equal(map.length, 15, `${mood}: 15 rows`);
    assert.ok(map.every((row) => row.length === 16), `${mood}: 16 columns`);
  }
});

test("Hachi with no mood or an unknown one looks calm", async () => {
  const hachiPixels = await pixels();
  assert.deepEqual(clone(hachiPixels()), clone(hachiPixels("calm")));
  assert.deepEqual(clone(hachiPixels("furious")), clone(hachiPixels("calm")));
});

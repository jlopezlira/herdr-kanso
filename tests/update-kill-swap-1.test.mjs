import { sweepTest } from "./update-harness.mjs";

sweepTest({ first: 1, last: 8, kills: Array(8).fill("old") });

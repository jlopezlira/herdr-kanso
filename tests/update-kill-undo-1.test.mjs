import { sweepTest } from "./update-harness.mjs";

sweepTest({ sabotage: true, first: 1, last: 8, kills: Array(8).fill("old") });

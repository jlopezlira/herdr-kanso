import { sweepTest } from "./update-harness.mjs";

sweepTest({ sabotage: true, first: 9, last: 16, kills: Array(8).fill("old") });

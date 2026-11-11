import { sweepTest } from "./update-harness.mjs";

sweepTest({ sabotage: true, first: 17, last: 24, kills: Array(8).fill("old") });

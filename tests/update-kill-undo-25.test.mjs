import { sweepTest } from "./update-harness.mjs";

sweepTest({ sabotage: true, first: 25, kills: Array(8).fill("old"), end: "before" });

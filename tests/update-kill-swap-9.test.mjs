import { sweepTest } from "./update-harness.mjs";

sweepTest({ first: 9, kills: [...Array(5).fill("old"), ...Array(3).fill("new")], end: "after" });

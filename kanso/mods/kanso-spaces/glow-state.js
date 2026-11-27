import { EASE } from "./ui.js";

export const glowState = (prior, scope, working, now) => {
  const moved = prior?.scope !== scope;
  if (working) return { scope, pose: moved ? "entering" : "working", next: moved ? now : Infinity };
  if (moved && prior?.pose === "working") return { scope, pose: "release", next: now };
  if (prior?.pose === "working" || prior?.pose === "release") return { scope, pose: "leaving", next: now + EASE.duration };
  if (!moved && prior?.pose === "leaving" && prior.next > now) return prior;
  return { scope, pose: "rest", next: Infinity };
};

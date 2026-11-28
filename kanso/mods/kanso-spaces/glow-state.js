import { EASE } from "./ui.js";

export const glowState = (prior, scope, working, now) => {
  const moved = prior?.scope !== scope;
  const frame = (pose, next = Infinity, fade = null) => ({ scope, pose, next, fade });
  if (working) return !prior || (moved && prior.pose !== "working") ? frame("entering", now) : frame("working");
  if (prior?.pose === "working" || prior?.pose === "release" || prior?.pose === "leaving") {
    const until = prior.fade?.until ?? now + EASE.duration;
    if (until > now) {
      const left = until - now;
      const opacity = prior.pose === "leaving" ? prior.fade.opacity * (left / prior.fade.duration) ** 3 : prior.fade?.opacity ?? 1;
      const fade = { until, opacity, duration: left };
      return moved ? frame("release", now, fade) : frame("leaving", until, prior.pose === "leaving" ? prior.fade : fade);
    }
  }
  return frame("rest");
};

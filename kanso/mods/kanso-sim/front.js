// Kanso, by jlopezlira (https://github.com/jlopezlira/herdr-kanso). Apache-2.0.
// A panel that skipped work reads once, on the next turn, when it is in front again.
import { window } from "herdr";

const shown = () => window()?.active !== false;

export class Front {
  constructor(inFront = shown) {
    this.inFront = inFront;
    this.skipped = false;
    this.pending = false;
  }

  behind() { return window()?.active === false; }

  rest() { this.skipped = true; }

  // A timer takes the skip once the panel is in front. render's wake leaves it until that read runs.
  woke() {
    if (!this.skipped || !this.inFront()) return false;
    this.skipped = false;
    return true;
  }

  wake(cx, read) {
    if (!cx || !this.skipped || this.pending || !this.inFront()) return;
    this.pending = true;
    cx.timer.after(0, (next) => {
      this.pending = false;
      if (!this.inFront()) return;
      read(next);
    });
  }
}

// The cap a key press lights for a moment, in the dōjō and on kansō help's keyboard page.
import { LIT_MS } from "./ui.js";

export class Lit {
  constructor() { this.lit = null; }

  // The light goes out on its own timer, and only while it is still the one this press set.
  light(key, cx) {
    const at = Date.now();
    this.lit = { key, at };
    cx.timer.after(LIT_MS, (timerCx) => { if (this.lit?.at === at) { this.lit = null; timerCx.notify(); } });
  }

  on(key) { return this.lit?.key === key; }
}

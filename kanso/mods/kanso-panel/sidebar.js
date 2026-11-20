// The sidebar's machine list and its keys. A lost answer waits, then goes on; it does not spin.
import { bounded } from "./pure.js";

export const KEY_WAIT_MS = 1000;
export const KEY_MISSES = 5;

export class MachineRead {
  constructor() { this.busy = false; }
  start(timer, ms, read) {
    if (this.busy) return null;
    this.busy = true;
    // A failure still ends the job, so the next look and the hold can run.
    return bounded(Promise.resolve().then(read), timer, ms).catch(() => {}).finally(() => { this.busy = false; });
  }
}

// `touch` throws once this build was replaced. Any other throw is one command and the loop stays.
export async function commandTurn(read, touch, act) {
  const live = () => { try { touch(); return true; } catch { return false; } };
  const got = await Promise.resolve().then(read).then((command) => ({ command }), () => null);
  if (!got) return live() ? "miss" : "stop";
  if (!live()) return "stop";
  const acted = await Promise.resolve(got.command).then((command) => act(command)).then(() => true, () => false);
  if (!acted) return live() ? "next" : "stop";
  return "next";
}

class Keys {
  constructor() { this.misses = 0; }
  async run(read, touch, act, timer) {
    for (;;) {
      const step = await commandTurn(read, touch, act);
      if (step === "stop") return;
      if (step === "next") { this.misses = 0; continue; }
      this.misses += 1;
      if (this.misses >= KEY_MISSES) return;
      await new Promise((resolve) => timer.after(KEY_WAIT_MS, resolve));
    }
  }
}

export const commandLoop = (read, touch, act, timer) => new Keys().run(read, touch, act, timer);

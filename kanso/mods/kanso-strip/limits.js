import { hc, terminals, shared } from "herdr";
import { limitStep, parseLimit, foundLabels, limitOf } from "./limits-model.js";
import { armResume, disarmResume, reconcileResumes } from "./clock.js";
import { pieces, runs } from "./pieces.js";

export const AUTO_RESUME = "agents.resume";
const RECONCILE_MS = 60_000;

const label = (address, pairs) => (pairs.length ? hc(["label", address, ...pairs]).catch(() => null) : null);

export class LimitWatch {
  constructor() {
    this.read = new Map();
    this.reconciled = 0;
  }

  watch(list, cx, now = Date.now()) {
    const terms = terminals();
    const byAddress = new Map(terms.map((t) => [t.address, t]));
    const auto = runs(AUTO_RESUME, pieces(shared));
    for (const p of list) {
      const term = byAddress.get(p.terminal);
      if (!term) continue;
      const step = limitStep({ status: p.status, app: p.app, labels: term.labels ?? {} });
      const stop = `${p.status}:${term.turn ?? 0}`;
      if (step.act === "clear") {
        this.read.delete(p.terminal);
        label(p.terminal, step.labels);
        disarmResume(p.terminal);
      } else if (step.act === "read" && this.read.get(p.terminal) !== stop) {
        this.read.set(p.terminal, stop);
        cx.spawn(async () => this.readLimit(p.terminal, auto));
      }
    }
    const shown = new Set(list.map((p) => p.terminal));
    for (const address of [...this.read.keys()]) if (!shown.has(address)) this.read.delete(address);
    if (now - this.reconciled >= RECONCILE_MS) {
      this.reconciled = now;
      cx.spawn(async () => reconcileResumes(terms));
    }
  }

  async readLimit(address, auto) {
    const shot = await hc(["read", address]).catch(() => null);
    if (shot?.code !== 0) return;
    const limit = parseLimit(shot.stdout, Date.now());
    if (!limit) return;
    await label(address, foundLabels(limit, auto));
    if (auto && limit.until) await armResume({ address, until: limit.until }).catch(() => null);
  }
}

export const limitOfTerminal = (address) => limitOf(terminals().find((t) => t.address === address)?.labels);

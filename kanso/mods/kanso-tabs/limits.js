import { hc, terminals, shared, checking } from "herdr";
import { limitStep, parseLimit, foundLabels, READ_TRIES, RETRY_MS } from "./limits-model.js";
import { armResume, disarmResume, reconcileResumes } from "./clock.js";
import { pieces, runs } from "./pieces.js";

const RECONCILE_MS = 60_000;
const live = (t) => !t.state || t.state === "live";
const appOf = (t) => t.report?.app ?? t.app ?? t.agent ?? null;

const label = (address, pairs) => (pairs.length ? hc(["label", address, ...pairs]).catch(() => null) : null);

export class LimitWatch {
  constructor() {
    this.read = new Map();
    this.reconciled = 0;
  }

  due(address, stop, now) {
    const was = this.read.get(address);
    if (!was || was.stop !== stop) return true;
    return !was.found && was.tries < READ_TRIES && now - was.at >= RETRY_MS;
  }

  watch(cx, now = Date.now()) {
    if (checking()) return;
    const terms = terminals().filter(live);
    const auto = runs("agents.resume", pieces(shared));
    for (const term of terms) {
      const step = limitStep({ status: term.status, app: appOf(term), labels: term.labels ?? {} });
      const stop = `${term.status}:${term.turn ?? 0}`;
      if (step.act === "clear") {
        this.read.delete(term.address);
        label(term.address, step.labels);
        disarmResume(term.address);
      } else if (step.act === "read" && this.due(term.address, stop, now)) {
        const was = this.read.get(term.address);
        this.read.set(term.address, { stop, at: now, found: false, tries: was?.stop === stop ? was.tries + 1 : 1 });
        cx.spawn(async () => this.readLimit(term.address, stop, auto));
      }
    }
    const listed = new Set(terms.map((t) => t.address));
    for (const address of [...this.read.keys()]) if (!listed.has(address)) this.read.delete(address);
    if (now - this.reconciled >= RECONCILE_MS) {
      this.reconciled = now;
      cx.spawn(async () => reconcileResumes(terms));
    }
  }

  async readLimit(address, stop, auto) {
    const shot = await hc(["read", address]).catch(() => null);
    if (shot?.code !== 0) return;
    const limit = parseLimit(shot.stdout, Date.now());
    if (!limit) return;
    const was = this.read.get(address);
    if (was?.stop === stop) this.read.set(address, { ...was, found: true });
    await label(address, foundLabels(limit, auto));
    if (auto && limit.until) await armResume({ address, until: limit.until }).catch(() => null);
  }
}

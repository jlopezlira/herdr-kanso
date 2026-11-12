import { serviceFor } from "./platform-host.js";
import { sqliteApi, sqliteLimit, CALL_MS, BUSY_MS } from "./platform-sqlite.js";
import { fileApi } from "./platform-files.js";
import { bounded, LATE } from "./pure.js";

class LostCall extends Error {
  constructor() { super("did not answer"); this.late = true; }
}
export const lostCall = () => new LostCall();

export class Database {
  constructor(timer, file, machine = null) {
    if (typeof timer?.after !== "function") throw new TypeError("A database needs its view's timer");
    this.timer = timer;
    this.file = file;
    this.on = machine;
    this.epoch = 0;
    this.ready = null;
  }

  bound(promise, ms = CALL_MS) {
    const epoch = this.epoch;
    return bounded(promise, this.timer, ms + BUSY_MS).then((result) => {
      if (result !== LATE) return result;
      if (epoch === this.epoch) this.abandon();
      throw lostCall();
    });
  }

  abandon() { this.epoch += 1; this.ready = null; }

  call(factory, ms = CALL_MS) {
    return this.bound(serviceFor(factory, this.on, ms), ms);
  }

  async prepare(dir, missing) {
    const ok = await this.call((_platform, run) => run("sqlite3", ["-version"])).catch((error) => { if (error?.late) throw error; return null; });
    if (ok?.code !== 0) throw new Error(missing);
    await this.call((platform, run) => fileApi(platform, run).mkdir(dir));
  }

  execute(text, options = {}) {
    return this.call((platform, run, write) => sqliteApi(platform, run, write).unchecked(this.file, text, options), sqliteLimit(text));
  }

  async sql(text, json = false) {
    const r = await this.execute(text, { json });
    if (r.code !== 0) throw new Error((r.stderr || "sqlite3 failed").trim().split("\n")[0]);
    return json ? (r.stdout.trim() ? JSON.parse(r.stdout) : []) : r.stdout;
  }

  opening(work) {
    if (this.ready) return this.ready;
    const pending = work().catch((error) => {
      if (this.ready === pending) this.ready = null;
      throw error;
    });
    this.ready = pending;
    return pending;
  }
}

import { q, pruneSinceSql } from "./kdb.js";
import { changes, digest } from "./since-left-model.js";

export class SinceStore {
  constructor(db) { this.db = db; }

  async observe(snapshots, now = Date.now(), seedOnly = false) {
    const sources = await this.db.read("SELECT source, value, at FROM since_observed;");
    const previous = new Map(sources.map((row) => [row.source, row]));
    const unique = [...new Map(snapshots.toReversed().map((snapshot) => [snapshot.source, snapshot])).values()];
    const writes = unique.flatMap(({ source, project, value }) => {
      const row = previous.get(source);
      if (row && (seedOnly || row.at > now)) return [];
      const raw = row?.value;
      const before = raw ? JSON.parse(raw) : null;
      const after = { ...before, ...value };
      const json = JSON.stringify(after);
      if (!project) return [];
      if (raw === json) return [`UPDATE since_observed SET at=MAX(at,${now}) WHERE source=${q(source)} AND value=${q(raw)};`];
      const guard = raw == null ? `NOT EXISTS(SELECT 1 FROM since_observed WHERE source=${q(source)})`
        : `EXISTS(SELECT 1 FROM since_observed WHERE source=${q(source)} AND value=${q(raw)} AND at <= ${now})`;
      const events = changes(before, after).map((event) => `INSERT INTO since_events(project,target,kind,text,at)
        SELECT ${q(project)},${q(after.target)},${q(event.kind)},${q(event.text)},${now} WHERE ${guard};`).join("");
      return [`${events}INSERT INTO since_observed(source,value,at) VALUES(${q(source)},${q(json)},${now})
        ON CONFLICT(source) DO UPDATE SET value=excluded.value,at=excluded.at WHERE ${guard};`];
    });
    if (writes.length) await this.db.run(`BEGIN IMMEDIATE;${writes.join("")}${pruneSinceSql(now)}COMMIT;`);
  }

  async enter(project, now = Date.now()) {
    const [focus] = await this.db.read(`SELECT * FROM since_focus WHERE project=${q(project)};`);
    const events = await this.db.read(`SELECT * FROM since_events WHERE project=${q(project)};`);
    const rows = digest(events, focus, now);
    const pending = rows.length ? JSON.stringify(rows.map((row) => row.id)) : null;
    await this.db.run(`INSERT INTO since_focus(project,focused_at,pending_json) VALUES(${q(project)},${now},${q(pending)})
      ON CONFLICT(project) DO UPDATE SET focused_at=excluded.focused_at,pending_json=excluded.pending_json;`);
    return rows;
  }

  touch(project, now = Date.now()) {
    return this.db.run(`UPDATE since_focus SET focused_at=MAX(focused_at,${now}) WHERE project=${q(project)};`);
  }

  dismiss(project, through) {
    return this.db.run(`UPDATE since_focus SET pending_json=NULL,dismissed_to=MAX(dismissed_to,${through}) WHERE project=${q(project)};`);
  }

  prune(now = Date.now()) { return this.db.run(pruneSinceSql(now)); }
}

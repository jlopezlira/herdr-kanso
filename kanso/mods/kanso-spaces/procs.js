// Kanso, by jlopezlira (https://github.com/jlopezlira/herdr-kanso). Apache-2.0.
// This is the source copy; `npm run sync:share` copies it into kanso-panel (ports), and a test fails when a copy differs.
// Reading `ps -axo pid=,ppid=,etime=,command=` (args= gives the same last column), with no host: the sidebar's
// tasks and liveness and the panel's ports all read the table the same way.

// The table read once: its rows in order, each process by its pid, and each parent's children in the table's order.
export function parseProcesses(text) {
  const rows = String(text ?? "").split("\n").flatMap((line) => {
    const m = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(line);
    return m ? [{ pid: Number(m[1]), ppid: Number(m[2]), etime: m[3], command: m[4] }] : [];
  });
  return { rows, byPid: new Map(rows.map((r) => [r.pid, r])), byParent: Map.groupBy(rows, (r) => r.ppid) };
}

// ps's elapsed time, [[dd-]hh:]mm:ss, in seconds.
export function etimeSecs(s) {
  const [days, rest] = String(s).includes("-") ? String(s).split("-") : [0, String(s)];
  const parts = rest.split(":").map(Number).toReversed();
  return Number(days) * 86400 + (parts[0] ?? 0) + (parts[1] ?? 0) * 60 + (parts[2] ?? 0) * 3600;
}
export const etimeMs = (s) => etimeSecs(s) * 1000;

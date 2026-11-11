// The saved off rows stand when the database does not answer, so that machine is not asked.
import { hc } from "herdr";
import { Kdb } from "./kdb.js";
import { listedMachines } from "./machines.js";

export async function powerOf(previous = []) {
  try {
    const stored = await new Kdb().machinesOff();
    const live = listedMachines(await hc(["machine", "ls", "--json"]).catch(() => null));
    return { stored: Array.isArray(stored) ? stored : previous, live };
  } catch {
    return { stored: previous, live: [] };
  }
}

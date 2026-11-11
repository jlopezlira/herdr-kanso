// Keeps a connected remote machine from idle sleep while this window holds the lease.

export const LEASE_S = 300;
export const RENEW_MS = 270_000;
export const EXEC_TIMEOUT_MS = 310_000;
const PROBE_TIMEOUT_MS = 30_000;
const KIND = { darwin: "darwin", macos: "darwin", linux: "linux", windows: "windows" };
const EMPTY = { gen: 0, os: null, skip: false, arming: false, nextAt: null };
const WIN_STATE = "[uint32]0x80000001";
const WIN_TYPE = "Add-Type -Namespace Kanso -Name Awake -MemberDefinition '[System.Runtime.InteropServices.StructLayout(System.Runtime.InteropServices.LayoutKind.Sequential)] public struct S { public byte AC; public byte BatteryFlag; public byte BatteryLifePercent; public byte Reserved; public uint BatteryLifeTime; public uint BatteryFullLifeTime; } [System.Runtime.InteropServices.DllImport(\"kernel32.dll\")] public static extern bool GetSystemPowerStatus(out S s); [System.Runtime.InteropServices.DllImport(\"kernel32.dll\")] public static extern uint SetThreadExecutionState(uint esFlags);'";
const WIN_HOLD = `[void][Kanso.Awake]::SetThreadExecutionState(${WIN_STATE})`;

function windowsScript(seconds, working) {
  const sleep = `Start-Sleep -Seconds ${seconds}`;
  const hold = working ? WIN_HOLD : `$s = New-Object Kanso.Awake+S; [void][Kanso.Awake]::GetSystemPowerStatus([ref]$s); if ($s.AC -eq 1) { ${WIN_HOLD} }`;
  return `${WIN_TYPE}; ${hold}; ${sleep}`;
}

export function holdCommand(os, seconds, working) {
  const kind = KIND[String(os ?? "").toLowerCase()];
  const secs = Math.max(0, Math.floor(Number(seconds)) || 0);
  if (kind === "darwin") return { command: "caffeinate", args: [working ? "-i" : "-s", "-t", String(secs)] };
  if (kind === "linux") return { command: "systemd-inhibit", args: ["--what=idle:sleep", "--who=kanso", "--why=awake", "sleep", String(secs)] };
  if (kind === "windows") return { command: "powershell", args: ["-NoProfile", "-NonInteractive", "-Command", windowsScript(secs, Boolean(working))] };
  return null;
}

export function shouldHold({ phase } = {}) {
  return phase === "connected";
}

export function osOf(result) {
  if (!result || result.threw || result.missing) return "windows";
  const text = String(result.stdout ?? "").trim();
  if (!(result.ok === true || result.code === 0)) return null;
  if (text === "Darwin") return "darwin";
  if (text === "Linux") return "linux";
  return null;
}

function missingOf(error, code) {
  return error?.code === "ENOENT" || code === 127 || code === 9009 || code === "ENOENT"
    || /not found|no such file|cannot find|could not find|not installed|enoent/i.test(String(error?.message ?? error ?? ""));
}

export function createAwake({ now = () => Date.now(), run }) {
  return {
    now, run,
    slots: new Map(),
    slot(name) { return this.slots.get(name) ?? EMPTY; },
    put(name, row) { this.slots.set(name, row); },
    due(row, at) { return !row.skip && !row.arming && (row.nextAt == null || at >= row.nextAt); },
    leave(name) {
      const prev = this.slots.get(name);
      if (!prev || (!prev.os && !prev.skip && !prev.arming && prev.nextAt == null)) return;
      this.put(name, { gen: prev.gen + 1, os: null, skip: false, arming: false, nextAt: null });
    },
    async call(spec, on, timeout) {
      try {
        const result = await this.run({ command: spec.command, args: spec.args, on, timeout });
        const code = result?.code ?? (result?.ok === false ? 1 : 0);
        const ok = result?.ok === true || code === 0;
        const stderr = ok ? "" : String(result?.stderr ?? "");
        return { ok, code, stdout: String(result?.stdout ?? ""), missing: Boolean(result?.missing) || missingOf({ message: stderr }, code), threw: false };
      } catch (error) {
        return { ok: false, code: error?.code ?? 1, stdout: "", missing: missingOf(error, error?.code), threw: true };
      }
    },
    probe(name) { return this.call({ command: "uname", args: ["-s"] }, name, PROBE_TIMEOUT_MS).then(osOf); },
    finish(name, gen, result) {
      const slot = this.slots.get(name);
      if (!slot || slot.gen !== gen || !result.missing) return;
      this.put(name, { ...slot, skip: true });
    },
    launch(item, os, gen, at) {
      const spec = holdCommand(os, LEASE_S, Boolean(item.working));
      const cur = this.slot(item.name);
      if (!spec || cur.gen !== gen) {
        if (cur.gen === gen) this.put(item.name, { ...cur, os, skip: true, arming: false });
        return;
      }
      this.put(item.name, { ...cur, os, arming: false, nextAt: at + RENEW_MS });
      this.call(spec, item.name, EXEC_TIMEOUT_MS).then((result) => this.finish(item.name, gen, result));
    },
    async hold(item) {
      const at = this.now();
      const prev = this.slot(item.name);
      if (!this.due(prev, at)) return;
      const gen = prev.gen;
      this.put(item.name, { ...prev, arming: true });
      const os = prev.os ?? await this.probe(item.name);
      const cur = this.slot(item.name);
      if (cur.gen !== gen) return;
      if (!os) { this.put(item.name, { ...cur, skip: true, arming: false }); return; }
      this.launch(item, os, gen, this.now());
    },
    async sync(list) {
      const rows = (list ?? []).filter((item) => item?.name);
      const seen = new Set(rows.map((item) => item.name));
      for (const item of rows) {
        if (shouldHold(item)) await this.hold(item);
        else this.leave(item.name);
      }
      for (const name of this.slots.keys()) if (!seen.has(name)) this.leave(name);
    },
    nextWait(at = this.now()) {
      return [...this.slots.values()].reduce((wait, row) => {
        if (row.skip || row.arming || row.nextAt == null) return wait;
        const delta = Math.max(0, row.nextAt - at);
        return wait == null || delta < wait ? delta : wait;
      }, null);
    },
  };
}

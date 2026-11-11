import { checked, jsonRows, powershell } from "./platform-command.js";
import { lsofFields } from "./platform-processes.js";

export const unixPorts = (text) => new Map(lsofFields(text).map(({ pid, fields }) => [pid, {
  pid, command: fields.filter((line) => line[0] === "c").at(-1)?.slice(1) ?? "",
  ports: [...new Set(fields.filter((line) => line[0] === "n").map((line) => Number(line.slice(line.lastIndexOf(":") + 1))).filter(Boolean))].toSorted((a, b) => a - b),
}]));

export function windowsPorts(text) {
  const rows = jsonRows(text).filter((row) => Number(row.pid) > 0 && Number(row.port) > 0);
  return new Map([...Map.groupBy(rows, (row) => Number(row.pid))].map(([pid, group]) => [pid, { pid, command: "", ports: [...new Set(group.map((row) => Number(row.port)))].toSorted((a, b) => a - b) }]));
}

export function portApi(platform, run) {
  return { async listen(options) {
    if (platform === "windows") return windowsPorts(checked(await powershell(run, "$ErrorActionPreference='Stop'; @(Get-NetTCPConnection | Where-Object State -eq Listen | ForEach-Object { @{pid=$_.OwningProcess;port=$_.LocalPort} }) | ConvertTo-Json -Compress", options)).stdout);
    const r = await run("lsof", ["-nP", "-iTCP", "-sTCP:LISTEN", "-F", "pcn"], options);
    if (r.code !== 0 && r.code !== 1) checked(r);
    return unixPorts(r.stdout);
  } };
}

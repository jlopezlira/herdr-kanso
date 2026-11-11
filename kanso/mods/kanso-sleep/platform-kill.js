import { validPid } from "./platform-command.js";

export const killApi = (platform, run) => ({
  stop: (pid, { force = false, ...options } = {}) => run(platform === "windows" ? "taskkill" : "kill", platform === "windows" ? ["/PID", validPid(pid), ...(force ? ["/F"] : [])] : [force ? "-KILL" : "-TERM", validPid(pid)], options),
});

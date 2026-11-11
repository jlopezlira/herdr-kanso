import { exec, window } from "herdr";
import { platformName, powershell, checked } from "./platform-command.js";
import { pathApi } from "./platform-paths.js";
import { processApi } from "./platform-processes.js";
import { portApi } from "./platform-ports.js";
import { killApi } from "./platform-kill.js";
import { openApi } from "./platform-open.js";
import { clipboardApi } from "./platform-clipboard.js";
import { fileApi } from "./platform-files.js";
import { petApi } from "./platform-pets.js";
import { markdownApi } from "./platform-markdown.js";
import { systemApi } from "./platform-system.js";
import { imageApi } from "./platform-images.js";
import { repositoryApi } from "./platform-repositories.js";
import { transcriptApi } from "./platform-transcripts.js";

export function platformFor(name, runner = exec) {
  const platform = platformName(name);
  return {
    name: platform,
    paths: pathApi(platform),
    processes: processApi(platform, runner),
    ports: portApi(platform, runner),
    kill: killApi(platform, runner),
    opener: openApi(platform, runner),
    clipboard: clipboardApi(platform, runner),
    files: fileApi(platform, runner),
    transcripts: transcriptApi(platform, runner),
    repositories: repositoryApi(platform, runner),
    images: imageApi(platform, runner),
    system: systemApi(platform, runner),
    markdown: markdownApi(platform, runner),
    pets: petApi(platform, runner),
    sleep: (seconds) => platform === "windows"
      ? powershell(runner, `Start-Sleep -Milliseconds ${Math.max(0, Math.round(Number(seconds) * 1000))}`)
      : runner("sleep", [String(seconds)]),
  };
}

export const localPlatform = () => platformFor(window()?.platform ?? "macos");
class RemotePlatforms {
  constructor() { this.values = new Map(); }
  async get(on) {
    if (!this.values.has(on)) {
      const runner = (program, args, options) => exec(program, args, { ...options, on });
      const probe = await powershell(runner, "[Environment]::OSVersion.Platform.ToString()").catch(() => null);
      const name = probe?.code === 0 && probe.stdout.trim() === "Win32NT" ? "windows" : checked(await runner("uname", ["-s"])).stdout.trim() === "Darwin" ? "macos" : "linux";
      this.values = new Map([...this.values, [on, platformFor(name, runner)]]);
    }
    return this.values.get(on);
  }
}
const remotePlatforms = new RemotePlatforms();
export const platformOn = (on) => on ? remotePlatforms.get(on) : Promise.resolve(localPlatform());
export const paths = pathApi();

import { serviceFor } from "./platform-host.js";

export const VIEWER_ENV = ["SSH_CONNECTION=0.0.0.0 0 0.0.0.0 0", "SSH_CLIENT=0.0.0.0 0 0", "HERDR_ENV=1", "HERDR_REMOTE_VIEWER=1"];

export const copiesToViewer = (platform) => (argv) => (platform === "windows" || !Array.isArray(argv) || !argv.length || argv[0] === "env" ? argv : ["env", ...VIEWER_ENV, ...argv]);

export const viewerFor = async (machine = null) => copiesToViewer(await serviceFor((platform) => platform, machine || null).catch(() => "windows"));

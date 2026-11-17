// Shared by the scripts: whether one runs from the command line, and whether it only checks.
import { fileURLToPath } from "node:url";

export const isMain = (url) => process.argv[1] === fileURLToPath(url);
export const CHECK = process.argv.includes("--check");
export const ROOT_URL = new URL("../", import.meta.url);
export const REPO_ROOT = fileURLToPath(ROOT_URL);

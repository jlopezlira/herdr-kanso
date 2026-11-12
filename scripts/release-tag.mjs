#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseRelease } from "../kanso/mods/kanso-chrome/release.js";
import { VERSION_FILE } from "./check-version.mjs";

const git = (args) => execFileSync("git", args, { encoding: "utf8" }).trim();

export function tagRelease(tag) {
  const release = parseRelease(tag);
  if (!release?.channel || !tag.startsWith("v")) throw new Error("a prerelease tag must be vX.Y.Z-beta.N or vX.Y.Z-rc.N");
  if (git(["tag", "--list", tag])) throw new Error(`${tag} already exists`);
  if (git(["status", "--porcelain", "--untracked-files=no"])) throw new Error("commit tracked changes before tagging a prerelease");
  const version = `${release.major}.${release.minor}.${release.patch}`;
  const data = JSON.parse(readFileSync(VERSION_FILE, "utf8"));
  if (release.channel === "beta" || data.version !== version) {
    git(["checkout", "--detach", "HEAD"]);
    if (data.version !== version) writeFileSync(VERSION_FILE, `${JSON.stringify({ ...data, version }, null, 2)}\n`);
    git(["add", "--", VERSION_FILE]);
    git(["commit", "--allow-empty", "-m", `Prepare ${tag}`]);
  }
  git(["tag", tag]);
  return git(["rev-parse", tag]);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { console.log(tagRelease(process.argv[2])); }
  catch (error) { console.error(`error: ${error.message}`); process.exit(1); }
}

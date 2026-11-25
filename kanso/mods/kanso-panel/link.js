import { run } from "herdr";
import { previewProps, showPreview } from "./preview-open.js";
import { previewable } from "./kinds.js";

const SUFFIX = /(?::\d+){1,2}$/;
const HERE = new Set(["", "localhost"]);

function fromUri(raw) {
  const uri = /^file:\/\/([^/?#]*)(\/[^?#]*)/i.exec(raw);
  if (!uri || !HERE.has(uri[1].toLowerCase())) return null;
  try { return decodeURIComponent(uri[2]); } catch { return null; }
}

function fullPath(raw, cwd) {
  if (raw.startsWith("/")) return raw;
  if (!cwd || raw.startsWith("~")) return null;
  return `${cwd.replace(/\/+$/, "")}/${raw.replace(/^\.\//, "")}`;
}

export function remoteFile({ link, source }) {
  if (link.kind !== "file" || !source.machine) return null;
  const raw = /^file:/i.test(link.raw) ? fromUri(link.raw) : link.raw.replace(SUFFIX, "");
  const path = raw && previewable(raw) ? fullPath(raw, source.cwd) : null;
  return path && { path, machine: source.machine };
}

export function handleLink(click) {
  const file = remoteFile(click);
  if (!file) return "pass";
  if (!showPreview(file.path, file.machine)) run("tab.new", { mod: "kanso-panel", props: previewProps(file.path, file.machine) });
  return "handled";
}

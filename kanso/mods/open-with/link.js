import { showPreview } from "./preview-open.js";

const SUFFIX = /(?::\d+){1,2}$/;
const fromUri = (raw) => decodeURIComponent(raw.replace(/^file:\/\/[^/]*/, ""));

export function remoteFile({ link, source }) {
  if (link.kind !== "file" || !source.machine) return null;
  const raw = link.raw.startsWith("file://") ? fromUri(link.raw) : link.raw.replace(SUFFIX, "");
  if (raw.startsWith("/")) return { path: raw, machine: source.machine };
  if (!source.cwd || raw.startsWith("~")) return null;
  return { path: `${source.cwd.replace(/\/+$/, "")}/${raw.replace(/^\.\//, "")}`, machine: source.machine };
}

export function handleLink(click) {
  const file = remoteFile(click);
  return file && showPreview(file.path, file.machine) ? "handled" : "pass";
}

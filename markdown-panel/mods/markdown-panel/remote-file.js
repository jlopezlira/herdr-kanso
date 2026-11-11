// A file on another machine, copied into the app folder so a picture can be drawn here.
import { appHome } from "herdr";
import { mkdir, readdir, stat, unlink, writeFile } from "fs/promises";
import { serviceOn } from "./platform-host.js";
import { fileApi } from "./platform-files.js";
import { paths } from "./platform-paths.js";
import { extOf } from "./pure.js";

export const BYTE_CAP = 20 * 1024 * 1024;
// Each slice stays under Herdr's exec output cap; a 20 MB file is several.
export const CHUNK = 2 * 1024 * 1024;
export const REMOTE_DIR = "data/kanso-panel/remote";
const DAY = 86400000;
const QUIET = /unreachable|did not answer|timed out|timeout|econnrefused|connection refused|offline|no route|was lost/i;
const DENIED = /permission denied|access is denied|eacces/i;
const MISSING = /no such file|cannot find (the )?path|not found|enoent/i;
const IMAGE = /!\[([^\]]*)\]\(([^)\s]+)\)|<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi;
const B64 = Object.fromEntries([..."ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"].map((c, i) => [c, i]));

export const fileId = (machine, path) => [...`${machine}\0${path}`].reduce((h, ch) => Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0, 2166136261).toString(36);

export const copyName = (machine, path, mtime, size, ext) => `${fileId(machine, path)}-${mtime}-${size}${ext ? `.${ext}` : ""}`;

export const tooBig = (size) => !Number.isFinite(size) || size < 0 || size > BYTE_CAP;

export const slices = (size, chunk = CHUNK) => Number.isFinite(size) && size >= 0
  ? Array.from({ length: size === 0 ? 0 : Math.ceil(size / chunk) }, (_, i) => ({ offset: i * chunk, length: Math.min(chunk, size - i * chunk) }))
  : null;

export const cutShort = (result) => Boolean(result?.truncated) || /truncat/i.test(`${result?.stdout ?? ""}${result?.stderr ?? ""}`);

export const dropCopies = (entries, { id, keep, now, maxAge = DAY }) => entries
  .filter((entry) => entry.name !== keep && (entry.name.startsWith(`${id}-`) || now - entry.mtime > maxAge))
  .map((entry) => entry.name);

export function decodeBase64(text) {
  const clean = String(text).replace(/\s/g, "");
  if (!clean || clean.length % 4 === 1 || /[^A-Za-z0-9+/=]/.test(clean)) throw new Error("The copy was cut short");
  const bytes = Array.from({ length: clean.length / 4 }, (_, i) => {
    const quad = [0, 1, 2, 3].map((k) => clean[i * 4 + k]);
    const raw = quad.map((ch) => (ch === "=" ? 0 : B64[ch]));
    if (raw.some((n) => n == null) || quad[0] === "=" || quad[1] === "=") throw new Error("The copy was cut short");
    const v = (raw[0] << 18) | (raw[1] << 12) | (raw[2] << 6) | raw[3];
    return [(v >> 16) & 255, ...(quad[2] === "=" ? [] : [(v >> 8) & 255]), ...(quad[3] === "=" ? [] : [v & 255])];
  }).flat();
  return Uint8Array.from(bytes);
}

export const concat = (parts) => Uint8Array.from(parts.flatMap((part) => [...part]));

export const said = (error) => String(error?.message ?? error ?? "").replace(/^Error:\s*/, "").trim();

export const copyFailure = (error, machine) => {
  const text = said(error);
  if (/over 20 MB/i.test(text)) return "This file is over 20 MB";
  if (/cut short|truncat/i.test(text)) return "The copy was cut short";
  if (DENIED.test(text)) return "Cannot read this file: permission denied";
  if (MISSING.test(text)) return "This file is no longer available";
  if (!text || QUIET.test(text)) return `${machine} did not answer`;
  return text;
};

export const listFailure = (error, machine) => {
  const text = said(error);
  if (DENIED.test(text)) return "Cannot list this folder: permission denied";
  if (!text || QUIET.test(text)) return machine ? `${machine} did not answer` : "This machine did not answer";
  return text || "Cannot list this folder";
};

export const remoteDue = (on, active, hidden) => Boolean(on) && active !== false && hidden !== true;

export const machineOf = (address) => {
  const at = String(address ?? "").indexOf("/");
  return at > 0 ? String(address).slice(0, at) : null;
};

export const appRelative = (file, root) => {
  const base = String(root).replaceAll("\\", "/").replace(/\/$/, "");
  const full = String(file).replaceAll("\\", "/");
  return full === base || full.startsWith(`${base}/`) ? full.slice(base.length + 1) : null;
};

export const drawablePath = (machine, image, path) => machine ? (image || null) : path;

export const svgPixels = (text) => {
  const tag = /<svg\b([^>]*)>/i.exec(String(text));
  const attr = (name) => {
    const n = Number(String(new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, "i").exec(tag?.[1] ?? "")?.[1] ?? "").replace(/px$/i, ""));
    return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
  };
  const raw = /\bviewBox\s*=\s*["']([^"']+)["']/i.exec(tag?.[1] ?? "");
  const box = raw ? raw[1].trim().split(/[\s,]+/).map(Number) : [];
  const width = attr("width") ?? (box.length === 4 && box[2] > 0 ? Math.round(box[2]) : null);
  const height = attr("height") ?? (box.length === 4 && box[3] > 0 ? Math.round(box[3]) : null);
  return tag && width && height ? { width, height } : null;
};

const localImage = (url) => url && !/^(https?:|data:|mailto:)/i.test(url);

export const markdownImages = (text) => [...String(text).matchAll(new RegExp(IMAGE.source, "gi"))].map((m) => ({ alt: m[1] ?? "", url: m[2] || m[3], at: m.index, length: m[0].length }));

export const markdownParts = (text) => {
  const images = markdownImages(text).filter((image) => localImage(image.url));
  const parts = images.reduce((out, image) => {
    const at = out.at(-1)?.end ?? 0;
    return [...out, ...(image.at > at ? [{ kind: "text", text: String(text).slice(at, image.at) }] : []), { kind: "image", alt: image.alt, url: image.url, end: image.at + image.length }];
  }, []);
  const end = parts.at(-1)?.end ?? 0;
  const rest = String(text).slice(end);
  return [...parts.map(({ end: _end, ...part }) => part), ...(rest ? [{ kind: "text", text: rest }] : [])];
};

export async function copiedBytes(encode, size, chunk = CHUNK) {
  const parts = slices(size, chunk);
  if (!parts) throw new Error("The copy was cut short");
  const chunks = await parts.reduce(async (acc, slice) => {
    const encoded = await encode(parts.length === 1 ? undefined : slice);
    if (!encoded || cutShort(encoded) || encoded.code !== 0) throw new Error(encoded?.stderr || "The copy was cut short");
    return [...await acc, decodeBase64(encoded.stdout)];
  }, Promise.resolve([]));
  const bytes = concat(chunks);
  if (bytes.length !== size) throw new Error("The copy was cut short");
  return bytes;
}

const aged = async (root) => Promise.all((await readdir(root).catch(() => [])).map(async (name) => ({ name, mtime: await stat(paths.join(root, name)).then((s) => s.mtimeMs).catch(() => 0) })));

export async function bring(file, on) {
  if (!on) return { path: file };
  try {
    const files = await serviceOn(fileApi, on);
    const info = await files.stat(file);
    if (tooBig(info.size)) throw new Error("This file is over 20 MB");
    const name = copyName(on, file, info.mtime, info.size, extOf(file));
    const root = paths.join(appHome(), REMOTE_DIR);
    const dest = paths.join(root, name);
    await mkdir(root, { recursive: true });
    const have = await stat(dest).then((s) => s.size === info.size).catch(() => false);
    if (!have) await writeFile(dest, await copiedBytes((range) => files.encode(file, range), info.size));
    await Promise.all(dropCopies(await aged(root), { id: fileId(on, file), keep: name, now: Date.now() }).map((old) => unlink(paths.join(root, old)).catch(() => {})));
    return { path: dest };
  } catch (e) {
    throw new Error(copyFailure(e, on));
  }
}

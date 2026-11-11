// Copyright (c) 2026 Robert Soriano
// Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions: The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
// Modified by jlopezlira (Kanso, https://github.com/jlopezlira/herdr-kanso): device lists, frames and input mapping from herdr-sim.
import { abiFits, STALL_MS } from "./sim-register.js";

export const RING = 12;
export const FRAME_MS = 33;
export const RELOAD_MS = 200;
export const SCROLL_LINE = 20;
export const TAG = { touch: 0x03, button: 0x04, key: 0x06, rotate: 0x07, scroll: 0x0b, keyboard: 0x0c };
const HOME_BAND = 0.93;
const EDGE_BOTTOM = 3;
const ROTATE = { portrait: "landscape_left", landscape_left: "portrait_upside_down", portrait_upside_down: "landscape_right", landscape_right: "portrait" };
const MODIFIERS = [["control", 224], ["shift", 225], ["alt", 226]];
const USAGES = {
  enter: 40, escape: 41, backspace: 42, tab: 43, space: 44,
  "-": 45, "=": 46, "[": 47, "]": 48, "\\": 49, ";": 51, "'": 52, "`": 53, ",": 54, ".": 55, "/": 56,
  home: 74, pageup: 75, delete: 76, end: 77, pagedown: 78, right: 79, left: 80, down: 81, up: 82,
  ...Object.fromEntries([..."abcdefghijklmnopqrstuvwxyz"].map((ch, index) => [ch, 4 + index])),
  ...Object.fromEntries([..."1234567890"].map((ch, index) => [ch, 30 + index])),
  ...Object.fromEntries(Array.from({ length: 12 }, (_, index) => [`f${index + 1}`, 58 + index])),
};
const UNSHIFTED = {
  "!": "1", "@": "2", "#": "3", $: "4", "%": "5", "^": "6", "&": "7", "*": "8", "(": "9", ")": "0",
  _: "-", "+": "=", "{": "[", "}": "]", "|": "\\", ":": ";", '"': "'", "~": "`", "<": ",", ">": ".", "?": "/",
};
const KEYCODES = {
  40: 66, 41: 111, 42: 67, 43: 61, 44: 62, 45: 69, 46: 70, 47: 71, 48: 72, 49: 73, 51: 74, 52: 75, 53: 68,
  54: 55, 55: 56, 56: 76, 74: 122, 75: 92, 76: 112, 77: 123, 78: 93, 79: 22, 80: 21, 81: 20, 82: 19,
  39: 7,
  ...Object.fromEntries(Array.from({ length: 26 }, (_, index) => [4 + index, 29 + index])),
  ...Object.fromEntries(Array.from({ length: 9 }, (_, index) => [30 + index, 8 + index])),
};

export const androidKeyCode = (usage) => KEYCODES[usage] ?? null;
export const ANDROID_SHIFT = 225;
export const ANDROID_MODIFIERS = new Set([224, 225, 226, 227]);
export const ANDROID_BUTTONS = { home: 3, lock: 26 };
export const ANDROID_VOLUME = { 233: 24, 234: 25 };
export const nextOrientation = (current) => ROTATE[current] ?? "portrait";
export const touchEdge = (point) => point.y >= HOME_BAND ? EDGE_BOTTOM : 0;
export const clamp01 = (value) => Math.min(1, Math.max(0, value));

export function runtimeLabel(key) {
  const match = /SimRuntime\.iOS-(\d+)-(\d+)/.exec(key);
  return match ? `iOS ${match[1]}.${match[2]}` : null;
}

export function parseSimctl(text) {
  const devices = JSON.parse(text).devices ?? {};
  return Object.entries(devices).flatMap(([key, list]) => {
    const os = runtimeLabel(key);
    if (!os || !Array.isArray(list)) return [];
    return list.filter((device) => device?.udid && device.isAvailable !== false).map((device) => ({
      platform: "ios", id: device.udid, name: device.name, os, booted: device.state === "Booted",
    }));
  }).toSorted((a, b) => b.os.localeCompare(a.os, undefined, { numeric: true }) || a.name.localeCompare(b.name));
}

export function parseAdbDevices(text) {
  return String(text).split(/\r?\n/).flatMap((line) => {
    const match = /^(emulator-\d+)\s+device\s*$/.exec(line.trim());
    return match ? [match[1]] : [];
  });
}

export function parseAvdNames(text) {
  return String(text).split(/\r?\n/).map((line) => line.trim()).filter((line) => /^[A-Za-z0-9._-]+$/.test(line));
}

export function parseAvdConfig(text) {
  const abi = /^abi\.type=(.*)$/m.exec(String(text))?.[1]?.trim() ?? "";
  const api = /^image\.sysdir\.1=system-images\/android-(\d+)/m.exec(String(text))?.[1] ?? "";
  return { abi, api };
}

export function parseEmuAvdName(text) {
  for (const raw of String(text).split(/\n/)) {
    const line = raw.replace(/\r/g, "").trim();
    if (line && line !== "OK" && !/^error/i.test(line)) return line;
  }
  return "";
}

export function parseWmSize(text) {
  const match = /(\d+)x(\d+)/.exec(String(text));
  return match ? { width: Number(match[1]), height: Number(match[2]) } : { width: 1080, height: 2220 };
}

export function emulatorRow(name, config, booted, family) {
  const abi = config?.abi ?? "";
  const api = config?.api ?? "";
  return {
    platform: "android", id: `avd:${name}`, avd: name, name: name.replaceAll("_", " "),
    os: api ? `Android API ${api}` : "Android", booted: Boolean(booted),
    unusable: abi && !abiFits(abi, family) ? `${abi} image, can't run on this computer` : null,
  };
}

export function chooseDevice(devices, picked) {
  const usable = (devices ?? []).filter((device) => !device.unusable);
  return usable.find((device) => device.id === picked) ?? usable.find((device) => device.booted) ?? usable[0] ?? null;
}

export function lastJson(text) {
  const line = String(text ?? "").split(/\r?\n/).findLast((item) => item.trim().startsWith("{"));
  return JSON.parse(line?.trim() || "{}");
}

export function streamAddress(address) {
  const rest = String(address ?? "").replace(/^https?:\/\//, "");
  const cut = rest.search(/[/?#]/);
  const authority = cut < 0 ? rest : rest.slice(0, cut);
  const tail = cut < 0 ? "" : rest.slice(cut);
  const path = (tail.startsWith("/") ? tail : `/${tail}`).split(/[?#]/)[0] || "/";
  const colon = authority.lastIndexOf(":");
  return {
    host: colon < 0 ? authority : authority.slice(0, colon),
    port: colon < 0 ? 0 : Number(authority.slice(colon + 1)),
    path,
  };
}

export function frameBytes(tag, body) {
  const json = body === undefined ? "" : JSON.stringify(body);
  return Uint8Array.from([tag, ...[...json].map((ch) => ch.charCodeAt(0))]);
}

export function keyUsages(event) {
  if (event?.modifiers?.platform) return null;
  const raw = event?.key;
  const fromSymbol = UNSHIFTED[raw];
  const capital = /^[A-Z]$/.test(raw ?? "");
  const key = fromSymbol ?? (capital ? raw.toLowerCase() : raw);
  const shift = Boolean(event?.modifiers?.shift || fromSymbol || capital);
  const usage = USAGES[key];
  if (!usage) return null;
  const held = { ...(event?.modifiers ?? {}), shift };
  return { usage, modifiers: MODIFIERS.filter(([name]) => held[name]).map(([, code]) => code) };
}

export function headerEnd(buf, len) {
  const end = Math.min(len, 4096);
  if (end < 4) return -1;
  return buf.subarray(0, end - 3).findIndex((byte, index) => byte === 13 && buf[index + 1] === 10 && buf[index + 2] === 13 && buf[index + 3] === 10);
}

const ascii = (buf, start, end) => String.fromCharCode(...buf.subarray(start, end));
const asBytes = (chunk) => chunk instanceof Uint8Array ? chunk : Uint8Array.from(chunk ?? []);
const cat = (left, right) => Uint8Array.from([...left, ...right]);

const pull = (buf) => {
  const head = headerEnd(buf, buf.length);
  if (head < 0) return { buf, frames: [] };
  const match = /Content-Length:\s*(\d+)/i.exec(ascii(buf, 0, head));
  const start = head + 4;
  if (!match) return pull(buf.subarray(start));
  const end = start + Number(match[1]);
  if (buf.length < end) return { buf, frames: [] };
  const frame = end > start ? [buf.slice(start, end)] : [];
  const rest = pull(buf.subarray(end));
  return { buf: rest.buf, frames: [...frame, ...rest.frames] };
};

export const createParser = () => ({ buf: new Uint8Array(0) });

export function pushBytes(parser, chunk) {
  const step = pull(cat(parser.buf, asBytes(chunk)));
  return { parser: { buf: step.buf }, frames: step.frames };
}

const sof = (bytes, i) => {
  if (i + 8 >= bytes.length || bytes[i] !== 0xff) return null;
  const marker = bytes[i + 1];
  if (marker >= 0xc0 && marker <= 0xc3) {
    const height = (bytes[i + 5] << 8) | bytes[i + 6];
    return height ? ((bytes[i + 7] << 8) | bytes[i + 8]) / height : null;
  }
  const size = (bytes[i + 2] << 8) | bytes[i + 3];
  return size < 2 ? null : sof(bytes, i + 2 + size);
};

export function imageAspect(bytes) {
  if (!bytes || bytes.length < 10) return null;
  if (bytes[0] === 137 && bytes[1] === 80 && bytes.length >= 24) {
    const u32 = (i) => bytes[i] * 16777216 + bytes[i + 1] * 65536 + bytes[i + 2] * 256 + bytes[i + 3];
    const height = u32(20);
    return height ? u32(16) / height : null;
  }
  return bytes[0] === 0xff && bytes[1] === 0xd8 ? sof(bytes, 2) : null;
}

export const frameFile = (slot, index) => `mods/kanso-sim-frames/${slot}-${index}.jpg`;
export const freshStack = (ring = RING) => Array.from({ length: ring }, (_, index) => index);
export const advanceSlot = (index, ring = RING) => (index + 1) % ring;
export const promoteStack = (stack, slot) => [...stack.filter((index) => index !== slot), slot];

export function scheduleFrame(due, now, frameMs = FRAME_MS) {
  if (now < due) return null;
  return Math.max(due, now - frameMs) + frameMs;
}

export function claimSlot(taken) {
  const id = Array.from({ length: taken.length + 1 }, (_, index) => `v${index + 1}`).find((item) => !taken.includes(item));
  return { id, taken: [...taken, id] };
}

export const releaseSlot = (taken, id) => taken.filter((item) => item !== id);

export function freshness(lastAt, now, stallMs = STALL_MS) {
  if (lastAt == null) return "stopped";
  return now - lastAt <= stallMs ? "live" : "stalled";
}

export function watch(book, id) {
  const count = (book[id] ?? 0) + 1;
  return { book: { ...book, [id]: count }, first: count === 1, last: false };
}

export function unwatch(book, id) {
  const count = (book[id] ?? 1) - 1;
  if (count > 0) return { book: { ...book, [id]: count }, first: false, last: false };
  return { book: Object.fromEntries(Object.entries(book).filter(([key]) => key !== id)), first: false, last: true };
}

export function fractionOf(local, bounds) {
  if (!local || !bounds?.width || !bounds?.height) return null;
  return { x: clamp01(local.x / bounds.width), y: clamp01(local.y / bounds.height) };
}

export function scrollFractions(delta, deltaLines, bounds) {
  const move = deltaLines ? { x: deltaLines.x * SCROLL_LINE, y: deltaLines.y * SCROLL_LINE } : delta;
  if (!move || !bounds?.width || !bounds?.height) return null;
  return { dx: -move.x / bounds.width, dy: -move.y / bounds.height };
}

export function fitScreen(maxW, maxH, aspect) {
  const height = Math.max(1, Math.min(maxH, maxW / aspect));
  const width = Math.max(1, Math.round(height * aspect));
  return { width, height, radius: Math.round(width * 0.13) };
}

export const BEAT_MS = 700;
export const FRAME_MS = 8000;
export const BOOT_MS = 90000;
const lines = (text) => String(text ?? "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
export const parseAvds = (text) => [...new Set(lines(text).filter((line) => !/^(INFO|WARNING|ERROR)\s*\|/.test(line)))];

export function parseSimctl(text) {
  const value = JSON.parse(text);
  return Object.entries(value.devices ?? {}).flatMap(([runtime, rows]) => rows
    .filter((row) => row.isAvailable !== false && row.udid && row.name)
    .map((row) => ({ id: `ios:${row.udid}`, target: row.udid, name: row.name, platform: "ios", runtime: runtime.split(".").at(-1).replace("-", " ").replace(/-/g, "."), state: row.state === "Booted" ? "Booted" : "Off" })));
}

export const parseAdb = (text) => lines(text).flatMap((line) => {
  const match = /^(\S+)\s+(device|offline|unauthorized)(?:\s|$)/.exec(line);
  return match ? [{ serial: match[1], state: match[2], emulator: /^emulator-\d+$/.test(match[1]) }] : [];
});

export function parseSize(text) {
  const matches = [...String(text).matchAll(/(?:Physical|Override) size:\s*(\d+)x(\d+)/g)];
  const match = matches.at(-1);
  return match && Number(match[1]) > 0 && Number(match[2]) > 0 ? { width: Number(match[1]), height: Number(match[2]) } : null;
}

export function deviceList(tools, ios = [], avds = [], android = []) {
  const running = tools.adb ? android : [];
  const virtual = tools.adb ? avds.map((name) => {
    const live = running.find((row) => row.avd === name);
    return { id: `avd:${name}`, name, avd: name, platform: "android", emulator: true, target: live?.serial ?? null, state: live?.state === "device" ? "Booted" : "Off" };
  }) : [];
  const other = running.filter((row) => !virtual.some((device) => device.target === row.serial)).map((row) => ({
    id: `android:${row.serial}`, name: row.avd || row.serial, target: row.serial, platform: "android", emulator: row.emulator, state: row.state === "device" ? "Booted" : "Off", issue: row.state === "device" ? null : row.state,
  }));
  return [...(tools.ios ? ios : []), ...virtual, ...other];
}

export const canStart = (device, tools) => device?.state === "Off" && (device.platform === "ios" ? tools.ios : device.avd && tools.emulator);
export const canRotate = (device) => device?.platform === "android" && device.emulator && device.state === "Booted";
export const bootState = (device, boot, now) => !boot || boot.id !== device?.id ? null : device.state === "Booted" ? null : now >= boot.until ? "Start timed out." : `Starting… ${Math.ceil((boot.until - now) / 1000)}s`;
export const age = (at, now) => `as of ${Math.max(0, Math.floor((now - at) / 1000))}s ago`;

const uint = (data, offset, length) => Array.from(data.slice(offset, offset + length)).reduce((out, byte) => out * 256 + byte, 0);
export function pictureSize(data) {
  if (data.length >= 24 && data[0] === 137 && data[1] === 80 && data[2] === 78 && data[3] === 71) return { width: uint(data, 16, 4), height: uint(data, 20, 4) };
  const jpeg = (offset) => {
    if (offset + 8 >= data.length || data[offset] !== 255) return null;
    const marker = data[offset + 1], length = uint(data, offset + 2, 2);
    if ([192, 193, 194].includes(marker)) return { width: uint(data, offset + 7, 2), height: uint(data, offset + 5, 2) };
    return length >= 2 ? jpeg(offset + 2 + length) : null;
  };
  return data[0] === 255 && data[1] === 216 ? jpeg(2) : null;
}

export function fitPicture(picture, box) {
  if (!picture?.width || !picture.height || !box?.width || !box.height) return null;
  const scale = Math.min(box.width / picture.width, box.height / picture.height);
  return { width: picture.width * scale, height: picture.height * scale };
}

export const sizeDue = (cached, picture) => !cached || cached.landscape !== (picture.width > picture.height);

export function screenPoint(point, drawn, size, picture) {
  if (!point || !drawn?.width || !drawn.height || !size || !picture) return null;
  const landscape = picture.width > picture.height, tall = size.width < size.height;
  const width = landscape === tall ? size.height : size.width, height = landscape === tall ? size.width : size.height;
  return { x: Math.max(0, Math.min(width - 1, Math.round(point.x / drawn.width * width))), y: Math.max(0, Math.min(height - 1, Math.round(point.y / drawn.height * height))) };
}

export function gesture(from, to, elapsed) {
  if (!from || !to) return null;
  return Math.hypot(to.x - from.x, to.y - from.y) < 8
    ? ["tap", String(to.x), String(to.y)]
    : ["swipe", String(from.x), String(from.y), String(to.x), String(to.y), String(Math.max(100, Math.min(2000, Math.round(elapsed))))];
}

export const KEYS = { enter: 66, backspace: 67, left: 21, right: 22, up: 19, down: 20 };
export const CONTROLS = [["Back", 4], ["Home", 3], ["Recents", 187], ["Power", 26], ["Volume up", 24], ["Volume down", 25]];
export const keyInput = (event) => event.modifiers?.control || event.modifiers?.alt || event.modifiers?.platform ? null : KEYS[event.key] ? { code: KEYS[event.key] } : event.key_char && !/[\x00-\x1f\x7f]/.test(event.key_char) ? { text: event.key_char } : null;
export const escapeText = (text) => Array.from(text).map((char) => char === " " ? "%s" : /[A-Za-z0-9_.,:@+\/-]/.test(char) ? char : `\\${char}`).join("");
export const textParts = (text) => String(text).split(/(?<=%)(?=s)/).filter(Boolean).map(escapeText);

export class TextBatch {
  constructor() { this.items = []; }
  add(target, input) {
    const last = this.items.at(-1);
    this.items = input.text && last?.text && last.target === target
      ? [...this.items.slice(0, -1), { target, text: last.text + input.text }]
      : [...this.items, { target, ...input }];
  }
  take() { const items = this.items; this.items = []; return items; }
}

export class FrameLoop {
  constructor() { this.key = null; this.inFlight = false; this.next = 0; this.last = null; this.failed = false; this.resting = false; }
  ready(now, front, key) {
    if (!front) { this.resting = true; return false; }
    if (key !== this.key) { this.key = key; this.last = null; this.failed = false; this.next = 0; }
    if (this.resting) { this.resting = false; this.next = 0; }
    return Boolean(key) && !this.inFlight && now >= this.next;
  }
  begin(now) { this.inFlight = true; this.started = now; return this.key; }
  land(key, frame, now) {
    this.inFlight = false;
    this.next = key === this.key ? now + BEAT_MS : now;
    if (key !== this.key) return false;
    this.failed = !frame;
    if (frame) this.last = { ...frame, at: now };
    return Boolean(frame);
  }
  late(now) { return this.failed || this.inFlight && now - this.started >= FRAME_MS; }
}

export function panelShown(tree, hidden = false) {
  if (!tree) return false;
  const away = hidden || Boolean(tree.hidden);
  if (tree.id === "sim") return !away;
  return (tree.children ?? []).some((child) => panelShown(child, away));
}

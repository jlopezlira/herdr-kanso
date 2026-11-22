export const OMARCHY = new Set([
  "alt-print", "alt-shift-super-,", "alt-shift-super--", "alt-shift-super-0", "alt-shift-super-1",
  "alt-shift-super-2", "alt-shift-super-3", "alt-shift-super-4", "alt-shift-super-5",
  "alt-shift-super-6", "alt-shift-super-7", "alt-shift-super-8", "alt-shift-super-9",
  "alt-shift-super-=", "alt-shift-super-a", "alt-shift-super-b", "alt-shift-super-down",
  "alt-shift-super-e", "alt-shift-super-f", "alt-shift-super-g", "alt-shift-super-left",
  "alt-shift-super-m", "alt-shift-super-right", "alt-shift-super-tab", "alt-shift-super-up",
  "alt-shift-super-x", "alt-shift-tab", "alt-space", "alt-super-,", "alt-super--", "alt-super-/",
  "alt-super-1", "alt-super-2", "alt-super-3", "alt-super-4", "alt-super-5", "alt-super-=",
  "alt-super-[", "alt-super-]", "alt-super-down", "alt-super-enter", "alt-super-f", "alt-super-g",
  "alt-super-home", "alt-super-k", "alt-super-l", "alt-super-left", "alt-super-right", "alt-super-s",
  "alt-super-space", "alt-super-tab", "alt-super-up", "alt-tab", "ctrl-alt-delete",
  "ctrl-alt-shift-tab", "ctrl-alt-super-,", "ctrl-alt-super-b", "ctrl-alt-super-c", "ctrl-alt-super-d",
  "ctrl-alt-super-delete", "ctrl-alt-super-e", "ctrl-alt-super-f", "ctrl-alt-super-r",
  "ctrl-alt-super-t", "ctrl-alt-super-w", "ctrl-alt-super-z", "ctrl-alt-tab", "ctrl-shift-super--",
  "ctrl-shift-super-=", "ctrl-shift-super-a", "ctrl-shift-super-down", "ctrl-shift-super-g",
  "ctrl-shift-super-left", "ctrl-shift-super-r", "ctrl-shift-super-right", "ctrl-shift-super-space",
  "ctrl-shift-super-up", "ctrl-space", "ctrl-super-,", "ctrl-super--", "ctrl-super-.", "ctrl-super-1",
  "ctrl-super-2", "ctrl-super-3", "ctrl-super-4", "ctrl-super-5", "ctrl-super-6", "ctrl-super-7",
  "ctrl-super-8", "ctrl-super-9", "ctrl-super-=", "ctrl-super-a", "ctrl-super-b",
  "ctrl-super-backspace", "ctrl-super-c", "ctrl-super-d", "ctrl-super-delete", "ctrl-super-e",
  "ctrl-super-enter", "ctrl-super-f", "ctrl-super-h", "ctrl-super-i", "ctrl-super-k", "ctrl-super-l",
  "ctrl-super-left", "ctrl-super-n", "ctrl-super-o", "ctrl-super-p", "ctrl-super-print",
  "ctrl-super-r", "ctrl-super-right", "ctrl-super-s", "ctrl-super-space", "ctrl-super-t",
  "ctrl-super-tab", "ctrl-super-v", "ctrl-super-w", "ctrl-super-z", "print", "shift-super-,",
  "shift-super--", "shift-super-/", "shift-super-0", "shift-super-1", "shift-super-2", "shift-super-3",
  "shift-super-4", "shift-super-5", "shift-super-6", "shift-super-7", "shift-super-8", "shift-super-9",
  "shift-super-=", "shift-super-`", "shift-super-a", "shift-super-b", "shift-super-backspace",
  "shift-super-c", "shift-super-d", "shift-super-down", "shift-super-e", "shift-super-enter",
  "shift-super-f", "shift-super-g", "shift-super-i", "shift-super-left", "shift-super-m",
  "shift-super-n", "shift-super-o", "shift-super-p", "shift-super-q", "shift-super-right",
  "shift-super-s", "shift-super-space", "shift-super-t", "shift-super-tab", "shift-super-up",
  "shift-super-w", "shift-super-x", "shift-super-y", "super-,", "super--", "super-/", "super-0",
  "super-1", "super-2", "super-3", "super-4", "super-5", "super-6", "super-7", "super-8", "super-9",
  "super-=", "super-`", "super-a", "super-backspace", "super-c", "super-down", "super-enter",
  "super-escape", "super-f", "super-g", "super-home", "super-i", "super-j", "super-k", "super-l",
  "super-left", "super-m", "super-o", "super-p", "super-print", "super-q", "super-right", "super-s",
  "super-space", "super-t", "super-tab", "super-up", "super-v", "super-w", "super-x",
]);

const ORDER = ["ctrl", "alt", "shift", "cmd"];
const SWAPS = [["cmd"], ["ctrl", "shift"], ["alt", "shift"], ["ctrl", "alt"], ["ctrl", "alt", "shift"], ["cmd", "ctrl"], ["cmd", "ctrl", "shift"]];

const parse = (chord) => {
  const [, prefix, key] = String(chord).match(/^((?:(?:ctrl|alt|shift|cmd)-)*)(.+)$/);
  return { mods: new Set(prefix.split("-").filter(Boolean)), key };
};
const chordOf = (mods, key) => [...ORDER.filter((mod) => mods.has(mod)), key].join("-");
const canonical = (chord) => { const { mods, key } = parse(chord); return chordOf(mods, key); };
const asOmarchy = (chord) => canonical(chord).replace(/(^|-)cmd-/, "$1super-");
const swapped = (chord, swap) => {
  if (swap === SWAPS[0]) return canonical(chord);
  const { mods, key } = parse(chord);
  return chordOf(new Set([...[...mods].filter((mod) => mod !== "cmd"), ...swap]), key);
};
const usesCmd = (chord) => parse(chord).mods.has("cmd");
const SHIFTED = { 1: "!", 2: "@", 3: "#", 4: "$", 5: "%", 6: "^", 7: "&", 8: "*", 9: "(", 0: ")", "-": "_", "=": "+", "[": "{", "]": "}", "\\": "|", ";": ":", "'": "\"", ",": "<", ".": ">", "/": "?", "`": "~" };
const reported = (chord) => {
  const { mods, key } = parse(chord);
  return mods.has("shift") && SHIFTED[key] ? chordOf(new Set([...mods].filter((mod) => mod !== "shift")), SHIFTED[key]) : null;
};
const familyOf = (action) => String(action).replace(/-(?:left|right|up|down|\d+)$/, "");

export const takenByOmarchy = (chord) => OMARCHY.has(asOmarchy(chord));

export const chordsOf = (section) => new Set(Object.keys(section ?? {}).map(canonical));

export function linuxSection(section, reserved = new Set()) {
  const entries = Object.entries(section ?? {});
  const families = [...new Set(entries.filter(([chord]) => usesCmd(chord)).map(([, action]) => familyOf(action)))];
  const fixed = new Set([...reserved, ...entries.filter(([chord]) => !usesCmd(chord)).map(([chord]) => canonical(chord))]);
  const chosen = families.reduce((picked, family) => {
    const members = entries.filter(([chord, action]) => usesCmd(chord) && familyOf(action) === family).map(([chord]) => chord);
    const taken = new Set([...fixed, ...[...picked.values()].map(([next]) => next)]);
    const free = (next) => new Set(next).size === next.length && next.every((chord) => !taken.has(chord) && !takenByOmarchy(chord));
    const together = SWAPS.find((swap) => free(members.map((chord) => swapped(chord, swap))));
    if (together) return new Map([...picked, ...members.map((chord) => [chord, [swapped(chord, together), together]])]);
    return members.reduce((alone, chord) => {
      const used = new Set([...taken, ...[...alone.values()].map(([next]) => next)]);
      const swap = SWAPS.find((each) => !used.has(swapped(chord, each)) && !takenByOmarchy(swapped(chord, each))) ?? SWAPS[0];
      return new Map([...alone, [chord, [swapped(chord, swap), swap]]]);
    }, picked);
  }, new Map());
  const written = (chord) => { const [next, swap] = chosen.get(chord) ?? [chord, SWAPS[0]]; return swap === SWAPS[0] ? chord : next; };
  const out = entries.map(([chord, action]) => [written(chord), action]);
  const bound = new Set([...reserved, ...out.map(([chord]) => canonical(chord))]);
  const aliases = out.map(([chord, action]) => [reported(chord), action]).filter(([chord]) => chord && !bound.has(canonical(chord)) && !takenByOmarchy(chord));
  return Object.fromEntries([...out, ...aliases]);
}

export const linuxKeymap = (keymap) => Object.fromEntries(Object.entries(keymap ?? {}).map(([name, section]) => [name, linuxSection(section)]));

export const reportedForms = (chords) => [...new Set([...chords, ...chords.map(reported).filter(Boolean)])];

export const withoutReported = (chords) => chords.filter((chord) => !chords.some((other) => other !== chord && reported(other) === chord));

export function migrateToLinux(user, mac) {
  const shipped = linuxKeymap(mac);
  const ours = Object.fromEntries(Object.keys(mac ?? {}).filter((name) => name in (user ?? {})).map((name) => {
    const macEntries = Object.entries(mac[name]);
    const linuxEntries = Object.entries(shipped[name]);
    const moved = new Map(macEntries.map(([chord, action], i) => [chord, [action, linuxEntries[i][0]]]));
    const entries = Object.entries(user[name]).flatMap(([chord, action]) => {
      const [was, next] = moved.get(chord) ?? [];
      if (was !== action) return [[chord, action]];
      const alias = reported(next);
      return [[next, action], ...(alias && shipped[name][alias] === action ? [[alias, action]] : [])];
    });
    return [name, linuxSection(Object.fromEntries(entries))];
  }));
  const reserved = new Set(Object.values(ours).flatMap((section) => [...chordsOf(section)]));
  const keys = Object.fromEntries(Object.entries(user ?? {}).map(([name, section]) => [name, ours[name] ?? linuxSection(section, reserved)]));
  if (JSON.stringify(keys) === JSON.stringify(user)) return { keys, changed: false };
  return { keys: withClipboardKeys(keys), changed: true };
}

export const CLIPBOARD_KEYS = { "ctrl-shift-c": "terminal.copy", "ctrl-insert": "terminal.copy", "ctrl-shift-v": "terminal.paste", "shift-insert": "terminal.paste" };

export function withClipboardKeys(keys) {
  const taken = chordsOf(keys.terminal);
  const missing = Object.entries(CLIPBOARD_KEYS).filter(([chord]) => !taken.has(canonical(chord)));
  return missing.length ? { ...keys, terminal: { ...keys.terminal, ...Object.fromEntries(missing) } } : keys;
}

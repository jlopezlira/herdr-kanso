// A computer's right-click menu as data: its rows in the Storybook's order, each act named by its key.

const PHASE_ROWS = {
  off: () => [{ key: "power", act: "connect" }],
  unavailable: () => [{ key: "retry", act: "refresh" }],
  login: () => [{ key: "signin", act: "sign-in" }],
  connected: (remote, syncOn, keyed, caffeine) => [
    ...(remote ? [{ key: "power", act: "disconnect" }, { key: "sync", act: "sync", hint: syncOn ? "on" : "off" }] : []),
    ...(caffeine ? [{ key: "caffeine", act: "caffeine", hint: caffeine }] : []),
    ...(remote && keyed ? [{ key: "unkey", act: "remove-key" }] : []),
    { key: "plus", act: "new-project" },
  ],
};

/** Rename, what its phase allows, Remove for another computer, Add computer unless it is switched off, then Hide and Settings for the Computers piece. */
export const computerMenuItems = ({ remote = false, phase = "connected", syncOn = false, addComputer = true, keyed = false, caffeine = null } = {}) => [
  { key: "rename", act: "rename" },
  ...(PHASE_ROWS[phase]?.(remote, syncOn, keyed, caffeine) ?? []),
  ...(remote && phase !== "loading" ? [{ key: "remove", act: "remove-computer" }] : []),
  ...(addComputer ? [{ separator: true }, { key: "add", act: "add-computer" }] : []),
  { separator: true },
  { key: "hide", icon: "eye-off", label: "Hide “Computers”" },
  { key: "settings", icon: "sliders-vertical", label: "Settings for this…" },
];

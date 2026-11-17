// A computer's right-click menu as data: its rows in the Storybook's order, each act named by its key.

const PHASE_ROWS = {
  off: () => [{ key: "power", icon: "power", label: "Turn on" }],
  unavailable: () => [{ key: "retry", icon: "refresh", label: "Refresh" }],
  login: () => [{ key: "signin", icon: "key", label: "Sign in…" }],
  connected: (remote, syncOn) => [
    ...(remote ? [{ key: "power", icon: "power", label: "Turn off" }, { key: "sync", icon: "arrow-right-left", label: "Sync", hint: syncOn ? "on" : "off" }] : []),
    { key: "plus", icon: "plus", label: "New project" },
  ],
};

/** Rename, what its phase allows, Add computer unless it is switched off, then Hide and Settings for the Computers piece. */
export const computerMenuItems = ({ remote = false, phase = "connected", syncOn = false, addComputer = true } = {}) => [
  { key: "rename", label: "Rename…" },
  ...(PHASE_ROWS[phase]?.(remote, syncOn) ?? []),
  ...(addComputer ? [{ separator: true }, { key: "add", icon: "server", label: "Add computer…" }] : []),
  { separator: true },
  { key: "hide", icon: "eye-off", label: "Hide “Computers”" },
  { key: "settings", icon: "sliders-vertical", label: "Settings for this…" },
];

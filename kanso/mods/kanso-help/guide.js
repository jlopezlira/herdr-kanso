import { modifierGlyphs, familyPattern, chordRun } from "./marks.js";

export const modifierLabels = (platform) => {
  const MOD_GLYPH = modifierGlyphs(platform);
  return { MOD_GLYPH, MOD_WORD: platform === "macos" ? { ctrl: "Control", alt: "Option", shift: "Shift", cmd: "Command" } : MOD_GLYPH, join: platform === "macos" ? "" : "+" };
};

export function guideSections(bindings, platform, home) {
  const hint = (actions, pattern = (chord) => chord) => {
    const chords = actions.flatMap((action) => bindings.filter((b) => b.section === "layout:kanso" && b.action === action).map((b) => pattern(b.keys)));
    return chords.length ? ` (${chordRun(chords, platform)})` : "";
  };
  const strip = (...actions) => hint(actions.map((a) => `kanso-strip.${a}`));
  const family = (prefix) => hint(Array.from({ length: 9 }, (_, i) => `${prefix}${i + 1}`), familyPattern);
  return [
    ["The strip", [
      `Every pane sits in a row you slide along, each one wide enough to read. Open a pane to the right${strip("new-right")} or below it in the same column${strip("new-down")}.`,
      `Move between panes as vim does${strip("vim-left", "vim-down", "vim-up", "vim-right")}, or move the pane itself${strip("vim-move-left", "vim-move-down", "vim-move-up", "vim-move-right")}. Jump to a column${family("kanso-strip.col-")}, show fewer panes${strip("fewer")} or more at once${strip("more")}.`,
      `Pin a pane to its side${strip("pin")} so it stays in view while you slide. New to h j k l? The hjkl dōjō is where to practice.`,
    ]],
    ["The sidebar", [
      `Projects lists your spaces and their agents${hint(["kanso-spaces.view-spaces"])}, Status sorts them by what they need from you${hint(["kanso-spaces.view-agents"])}, Threads by conversation${hint(["kanso-spaces.view-threads"])}.`,
      `Move left from the first pane${strip("vim-left")} to put the keyboard on the list: J and K move, gg and G go to the ends, Enter or L opens the row, / searches, Esc goes back.`,
      `Go to the next agent that needs you, in any space${hint(["kanso-spaces.needs-you.next"])}.`,
    ]],
    ["Panels", [
      `The icons at the top right open a panel beside the strip: Files, the PR, Ports, Memory, Spend and more. Open them by place${family("kanso-tabs.panel-")}.`,
    ]],
    ["Sleep and Arrangements", [
      "Sleep puts a tab, or a whole project, away: its agents exit and keep their conversations; Wake brings them back on the same ones. Right-click a project, or the moon in a pane's header.",
      `Arrangements${strip("arrange")} saves a tab as it is, agents and widths included, to open again in any project.`,
    ]],
    ["Every list and menu", [
      "J and K (or the arrows) move, gg and G go to the first and last, Enter chooses, Esc closes.",
    ]],
    ["Your setup", [
      "Your keys, the panels and what shows are in kansō settings (Settings, at the top right here): rebind a key by clicking it and pressing the new chord.",
      "Two themes come with kansō: kanso (dark) and kanso-day (light). Pick one in Herdr's settings, under Appearance.",
      `Your settings folder is ${home}: keys in keys.json, the layout in layouts/kanso.json, kansō's data under data/. An update changes a key only where the release changed it, never one you set.`,
      "kansō checks for a new release on start and every few minutes; turn automatic checks off or check now in kansō settings, What's new. Installing an update is always your choice.",
    ]],
  ];
}

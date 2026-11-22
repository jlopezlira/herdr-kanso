import { readTextFile, writeTextFile, appHome, exec, notify } from "herdr";
import { paths } from "./platform-paths.js";
import { DEFAULT_KEYS } from "./defaults.js";
import { migrateToLinux } from "./platform-linux-keys.js";
import { formerKeymap } from "./platform-keymap.js";
import { tryOr, tryOrAsync } from "./pure.js";

export async function arriveOnLinux(platform) {
  const former = formerKeymap(platform);
  if (!former) return false;
  const file = paths.join(appHome(), "keys.json");
  const text = await tryOrAsync(() => readTextFile(file));
  const user = text ? tryOr(() => JSON.parse(text), null) : null;
  if (!user) return false;
  const { keys, changed } = migrateToLinux(user, DEFAULT_KEYS[former]);
  if (!changed) return false;
  await writeTextFile(file, `${JSON.stringify(keys, null, 2)}\n`, text);
  notify({ title: "kansō's keys now work with Omarchy" });
  return true;
}

const HERDR_RULE = { lua: 'hl.window_rule({ match = { class = "herdr-app" }, tag = "+terminal" })', conf: "tag +terminal, class:^(herdr-app)$" };

export const HYPRLAND_TERMINAL = `
[ -n "\${HYPRLAND_INSTANCE_SIGNATURE:-}" ] && command -v hyprctl >/dev/null || exit 3
[ -d "\${OMARCHY_PATH:-/usr/share/omarchy}" ] || [ -d "$HOME/.local/share/omarchy" ] || exit 3
cfg="\${XDG_CONFIG_HOME:-$HOME/.config}/hypr"
if [ -f "$cfg/hyprland.lua" ]; then
  rule='${HERDR_RULE.lua}'
  hyprctl dispatch "(function() $rule return hl.dsp.exec_cmd('true') end)()" >/dev/null 2>&1
  [ "$(cat "$cfg/kanso.lua" 2>/dev/null)" = "$rule" ] && grep -qF 'pcall(require, "hypr.kanso")' "$cfg/hyprland.lua" && exit 1
  printf '%s\\n' "$rule" > "$cfg/kanso.lua" || exit 2
  grep -qF 'pcall(require, "hypr.kanso")' "$cfg/hyprland.lua" || printf '\\npcall(require, "hypr.kanso")\\n' >> "$cfg/hyprland.lua" || exit 2
elif [ -f "$cfg/hyprland.conf" ]; then
  rule='windowrule = ${HERDR_RULE.conf}'
  hyprctl keyword windowrule '${HERDR_RULE.conf}' >/dev/null 2>&1
  [ "$(cat "$cfg/kanso.conf" 2>/dev/null)" = "$rule" ] && grep -qF 'source = '"$cfg"'/kanso.conf' "$cfg/hyprland.conf" && exit 1
  printf '%s\\n' "$rule" > "$cfg/kanso.conf" || exit 2
  grep -qF 'source = '"$cfg"'/kanso.conf' "$cfg/hyprland.conf" || printf '\\nsource = %s/kanso.conf\\n' "$cfg" >> "$cfg/hyprland.conf" || exit 2
else
  exit 3
fi`;

export async function herdrIsTerminal(platform) {
  if (!formerKeymap(platform)) return false;
  const r = await tryOrAsync(() => exec("sh", ["-c", HYPRLAND_TERMINAL]));
  if (r?.code !== 0) return false;
  notify({ title: "Super+C and Super+V copy and paste in Herdr", body: "Hyprland now treats Herdr as a terminal, as Omarchy's clipboard keys expect." });
  return true;
}

import { checked, powershell, psQuote, shellQuote, windowsArg } from "./platform-command.js";

const DETECT = `
for a in "$@"; do
  case "$a" in
    app:*) n=\${a#app:}
      for d in /Applications "$HOME/Applications" /Applications/Setapp "$HOME/Applications/JetBrains Toolbox"; do
        if [ -d "$d/$n" ]; then printf 'app\\t%s\\t%s\\n' "$n" "$d/$n"; break; fi
      done;;
    cli:*) n=\${a#cli:}
      p=$(command -v "$n" 2>/dev/null) && case "$p" in /*) printf 'cli\\t%s\\t%s\\n' "$n" "$p";; esac;;
  esac
done
if command -v flatpak >/dev/null 2>&1; then
  flatpak list --app --columns=application 2>/dev/null | awk '{ printf "flatpak\\t%s\\t\\n", $1 }'
fi`;

const ICON = `
out=$1; shift; mkdir -p "$out"
while [ $# -gt 1 ]; do
  id=$1; app=$2; shift 2
  [ -f "$out/$id.png" ] && continue
  f=$(plutil -extract CFBundleIconFile raw "$app/Contents/Info.plist" 2>/dev/null) || continue
  case "$f" in *.icns) ;; *) f="$f.icns";; esac
  [ -f "$app/Contents/Resources/$f" ] && sips -s format png -Z 64 "$app/Contents/Resources/$f" --out "$out/$id.png" >/dev/null 2>&1
done
exit 0`;

const LINUX_ICON = `
out=$1; shift; mkdir -p "$out"
IFS='
'
data=\${XDG_DATA_HOME:-$HOME/.local/share}
apps="$data/applications
/usr/share/applications
/var/lib/flatpak/exports/share/applications
$HOME/.local/share/flatpak/exports/share/applications"
themes="$data/icons/hicolor
/usr/share/icons/hicolor
/var/lib/flatpak/exports/share/icons/hicolor
$HOME/.local/share/flatpak/exports/share/icons/hicolor"
while [ $# -gt 1 ]; do
  id=$1; name=$(basename "$2"); shift 2
  pattern=$(printf '%s' "$name" | sed 's/[][\\.*^$+?(){}|/]/\\\\&/g')
  [ -f "$out/$id.png" ] && continue
  d=""
  for a in $apps; do
    [ -f "$a/$name.desktop" ] && { d="$a/$name.desktop"; break; }
    for f in "$a"/*.desktop; do grep -qE "^Exec=([^ ]*/)?$pattern( |$)" "$f" 2>/dev/null && { d=$f; break 2; }; done
  done
  [ -n "$d" ] || continue
  i=$(sed -n 's/^Icon=//p' "$d" | head -1)
  src=""
  case "$i" in
    /*) src=$i;;
    *) for t in $themes; do for s in 256x256 128x128 512x512 96x96 64x64 48x48 scalable; do for x in png svg; do [ -f "$t/$s/apps/$i.$x" ] && { src="$t/$s/apps/$i.$x"; break 3; }; done; done; done
       [ -n "$src" ] || for x in png svg; do [ -f "/usr/share/pixmaps/$i.$x" ] && { src="/usr/share/pixmaps/$i.$x"; break; }; done;;
  esac
  [ -n "$src" ] || continue
  magick -background none "$src" -resize 64x64 "$out/$id.png" >/dev/null 2>&1 || rsvg-convert -w 64 -h 64 "$src" -o "$out/$id.png" >/dev/null 2>&1 || rm -f "$out/$id.png"
done
exit 0`;

const WEB_LINK = /^(https?):\/\/(\[[0-9a-f:.]+\]|[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*)(?::(\d{1,5}))?(?:[/?#]\S*)?$/i;
const NEAR = /^(?:localhost|\[::1\]|127(?:\.\d{1,3}){3}|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2})$/i;
export const isWebLink = (url) => {
  const parts = typeof url === "string" ? WEB_LINK.exec(url) : null;
  if (!parts || Number(parts[3] ?? 0) > 65535) return false;
  return parts[1].toLowerCase() === "https" || NEAR.test(parts[2]);
};
const notOption = (target) => (String(target).startsWith("-") ? `./${target}` : target);

export function openApi(platform, run) {
  async function detectEditors(editors) {
    if (platform === "windows") {
      const tries = editors.flatMap((e) => (e.cli ?? []).map((c) => [e, c]));
      const hits = (await Promise.all(tries.map(([e, c]) =>
        run("where", [c]).then((r) => (r.code === 0 ? [e, r.stdout.split(/\r?\n/)[0].trim()] : null)).catch(() => null)))).filter(Boolean);
      return Object.fromEntries(hits.filter((h, i) => hits.findIndex((x) => x[0].id === h[0].id) === i).map((h) => [h[0].id, { cli: h[1] }]));
    }
    const args = editors.flatMap((e) => [...(platform === "macos" ? (e.mac ?? []).map((m) => `app:${m}`) : []), ...(e.cli ?? []).map((c) => `cli:${c}`)]);
    const r = checked(await run("sh", ["-c", DETECT, "sh", ...args]));
    const hits = r.stdout.split("\n").filter(Boolean).map((l) => l.split("\t"));
    return Object.fromEntries(editors.flatMap((e) => {
      const app = hits.find(([k, n]) => k === "app" && e.mac?.includes(n));
      const cli = hits.find(([k, n]) => k === "cli" && e.cli?.includes(n));
      const fp = hits.find(([k, n]) => k === "flatpak" && e.flatpak?.includes(n));
      return app || cli || fp ? [[e.id, { app: app?.[2], cli: cli?.[2], flatpak: fp?.[1] }]] : [];
    }));
  }
  const spawn = (program, args = [], options) => platform === "windows"
    ? powershell(run, `Start-Process -FilePath ${psQuote(program)}${args.length ? ` -ArgumentList ${psQuote(args.map(windowsArg).join(" "))}` : ""} -ErrorAction Stop`, options)
    : run("sh", ["-c", 'if command -v setsid >/dev/null 2>&1; then setsid -f "$@" >/dev/null 2>&1; else nohup "$@" >/dev/null 2>&1 & fi', "sh", program, ...args], options);
  const open = (target, { application, ...options } = {}) => platform === "windows" ? spawn(application || target, application ? [target] : [], options) : platform === "macos" ? run("open", [...(application ? ["-a", application] : []), notOption(target)], options) : application ? spawn(application, [target], options) : run("xdg-open", [notOption(target)], options);
  const web = (url, options) => (isWebLink(url) ? open(url, options) : Promise.resolve({ code: 1, stdout: "", stderr: "Only web links open from here" }));
  const terminalLine = (cwd, argv) => platform === "windows" ? `Set-Location -LiteralPath ${psQuote(cwd)}; if ($?) { & ${argv.map(psQuote).join(" ")} }` : `cd ${shellQuote(cwd)} && ${argv.map(shellQuote).join(" ")}`;
  const editorIcons = async (found, dir) => {
    if (platform === "windows") return [];
    const linux = platform !== "macos";
    const pairs = Object.entries(found).flatMap(([id, how]) => {
      const source = linux ? how.flatpak || how.cli : how.app;
      return source ? [id, source] : [];
    });
    if (pairs.length) await run("sh", ["-c", linux ? LINUX_ICON : ICON, "sh", dir, ...pairs]);
    const ids = Object.keys(found);
    if (!ids.length) return [];
    const result = await run("sh", ["-c", 'out="$1"; shift; for id in "$@"; do [ -f "$out/$id.png" ] && printf "%s\\n" "$id"; done; true', "sh", dir, ...ids]);
    return result.stdout.split("\n").filter((id) => ids.includes(id));
  };
  return { open, web, spawn, terminalLine, detectEditors, editorIcons };
}

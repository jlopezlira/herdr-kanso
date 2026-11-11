import { checked, powershell, psQuote, jsonRows } from "./platform-command.js";
import { paths } from "./platform-paths.js";
import { fileApi } from "./platform-files.js";

const CHROMIUMS = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser", "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "chromium", "chromium-browser", "google-chrome", "google-chrome-stable", "brave", "brave-browser", "microsoft-edge",
];

const COLOR = `d=$(mktemp -t kanso-dot).bmp
sips -s format bmp -z 1 1 "$1" --out "$d" >/dev/null 2>&1 || { rm -f "$d"; exit 1; }
python3 - "$d" <<'PY'
import struct,sys
b=open(sys.argv[1],"rb").read()
if len(b)<30: raise SystemExit(1)
off,bpp=struct.unpack_from("<I",b,10)[0],struct.unpack_from("<H",b,28)[0]
px=b[off:off+4]
r,g,bl=(px[2],px[1],px[0]) if bpp>=24 else (0,0,0)
print("#%02x%02x%02x"%(r,g,bl))
PY
rm -f "$d"`;

const AVATARS = 'mkdir -p "$1" && cd "$1" || exit 0; shift; for l; do (curl -fsL --max-time 10 -o "$l.part" "https://github.com/$l.png?size=96" && mv -f "$l.part" "$l.jpg"; rm -f "$l.part") & done; wait; for l; do [ -s "$l.jpg" ] && printf "%s\\n" "$l"; done; true';

export function imageApi(platform, run) {
  const files = fileApi(platform, run);
  const firstRuns = async (tries, made = async () => true) => {
    for (const [program, args] of tries) if ((await run(program, args).catch(() => null))?.code === 0 && await made()) return true;
    return false;
  };
  const exists = (file) => files.test(file, "nonempty").catch(() => false);
  const folderOf = (file) => paths.dirname(file);
async function quickLook(file, size, pngPath) {
  const made = paths.join(folderOf(pngPath), paths.basename(file) + ".png");
  if (platform !== "macos") return false;
  const r = await run("qlmanage", ["-t", "-s", String(size), "-o", folderOf(pngPath), file], { cwd: folderOf(file) }).catch(() => null);
  if (!(r?.code === 0 && await exists(made))) return false;
  if (made !== pngPath) await files.move(made, pngPath);
  return true;
}

// A picture GPUI can't draw (HEIC, TIFF) as a PNG: sips on macOS, ImageMagick elsewhere.
const toPng = (file, pngPath) =>
  firstRuns(platform === "macos" ? [["sips", ["-s", "format", "png", file, "--out", pngPath]]] : [["magick", [file, pngPath]]], () => exists(pngPath));

// A PDF's first page, `size` px on its long side: QuickLook, else Poppler's pdftoppm.
const firstPage = async (file, size, pngPath) => await quickLook(file, size, pngPath)
  || firstRuns([["pdftoppm", ["-png", "-singlefile", "-f", "1", "-scale-to", String(size), file, pngPath.replace(/\.png$/, "")]]], () => exists(pngPath));


  const chromiumPrograms = async () => {
    if (platform !== "windows") return CHROMIUMS;
    const script = "$ErrorActionPreference='Stop'; @(@($env:ProgramFiles,${env:ProgramFiles(x86)},$env:LOCALAPPDATA) | Where-Object { $_ } | ForEach-Object { $root=$_; @('Google\\Chrome\\Application\\chrome.exe','Microsoft\\Edge\\Application\\msedge.exe','BraveSoftware\\Brave-Browser\\Application\\brave.exe') | ForEach-Object { $file=Join-Path $root $_; if (Test-Path -LiteralPath $file) { $file } } }) | ConvertTo-Json -Compress";
    return [...jsonRows(checked(await powershell(run, script)).stdout), "chrome", "msedge", "chromium"];
  };
  const probe = async (file, kind, ext) => {
    if (ext === "svg") return platform === "windows" ? /<svg/i.test(await files.read(file, 800).catch(() => "")) : (await run("sh", ["-c", 'head -c 800 "$1" | grep -qi "<svg"', "sh", file]).catch(() => null))?.code === 0;
    if (kind !== "image") return true;
    if (platform === "macos") {
      const r = await run("sips", ["-g", "pixelWidth", file]).catch(() => null);
      return r?.code === 0 && /pixelWidth:\s*[1-9]\d*/.test(r.stdout ?? "");
    }
    if (platform === "windows" && ext === "webp") return (await powershell(run, `$stream=[IO.File]::OpenRead(${psQuote(file)}); try { $bytes=New-Object byte[] 12; $count=$stream.Read($bytes,0,12); if ($count -lt 12 -or [Text.Encoding]::ASCII.GetString($bytes,0,4) -cne 'RIFF' -or [Text.Encoding]::ASCII.GetString($bytes,8,4) -cne 'WEBP') { exit 1 } } finally { $stream.Dispose() }`).catch(() => null))?.code === 0;
    if (platform === "windows") return (await powershell(run, `$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Drawing; $image=[Drawing.Image]::FromFile(${psQuote(file)}); try { if ($image.Width -lt 1) { exit 1 } } finally { $image.Dispose() }`).catch(() => null))?.code === 0;
    return (await run("magick", ["identify", "-ping", file]).catch(() => null))?.code === 0;
  };
  const color = (file) => platform === "macos" ? run("sh", ["-c", COLOR, "sh", file]) : platform === "windows"
    ? powershell(run, `$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Drawing; $image=[Drawing.Image]::FromFile(${psQuote(file)}); try { $small=$image.GetThumbnailImage(1,1,$null,[IntPtr]::Zero); try { $p=$small.GetPixel(0,0); '#{0:x2}{1:x2}{2:x2}' -f $p.R,$p.G,$p.B } finally { $small.Dispose() } } finally { $image.Dispose() }`)
    : run("magick", [file, "-scale", "1x1!", "-depth", "8", "-format", "#%[hex:p{0,0}]", "info:"]);
  const fresh = (dir, key) => platform === "windows"
    ? powershell(run, `$ErrorActionPreference='Stop'; [IO.Directory]::CreateDirectory(${psQuote(dir)}) | Out-Null; Get-ChildItem -LiteralPath ${psQuote(dir)} -File | Where-Object { $_.Name.StartsWith(${psQuote(key + "-")}) -or $_.LastWriteTimeUtc -lt [DateTime]::UtcNow.AddDays(-1) } | Remove-Item -Force`)
    : run("sh", ["-c", 'mkdir -p "$1" && rm -f "$1/$2"-* && find "$1" -type f -mtime +1 -exec rm -f {} + 2>/dev/null; true', "sh", dir, key]);
  const avatars = (dir, logins) => platform === "windows"
    ? powershell(run, `$dir=${psQuote(dir)}; [IO.Directory]::CreateDirectory($dir) | Out-Null; foreach ($login in @(${logins.map(psQuote).join(",")})) { $file=Join-Path $dir ($login+'.jpg'); $part=$file+'.part'; try { Invoke-WebRequest -Uri ('https://github.com/'+$login+'.png?size=96') -OutFile $part -TimeoutSec 10; Move-Item -LiteralPath $part -Destination $file -Force } catch {} finally { if (Test-Path -LiteralPath $part) { Remove-Item -LiteralPath $part -Force } }; if ((Test-Path -LiteralPath $file) -and (Get-Item -LiteralPath $file).Length -gt 0) { $login } }`)
    : run("sh", ["-c", AVATARS, "sh", dir, ...logins]);
  return { avatars, quickLook, toPng, firstPage, chromiums: chromiumPrograms, probe, color, fresh };
}

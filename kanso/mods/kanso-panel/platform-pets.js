import { powershell, psQuote } from "./platform-command.js";

const LIST = `out="$1"; shift; mkdir -p "$out" || exit 1; seen=" "
for d in "$@"; do [ -d "$d" ] && printf '%s\\n' "$d"/*/; done | while IFS= read -r d; do
  [ -d "$d" ] || continue
  id=$(basename "$d")
  case "$id" in .*|*[!A-Za-z0-9._-]*) continue;; esac
  case "$seen" in *" $id "*) continue;; esac
  j="$d/pet.json"; [ -f "$j" ] || continue
  s="$d/spritesheet.webp"; [ -f "$s" ] || s="$d/spritesheet.png"; [ -f "$s" ] || continue
  f="$id.png"
  if [ ! -s "$out/$f" ] || [ "$s" -nt "$out/$f" ]; then
    if command -v sips >/dev/null 2>&1 && sips -s format png "$s" --out "$out/.$f" >/dev/null 2>&1; then
      mkdir -p "$out/thumbs" && sips -Z 749 "$out/.$f" --out "$out/thumbs/$f" >/dev/null 2>&1 || cp -f "$out/.$f" "$out/thumbs/$f"
      mv -f "$out/.$f" "$out/$f"
    else f="$id.\${s##*.}"; mkdir -p "$out/thumbs" && cp -f "$s" "$out/$f" && cp -f "$s" "$out/thumbs/$f" || continue; fi
  fi
  seen="$seen$id "
  printf '%s\\t%s\\t' "$id" "$f"; head -c 4096 "$j" | tr '\\n\\r\\t' '   '; echo
done`;

// The agents' pets not here yet, brought into Kanso's folder: id, name, URL and kind (zip or webp) each.
// A codex-pets.net zip is unpacked aside and only its pet.json and atlas kept.
const BRING = `src="$1"; shift; mkdir -p "$src" || exit 1
tmp=$(mktemp -d) || exit 1; trap 'rm -rf "$tmp"' EXIT
while [ $# -ge 4 ]; do
  id="$1"; name="$2"; url="$3"; kind="$4"; shift 4
  case "$id" in ""|.*|*[!A-Za-z0-9._-]*) continue;; esac
  [ -f "$src/$id/pet.json" ] && continue
  rm -rf "$tmp/x" "$tmp/p"; mkdir -p "$tmp/x"
  if [ "$kind" = zip ]; then
    curl -fsSL --max-time 90 "$url" -o "$tmp/p" 2>/dev/null && unzip -qq "$tmp/p" -d "$tmp/x" 2>/dev/null || { echo "$id" >&2; continue; }
    j=$(find "$tmp/x" -maxdepth 2 -type f -name pet.json | head -n 1); [ -n "$j" ] || { echo "$id" >&2; continue; }
    d=$(dirname "$j"); s="$d/spritesheet.webp"; [ -f "$s" ] || s="$d/spritesheet.png"; [ -f "$s" ] || { echo "$id" >&2; continue; }
    mkdir -p "$src/$id" && cp -f "$s" "$src/$id/" && cp -f "$j" "$src/$id/pet.json"
  else
    curl -fsSL --max-time 90 "$url" -o "$tmp/x/spritesheet.webp" 2>/dev/null || { echo "$id" >&2; continue; }
    mkdir -p "$src/$id" && mv -f "$tmp/x/spritesheet.webp" "$src/$id/" && printf '{"id":"%s","displayName":"%s"}\\n' "$id" "$name" > "$src/$id/pet.json"
  fi
done`;


const WINDOWS_LIST = String.raw`
[IO.Directory]::CreateDirectory($out) | Out-Null
[IO.Directory]::CreateDirectory((Join-Path $out 'thumbs')) | Out-Null
$seen=@{}
foreach ($source in $sources) {
  if (-not (Test-Path -LiteralPath $source -PathType Container)) { continue }
  foreach ($dir in Get-ChildItem -LiteralPath $source -Directory | Sort-Object Name) {
    $id=$dir.Name
    if ($id -notmatch '^[A-Za-z0-9_-][A-Za-z0-9._-]*$' -or $seen.ContainsKey($id) -or ($dir.Attributes -band [IO.FileAttributes]::ReparsePoint)) { continue }
    $json=Join-Path $dir.FullName 'pet.json'
    if (-not (Test-Path -LiteralPath $json -PathType Leaf)) { continue }
    $sheet=Join-Path $dir.FullName 'spritesheet.webp'
    if (-not (Test-Path -LiteralPath $sheet -PathType Leaf)) { $sheet=Join-Path $dir.FullName 'spritesheet.png' }
    if (-not (Test-Path -LiteralPath $sheet -PathType Leaf)) { continue }
    $file=$id+[IO.Path]::GetExtension($sheet)
    $target=Join-Path $out $file; $thumb=Join-Path (Join-Path $out 'thumbs') $file
    if (-not (Test-Path -LiteralPath $target) -or (Get-Item -LiteralPath $sheet).LastWriteTimeUtc -gt (Get-Item -LiteralPath $target).LastWriteTimeUtc) { Copy-Item -LiteralPath $sheet -Destination $target -Force; Copy-Item -LiteralPath $sheet -Destination $thumb -Force }
    $stream=[IO.File]::OpenRead($json)
    try { $bytes=New-Object byte[] 4096; $n=$stream.Read($bytes,0,$bytes.Length); $text=[Text.Encoding]::UTF8.GetString($bytes,0,$n).Replace([string][char]13,' ').Replace([string][char]10,' ').Replace([string][char]9,' ') } finally { $stream.Dispose() }
    $seen[$id]=$true
    [Console]::WriteLine($id+[char]9+$file+[char]9+$text)
  }
}
`;

const WINDOWS_BRING = String.raw`
[IO.Directory]::CreateDirectory($source) | Out-Null
$temp=Join-Path ([IO.Path]::GetTempPath()) ('kanso-pets-'+[Guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($temp) | Out-Null
try {
  foreach ($pet in $pets) {
    $id=$pet.id
    if ($id -notmatch '^[A-Za-z0-9_-][A-Za-z0-9._-]*$') { continue }
    $target=Join-Path $source $id
    if (Test-Path -LiteralPath (Join-Path $target 'pet.json')) { continue }
    $work=Join-Path $temp $id; [IO.Directory]::CreateDirectory($work) | Out-Null
    try {
      $archive=Join-Path $work $(if ($pet.zip) {'pet.zip'} else {'spritesheet.webp'})
      $uri=[Uri]$pet.url
      if ($uri.IsFile) { [IO.File]::Copy($uri.LocalPath,$archive,$true) } else { Invoke-WebRequest -UseBasicParsing -Uri $uri -OutFile $archive -TimeoutSec 90 }
      if ($pet.zip) {
        $unpacked=Join-Path $work 'unpacked'; Expand-Archive -LiteralPath $archive -DestinationPath $unpacked
        $json=Get-ChildItem -LiteralPath $unpacked -Filter pet.json -Recurse -Depth 1 -File | Select-Object -First 1
        if (-not $json) { throw 'No pet.json' }
        $sheet=Join-Path $json.DirectoryName 'spritesheet.webp'
        if (-not (Test-Path -LiteralPath $sheet)) { $sheet=Join-Path $json.DirectoryName 'spritesheet.png' }
        if (-not (Test-Path -LiteralPath $sheet)) { throw 'No atlas' }
        [IO.Directory]::CreateDirectory($target) | Out-Null
        Copy-Item -LiteralPath $sheet -Destination $target -Force
        Copy-Item -LiteralPath $json.FullName -Destination (Join-Path $target 'pet.json') -Force
      } else {
        [IO.Directory]::CreateDirectory($target) | Out-Null
        Move-Item -LiteralPath $archive -Destination (Join-Path $target 'spritesheet.webp') -Force
        [IO.File]::WriteAllText((Join-Path $target 'pet.json'),(@{id=$id;displayName=$pet.name} | ConvertTo-Json -Compress),[Text.UTF8Encoding]::new($false))
      }
    } catch { [Console]::Error.WriteLine($id) }
  }
} finally { Remove-Item -LiteralPath $temp -Recurse -Force }
`;

export function petApi(platform, run) {
  const list = (out, sources) => platform === "windows"
    ? powershell(run, `$out=${psQuote(out)}; $sources=@(${sources.map(psQuote).join(",")}); ` + WINDOWS_LIST)
    : run("sh", ["-c", LIST, "sh", out, ...sources]);
  const bring = (source, pets) => platform === "windows"
    ? powershell(run, `$source=${psQuote(source)}; $pets=ConvertFrom-Json ${psQuote(JSON.stringify(pets))}; ` + WINDOWS_BRING, { timeout: 120000 })
    : run("sh", ["-c", BRING, "sh", source, ...pets.flatMap((pet) => [pet.id, pet.name, pet.url, pet.zip ? "zip" : "webp"])]);
  return { list, bring };
}

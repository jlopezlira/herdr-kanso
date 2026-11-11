import { checked, jsonRows, powershell, psQuote, windowsArg } from "./platform-command.js";

// 2097150 is a multiple of 3, so only the last slice's base64 is padded, and it stays under the exec cap.
export const CHUNK = 2097150;
const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

class Utf8 {
  constructor() { this.raw = []; this.n = 0; }

  add(b) { this.raw[this.n] = b & 255; this.n = this.n + 1; return this; }

  put(cp) {
    if (cp < 0x80) return this.add(cp);
    if (cp < 0x800) return this.add(0xc0 | (cp >> 6)).add(0x80 | (cp & 63));
    if (cp < 0x10000) return this.add(0xe0 | (cp >> 12)).add(0x80 | ((cp >> 6) & 63)).add(0x80 | (cp & 63));
    return this.add(0xf0 | (cp >> 18)).add(0x80 | ((cp >> 12) & 63)).add(0x80 | ((cp >> 6) & 63)).add(0x80 | (cp & 63));
  }
}

const bytesOf = (text) => [...String(text ?? "")].reduce((out, ch) => out.put(ch.codePointAt(0)), new Utf8());

const encodeSlice = (raw, start, end) => Array.from({ length: Math.ceil((end - start) / 3) }, (_, group) => {
  const i = start + group * 3;
  const b0 = raw[i];
  const b1 = i + 1 < end ? raw[i + 1] : null;
  const b2 = i + 2 < end ? raw[i + 2] : null;
  return B64[b0 >> 2] + B64[((b0 & 3) << 4) | ((b1 ?? 0) >> 4)] + (b1 == null ? "=" : B64[((b1 & 15) << 2) | ((b2 ?? 0) >> 6)]) + (b2 == null ? "=" : B64[b2 & 63]);
}).join("");

export const base64Chunks = (text, chunk = CHUNK) => {
  const { raw, n } = bytesOf(text);
  if (n === 0) return [""];
  return Array.from({ length: Math.ceil(n / chunk) }, (_, i) => encodeSlice(raw, i * chunk, Math.min(n, (i + 1) * chunk)));
};

export const b64Path = (path) => `${path}.kanso-b64`;
export const newPath = (path) => `${path}.kanso-new`;
export const expPath = (path) => `${path}.kanso-exp`;
export const expB64Path = (path) => `${path}.kanso-exp.b64`;
export const writeTemps = (path) => [b64Path(path), newPath(path), expPath(path), expB64Path(path)];

export class SaveConflict extends Error {
  constructor() { super("changed on disk"); this.conflict = true; }
}

const unixPut = (file, body, fresh) => ({ cmd: "sh", args: ["-c", fresh ? 'printf %s "$1" > "$2"' : 'printf %s "$1" >> "$2"', "put", body, file] });

const winPut = (file, body, fresh) => ({
  script: `$enc = New-Object System.Text.UTF8Encoding $false; ${fresh ? "[IO.File]::WriteAllText" : "[IO.File]::AppendAllText"}(${psQuote(file)}, ${psQuote(body)}, $enc)`,
});

const unixDecode = (platform) => {
  const one = platform === "macos" ? 'base64 -D -i "$src" -o "$dst"' : 'base64 -d "$src" > "$dst"';
  const two = platform === "macos" ? 'base64 -D -i "$expsrc" -o "$expdst"' : 'base64 -d "$expsrc" > "$expdst"';
  return `
src=$1
dst=$2
expsrc=$3
expdst=$4
if [ ! -s "$src" ]; then : > "$dst"; else ${one} || exit 1; fi
rm -f -- "$src"
if [ -n "$expsrc" ]; then
  if [ ! -s "$expsrc" ]; then : > "$expdst"; else ${two} || exit 1; fi
  rm -f -- "$expsrc"
fi`;
};

const unixCompare = (platform) => {
  const stat = platform === "macos" ? "stat -f %z" : "stat -c %s";
  const hash = platform === "macos" ? "shasum -a 256" : "sha256sum";
  const dec = platform === "macos" ? "base64 -D" : "base64 -d";
  return `
target=$1
decoded=$2
expfile=$3
mode=$4
expb64=$5
cleanup() { status=$?; rm -f -- "$decoded" "$expfile"; exit "$status"; }
trap cleanup EXIT
if [ "$mode" = create ]; then
  if [ -e "$target" ]; then exit 3; fi
elif [ "$mode" = files ]; then
  if [ ! -f "$target" ] || [ ! -f "$expfile" ]; then exit 3; fi
else
  if [ ! -f "$target" ]; then exit 3; fi
  if [ -z "$expb64" ]; then : > "$expfile"; else printf %s "$expb64" | ${dec} > "$expfile" || exit 1; fi
fi
if [ "$mode" != create ]; then
  s1=$(${stat} "$target") || exit 1
  s2=$(${stat} "$expfile") || exit 1
  [ "$s1" = "$s2" ] || exit 3
  h1=$(${hash} "$target") || exit 1
  h2=$(${hash} "$expfile") || exit 1
  [ "\${h1%% *}" = "\${h2%% *}" ] || exit 3
fi
mv -f -- "$decoded" "$target" || exit 1
trap - EXIT
rm -f -- "$expfile"`;
};

const winDecode = (path, withExp) => `
$src = ${psQuote(b64Path(path))}
$dst = ${psQuote(newPath(path))}
$text = if (Test-Path -LiteralPath $src) { [IO.File]::ReadAllText($src) } else { '' }
if ([string]::IsNullOrEmpty($text)) { [IO.File]::WriteAllBytes($dst, (New-Object byte[] 0)) } else { [IO.File]::WriteAllBytes($dst, [Convert]::FromBase64String(($text -replace '\\s',''))) }
if (Test-Path -LiteralPath $src) { Remove-Item -LiteralPath $src -Force }
${withExp ? `$esrc = ${psQuote(expB64Path(path))}
$edst = ${psQuote(expPath(path))}
$etext = if (Test-Path -LiteralPath $esrc) { [IO.File]::ReadAllText($esrc) } else { '' }
if ([string]::IsNullOrEmpty($etext)) { [IO.File]::WriteAllBytes($edst, (New-Object byte[] 0)) } else { [IO.File]::WriteAllBytes($edst, [Convert]::FromBase64String(($etext -replace '\\s',''))) }
if (Test-Path -LiteralPath $esrc) { Remove-Item -LiteralPath $esrc -Force }` : ""}`;

// Move-Item leaves a file that is already there, so that case is replaced.
const winCompare = (path, mode, expb64) => `
$code = 0
$target = ${psQuote(path)}
$decoded = ${psQuote(newPath(path))}
$expfile = ${psQuote(expPath(path))}
try {
  if (${psQuote(mode)} -eq 'create') {
    if (Test-Path -LiteralPath $target) { $code = 3 }
  } elseif (${psQuote(mode)} -eq 'files') {
    if (-not (Test-Path -LiteralPath $target -PathType Leaf) -or -not (Test-Path -LiteralPath $expfile -PathType Leaf)) { $code = 3 }
  } elseif (-not (Test-Path -LiteralPath $target -PathType Leaf)) { $code = 3 }
  else {
    $expText = ${psQuote(expb64 ?? "")}
    if ([string]::IsNullOrEmpty($expText)) { [IO.File]::WriteAllBytes($expfile, (New-Object byte[] 0)) }
    else { [IO.File]::WriteAllBytes($expfile, [Convert]::FromBase64String(($expText -replace '\\s',''))) }
  }
  if ($code -eq 0 -and ${psQuote(mode)} -ne 'create') {
    $a = Get-Item -LiteralPath $target
    $b = Get-Item -LiteralPath $expfile
    if ($a.Length -ne $b.Length) { $code = 3 }
    else {
      $ha = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash
      $hb = (Get-FileHash -LiteralPath $expfile -Algorithm SHA256).Hash
      if ($ha -ne $hb) { $code = 3 }
    }
  }
  if ($code -eq 0) {
    if (Test-Path -LiteralPath $target -PathType Leaf) { [IO.File]::Replace($decoded, $target, $null) }
    else { Move-Item -LiteralPath $decoded -Destination $target -Force }
  }
} finally {
  if (Test-Path -LiteralPath $decoded) { Remove-Item -LiteralPath $decoded -Force -ErrorAction SilentlyContinue }
  if (Test-Path -LiteralPath $expfile) { Remove-Item -LiteralPath $expfile -Force -ErrorAction SilentlyContinue }
}
if ($code -ne 0) { exit $code }`;

export const writeSteps = (platform, path, text, expected) => {
  const parts = base64Chunks(text);
  const expParts = expected == null ? null : base64Chunks(expected);
  const many = expParts != null && expParts.length > 1;
  const mode = expected == null ? "create" : many ? "files" : "match";
  const puts = parts.map((body, i) => (platform === "windows" ? winPut(b64Path(path), body, i === 0) : unixPut(b64Path(path), body, i === 0)));
  const expPuts = many ? expParts.map((body, i) => (platform === "windows" ? winPut(expB64Path(path), body, i === 0) : unixPut(expB64Path(path), body, i === 0))) : [];
  const decode = platform === "windows"
    ? { script: winDecode(path, many) }
    : { cmd: "sh", args: ["-c", unixDecode(platform), "dec", b64Path(path), newPath(path), many ? expB64Path(path) : "", many ? expPath(path) : ""] };
  const compare = platform === "windows"
    ? { script: winCompare(path, mode, many ? "" : expParts?.[0] ?? "") }
    : { cmd: "sh", args: ["-c", unixCompare(platform), "cmp", path, newPath(path), expPath(path), mode, many ? "" : expParts?.[0] ?? ""] };
  return [...puts, ...expPuts, decode, compare];
};

// find prints each directory twice in a row, so its type costs no extra call.
export const pairEntries = (raw) => {
  const names = raw.slice(0, 2 * (500 + 2)).map((name) => name.slice(2));
  const paired = names.reduce((out, name) => [...out, name === names[out.length - 1] && !out.at(-1)], []);
  return names.flatMap((name, i) => (paired[i] ? [] : [{ name, dir: paired[i + 1] === true }])).slice(0, 500 + 1);
};

const unixTree = (platform) => {
  const stat = platform === "macos" ? "stat -f '%z %m'" : "stat -c '%s %Y'";
  return [
    "root=$1",
    "shift",
    `stamp=$(${stat} "$root") || exit 1`,
    "printf '\\005%s\\000' \"$stamp\"",
    "for rel in \"$@\"; do",
    "  if [ -n \"$rel\" ]; then dir=\"$root/$rel\"; else dir=\"$root\"; fi",
    "  printf '\\001%s\\000' \"$rel\"",
    "  find -H \"$dir\" -mindepth 1 -maxdepth 1 ! -name .git \\( -type d -print0 -print0 -o -print0 \\) || exit 1",
    "  printf '\\002\\000'",
    "done",
    "top=$(git -C \"$root\" rev-parse --show-toplevel 2>/dev/null) || top=",
    "printf '\\003%s\\000' \"$top\"",
    "if [ -n \"$top\" ]; then git -C \"$root\" status --porcelain=v1 -z --no-renames --untracked-files=normal 2>/dev/null | tr '\\000' '\\n'; printf '\\000'; fi",
    "printf '\\004\\000'",
  ].join("\n");
};

const winTree = (root, rels) => `
$root = ${psQuote(root)}
$rels = @(${rels.map(psQuote).join(",")})
$item = Get-Item -LiteralPath $root
$stamp = '{0} {1}' -f $item.Length, ([DateTimeOffset]$item.LastWriteTimeUtc).ToUnixTimeSeconds()
[Console]::Out.Write([string][char]5 + $stamp + [char]0)
foreach ($rel in $rels) {
  $dir = if ([string]::IsNullOrEmpty($rel)) { $root } else { Join-Path $root $rel }
  [Console]::Out.Write([string][char]1 + $rel + [char]0)
  foreach ($row in @(Get-ChildItem -LiteralPath $dir -Force | Where-Object { $_.Name -ne '.git' } | Select-Object -First 501)) {
    $kind = if ($row.PSIsContainer -and -not ($row.Attributes -band [IO.FileAttributes]::ReparsePoint)) { 'd' } else { 'f' }
    [Console]::Out.Write($kind + [char]9 + $row.Name + [char]0)
  }
  [Console]::Out.Write([string][char]2 + [char]0)
}
$top = ''
& git -C $root rev-parse --show-toplevel 2>$null | ForEach-Object { $top = "$_".Trim() }
[Console]::Out.Write([string][char]3 + $top + [char]0)
if ($top) {
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = 'git'
  $psi.Arguments = '-C ' + ${windowsArg(root)} + ' status --porcelain=v1 -z --no-renames --untracked-files=normal'
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $false
  $psi.UseShellExecute = $false
  $psi.StandardOutputEncoding = [Text.UTF8Encoding]::new($false)
  $proc = [System.Diagnostics.Process]::Start($psi)
  $text = $proc.StandardOutput.ReadToEnd().Replace([char]0, [char]10)
  $proc.WaitForExit()
  [Console]::Out.Write($text)
}
[Console]::Out.Write([string][char]0 + [char]4 + [char]0)
`;

export function fileApi(platform, run) {
  const ps = (script, options) => powershell(run, "$ErrorActionPreference='Stop'; " + script, options);
  const mkdir = (path, options) => platform === "windows" ? ps(`[IO.Directory]::CreateDirectory(${psQuote(path)}) | Out-Null`, options) : run("mkdir", ["-p", path], options);
  const remove = (paths, { recursive = false, ...options } = {}) => platform === "windows"
    ? ps(`foreach ($path in @(${paths.map(psQuote).join(",")})) { if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Force${recursive ? " -Recurse" : ""} } }`, options)
    : run("rm", [recursive ? "-rf" : "-f", ...paths], options);
  const copy = (from, to, options) => platform === "windows" ? ps(`Copy-Item -LiteralPath ${psQuote(from)} -Destination ${psQuote(to)} -Force`, options) : run("cp", ["-f", from, to], options);
  const move = (from, to, options) => platform === "windows" ? ps(`Move-Item -LiteralPath ${psQuote(from)} -Destination ${psQuote(to)} -Force`, options) : run("mv", ["-f", from, to], options);
  const test = async (path, kind = "file", options) => {
    const r = platform === "windows"
      ? await ps(`if (${kind === "nonempty" ? `(Test-Path -LiteralPath ${psQuote(path)} -PathType Leaf) -and (Get-Item -LiteralPath ${psQuote(path)}).Length -gt 0` : `Test-Path -LiteralPath ${psQuote(path)}${kind === "directory" ? " -PathType Container" : kind === "file" ? " -PathType Leaf" : ""}`}) { exit 0 } else { exit 1 }`, options)
      : await run("test", [kind === "directory" ? "-d" : kind === "nonempty" ? "-s" : kind === "file" ? "-f" : "-e", path], options);
    if (r.code !== 0 && (r.code !== 1 || platform === "windows" && r.stderr?.trim())) checked(r);
    return r.code === 0;
  };
  const directory = async (path, options) => {
    if (platform === "windows") return jsonRows(checked(await ps(`@(Get-ChildItem -LiteralPath ${psQuote(path)} -Force | Where-Object { $_.Name -ne '.git' } | Select-Object -First 501 | ForEach-Object { @{name=$_.Name;dir=($_.PSIsContainer -and -not ($_.Attributes -band [IO.FileAttributes]::ReparsePoint))} }) | ConvertTo-Json -Compress`, options)).stdout);
  // -H follows only the folder itself (a link to a folder should open); entries are not followed.
  const fast = await run("find", ["-H", ".", "-mindepth", "1", "-maxdepth", "1", "!", "-name", ".git",
    "(", "-type", "d", "-print0", "-print0", "-o", "-print0", ")"], { ...options, cwd: path }).catch(() => null);
  if (fast?.code === 0) return pairEntries(fast.stdout.split("\0").slice(0, -1));
  // Fallback when find is missing or its output would pass exec's limit; one extra entry detects truncation.
  const script = `
n=0
find -H "$1" -mindepth 1 -maxdepth 1 ! -name .git -print0 2>/dev/null |
while IFS= read -r -d '' p; do
  name=\${p##*/}
  if [ -d "$p" ] && [ ! -L "$p" ]; then kind=d; else kind=f; fi
  printf '%s\\0%s\\0' "$kind" "$name"
  n=$((n+1))
  [ "$n" -ge ${500 + 1} ] && break
done
test -d "$1"`;
  const r = await run("bash", ["-c", script, "files", path], options);
  if (r.code !== 0) throw new Error(r.stderr || "Cannot list this folder");
  const fields = r.stdout.split("\0");
  return Array.from({ length: Math.floor(fields.length / 2) }, (_, k) => ({ name: fields[2 * k + 1], dir: fields[2 * k] === "d" }));
  };
  const existing = async (paths, kind = "file", options) => {
    if (!paths.length) return [];
    if (platform === "windows") return jsonRows(checked(await ps(`@(@(${paths.map(psQuote).join(",")}) | Where-Object { Test-Path -LiteralPath $_${kind === "directory" ? " -PathType Container" : kind === "file" ? " -PathType Leaf" : ""} }) | ConvertTo-Json -Compress`, options)).stdout);
    const flag = kind === "directory" ? "-d" : kind === "file" ? "-f" : "-e";
    const r = checked(await run("sh", ["-c", `for f; do [ ${flag} "$f" ] && printf "%s\\n" "$f"; done; true`, "sh", ...paths], options));
    return r.stdout.split("\n").filter(Boolean);
  };
  const legacyStatus = async (file) => {
    if (platform === "windows") return checked(await ps(`if (Test-Path -LiteralPath ${psQuote(file)} -PathType Leaf) { 'file' } elseif (Test-Path -LiteralPath ${psQuote(file)}) { 'other' } else { 'none' }`)).stdout.trim();
    return (await run("sh", ["-c", 'if [ -f "$1" ]; then echo file; elif out=$(LC_ALL=C ls -d "$1" 2>&1); then echo other; else case "$out" in *": No such file or directory") echo none;; *) echo "error: $out";; esac; fi', "sh", file])).stdout?.trim() ?? "";
  };
  const drain = async (dir) => {
    if (platform === "windows") return checked(await ps(`if (Test-Path -LiteralPath ${psQuote(dir)}) { Get-ChildItem -LiteralPath ${psQuote(dir)} -Filter '*.path' -File | ForEach-Object { [Console]::Write([IO.File]::ReadAllText($_.FullName)+[char]0); Remove-Item -LiteralPath $_.FullName -Force } }`));
    return run("sh", ["-c", 'for f in "$1"/*.path; do [ -f "$f" ] || continue; cat "$f"; printf "\\0"; rm -f "$f"; done', "sh", dir]);
  };
  const read = async (path, limit = 1048576, options) => platform === "windows"
    ? checked(await ps(`$s=[IO.File]::Open(${psQuote(path)},'Open','Read','ReadWrite'); try { $b=New-Object byte[] ([Math]::Min($s.Length,${Number(limit)})); $n=$s.Read($b,0,$b.Length); [Console]::Write([Text.Encoding]::UTF8.GetString($b,0,$n)) } finally { $s.Dispose() }`, options)).stdout
    : checked(await run("head", ["-c", String(limit), path], options)).stdout;
  const tree = async (root, rels = [], options) => {
    const folders = rels.length ? rels : [""];
    const r = platform === "windows" ? await ps(winTree(root, folders), options) : await run("sh", ["-c", unixTree(platform), "tree", root, ...folders], options);
    if (r.code !== 0 || r.truncated || /truncat/i.test(`${r.stdout ?? ""}${r.stderr ?? ""}`)) throw new Error(r.stderr || "Cannot list this folder");
    return r.stdout;
  };
  const walk = async (roots, { depth = 4, names = [], skip = ["node_modules", ".venv", "venv", "target", "dist", "build", ".next", ".turbo", ".cache", "vendor", "Pods", "DerivedData", "coverage", "__pycache__", ".Trash", "Library"], newer = null } = {}) => {
    if (!roots.length) return [];
    if (platform === "windows") return jsonRows(checked(await ps(`$skip=@(${skip.map(psQuote).join(",")}); $names=@(${names.map(psQuote).join(",")}); function walk($dir,$level) { if ($level -gt ${Number(depth)}) { return }; foreach ($f in Get-ChildItem -LiteralPath $dir -Force -ErrorAction Stop) { if (($f.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $skip -contains $f.Name) { continue }; if (($names.Count -eq 0 -or $names -contains $f.Name)${newer == null ? "" : ` -and $f.LastWriteTimeUtc -gt [DateTimeOffset]::FromUnixTimeMilliseconds(${Number(newer)}).UtcDateTime`}) { $f.FullName }; if ($f.PSIsContainer -and $skip -notcontains $f.Name -and $names -notcontains $f.Name) { walk $f.FullName ($level+1) } } }; @(foreach ($root in @(${roots.map(psQuote).join(",")})) { if (Test-Path -LiteralPath $root -PathType Container) { walk $root 1 } }) | ConvertTo-Json -Compress`)).stdout);
    const args = [...roots, "-maxdepth", String(depth), ...(skip.length ? ["(", ...skip.flatMap((name, i) => [...(i ? ["-o"] : []), "-name", name]), ")", "-prune", "-o"] : []), ...(names.length ? ["(", ...names.flatMap((name, i) => [...(i ? ["-o"] : []), "-name", name]), ")"] : []), ...(newer == null ? [] : ["-mmin", `-${Math.max(1, Math.ceil((Date.now() - newer) / 60000))}`]), "-print0"];
    const result = await run("find", args);
    if (result.code !== 0 && !result.stdout) checked(result);
    return result.stdout.split("\0").filter(Boolean);
  };
  const size = async (path) => platform === "windows"
    ? Number(checked(await ps(`$bytes=(Get-ChildItem -LiteralPath ${psQuote(path)} -Recurse -Force -File | Where-Object { -not ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) } | Measure-Object -Property Length -Sum).Sum; [Math]::Ceiling($bytes/1024)`)).stdout.trim())
    : Number(checked(await run("du", ["-sk", path])).stdout.trim().split(/\s+/)[0]);
  const stat = async (path, options) => {
    const r = platform === "windows"
      ? checked(await ps(`$i=Get-Item -LiteralPath ${psQuote(path)}; '{0} {1}' -f $i.Length, ([DateTimeOffset]$i.LastWriteTimeUtc).ToUnixTimeSeconds()`, options))
      : checked(await run("stat", platform === "macos" ? ["-f", "%z %m", path] : ["-c", "%s %Y", path], options));
    const [size, mtime] = r.stdout.trim().split(/\s+/).map(Number);
    return { size, mtime };
  };
  const encode = (path, range, options) => {
    const whole = !range || (range.offset === 0 && range.length == null);
    if (platform === "windows") return whole
      ? ps(`[Convert]::ToBase64String([IO.File]::ReadAllBytes(${psQuote(path)}))`, options)
      : ps(`$s=[IO.File]::OpenRead(${psQuote(path)}); try { [void]$s.Seek(${Number(range.offset)}, 'Begin'); $b=New-Object byte[] ${Number(range.length)}; $n=$s.Read($b,0,$b.Length); [Convert]::ToBase64String($b,0,$n) } finally { $s.Dispose() }`, options);
    if (!whole) return run("sh", ["-c", "tail -c +\"$2\" \"$1\" | head -c \"$3\" | base64", "slice", path, String(Number(range.offset) + 1), String(Number(range.length))], options);
    return platform === "macos" ? run("base64", ["-i", path], options) : run("base64", [path], options);
  };
  const decodeBase64File = async (from, to, options = {}) => {
    const { append: extra, ...rest } = options;
    if (extra) {
      const appended = platform === "windows"
        ? await ps(`[IO.File]::AppendAllText(${psQuote(from)}, [IO.File]::ReadAllText(${psQuote(extra)}))`, rest)
        : await run("sh", ["-c", "cat \"$1\" >> \"$2\"", "cat", extra, from], rest);
      checked(appended);
    }
    if (to == null) return;
    const decoded = platform === "windows"
      ? await ps(`[IO.File]::WriteAllBytes(${psQuote(to)}, [Convert]::FromBase64String(([IO.File]::ReadAllText(${psQuote(from)}) -replace '\\s','')))`, rest)
      : platform === "macos"
        ? await run("base64", ["-D", "-i", from, "-o", to], rest)
        : await run("sh", ["-c", "base64 -d \"$1\" > \"$2\"", "b64", from, to], rest);
    checked(decoded);
  };
  const touch = async (paths) => {
    if (platform === "windows") return ps(`foreach ($file in @(${paths.map(psQuote).join(",")})) { [IO.File]::WriteAllText($file,'') }`);
    if (!paths.length) return { code: 0, stdout: "" };
    return run("touch", paths);
  };
  const recent = async (paths, since) => {
    if (!paths.length) return false;
    if (platform === "windows") return jsonRows(checked(await ps(`@(@(${paths.map(psQuote).join(",")}) | Where-Object { (Test-Path -LiteralPath $_) -and (Get-Item -LiteralPath $_ -Force).LastWriteTimeUtc -gt [DateTimeOffset]::FromUnixTimeMilliseconds(${Number(since)}).UtcDateTime }) | ConvertTo-Json -Compress`)).stdout).length > 0;
    const result = await run("find", [...paths, "-maxdepth", "0", "-mmin", `-${Math.max(1, Math.ceil((Date.now() - since) / 60000))}`, "-print0"]);
    if (result.code !== 0 && !result.stdout) checked(result);
    return Boolean(result.stdout);
  };
  const write = async (path, text, expected, options) => {
    try {
      await writeSteps(platform, path, text, expected).reduce(async (done, step) => {
        await done;
        const result = step.script ? await ps(step.script, options) : await run(step.cmd, step.args, options);
        if (result.code === 3) throw new SaveConflict();
        checked(result);
      }, Promise.resolve());
    } catch (error) {
      await remove(writeTemps(path), options).catch(() => {});
      throw error;
    }
  };
  const migrate = (from, to) => platform === "windows"
    ? ps(`$from=${psQuote(from)}; $to=${psQuote(to)}; if (-not (Test-Path -LiteralPath (Join-Path $to 'store.json')) -and (Test-Path -LiteralPath $from -PathType Container)) { [IO.Directory]::CreateDirectory($to) | Out-Null; Get-ChildItem -LiteralPath $from -Force | Copy-Item -Destination $to -Recurse -Force; Get-ChildItem -LiteralPath $to -Filter '*.lock' -Force | Remove-Item -Force -Recurse }`)
    : run("sh", ["-c", 'if [ ! -e "$2/store.json" ] && [ -d "$1" ]; then mkdir -p "$2" && cp -R "$1/." "$2/" && rm -rf "$2"/*.lock; fi', "sh", from, to]);
  return { recent, migrate, mkdir, remove, copy, move, test, directory, existing, legacyStatus, drain, read, walk, size, touch, stat, encode, tree, decodeBase64File, write };
}

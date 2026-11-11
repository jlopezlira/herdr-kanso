import { exists, mkdir, unlink } from "fs/promises";
import { powershell, psQuote, windowsArg } from "./platform-command.js";
import { sleepFor } from "./platform-host.js";
import { paths } from "./platform-paths.js";

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

const utf8Bytes = (c) => c < 0x80 ? [c]
  : c < 0x800 ? [0xc0 | (c >> 6), 0x80 | (c & 0x3f)]
  : c < 0x10000 ? [0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f)]
  : [0xf0 | (c >> 18), 0x80 | ((c >> 12) & 0x3f), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f)];

const base64 = (bytes) => Array.from({ length: Math.ceil(bytes.length / 3) }, (_, i) => {
  const a = bytes[i * 3], b = bytes[i * 3 + 1], c = bytes[i * 3 + 2];
  const n = (a << 16) | ((b ?? 0) << 8) | (c ?? 0);
  return B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + (b == null ? "=" : B64[(n >> 6) & 63]) + (c == null ? "=" : B64[n & 63]);
}).join("");

const utf16leBytes = (text) => [...text].flatMap((ch) => {
  const units = ch.length === 1 ? [ch.charCodeAt(0)] : [ch.charCodeAt(0), ch.charCodeAt(1)];
  return units.flatMap((code) => [code & 255, code >> 8]);
});

export function utf8Base64(text) {
  return base64([...String(text).matchAll(/./gsu)].flatMap((m) => utf8Bytes(m[0].codePointAt(0))));
}

const encodeCommand = (script) => base64(utf16leBytes(script));

const driveRoot = (value) => {
  const text = String(value).replace(/\//g, "\\");
  const drive = /^[A-Za-z]:/.exec(text);
  if (drive) return drive[0].toUpperCase();
  if (text.startsWith("\\\\")) return "\\\\";
  return "/";
};
export const sameVolume = (stage, home) => driveRoot(stage) === driveRoot(home);

const LIB = [
  "function Write-Utf8([string]$Path, [string]$Text) {",
  "  $enc = New-Object System.Text.UTF8Encoding $false",
  "  [IO.File]::WriteAllText($Path, $Text, $enc)",
  "}",
  "function Note([string]$Line) {",
  "  [Console]::Error.WriteLine($Line)",
  "  [Console]::Error.Flush()",
  "  if (-not $id) { return }",
  "  try {",
  "    $enc = New-Object System.Text.UTF8Encoding $false",
  "    [IO.File]::AppendAllText((Join-Path $dir ($id + '.log')), ($Line + [char]10), $enc)",
  "  } catch {}",
  "}",
  "function Say([string]$State, [string]$Why) {",
  "  $part = Join-Path $dir ($id + '.status.part')",
  "  Write-Utf8 $part ($State + [char]10 + $Why + [char]10)",
  "  Move-Item -LiteralPath $part -Destination (Join-Path $dir ($id + '.status')) -Force",
  "}",
  "function Last-Log {",
  "  if (-not $id) { return '' }",
  "  $p = Join-Path $dir ($id + '.log')",
  "  if (-not (Test-Path -LiteralPath $p)) { return '' }",
  "  $raw = [IO.File]::ReadAllText($p)",
  "  $lines = @($raw -split [char]10 | Where-Object { $_ -ne '' })",
  "  if ($lines.Count -eq 0) { return '' }",
  "  return ([string]$lines[-1]).TrimEnd([char]13)",
  "}",
  "function Remove-Self {",
  "  if ($script:self) { Remove-Item -LiteralPath $script:self -Force -ErrorAction SilentlyContinue }",
  "}",
  "function Clear-Scripts {",
  "  if (-not (Test-Path -LiteralPath $dir)) { return }",
  "  Get-ChildItem -LiteralPath $dir -File -Filter *.ps1 -ErrorAction SilentlyContinue | ForEach-Object {",
  "    if ($_.FullName -ne $script:self) { Remove-Item -LiteralPath $_.FullName -Force -ErrorAction SilentlyContinue }",
  "  }",
  "}",
  "function Test-Sharing($Err) {",
  "  $ex = $Err.Exception",
  "  while ($ex) {",
  "    if ($ex.HResult -eq -2147024864) { return $true }",
  "    if ([string]$ex.Message -match 'being used by another process') { return $true }",
  "    $ex = $ex.InnerException",
  "  }",
  "  return $false",
  "}",
  "function Clear-Readonly([string]$Path) {",
  "  if (-not (Test-Path -LiteralPath $Path)) { return }",
  "  $items = @(Get-ChildItem -LiteralPath $Path -Force -Recurse -ErrorAction SilentlyContinue)",
  "  foreach ($item in $items) {",
  "    if ($item.Attributes -band [IO.FileAttributes]::ReadOnly) { $item.Attributes = $item.Attributes -band (-bnot [IO.FileAttributes]::ReadOnly) }",
  "  }",
  "  $self = Get-Item -LiteralPath $Path -Force",
  "  if ($self.Attributes -band [IO.FileAttributes]::ReadOnly) { $self.Attributes = $self.Attributes -band (-bnot [IO.FileAttributes]::ReadOnly) }",
  "}",
  "function Unlock-Tree([string]$Path) {",
  "  if (-not (Test-Path -LiteralPath $Path)) { return }",
  "  Clear-Readonly $Path",
  // A denied tree writes an error per file. Piping that fills the buffer and icacls never returns.
  "  $quoted = '\"' + $Path.Replace('\"', '\"\"') + '\"'",
  "  & cmd.exe /d /c ('icacls.exe ' + $quoted + ' /reset /T /C /Q >NUL 2>&1 <NUL')",
  "}",
  "function Join-Rel([string]$Root, [string]$Rel) {",
  "  $path = $Root",
  "  foreach ($part in ($Rel -split '/')) { if ($part) { $path = Join-Path $path $part } }",
  "  return $path",
  "}",
  "function Assert-Volume([string]$From, [string]$To) {",
  "  $rootFrom = [IO.Path]::GetPathRoot([IO.Path]::GetFullPath($From))",
  "  $parent = Split-Path -Parent $To",
  "  if ($parent -and -not (Test-Path -LiteralPath $parent)) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }",
  "  $rootTo = [IO.Path]::GetPathRoot([IO.Path]::GetFullPath($(if ($parent) { $parent } else { $To })))",
  "  if ($rootFrom.ToUpperInvariant() -ne $rootTo.ToUpperInvariant()) { throw ('another drive ' + $From) }",
  "}",
  "function Test-There([string]$Path) {",
  "  if (-not $Path) { return $false }",
  "  try { return Test-Path -LiteralPath $Path -ErrorAction Stop } catch { return $true }",
  "}",
  "function Move-Update([string]$From, [string]$To) {",
  "  Assert-Volume $From $To",
  "  Clear-Readonly $From",
  "  $budget = 3000",
  "  $parsed = 0",
  "  if ([int]::TryParse([string]$env:KANSO_UPDATE_RETRY_MS, [ref]$parsed)) { if ($parsed -ge 0) { $budget = $parsed } }",
  "  $deadline = (Get-Date).AddMilliseconds($budget)",
  "  while ($true) {",
  "    try { Move-Item -LiteralPath $From -Destination $To -Force; return }",
  "    catch {",
  "      if ((Test-There $From) -and (Test-There $To)) {",
  "        $kids = @(Get-ChildItem -LiteralPath $To -Force -ErrorAction SilentlyContinue)",
  "        if ($kids.Count -eq 0) { Remove-Item -LiteralPath $To -Force -ErrorAction SilentlyContinue }",
  "      }",
  "      if ((Test-Sharing $_) -and ((Get-Date) -lt $deadline)) { Start-Sleep -Milliseconds 100; continue }",
  "      throw",
  "    }",
  "  }",
  "}",
  "function Try-Move([string]$From, [string]$To) {",
  "  try { Move-Update $From $To; return $true } catch {",
  "    Unlock-Tree $From",
  "    if (Test-There $To) {",
  "      Unlock-Tree $To",
  "      if (Test-There $From) { Remove-Item -LiteralPath $To -Recurse -Force -ErrorAction SilentlyContinue }",
  "    }",
  "    try { Move-Update $From $To; return $true } catch { return $false }",
  "  }",
  "}",
  "function Step {",
  "  $script:n = $script:n + 1",
  "  $stop = 0",
  "  [void][int]::TryParse([string]$env:KANSO_UPDATE_STOP, [ref]$stop)",
  "  if ($stop -ne 0 -and $script:n -eq $stop) { [Environment]::Exit(137) }",
  "}",
  "function Hold([string]$Lock) {",
  "  try {",
  "    $script:lockStream = [IO.File]::Open($Lock, [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)",
  "    return 0",
  "  } catch {",
  "    if (Test-Sharing $_) { return 75 }",
  "    return 1",
  "  }",
  "}",
  "function Set-Slot([string]$Name) {",
  "  if ($Name -eq 'keys') {",
  "    $script:L = Join-Path $AppHome 'keys.json'",
  "    $script:B = Join-Rel $script:st 'old/keys.json'",
  "    $script:S = Join-Path $script:st 'keys.json'",
  "  } elseif ($Name -eq 'layout') {",
  "    $script:L = Join-Rel $AppHome 'layouts/kanso.json'",
  "    $script:B = Join-Rel $script:st 'old/kanso.json'",
  "    $script:S = Join-Path $script:st 'kanso.json'",
  "  } elseif ($Name -eq 'picture') {",
  "    $script:L = Join-Rel $AppHome 'layouts/kanso.png'",
  "    $script:B = Join-Rel $script:st 'old/kanso.png'",
  "    $script:S = Join-Rel $script:st 'src/kanso/layouts/kanso.png'",
  "  } elseif ($Name.StartsWith('themes/')) {",
  "    $script:L = Join-Rel $AppHome $Name",
  "    $script:B = Join-Rel (Join-Rel $script:st 'old') $Name",
  "    $script:S = Join-Rel (Join-Rel $script:st 'src/kanso') $Name",
  "  } else {",
  "    $script:L = Join-Path (Join-Path $AppHome 'mods') $Name",
  "    $script:B = Join-Rel $script:st ('old/mods/' + $Name)",
  "    $script:S = Join-Rel $script:st ('src/kanso/mods/' + $Name)",
  "  }",
  "}",
  "function Fail-Put([string]$Name, [string]$Path, [string]$Detail) {",
  "  $flat = [string]$Detail",
  "  if ($flat) { $flat = (($flat -split [char]10)[0] -split [char]13)[0] }",
  "  $script:why = 'could not put ' + $Name + ' in place: ' + $Path",
  "  if ($flat) { $script:why = $script:why + ' ' + $flat }",
  "  Note $script:why",
  "}",
  "function Swap([string]$Had, [string]$Name) {",
  "  Set-Slot $Name",
  "  if ($Had -eq '1' -and (Test-There $script:S) -and (Test-There $script:L) -and -not (Test-There $script:B)) {",
  "    try { Move-Update $script:L $script:B } catch { Fail-Put $Name $script:L ([string]$_.Exception.Message); return $false }",
  "    Step",
  "  }",
  "  if ((Test-There $script:S) -and -not (Test-There $script:L)) {",
  "    try { Move-Update $script:S $script:L } catch { Fail-Put $Name $script:S ([string]$_.Exception.Message); return $false }",
  "    Step",
  "  }",
  "  return $true",
  "}",
  "function Read-Slots {",
  "  $p = Join-Path $script:st 'slots'",
  "  if (-not (Test-Path -LiteralPath $p)) { return @() }",
  "  $raw = [IO.File]::ReadAllText($p)",
  "  if ([string]::IsNullOrEmpty($raw)) { return @() }",
  "  return @($raw -split [char]10 | ForEach-Object { $_.TrimEnd([char]13) } | Where-Object { $_ -ne '' })",
  "}",
  "function Write-Slots($Lines) {",
  "  $list = @()",
  "  foreach ($line in @($Lines)) { if ($line) { $list += [string]$line } }",
  "  $text = ''",
  "  if ($list.Count -gt 0) { $text = ($list -join [char]10) + [char]10 }",
  "  Write-Utf8 (Join-Path $script:st 'slots') $text",
  "}",
  "function Undo([string]$Had, [string]$Name) {",
  "  Set-Slot $Name",
  "  if (-not (Test-There $script:S) -and (Test-There $script:L)) {",
  "    if (-not (Try-Move $script:L $script:S)) { return $false }",
  "    Step",
  "  }",
  "  if ($Had -eq '1' -and (Test-There $script:B) -and (Test-There $script:L) -and (Test-There $script:S)) {",
  "    Unlock-Tree $script:L",
  "    Remove-Item -LiteralPath $script:L -Recurse -Force -ErrorAction SilentlyContinue",
  "  }",
  "  if ($Had -eq '1' -and (Test-There $script:B) -and -not (Test-There $script:L)) {",
  "    if (-not (Try-Move $script:B $script:L)) { return $false }",
  "    Step",
  "  }",
  "  $sOk = Test-There $script:S",
  "  $lOk = Test-There $script:L",
  "  $bOk = Test-There $script:B",
  "  if (-not ($sOk -and (($Had -eq '0') -or ($lOk -and -not $bOk)))) { return $false }",
  "  $line = $Had + ' ' + $Name",
  "  $left = @()",
  "  foreach ($row in @(Read-Slots)) { if ($row -ne $line) { $left += $row } }",
  "  Write-Slots $left",
  "  Step",
  "  return $true",
  "}",
  "function Slot-Had([string]$Row) {",
  "  $i = $Row.IndexOf(' ')",
  "  return @($Row.Substring(0, $i), $Row.Substring($i + 1))",
  "}",
  "function Forward {",
  "  foreach ($row in @(Read-Slots)) {",
  "    $pair = @(Slot-Had ([string]$row))",
  "    if (-not (Swap $pair[0] $pair[1])) { return $false }",
  "  }",
  "  return $true",
  "}",
  "function Backward {",
  "  $lines = @()",
  "  foreach ($row in @(Read-Slots)) { $lines += [string]$row }",
  "  if ($lines.Count -gt 1) { [array]::Reverse($lines) }",
  "  foreach ($row in $lines) {",
  "    $pair = @(Slot-Had $row)",
  "    if (-not (Undo $pair[0] $pair[1])) { return $false }",
  "  }",
  "  return $true",
  "}",
  "function Keep {",
  "  $old = Join-Rel $script:st 'old/kanso.json'",
  "  if (Test-Path -LiteralPath $old) {",
  "    $stampText = [IO.File]::ReadAllText((Join-Path $script:st 'stamp')).Trim()",
  "    Move-Update $old (Join-Path (Join-Rel $AppHome 'layouts') ('kanso.json.old-' + $stampText))",
  "    Step",
  "  }",
  "  return $true",
  "}",
  "function Settle {",
  "  try {",
  "    Unlock-Tree $script:st",
  "    $slots = Join-Path $script:st 'slots'",
  "    if (Test-Path -LiteralPath $slots) {",
  "      if (Test-Path -LiteralPath (Join-Path $script:st 'committed')) { if (-not (Keep)) { return $false } }",
  "      else { if (-not (Backward)) { return $false } }",
  "      Remove-Item -LiteralPath $slots -Force",
  "      Step",
  "    }",
  "    Unlock-Tree $script:st",
  "    Remove-Item -LiteralPath $script:st -Recurse -Force -ErrorAction SilentlyContinue",
  "    if (Test-Path -LiteralPath $script:st) { return $false }",
  "    return $true",
  "  } catch { return $false }",
  "}",
  "function Recover-Stages {",
  "  if (-not (Test-Path -LiteralPath $dir)) { return $true }",
  "  Clear-Scripts",
  "  $leaf = ''",
  "  if ($stage) { $leaf = Split-Path -Leaf $stage }",
  "  foreach ($d in @(Get-ChildItem -LiteralPath $dir -Directory -ErrorAction SilentlyContinue)) {",
  "    if ($leaf -and $d.Name -eq $leaf) { continue }",
  "    $script:st = $d.FullName",
  "    if (-not (Settle)) {",
  "      $script:why = 'an update that stopped could not be undone; its files are in ' + $d.FullName",
  "      Note $script:why",
  "      return $false",
  "    }",
  "  }",
  "  return $true",
  "}",
  "function From-B64([string]$Text) {",
  "  if ([string]::IsNullOrEmpty($Text)) { return '' }",
  "  return [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($Text))",
  "}",
  "function Version-Of([string]$Path) {",
  "  if (-not (Test-Path -LiteralPath $Path)) { return '' }",
  "  $m = [regex]::Match([IO.File]::ReadAllText($Path), '\"version\"\\s*:\\s*\"([^\"]*)\"')",
  "  if ($m.Success) { return $m.Groups[1].Value }",
  "  return ''",
  "}",
  "function Die([int]$Code, [string]$Message) {",
  "  $script:code = $Code",
  "  if ($Message) { $script:why = $Message; Note $Message }",
  "  throw 'kanso-update'",
  "}",
  "function Require-Tool([string]$Name) {",
  "  if (-not (Get-Command ($Name + '.exe') -ErrorAction SilentlyContinue)) {",
  "    Die 1 ($Name + '.exe is not on PATH; nothing was downloaded another way')",
  "  }",
  "}",
].join("\n");

const INSTALL_MAIN = [
  "try {",
  "  $taken = Hold (Join-Path $dir 'lock')",
  "  if ($taken -ne 0) {",
  "    if ($taken -ne 75) { Die 1 'the update lock could not be taken' }",
  "    $script:code = 75",
  "    throw 'kanso-update'",
  "  }",
  "  Say 'running' 'download'",
  "  if (-not (Recover-Stages)) { $script:code = 1; throw 'kanso-update' }",
  "  $limit = (Get-Date).AddDays(-1)",
  "  Get-ChildItem -LiteralPath $dir -File -ErrorAction SilentlyContinue | ForEach-Object {",
  "    if ($_.Name -eq 'lock') { return }",
  "    if ($_.Name -like ($id + '.*')) { return }",
  "    if ($_.LastWriteTime -lt $limit) { Remove-Item -LiteralPath $_.FullName -Force -ErrorAction SilentlyContinue }",
  "  }",
  "  $have = Version-Of (Join-Rel $AppHome 'mods/kanso-chrome/version.json')",
  "  if ($have -ne $from) {",
  "    $shown = $have",
  "    if (-not $shown) { $shown = 'another version' }",
  "    Die 4 ('kansō is already at ' + $shown)",
  "  }",
  "  if ($baseText -ne '') {",
  "    $cur = ''",
  "    $kp = Join-Path $AppHome 'keys.json'",
  "    if (Test-Path -LiteralPath $kp) { $cur = [IO.File]::ReadAllText($kp) }",
  "    if ($cur -ne $baseText) { Die 1 'your keys.json changed while the update was prepared; try again' }",
  "  }",
  "  Require-Tool 'curl'",
  "  Require-Tool 'tar'",
  "  $srcDir = Join-Path $stage 'src'",
  "  New-Item -ItemType Directory -Force -Path $srcDir | Out-Null",
  "  $tarball = Join-Path $stage 'release.tar.gz'",
  "  & curl.exe @('-fsSL', '--max-time', '120', '-o', $tarball, $url)",
  "  if ($LASTEXITCODE -ne 0) { Die 1 'the download failed' }",
  "  & tar.exe @('-xzf', $tarball, '-C', $srcDir, '--strip-components=1')",
  "  if ($LASTEXITCODE -ne 0) { Die 1 'the download could not be opened' }",
  "  Remove-Item -LiteralPath $tarball -Force -ErrorAction SilentlyContinue",
  "  $src = Join-Path $srcDir 'kanso'",
  "  $got = Version-Of (Join-Rel $src 'mods/kanso-chrome/version.json')",
  "  if ($got -ne $want) {",
  "    $shown = $got",
  "    if (-not $shown) { $shown = 'no version' }",
  "    Die 3 ('the v' + $want + ' release says it is ' + $shown)",
  "  }",
  "  Say 'running' 'check'",
  "  foreach ($d in @(Get-ChildItem -LiteralPath (Join-Path $src 'mods') -Directory | Sort-Object Name)) {",
  "    $name = $d.Name",
  "    $modPath = $d.FullName",
  "    $out = ''",
  "    $bad = $false",
  "    try { $out = & $checker @('check', $modPath) 2>&1 | Out-String; if ($LASTEXITCODE -ne 0) { $bad = $true } } catch { $bad = $true; $out = [string]$_.Exception.Message }",
  "    if ($bad) {",
  "      $bits = @($out -split [char]10 | ForEach-Object { $_.TrimEnd([char]13) } | Where-Object { $_ -ne '' })",
  "      $last = ''",
  "      if ($bits.Count -gt 0) { $last = [string]$bits[-1] }",
  "      Die 1 ($name + ' does not load on this Herdr: ' + $last)",
  "    }",
  "  }",
  "  if ($keysText -ne '') { Write-Utf8 (Join-Path $stage 'keys.json') ($keysText + [char]10) }",
  "  if ($layoutFlag -eq '1') { Copy-Item -LiteralPath (Join-Rel $src 'layouts/kanso.json') -Destination (Join-Path $stage 'kanso.json') -Force }",
  "  foreach ($rel in @('old/mods', 'old/themes')) { New-Item -ItemType Directory -Force -Path (Join-Rel $stage $rel) | Out-Null }",
  "  foreach ($rel in @('mods', 'themes', 'layouts')) { New-Item -ItemType Directory -Force -Path (Join-Rel $AppHome $rel) | Out-Null }",
  "  Write-Utf8 (Join-Path $stage 'stamp') ($stamp + [char]10)",
  "  $script:st = $stage",
  "  $script:journal = New-Object System.Collections.Generic.List[string]",
  "  function Add-Entry([string]$Name) {",
  "    Set-Slot $Name",
  "    if (-not (Test-Path -LiteralPath $script:S)) { return }",
  "    if (Test-Path -LiteralPath $script:L) { [void]$script:journal.Add('1 ' + $Name) } else { [void]$script:journal.Add('0 ' + $Name) }",
  "  }",
  "  Add-Entry 'keys'",
  "  Add-Entry 'layout'",
  "  Add-Entry 'picture'",
  "  $themeDir = Join-Path $src 'themes'",
  "  if (Test-Path -LiteralPath $themeDir) {",
  "    foreach ($t in @(Get-ChildItem -LiteralPath $themeDir -Filter '*.json' -File | Sort-Object Name)) { Add-Entry ('themes/' + $t.Name) }",
  "  }",
  "  foreach ($d in @(Get-ChildItem -LiteralPath (Join-Path $src 'mods') -Directory | Sort-Object Name)) {",
  "    if ($d.Name -ne 'kanso-tabs' -and $d.Name -ne 'kanso-chrome') { Add-Entry $d.Name }",
  "  }",
  "  Add-Entry 'kanso-tabs'",
  "  Add-Entry 'kanso-chrome'",
  "  $slotText = ''",
  "  if ($script:journal.Count -gt 0) { $slotText = ($script:journal -join [char]10) + [char]10 }",
  "  Write-Utf8 (Join-Path $stage 'slots.part') $slotText",
  "  Say 'running' 'swap'",
  "  Move-Item -LiteralPath (Join-Path $stage 'slots.part') -Destination (Join-Path $stage 'slots') -Force",
  "  if (-not (Forward)) { $script:code = 1; throw 'kanso-update' }",
  "  New-Item -ItemType File -Force -Path (Join-Path $stage 'committed') | Out-Null",
  "  Step",
  "  $script:st = $stage",
  "  if (-not (Settle)) { $script:code = 1; throw 'kanso-update' }",
  "  $script:code = 0",
  "} catch {",
  "  if (-not $script:why) {",
  "    $script:why = [string]$_.Exception.Message",
  "    if ($script:why -eq 'kanso-update' -or -not $script:why) { $script:why = 'the update failed' }",
  "    Note $script:why",
  "  }",
  "  if ($script:code -eq 0) { $script:code = 1 }",
  "} finally {",
  "  if ($stage -and (Test-Path -LiteralPath $stage)) {",
  "    $script:st = $stage",
  "    if (-not (Settle)) {",
  "      $extra = '; what you had is in ' + (Join-Path $stage 'old')",
  "      if ($script:why) { $script:why = $script:why + $extra } else { $script:why = 'the update failed' + $extra }",
  "    }",
  "  }",
  "  $reason = $script:why",
  "  if (-not $reason) { $reason = Last-Log }",
  "  $state = 'error'",
  "  if ($script:code -eq 0) { $state = 'ok'; $reason = '' }",
  "  elseif ($script:code -eq 75) { $state = 'busy'; $reason = '' }",
  "  elseif ($script:code -eq 4) { $state = 'already'; if (-not $reason) { $reason = '' } }",
  "  else { if (-not $reason) { $reason = 'the update failed' } }",
  "  try { Say $state $reason } catch {}",
  "  Remove-Self",
  "}",
  "exit $script:code",
].join("\n");

const RECOVER_MAIN = [
  "try {",
  "  if (-not (Test-Path -LiteralPath $dir)) { Remove-Self; exit 0 }",
  "  $dirs = @(Get-ChildItem -LiteralPath $dir -Directory -ErrorAction SilentlyContinue)",
  "  if ($dirs.Count -eq 0) { Remove-Self; exit 0 }",
  "  $taken = Hold (Join-Path $dir 'lock')",
  "  if ($taken -ne 0) { Remove-Self; exit $taken }",
  "  if (-not (Recover-Stages)) { Remove-Self; exit 1 }",
  "  Remove-Self",
  "  exit 0",
  "} catch {",
  "  if ($script:why) { Remove-Self; exit 1 }",
  "  Note ([string]$_.Exception.Message)",
  "  Remove-Self",
  "  exit 1",
  "}",
].join("\n");

const header = (lines) => ["$ErrorActionPreference = 'Stop'", "$ProgressPreference = 'SilentlyContinue'", "$script:n = 0", "$script:code = 1", "$script:why = $null", "$script:lockStream = $null", ...lines].join("\n");

export function windowsInstallScript(spec, self) {
  const body = header([
    `$url = ${psQuote(spec.url)}`,
    `$AppHome = ${psQuote(spec.home)}`,
    `$dir = ${psQuote(spec.dir)}`,
    `$id = ${psQuote(spec.id)}`,
    `$want = ${psQuote(spec.want)}`,
    `$from = ${psQuote(spec.from ?? "")}`,
    `$checker = ${psQuote(spec.checker)}`,
    `$stamp = ${psQuote(spec.stamp)}`,
    `$layoutFlag = ${psQuote(spec.layout ?? "")}`,
    `$keysText = From-B64 ${psQuote(utf8Base64(spec.keys ?? ""))}`,
    `$baseText = From-B64 ${psQuote(utf8Base64(spec.base ?? ""))}`,
    "$stage = Join-Path $dir $id",
    `$script:self = ${psQuote(self)}`,
  ]);
  return `${LIB}\n${body}\n${INSTALL_MAIN}`;
}

export function windowsRecoverScript(home, dir, self) {
  const body = header([
    `$AppHome = ${psQuote(home)}`,
    `$dir = ${psQuote(dir)}`,
    "$id = ''",
    "$stage = ''",
    "$from = ''",
    "$want = ''",
    "$checker = ''",
    "$stamp = ''",
    "$layoutFlag = ''",
    "$keysText = ''",
    "$baseText = ''",
    "$url = ''",
    `$script:self = ${psQuote(self)}`,
    "$script:code = 0",
  ]);
  return `${LIB}\n${body}\n${RECOVER_MAIN}`;
}

export function windowsLaunchScript(dir, id, file) {
  const pid = paths.join(dir, `${id}.pid`);
  return [
    "$exe = (Get-Process -Id $PID).Path",
    // Shell execute passes no handle on, so exec's pipes close when this script ends, not the install.
    `$proc = Start-Process -FilePath $exe -ArgumentList ('-NoProfile -NonInteractive -File ' + ${psQuote(windowsArg(file))}) -WindowStyle Hidden -PassThru`,
    "$enc = New-Object System.Text.UTF8Encoding $false",
    `[IO.File]::WriteAllText(${psQuote(pid)}, ([string]$proc.Id + [char]10), $enc)`,
  ].join("; ");
}

export function windowsHoldScript(lockPath) {
  return [
    "$ErrorActionPreference = 'Stop'",
    "try {",
    `  $script:lockStream = [IO.File]::Open(${psQuote(lockPath)}, [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)`,
    "} catch {",
    "  if ($_.Exception.HResult -eq -2147024864 -or ($_.Exception.InnerException -and $_.Exception.InnerException.HResult -eq -2147024864) -or ([string]$_.Exception.Message -match 'being used by another process')) { exit 75 }",
    "  exit 1",
    "}",
    // Console.Out is not the redirected stdout pipe, so the holder never says held and then sleeps.
    "$script:heldOut = New-Object System.IO.StreamWriter -ArgumentList ([Console]::OpenStandardOutput())",
    "$script:heldOut.AutoFlush = $true",
    "$script:heldOut.WriteLine('held')",
    "while ($true) { Start-Sleep -Seconds 60 }",
  ].join("\n");
}

async function runPowershellFile(run, file, options) {
  const args = ["-NoProfile", "-NonInteractive", "-File", file];
  const first = await run("pwsh", args, options);
  const result = first && first.code !== "ENOENT" && first.code !== 127 && first.code !== 9009 ? first : await run("powershell", args, options);
  // The interpreter holds the script open, so the script cannot delete itself.
  try { await unlink(file); } catch { /* already gone */ }
  return result;
}

async function place(dir, name, text, writeTextFile) {
  await mkdir(dir, { recursive: true });
  const file = paths.join(dir, name);
  if (await exists(file)) await unlink(file);
  // PowerShell 5.1 reads a file with no BOM as the system code page.
  await writeTextFile(file, `\uFEFF${text}`, null);
  return file;
}

function posixHost(platform, run, scripts) {
  const { INSTALL_SCRIPT, RECOVER, LAUNCH, HOLD } = scripts;
  const installArgs = (spec) => ["-c", INSTALL_SCRIPT, "sh", spec.url, spec.home, spec.dir, spec.id, spec.want, spec.from, spec.checker, spec.stamp, spec.keys, spec.layout, spec.base];
  return {
    launch(spec) {
      return run("sh", ["-c", LAUNCH, "sh", spec.dir, spec.id, INSTALL_SCRIPT, spec.url, spec.home, spec.dir, spec.id, spec.want, spec.from, spec.checker, spec.stamp, spec.keys, spec.layout, spec.base]);
    },
    recover(home, dir) { return run("sh", ["-c", RECOVER, "sh", home, dir]); },
    alive(pidFile) { return run("sh", ["-c", 'kill -0 "$(cat "$1")" 2>/dev/null', "sh", pidFile]); },
    fetch(url) { return run("curl", ["-fsSL", "--max-time", "15", url]); },
    claim(from, to) { return run("mv", [from, to]); },
    clear(files) { return run("rm", ["-f", ...files]); },
    pause(seconds) { return sleepFor(platform, run, seconds); },
    foreground(spec, options) { return run("sh", installArgs(spec), options); },
    holdArgs(lockPath) {
      return { commands: ["sh"], args: ["-c", `${HOLD}\nhold "$1" || exit $?\necho held\nexec sleep 60`, "sh", lockPath] };
    },
  };
}

function windowsHost(run, writeTextFile) {
  return {
    async launch(spec) {
      const name = `${spec.id}.ps1`;
      const file = await place(spec.dir, name, windowsInstallScript(spec, paths.join(spec.dir, name)), writeTextFile);
      return powershell(run, windowsLaunchScript(spec.dir, spec.id, file));
    },
    async recover(home, dir) {
      if (!(await exists(dir))) return { code: 0, stdout: "", stderr: "" };
      const name = `recover-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}.ps1`;
      const file = await place(dir, name, windowsRecoverScript(home, dir, paths.join(dir, name)), writeTextFile);
      return runPowershellFile(run, file);
    },
    alive(pidFile) {
      const q = psQuote(pidFile);
      return powershell(run, `$raw=''; if (Test-Path -LiteralPath ${q}) { $raw = [IO.File]::ReadAllText(${q}) }; $n=0; if (-not [int]::TryParse($raw.Trim(), [ref]$n) -or $n -le 0) { exit 1 }; try { $p = Get-Process -Id $n -ErrorAction SilentlyContinue } catch { exit 1 }; if ($p) { exit 0 }; exit 1`);
    },
    fetch(url) { return run("curl.exe", ["-fsSL", "--max-time", "15", url]); },
    claim(from, to) { return powershell(run, `Move-Item -LiteralPath ${psQuote(from)} -Destination ${psQuote(to)} -Force`); },
    clear(files) {
      return powershell(run, files.map((file) => `Remove-Item -LiteralPath ${psQuote(file)} -Force -ErrorAction SilentlyContinue`).join("; "));
    },
    pause(seconds) { return sleepFor("windows", run, seconds); },
    async foreground(spec, options) {
      const name = `${spec.id}.ps1`;
      const file = await place(spec.dir, name, windowsInstallScript(spec, paths.join(spec.dir, name)), writeTextFile);
      return runPowershellFile(run, file, options);
    },
    holdArgs(lockPath) {
      return { commands: ["pwsh", "powershell"], args: ["-NoProfile", "-NonInteractive", "-EncodedCommand", encodeCommand(windowsHoldScript(lockPath))] };
    },
  };
}

export function updateHost(platform, run, writeTextFile, scripts) {
  return platform === "windows" ? windowsHost(run, writeTextFile) : posixHost(platform, run, scripts);
}

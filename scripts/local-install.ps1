$ErrorActionPreference = 'Stop'

$Root = Split-Path -Parent $PSScriptRoot
$AppHome = Join-Path $env:APPDATA 'herdr-app'
if ($env:HERDR_APP_HOME) { $AppHome = $env:HERDR_APP_HOME }
if (-not (Test-Path -LiteralPath $AppHome)) { New-Item -ItemType Directory -Force -Path $AppHome | Out-Null }
if (-not (Test-Path -LiteralPath $AppHome)) { throw "Herdr app home does not exist: $AppHome" }

foreach ($rel in @('layouts', 'themes', 'mods')) {
  $dest = Join-Path $AppHome $rel
  if (-not (Test-Path -LiteralPath $dest)) { New-Item -ItemType Directory -Force -Path $dest | Out-Null }
}

Copy-Item -LiteralPath (Join-Path $Root 'kanso\layouts\kanso.json') -Destination (Join-Path $AppHome 'layouts') -Force
Copy-Item -LiteralPath (Join-Path $Root 'kanso\layouts\kanso.png') -Destination (Join-Path $AppHome 'layouts') -Force
Get-ChildItem -LiteralPath (Join-Path $Root 'kanso\themes') -Filter '*.json' | ForEach-Object {
  Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $AppHome 'themes') -Force
}
Get-ChildItem -LiteralPath (Join-Path $Root 'kanso\mods') -Directory | ForEach-Object {
  if ($_.Name -like 'kanso-*' -or $_.Name -eq 'open-with') {
    Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $AppHome 'mods') -Recurse -Force
  }
}

Write-Output "Installed kansō files to $AppHome."
Write-Output ("Merge the `"layout:kanso`" section of " + (Join-Path $Root 'kanso\keys.json') + " into " + (Join-Path $AppHome 'keys.json') + ".")
Write-Output ("On Windows, merge " + (Join-Path $Root 'kanso\keys.windows.json') + " instead of keys.json.")

& herdr-app do layout.switch --name kanso
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

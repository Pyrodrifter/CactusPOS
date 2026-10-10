<#
.SYNOPSIS
  Puts a CactusPOS backup back: the newest one on this computer, or the file given.
  Run it by double-clicking "Restore CactusPOS backup.bat" (or drag a backup file onto that).
  The launcher shows what the backup holds, asks first, stops and restarts CactusPOS, and moves the data it
  replaces to a folder of its own instead of deleting it.
#>
[CmdletBinding()]
param([string]$File = '')
$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$Launcher = Join-Path $Root 'ops\app\launch.mjs'

$nodeExe = Join-Path $Root 'runtime\node\node.exe'
if (-not (Test-Path $nodeExe)) {
  $onPath = Get-Command node.exe -ErrorAction SilentlyContinue
  if ($onPath) { $nodeExe = $onPath.Source } else { $nodeExe = '' }
}
if (-not $nodeExe) {
  Write-Host 'Node.js was not found. Run "Install CactusPOS.bat" first, then restore.' -ForegroundColor Red
  exit 1
}
if ($File) { & $nodeExe $Launcher --restore $File } else { & $nodeExe $Launcher --restore }
exit $LASTEXITCODE

<#
.SYNOPSIS
  Puts a CactusPOS backup back: the newest one on this computer, or the file given.
  Run it by double-clicking "Restore CactusPOS backup.bat" (or drag a backup file onto that).
  The Start menu entry "Restore a backup" adds -Choose: it first asks whether to use the newest backup on this
  computer or to pick a file, for example on a USB stick.
  The launcher shows what the backup holds, asks first, stops and restarts CactusPOS, and moves the data it
  replaces to a folder of its own instead of deleting it.
#>
[CmdletBinding()]
param([string]$File = '', [switch]$Choose)
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
if ($Choose -and -not $File) {
  Write-Host 'Put a CactusPOS backup back'
  Write-Host ''
  Write-Host '  1   Use the newest backup on this computer'
  Write-Host '  2   Choose a backup file, for example on a USB stick'
  Write-Host ''
  $answer = (Read-Host 'Type 1 or 2 and press Enter (anything else stops)').Trim()
  if ($answer -eq '2') {
    Add-Type -AssemblyName System.Windows.Forms
    $dialog = New-Object System.Windows.Forms.OpenFileDialog
    $dialog.Title = 'Choose a CactusPOS backup file'
    $dialog.Filter = 'CactusPOS backup (*.sqlite)|*.sqlite|All files (*.*)|*.*'
    if ($dialog.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) { Write-Host 'Nothing was changed.'; exit 0 }
    $File = $dialog.FileName
  } elseif ($answer -ne '1') { Write-Host 'Nothing was changed.'; exit 0 }
  Write-Host ''
}
if ($File) { & $nodeExe $Launcher --restore $File } else { & $nodeExe $Launcher --restore }
exit $LASTEXITCODE

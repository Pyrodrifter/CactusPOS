<#
.SYNOPSIS
  Removes CactusPOS from this Windows user: stops the server, removes the shortcuts and the firewall rule.
  Sales data and settings in %LOCALAPPDATA%\CactusPOS are kept. Delete that folder yourself only when you are
  sure you no longer need the sales records.
#>
[CmdletBinding()]
param(
  [switch]$SkipFirewall,       # leave the Windows Firewall rule in place
  [string]$ShortcutRoot = ''   # for testing: the folder given to install.ps1
)
$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$Launcher = Join-Path $Root 'ops\app\launch.mjs'

$nodeExe = Join-Path $Root 'runtime\node\node.exe'
if (-not (Test-Path $nodeExe)) {
  $onPath = Get-Command node.exe -ErrorAction SilentlyContinue
  if ($onPath) { $nodeExe = $onPath.Source } else { $nodeExe = '' }
}
if ($nodeExe) {
  & $nodeExe $Launcher --stop
  $status = (& $nodeExe $Launcher --status --json) -join "`n" | ConvertFrom-Json
}

if ($ShortcutRoot) {
  $desktop = Join-Path $ShortcutRoot 'Desktop'; $programs = Join-Path $ShortcutRoot 'Programs'; $startup = Join-Path $ShortcutRoot 'Startup'
} else {
  $desktop = [Environment]::GetFolderPath('Desktop'); $programs = [Environment]::GetFolderPath('Programs'); $startup = [Environment]::GetFolderPath('Startup')
}
foreach ($link in @((Join-Path $desktop 'CactusPOS.lnk'), (Join-Path $startup 'CactusPOS.lnk'))) {
  if (Test-Path $link) { Remove-Item $link -Force -Confirm:$false; Write-Host "Removed $link" }
}
$menu = Join-Path $programs 'CactusPOS'
if (Test-Path $menu) { Remove-Item $menu -Recurse -Force -Confirm:$false; Write-Host "Removed $menu" }

if (-not $SkipFirewall -and (Get-NetFirewallRule -DisplayName 'CactusPOS' -ErrorAction SilentlyContinue)) {
  Write-Host 'Removing the firewall rule. Windows will ask for permission.'
  try {
    $fw = Join-Path $PSScriptRoot 'firewall.ps1'
    Start-Process -FilePath 'powershell.exe' -Verb RunAs -Wait -WindowStyle Hidden -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$fw`"", '-Remove')
  } catch { Write-Host 'The firewall rule was left in place.' -ForegroundColor Yellow }
}

Write-Host ''
Write-Host 'CactusPOS shortcuts are removed. The program folder can now be deleted.'
if ($status) { Write-Host "Sales data and settings were kept in: $($status.home)" }

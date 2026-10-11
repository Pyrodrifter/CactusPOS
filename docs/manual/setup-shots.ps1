<#
.SYNOPSIS
  Takes the pictures of the setup program's windows for the user manual (docs/manual/img/<lang>-setup-*.png), by
  running the real setup program and clicking through it. It is also an end-to-end check of the setup.

.DESCRIPTION
  The setup runs as a TEST copy: it installs into -Work\app, puts its shortcuts in -Work\shortcuts, keeps its data
  in -Work\home, uses port -Port, skips the firewall question and leaves no entry under Apps. This Windows user's
  real CactusPOS (shortcuts, firewall rule, sales) is not touched.

  With -Finish click, the last window's Finish button is pressed with "Start CactusPOS now" ticked, as a person
  would: the till must then come up on the test port. It is stopped again and its window closed.
  With -Finish close (the default) the setup is ended after the last picture, without starting the till.

  Afterwards the copy is removed with its own uninstaller, and the script says what it found.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File docs\manual\setup-shots.ps1 -Setup dist\redist\CactusPOS-Setup-0.2.0.exe -Lang nl
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Setup,
  [ValidateSet('en', 'nl')][string]$Lang = 'en',
  [string]$OutDir = '',      # default: the img folder beside this script
  [string]$Work = '',        # default: a folder under %TEMP%
  [int]$Port = 3190,
  [ValidateSet('click', 'close')][string]$Finish = 'close',
  [switch]$KeepInstalled     # leave the test copy in -Work (for looking at it); remove it with its unins000.exe
)
$ErrorActionPreference = 'Stop'
if (-not $OutDir) { $OutDir = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) 'img' }
if (-not $Work) { $Work = Join-Path $env:TEMP "cactus-setup-shots-$Lang" }
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class CactusWin {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hwnd, IntPtr hdc, uint flags);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hwnd, out RECT rect);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hwnd, uint message, IntPtr w, IntPtr l);
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr hwnd, int attribute, out RECT rect, int size);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
}
'@
[void][CactusWin]::SetProcessDPIAware()

$Setup = (Resolve-Path $Setup).Path
$labels = @{
  en = @{ next = 'Next'; install = 'Install'; finish = 'Finish' }
  nl = @{ next = 'Volgende'; install = 'Installeren'; finish = 'Voltooien' }
}[$Lang]
$app = Join-Path $Work 'app'; $shortcuts = Join-Path $Work 'shortcuts'; $home2 = Join-Path $Work 'home'
if (Test-Path $Work) { Remove-Item $Work -Recurse -Force -Confirm:$false }
New-Item -ItemType Directory -Force -Path $Work, $OutDir | Out-Null

$auto = [System.Windows.Automation.AutomationElement]
$tree = [System.Windows.Automation.TreeScope]
function Find-Wizard {
  $condition = New-Object System.Windows.Automation.PropertyCondition($auto::ClassNameProperty, 'TWizardForm')
  return $auto::RootElement.FindFirst($tree::Children, $condition)
}
# Inno Setup's buttons are plain windows of class TNewButton: Windows shows them to automation as panes with a
# name, without a "press" action. So they are found by class and name, and pressed with the button-click message.
function Find-Button($window, [string]$name) {
  $all = $window.FindAll($tree::Descendants, (New-Object System.Windows.Automation.PropertyCondition($auto::ClassNameProperty, 'TNewButton')))
  foreach ($button in $all) { if ($button.Current.Name -eq $name -and $button.Current.IsEnabled -and -not $button.Current.IsOffscreen) { return $button } }
  return $null
}
# Waits until the setup window shows one of these buttons, active. Returns the window, the button and its name.
function Wait-Button([string[]]$names, [int]$seconds) {
  for ($i = 0; $i -lt $seconds * 4; $i++) {
    $window = Find-Wizard
    if ($window) { foreach ($name in $names) { $button = Find-Button $window $name; if ($button) { return @{ Window = $window; Button = $button; Name = $name } } } }
    Start-Sleep -Milliseconds 250
  }
  throw "The setup window never showed an active button ($($names -join ', ')) within $seconds seconds."
}
function Save-Window($window, [string]$name) {
  Start-Sleep -Milliseconds 700   # let the page finish drawing
  $hwnd = [IntPtr]$window.Current.NativeWindowHandle
  $r = New-Object CactusWin+RECT
  [void][CactusWin]::GetWindowRect($hwnd, [ref]$r)
  $whole = New-Object System.Drawing.Bitmap(($r.Right - $r.Left), ($r.Bottom - $r.Top))
  $graphics = [System.Drawing.Graphics]::FromImage($whole)
  $hdc = $graphics.GetHdc()
  [void][CactusWin]::PrintWindow($hwnd, $hdc, 2)   # 2 = include what the window manager draws
  $graphics.ReleaseHdc($hdc); $graphics.Dispose()
  # A window is a few pixels larger than what is seen (the edge for resizing); that edge comes out black. Cut it off.
  $seen = New-Object CactusWin+RECT
  if ([CactusWin]::DwmGetWindowAttribute($hwnd, 9, [ref]$seen, 16) -ne 0) { $seen = $r }
  $crop = New-Object System.Drawing.Rectangle(($seen.Left - $r.Left), ($seen.Top - $r.Top), ($seen.Right - $seen.Left), ($seen.Bottom - $seen.Top))
  $bitmap = $whole.Clone($crop, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
  $whole.Dispose()
  $file = Join-Path $OutDir "$Lang-setup-$name.png"
  $bitmap.Save($file, [System.Drawing.Imaging.ImageFormat]::Png); $bitmap.Dispose()
  Write-Host "  $file"
}
function Press($found) { [void][CactusWin]::PostMessage([IntPtr]$found.Button.Current.NativeWindowHandle, 0x00F5, [IntPtr]::Zero, [IntPtr]::Zero) }   # BM_CLICK

# Inno Setup works in folders named is-*.tmp under %TEMP%. The ones that are new afterwards are ours to tidy up.
$tempBefore = @(Get-ChildItem -Path $env:TEMP -Directory -Filter 'is-*.tmp' | ForEach-Object { $_.Name })

# Everything the setup starts inherits this, so the test copy keeps its data in its own folder.
$env:CACTUS_HOME = $home2
$log = Join-Path $Work 'setup.log'
Write-Host "Running $Setup ($Lang) as a test copy in $Work"
Start-Process -FilePath $Setup -ArgumentList @("/LANG=$Lang", "/DIR=`"$app`"", "/SHORTCUTROOT=`"$shortcuts`"", "/PORT=$Port", "/LOG=`"$log`"")

# Page after page: take its picture and press Next (or Install), until the last page with Finish is there.
# Copying the files takes a minute or two; during that only Cancel is active.
$pictures = @('welcome', 'task', 'ready')
$seen = 0
while ($true) {
  $page = Wait-Button @($labels.finish, $labels.install, $labels.next) 600
  if ($page.Name -eq $labels.finish) { Save-Window $page.Window 'finish'; break }
  if ($seen -ge $pictures.Count) { throw 'The setup shows more pages than this script knows.' }
  Save-Window $page.Window $pictures[$seen]
  Write-Host "    page $($seen + 1): pressed '$($page.Name)'"
  $seen++
  Press $page
  Start-Sleep -Milliseconds 1500
}

$problems = @()
$node = Join-Path $app 'runtime\node\node.exe'
$launcher = Join-Path $app 'ops\app\launch.mjs'
if ($Finish -eq 'click') {
  Press $page
  # "Start CactusPOS now" is ticked: the till has to come up by itself.
  $up = $false
  for ($i = 0; $i -lt 90 -and -not $up; $i++) {
    Start-Sleep -Seconds 1
    try { $up = (Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/health" -TimeoutSec 2).app -eq 'cactuspos' } catch { }
  }
  if ($up) { Write-Host "  The till started by itself on port $Port after Finish." } else { $problems += "The till did not start on port $Port after Finish." }
  Start-Sleep -Seconds 4
  $windows = @(Get-CimInstance Win32_Process -Filter "Name = 'msedge.exe' OR Name = 'chrome.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($home2) })
  if ($windows.Count -gt 0) { Write-Host '  The till window opened.' } else { $problems += 'No till window (Edge or Chrome on the test profile) was found.' }
  & $node $launcher --stop | Out-Null
  foreach ($w in $windows) { Stop-Process -Id $w.ProcessId -Force -ErrorAction SilentlyContinue }
} else {
  # End the setup here instead of pressing Finish, so nothing is started. The installation itself is complete.
  $wizardPid = $page.Window.Current.ProcessId
  Stop-Process -Id $wizardPid -Force
  Get-Process | Where-Object { $_.Path -eq $Setup } | Stop-Process -Force -ErrorAction SilentlyContinue
}

# What a person would find after the setup.
foreach ($expected in @(
    (Join-Path $shortcuts 'Desktop\CactusPOS.lnk'), (Join-Path $shortcuts 'Startup\CactusPOS.lnk'),
    (Join-Path $shortcuts 'Programs\CactusPOS\CactusPOS.lnk'), (Join-Path $shortcuts 'Programs\CactusPOS\Connect a tablet or phone.lnk'),
    (Join-Path $shortcuts 'Programs\CactusPOS\Restore a backup.lnk'), (Join-Path $shortcuts 'Programs\CactusPOS\Manual (English).lnk'),
    (Join-Path $shortcuts 'Programs\CactusPOS\Handleiding (Nederlands).lnk'),
    (Join-Path $home2 'config.json'), $node, (Join-Path $app 'unins000.exe'))) {
  if (-not (Test-Path $expected)) { $problems += "Missing after the setup: $expected" }
}

if (-not $KeepInstalled) {
  Start-Sleep -Seconds 2
  $un = Start-Process -FilePath (Join-Path $app 'unins000.exe') -ArgumentList '/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART' -Wait -PassThru
  Start-Sleep -Seconds 2
  if ($un.ExitCode -ne 0) { $problems += "The uninstaller ended with code $($un.ExitCode)." }
  if (Test-Path $node) { $problems += 'The program files are still there after removing.' }
  if (Test-Path (Join-Path $shortcuts 'Desktop\CactusPOS.lnk')) { $problems += 'The Desktop shortcut is still there after removing.' }
  if (-not (Test-Path (Join-Path $home2 'config.json'))) { $problems += 'The data folder was removed too; it must be kept.' }
  if ($problems.Count -eq 0) { Write-Host '  Removed again: program and shortcuts gone, data folder kept.' }
}

Start-Sleep -Seconds 1
Get-ChildItem -Path $env:TEMP -Directory -Filter 'is-*.tmp' | Where-Object { $tempBefore -notcontains $_.Name } | Remove-Item -Recurse -Force -Confirm:$false -ErrorAction SilentlyContinue

if ($problems.Count) { Write-Host ''; $problems | ForEach-Object { Write-Host "PROBLEM: $_" -ForegroundColor Red }; Write-Host "Setup log: $log"; exit 1 }
if (-not $KeepInstalled) { Remove-Item $Work -Recurse -Force -Confirm:$false -ErrorAction SilentlyContinue }
Write-Host "Setup pictures taken ($Lang)."
exit 0

<#
.SYNOPSIS
  Installs CactusPOS on this Windows computer for the signed-in Windows user.

.DESCRIPTION
  Run it by double-clicking "Install CactusPOS.bat" in the program folder. It is safe to run again: use it after
  an update, or to change the port. The setup program (CactusPOS-Setup-<version>.exe, see setup.iss) copies the
  program folder into place and then runs this script for the settings and shortcuts.

  What it does:
    1. Finds Node.js: the copy shipped in runtime\node (ready-made package), or an installed Node.js 22.13+ / 24+.
       When there is none it offers to install Node.js LTS with winget.
    2. Source checkout only: downloads the program libraries (npm ci) and builds the screens.
    3. Writes the settings file, and creates shortcuts on the Desktop, in the Start menu, and in Startup.
    4. Asks Windows (one administrator prompt) to let phones and tablets on the same network reach the till.
    5. Starts CactusPOS.

  Sales data lives in %LOCALAPPDATA%\CactusPOS, outside the program folder. Installing again or replacing the
  program folder never touches it.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File ops\windows\install.ps1 -Port 3100 -ServerOnlyAtSignIn
#>
[CmdletBinding()]
param(
  [int]$Port = 0,                # 0 = keep the configured port (3000 on a first install)
  [string]$Seed = '',            # menu for an EMPTY database: a file name from seed\ without .json. First install: cactus-blue
  [switch]$NoAutostart,          # do not start CactusPOS when this Windows user signs in
  [switch]$ServerOnlyAtSignIn,   # at sign-in start the server, but do not open the till window
  [switch]$SkipFirewall,         # do not ask Windows Firewall to allow phones and tablets
  [switch]$NoStart,              # do not start CactusPOS when the installer is done
  [switch]$NoNodeInstall,        # never run winget; stop when Node.js is missing
  [string]$ResultFile = '',      # for the setup program: write the port and the firewall state to this file
  [string]$ShortcutRoot = ''     # for testing: create the shortcuts under this folder instead of the real places
)

$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$Launcher = Join-Path $Root 'ops\app\launch.mjs'
$Icon = Join-Path $PSScriptRoot 'cactuspos.ico'

function Step([string]$Text) { Write-Host ''; Write-Host "== $Text" -ForegroundColor Cyan }
function Fail([string]$Text) { Write-Host ''; Write-Host $Text -ForegroundColor Red; exit 1 }

function Test-NodeVersion([string]$Version) {
  $parts = $Version.TrimStart('v').Split('.')
  if ($parts.Count -lt 2) { return $false }
  $major = [int]$parts[0]; $minor = [int]$parts[1]
  return (($major -eq 22 -and $minor -ge 13) -or $major -ge 24)
}

function Get-NodeVersion([string]$Exe) {
  try { return (& $Exe -p 'process.versions.node' | Select-Object -First 1) } catch { return '' }
}

function Find-Node {
  $candidates = @((Join-Path $Root 'runtime\node\node.exe'))
  $onPath = Get-Command node.exe -ErrorAction SilentlyContinue
  if ($onPath) { $candidates += $onPath.Source }
  $candidates += (Join-Path $env:ProgramFiles 'nodejs\node.exe')
  foreach ($exe in $candidates) {
    if ($exe -and (Test-Path $exe)) {
      $version = Get-NodeVersion $exe
      if ($version -and (Test-NodeVersion $version)) { return [pscustomobject]@{ Exe = $exe; Version = $version } }
      if ($version) { Write-Host "  Found Node.js $version at $exe, but CactusPOS needs 22.13+ or 24+." -ForegroundColor Yellow }
    }
  }
  return $null
}

# ---------------------------------------------------------------- 1. Node.js
Step 'Looking for Node.js'
$node = Find-Node
if (-not $node) {
  $winget = Get-Command winget.exe -ErrorAction SilentlyContinue
  if ($NoNodeInstall -or -not $winget) {
    Fail "CactusPOS needs Node.js 22.13 or newer (24 recommended), and it is not installed.`nInstall the LTS version from https://nodejs.org and run this installer again."
  }
  Write-Host '  Node.js is not installed. Installing Node.js LTS from its publisher (OpenJS Foundation) with winget.'
  Write-Host '  Windows may ask for permission.'
  & $winget.Source install --id OpenJS.NodeJS.LTS -e --source winget --accept-package-agreements --accept-source-agreements
  $node = Find-Node
  if (-not $node) { Fail "Node.js could not be installed automatically.`nInstall the LTS version from https://nodejs.org and run this installer again." }
}
Write-Host "  Node.js $($node.Version)  ($($node.Exe))"
$Bundled = $node.Exe -eq (Join-Path $Root 'runtime\node\node.exe')

# ---------------------------------------------------------------- 2. Libraries and screens
$hasLibraries = (Test-Path (Join-Path $Root 'node_modules\fastify')) -and (Test-Path (Join-Path $Root 'node_modules\tsx'))
$hasScreens = Test-Path (Join-Path $Root 'packages\web\dist\index.html')
$isCheckout = Test-Path (Join-Path $Root '.git')
if ($Bundled) {
  if (-not ($hasLibraries -and $hasScreens)) { Fail "This CactusPOS package is incomplete (program libraries or screens are missing).`nDownload the package again." }
} elseif ($isCheckout -or -not ($hasLibraries -and $hasScreens)) {
  Step 'Getting the program libraries and building the screens (needs internet, takes a few minutes)'
  $npm = Join-Path (Split-Path $node.Exe) 'npm.cmd'
  if (-not (Test-Path $npm)) { Fail "npm was not found next to $($node.Exe). Reinstall Node.js from https://nodejs.org." }
  Push-Location $Root
  try {
    # A running server keeps files in node_modules open; stop the one this launcher started before replacing them.
    & $node.Exe $Launcher --stop | Out-Null
    & $npm ci
    if ($LASTEXITCODE -ne 0) { Fail 'Downloading the program libraries failed. Check the internet connection and run the installer again.' }
    & $npm run build
    if ($LASTEXITCODE -ne 0) { Fail 'Building the screens failed. The messages above say why.' }
  } finally { Pop-Location }
}

# ---------------------------------------------------------------- 3. Settings
Step 'Settings'
& $node.Exe $Launcher --stop | Out-Null
if ($LASTEXITCODE -eq 2) {
  Write-Host '  Another CactusPOS is running that was started by hand (start.bat or npm start). Close it; the shortcuts will use it while it runs.' -ForegroundColor Yellow
}
# First install: standard settings, with the Cactus Blue menu when that file is part of this copy.
$firstArgs = @($Launcher, '--configure', '--if-new', '--json')
if (Test-Path (Join-Path $Root 'seed\cactus-blue.json')) { $firstArgs += @('--seed', 'cactus-blue') }
$configText = & $node.Exe @firstArgs
if ($LASTEXITCODE -ne 0) { Fail 'The settings file could not be read. The message above says which file to fix.' }
if ($Port -ne 0 -or $Seed) {
  $changeArgs = @($Launcher, '--configure', '--json')
  if ($Port -ne 0) { $changeArgs += @('--port', "$Port") }
  if ($Seed) { $changeArgs += @('--seed', $Seed) }
  $configText = & $node.Exe @changeArgs
  if ($LASTEXITCODE -ne 0) { Fail 'The settings could not be changed. The message above says why.' }
}
$config = ($configText -join "`n") | ConvertFrom-Json
Write-Host "  Port $($config.port). Data folder: $($config.home)"

# ---------------------------------------------------------------- 4. Shortcuts
Step 'Shortcuts'
# conhost --headless runs the launcher without a console window flashing up. No extra program is installed for this.
$Conhost = Join-Path $env:WINDIR 'System32\conhost.exe'
function New-CactusShortcut([string]$Path, [string]$LauncherArgs, [string]$Description) {
  $folder = Split-Path $Path
  if (-not (Test-Path $folder)) { New-Item -ItemType Directory -Force -Path $folder | Out-Null }
  $shell = New-Object -ComObject WScript.Shell
  $link = $shell.CreateShortcut($Path)
  $link.TargetPath = $Conhost
  $link.Arguments = ('--headless "{0}" "{1}" --gui {2}' -f $node.Exe, $Launcher, $LauncherArgs).Trim()
  $link.WorkingDirectory = $Root
  $link.IconLocation = "$Icon,0"
  $link.Description = $Description
  $link.WindowStyle = 7
  $link.Save()
  Write-Host "  $Path"
}
if ($ShortcutRoot) {
  $desktop = Join-Path $ShortcutRoot 'Desktop'; $programs = Join-Path $ShortcutRoot 'Programs'; $startup = Join-Path $ShortcutRoot 'Startup'
} else {
  $desktop = [Environment]::GetFolderPath('Desktop'); $programs = [Environment]::GetFolderPath('Programs'); $startup = [Environment]::GetFolderPath('Startup')
}
New-CactusShortcut (Join-Path $desktop 'CactusPOS.lnk') '' 'CactusPOS till'
New-CactusShortcut (Join-Path $programs 'CactusPOS\CactusPOS.lnk') '' 'CactusPOS till'
New-CactusShortcut (Join-Path $programs 'CactusPOS\CactusPOS kitchen screen.lnk') '--screen kitchen' 'CactusPOS kitchen screen'
New-CactusShortcut (Join-Path $programs 'CactusPOS\CactusPOS pickup board.lnk') '--screen pickup' 'CactusPOS pickup board for guests'
New-CactusShortcut (Join-Path $programs 'CactusPOS\Connect a tablet or phone.lnk') '--addresses' 'Shows the addresses a tablet or phone uses to reach the till'
# Plain shortcuts to a file: putting a backup back, and the manual when this copy has it.
function New-FileShortcut([string]$Path, [string]$Target, [string]$Arguments, [string]$Description, [string]$IconFile) {
  $shell = New-Object -ComObject WScript.Shell
  $link = $shell.CreateShortcut($Path)
  $link.TargetPath = $Target
  $link.Arguments = $Arguments
  $link.WorkingDirectory = $Root
  if ($IconFile) { $link.IconLocation = "$IconFile,0" }
  $link.Description = $Description
  $link.Save()
  Write-Host "  $Path"
}
New-FileShortcut (Join-Path $programs 'CactusPOS\Restore a backup.lnk') (Join-Path $Root 'Restore CactusPOS backup.bat') '-Choose' 'Puts a backup of the sales data back; asks first' $Icon
foreach ($manual in @(@('CactusPOS-Manual-English.pdf', 'Manual (English)'), @('CactusPOS-Handleiding-Nederlands.pdf', 'Handleiding (Nederlands)'))) {
  $file = Join-Path $Root "Manual\$($manual[0])"
  $link = Join-Path $programs "CactusPOS\$($manual[1]).lnk"
  if (Test-Path $file) { New-FileShortcut $link $file '' 'CactusPOS user manual' '' }
  elseif (Test-Path $link) { Remove-Item $link -Force -Confirm:$false }
}
$startupLink = Join-Path $startup 'CactusPOS.lnk'
if ($NoAutostart) {
  if (Test-Path $startupLink) { Remove-Item $startupLink -Force -Confirm:$false; Write-Host '  Removed the start-at-sign-in shortcut.' }
} elseif ($ServerOnlyAtSignIn) {
  New-CactusShortcut $startupLink '--server-only' 'Starts the CactusPOS server at sign-in'
} else {
  New-CactusShortcut $startupLink '' 'Starts CactusPOS at sign-in'
}

# ---------------------------------------------------------------- 5. Firewall
# Looking needs no administrator rights; changing does. 'needed' = no active rule lets this port in.
$firewall = 'needed'
try {
  & (Join-Path $PSScriptRoot 'firewall.ps1') -Check -Port $config.port -LanPort $config.lanPort
  if ($LASTEXITCODE -eq 0) { $firewall = 'ok' }
} catch { }
if (-not $SkipFirewall) {
  Step 'Windows Firewall (so phones and tablets can reach the till)'
  if ($firewall -eq 'ok') {
    Write-Host "  Already allowed for port $($config.port)."
  } else {
    Write-Host '  Windows will ask "Do you want to allow this app to make changes?". Choose Yes.'
    try {
      $fw = Join-Path $PSScriptRoot 'firewall.ps1'
      $p = Start-Process -FilePath 'powershell.exe' -Verb RunAs -Wait -PassThru -WindowStyle Hidden `
        -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$fw`"", '-Port', "$($config.port)", '-LanPort', "$($config.lanPort)")
      if ($p.ExitCode -ne 0) { throw "exit code $($p.ExitCode)" }
      $firewall = 'ok'
      Write-Host "  Allowed: devices on the same network may connect to port $($config.port)."
    } catch {
      Write-Host '  Not allowed. The till works on this computer, but phones and tablets may not be able to connect.' -ForegroundColor Yellow
      Write-Host '  Run "Install CactusPOS" again and choose Yes to fix that.' -ForegroundColor Yellow
    }
  }
}

# ---------------------------------------------------------------- 6. Start
if (-not $NoStart) {
  Step 'Starting CactusPOS'
  Start-Process -FilePath $Conhost -ArgumentList @('--headless', "`"$($node.Exe)`"", "`"$Launcher`"", '--gui') -WorkingDirectory $Root
}

Step 'Done'
$status = (& $node.Exe $Launcher --status --json) -join "`n" | ConvertFrom-Json
Write-Host '  Till on this computer:  the CactusPOS icon on the Desktop'
if ($status.otherDevices.Count -gt 0) {
  foreach ($url in $status.otherDevices) { Write-Host "  Kitchen tablet:         open $url/kitchen in its browser (same WiFi)" }
} else {
  Write-Host '  Kitchen tablet:         connect this computer to the WiFi first; then run the Start menu entry again'
}
Write-Host "  Sales data:             $($status.home)"
Write-Host ''
Write-Host '  A new database starts with the example PINs 1234 (owner) and 1111 (staff).' -ForegroundColor Yellow
Write-Host '  Change them before real use: sign in as owner, Admin, Staff.' -ForegroundColor Yellow
if ($ResultFile) {
  # Read by the setup program with the Windows INI functions, so plain ASCII.
  Set-Content -Path $ResultFile -Encoding ASCII -Value @('[result]', "port=$($config.port)", "lanPort=$($config.lanPort)", "firewall=$firewall", "home=$($status.home)")
}
exit 0

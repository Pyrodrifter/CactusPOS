<#
.SYNOPSIS
  Adds (or with -Remove, removes) the Windows Firewall rule that lets devices on the same network reach CactusPOS.
  Needs administrator rights; install.ps1, uninstall.ps1 and the setup program start it with the Windows
  permission prompt.

  -Check changes nothing and needs no administrator rights. It ends with code 0 when an active rule is there
  (with -Port 0: for any port; otherwise: one that lets that port in), and with code 3 when not.

  The rule allows incoming TCP on one port, from the local subnet only, on every network type. Truck and home
  routers are usually classed as "Public" by Windows, so limiting the rule to "Private" would block the tablets.
#>
[CmdletBinding()]
param([int]$Port = 3000, [int]$LanPort = 80, [switch]$Remove, [switch]$Check)
$ErrorActionPreference = 'Stop'
if ($Check) {
  try {
    $rule = Get-NetFirewallRule -DisplayName 'CactusPOS' -ErrorAction SilentlyContinue | Where-Object { $_.Enabled -eq 'True' }
    if (-not $rule) { exit 3 }
    $lanRule = Get-NetFirewallRule -DisplayName 'CactusPOS local name' -ErrorAction SilentlyContinue | Where-Object { $_.Enabled -eq 'True' }
    $webRule = Get-NetFirewallRule -DisplayName 'CactusPOS friendly address' -ErrorAction SilentlyContinue | Where-Object { $_.Enabled -eq 'True' }
    if (-not $lanRule -or ($LanPort -gt 0 -and (-not $webRule -or (($webRule | Get-NetFirewallPortFilter).LocalPort -notcontains "$LanPort")))) { exit 3 }
    if ($Port -eq 0 -or (($rule | Get-NetFirewallPortFilter).LocalPort -contains "$Port")) { exit 0 }
    exit 3
  } catch { exit 3 }
}
try {
  Get-NetFirewallRule -DisplayName 'CactusPOS' -ErrorAction SilentlyContinue | Remove-NetFirewallRule
  Get-NetFirewallRule -DisplayName 'CactusPOS local name' -ErrorAction SilentlyContinue | Remove-NetFirewallRule
  Get-NetFirewallRule -DisplayName 'CactusPOS friendly address' -ErrorAction SilentlyContinue | Remove-NetFirewallRule
  if (-not $Remove) {
    New-NetFirewallRule -DisplayName 'CactusPOS' -Description 'Lets phones and tablets on the same network use the CactusPOS till.' `
      -Direction Inbound -Action Allow -Protocol TCP -LocalPort $Port -RemoteAddress LocalSubnet -Profile Any | Out-Null
    if ($LanPort -gt 0) {
      New-NetFirewallRule -DisplayName 'CactusPOS friendly address' -Description 'Local HTTP address for CactusPOS.' `
        -Direction Inbound -Action Allow -Protocol TCP -LocalPort $LanPort -RemoteAddress LocalSubnet -Profile Any | Out-Null
    }
    New-NetFirewallRule -DisplayName 'CactusPOS local name' -Description 'Local multicast discovery for CactusPOS.' `
      -Direction Inbound -Action Allow -Protocol UDP -LocalPort 5353 -RemoteAddress LocalSubnet -Profile Any | Out-Null
  }
  exit 0
} catch {
  exit 1
}

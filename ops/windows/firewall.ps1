<#
.SYNOPSIS
  Adds (or with -Remove, removes) the Windows Firewall rule that lets devices on the same network reach CactusPOS.
  Needs administrator rights; install.ps1 and uninstall.ps1 start it with the Windows permission prompt.

  The rule allows incoming TCP on one port, from the local subnet only, on every network type. Truck and home
  routers are usually classed as "Public" by Windows, so limiting the rule to "Private" would block the tablets.
#>
[CmdletBinding()]
param([int]$Port = 3000, [switch]$Remove)
$ErrorActionPreference = 'Stop'
try {
  Get-NetFirewallRule -DisplayName 'CactusPOS' -ErrorAction SilentlyContinue | Remove-NetFirewallRule
  if (-not $Remove) {
    New-NetFirewallRule -DisplayName 'CactusPOS' -Description 'Lets phones and tablets on the same network use the CactusPOS till.' `
      -Direction Inbound -Action Allow -Protocol TCP -LocalPort $Port -RemoteAddress LocalSubnet -Profile Any | Out-Null
  }
  exit 0
} catch {
  exit 1
}

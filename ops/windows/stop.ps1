<#
.SYNOPSIS
  Stops the CactusPOS server that runs from one program folder, so that its files can be replaced or removed.
  The setup program (setup.iss) runs this before an update and before removing CactusPOS.

  First the launcher is asked to stop the server it started. Then any Node.js still running from THIS folder's own
  runtime\node is ended. Another Node.js on the computer is never touched.
#>
[CmdletBinding()]
param([Parameter(Mandatory = $true)][string]$Root)
$ErrorActionPreference = 'SilentlyContinue'
$node = Join-Path $Root 'runtime\node\node.exe'
$launcher = Join-Path $Root 'ops\app\launch.mjs'
if ((Test-Path $node) -and (Test-Path $launcher)) { & $node $launcher --stop | Out-Null }

$own = [IO.Path]::GetFullPath($node)
function Get-OwnNode { Get-Process -Name node | Where-Object { $_.Path -and ([IO.Path]::GetFullPath($_.Path) -ieq $own) } }
Get-OwnNode | Stop-Process -Force
# Windows frees the files a moment after the process is gone.
for ($i = 0; $i -lt 20 -and (Get-OwnNode); $i++) { Start-Sleep -Milliseconds 250 }
exit 0

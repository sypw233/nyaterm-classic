# NyaTerm CPU sampler
#
# Run this in a NORMAL PowerShell window OUTSIDE of NyaTerm.
# Do not run it inside the terminal being measured: its own progress output
# would become extra load and skew the result.
#
# It measures the average CPU usage of the whole NyaTerm process tree.
#
# Why the whole process tree matters:
#   Terminal rendering happens in WebView2 child processes (msedgewebview2.exe),
#   not in nyaterm-classic.exe itself. Looking only at the main process badly
#   undercounts the real cost.
#
# Usage:
#   .\sample-cpu.ps1                  # 20 seconds
#   .\sample-cpu.ps1 -Seconds 30
#
# Output: two CPU numbers.
#   "task manager style" = percent of ALL logical CPUs (matches Task Manager)
#   "per core"           = percent of ONE core (can exceed 100 on multicore)
#
# This file is intentionally pure ASCII so Windows PowerShell 5.1 can parse it
# regardless of the system code page.

[CmdletBinding()]
param(
  [int]$Seconds = 20
)

$ErrorActionPreference = "Stop"

function Get-DescendantIds {
  param([int]$RootId, $AllProcesses)
  $ids = New-Object 'System.Collections.Generic.List[int]'
  $queue = New-Object 'System.Collections.Generic.Queue[int]'
  $queue.Enqueue($RootId)
  $seen = New-Object 'System.Collections.Generic.HashSet[int]'
  while ($queue.Count -gt 0) {
    $current = $queue.Dequeue()
    if (-not $seen.Add($current)) { continue }
    $ids.Add($current)
    foreach ($child in $AllProcesses) {
      if ($child.ParentProcessId -eq $current) { $queue.Enqueue([int]$child.ProcessId) }
    }
  }
  return $ids
}

$app = @(Get-Process -Name "nyaterm-classic" -ErrorAction SilentlyContinue)
if ($app.Count -eq 0) {
  Write-Host "ERROR: nyaterm-classic.exe is not running. Start NyaTerm first." -ForegroundColor Red
  exit 1
}

$all = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)
$treeIds = New-Object 'System.Collections.Generic.List[int]'
foreach ($root in $app) {
  foreach ($id in (Get-DescendantIds -RootId $root.Id -AllProcesses $all)) {
    if (-not $treeIds.Contains($id)) { $treeIds.Add($id) }
  }
}

$webviewCount = 0
foreach ($id in $treeIds) {
  $p = Get-Process -Id $id -ErrorAction SilentlyContinue
  if ($null -ne $p -and $p.ProcessName -like "msedgewebview2*") { $webviewCount++ }
}

$logicalCpus = [Environment]::ProcessorCount
Write-Host "== NyaTerm CPU sampler ==" -ForegroundColor Cyan
Write-Host ("  processes in tree : {0} (WebView2 children: {1})" -f $treeIds.Count, $webviewCount)
Write-Host ("  logical CPUs      : {0}" -f $logicalCpus)
Write-Host ("  sample duration   : {0} s" -f $Seconds)
Write-Host ""
if ($webviewCount -eq 0) {
  Write-Host "WARNING: no WebView2 child process found." -ForegroundColor Yellow
  Write-Host "         Rendering cost will be missing from the total." -ForegroundColor Yellow
  Write-Host "         Make sure NyaTerm is open with a visible terminal." -ForegroundColor Yellow
  Write-Host ""
}
Write-Host "Switch to NyaTerm now and keep the terminal tab in the foreground" -ForegroundColor Yellow
Write-Host "while it keeps producing output. Do not switch tabs or move the mouse." -ForegroundColor Yellow
Write-Host ""

$cpuStart = 0.0
foreach ($id in $treeIds) {
  $p = Get-Process -Id $id -ErrorAction SilentlyContinue
  if ($p) { try { $cpuStart += $p.TotalProcessorTime.TotalSeconds } catch { } }
}
$wallStart = Get-Date
$deadline = $wallStart.AddSeconds($Seconds)

while ((Get-Date) -lt $deadline) {
  $remaining = [int]($deadline - (Get-Date)).TotalSeconds
  Write-Host ("`r  remaining {0,3} s   " -f $remaining) -NoNewline -ForegroundColor DarkGray
  Start-Sleep -Milliseconds 500
}
Write-Host "`r  sampling finished.       "

$cpuEnd = 0.0
$memMb = 0.0
foreach ($id in $treeIds) {
  $p = Get-Process -Id $id -ErrorAction SilentlyContinue
  if ($p) {
    try { $cpuEnd += $p.TotalProcessorTime.TotalSeconds } catch { }
    try { $memMb += $p.WorkingSet64 / 1MB } catch { }
  }
}

$elapsed = ((Get-Date) - $wallStart).TotalSeconds
$avgPct = (($cpuEnd - $cpuStart) / $elapsed) / $logicalCpus * 100
$singleCorePct = (($cpuEnd - $cpuStart) / $elapsed) * 100

Write-Host ""
Write-Host "== RESULT ==" -ForegroundColor Cyan
Write-Host ("  avg CPU (task manager style) : {0:N1} %" -f $avgPct) -ForegroundColor Green
Write-Host ("  avg CPU (per core)           : {0:N1} %" -f $singleCorePct)
Write-Host ("  process tree memory          : {0:N0} MB" -f $memMb)
Write-Host ("  actual sample duration       : {0:N1} s" -f $elapsed)
Write-Host ""
Write-Host "Record the CPU number, change ONE setting, then run again." -ForegroundColor DarkGray

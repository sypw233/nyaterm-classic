# Identify which WebView2 subprocess is burning CPU.
# Pure ASCII so Windows PowerShell 5.1 can parse it on any code page.
#
# Usage: run this in a normal PowerShell window while NyaTerm is under load.
#   .\check-render-process.ps1
#
# It prints one line per WebView2 process with:
#   type     gpu / renderer / utility / browser
#   cpu_s    total CPU seconds consumed so far
#   delta_s  CPU seconds consumed during the 5 second sample window
#   pct      percent of one core during that window

param([int]$SampleSeconds = 5)

$ErrorActionPreference = "Stop"

function Get-Type([string]$cmd) {
  if ([string]::IsNullOrEmpty($cmd)) { return "browser" }
  if ($cmd -match "--type=gpu-process")    { return "gpu" }
  if ($cmd -match "--type=renderer")       { return "renderer" }
  if ($cmd -match "--type=utility")        { return "utility" }
  if ($cmd -match "--type=crashpad")       { return "crashpad" }
  return "browser"
}

$app = @(Get-Process -Name "nyaterm-classic" -ErrorAction SilentlyContinue)
if ($app.Count -eq 0) {
  Write-Host "ERROR: nyaterm-classic.exe is not running." -ForegroundColor Red
  exit 1
}

# Collect NyaTerm plus every WebView2 process (they are children of it).
$all = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)
$ids = New-Object 'System.Collections.Generic.HashSet[int]'
$queue = New-Object 'System.Collections.Generic.Queue[int]'
foreach ($a in $app) { $queue.Enqueue($a.Id) }
while ($queue.Count -gt 0) {
  $cur = $queue.Dequeue()
  if (-not $ids.Add($cur)) { continue }
  foreach ($c in $all) { if ($c.ParentProcessId -eq $cur) { $queue.Enqueue([int]$c.ProcessId) } }
}

$targets = @()
foreach ($id in $ids) {
  $info = $all | Where-Object { $_.ProcessId -eq $id } | Select-Object -First 1
  if ($null -eq $info) { continue }
  if ($info.Name -notlike "msedgewebview2*" -and $info.Name -notlike "nyaterm-classic*") { continue }
  $proc = Get-Process -Id $id -ErrorAction SilentlyContinue
  if ($null -eq $proc) { continue }
  $targets += [pscustomobject]@{
    Id    = $id
    Name  = $info.Name
    Type  = Get-Type $info.CommandLine
    Start = $proc.TotalProcessorTime.TotalSeconds
  }
}

if ($targets.Count -eq 0) {
  Write-Host "No WebView2 processes found under NyaTerm." -ForegroundColor Yellow
  exit 1
}

Write-Host "Sampling $SampleSeconds s. Keep the terminal producing output..." -ForegroundColor Yellow
Start-Sleep -Seconds $SampleSeconds

$rows = @()
foreach ($t in $targets) {
  $proc = Get-Process -Id $t.Id -ErrorAction SilentlyContinue
  $end = if ($proc) { $proc.TotalProcessorTime.TotalSeconds } else { $t.Start }
  $delta = $end - $t.Start
  $rows += [pscustomobject]@{
    Type    = $t.Type
    PID     = $t.Id
    CpuSec  = [math]::Round($end, 1)
    DeltaS  = [math]::Round($delta, 2)
    PctCore = [math]::Round($delta / $SampleSeconds * 100, 1)
  }
}

$rows | Sort-Object DeltaS -Descending | Format-Table -AutoSize | Out-String | Write-Host

$hottest = $rows | Sort-Object DeltaS -Descending | Select-Object -First 1
Write-Host ("Hottest process: {0} (PID {1}) at {2}% of one core" -f $hottest.Type, $hottest.PID, $hottest.PctCore) -ForegroundColor Cyan
Write-Host ""
Write-Host "How to read this:" -ForegroundColor Gray
Write-Host "  gpu      highest  => WebView2 is rasterizing in software (no GPU). Code changes cannot fix it." -ForegroundColor Gray
Write-Host "  renderer highest  => JavaScript/DOM work. That IS fixable in code." -ForegroundColor Gray
Write-Host "  browser  highest  => window composition. Transparency/modal overlays matter." -ForegroundColor Gray

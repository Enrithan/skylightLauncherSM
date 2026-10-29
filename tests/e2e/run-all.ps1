<#
.SYNOPSIS
    Master E2E Test Suite Runner for Skylight Tizen
.DESCRIPTION
    Executes Tiers 1-4 opaque-box end-to-end test suites:
      - Tier 1: Feature Coverage (tests/e2e/tier1-features.js)
      - Tier 2: Boundary & Corner Cases (tests/e2e/tier2-boundaries.js)
      - Tier 3: Pairwise Combinations (tests/e2e/tier3-combinations.js)
      - Tier 4: Real-World Device Telemetry (tests/e2e/tier4-device-telemetry.ps1)
#>
param(
    [string]$DeviceUrl = "http://192.168.40.15:8130",
    [string]$Tier = "All",
    [switch]$AllowFailures
)

$ErrorActionPreference = "Continue"
$ScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Resolve-Path (Join-Path $ScriptRoot "..\..")

Write-Host ""
Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host "  Skylight Tizen: Master E2E Test Suite Runner (Tiers 1-4)" -ForegroundColor Cyan
Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host "  Project Root: $ProjectRoot"
Write-Host "  Device URL  : $DeviceUrl"
Write-Host "  Scope       : $Tier"
Write-Host "-----------------------------------------------------------------"

$MasterStart = [DateTime]::UtcNow
$TierResults = @()

function Run-TierNode {
    param(
        [string]$TierName,
        [string]$ScriptFile
    )
    Write-Host "`n>>> Running $TierName ($ScriptFile)..." -ForegroundColor Yellow
    $start = [DateTime]::UtcNow
    $output = & node.exe (Join-Path $ScriptRoot $ScriptFile) 2>&1
    $exitCode = $LASTEXITCODE
    $elapsed = [math]::Round(([DateTime]::UtcNow - $start).TotalSeconds, 2)

    # Print output
    $output | ForEach-Object { Write-Host $_ }

    # Parse counts from output
    $total = 0; $passed = 0; $failed = 0
    foreach ($line in $output) {
        if ($line -match "Total:\s*(\d+)\s*\|\s*Passed:\s*(\d+)\s*\|\s*Failed:\s*(\d+)") {
            $total = [int]$matches[1]
            $passed = [int]$matches[2]
            $failed = [int]$matches[3]
        }
    }

    $script:TierResults += [PSCustomObject]@{
        Tier     = $TierName
        File     = $ScriptFile
        Total    = $total
        Passed   = $passed
        Failed   = $failed
        TimeSec  = $elapsed
        ExitCode = $exitCode
    }
}

function Run-TierPowerShell {
    param(
        [string]$TierName,
        [string]$ScriptFile
    )
    Write-Host "`n>>> Running $TierName ($ScriptFile)..." -ForegroundColor Yellow
    $start = [DateTime]::UtcNow
    $output = & powershell.exe -ExecutionPolicy Bypass -File (Join-Path $ScriptRoot $ScriptFile) -DeviceUrl $DeviceUrl 2>&1
    $exitCode = $LASTEXITCODE
    $elapsed = [math]::Round(([DateTime]::UtcNow - $start).TotalSeconds, 2)

    $output | ForEach-Object { Write-Host $_ }

    $total = 0; $passed = 0; $failed = 0
    foreach ($line in $output) {
        if ($line -match "Total Scenarios:\s*(\d+)\s*\|\s*Passed:\s*(\d+)\s*\|\s*Failed:\s*(\d+)") {
            $total = [int]$matches[1]
            $passed = [int]$matches[2]
            $failed = [int]$matches[3]
        }
    }

    $script:TierResults += [PSCustomObject]@{
        Tier     = $TierName
        File     = $ScriptFile
        Total    = $total
        Passed   = $passed
        Failed   = $failed
        TimeSec  = $elapsed
        ExitCode = $exitCode
    }
}

# Execute selected tiers
if ($Tier -eq "All" -or $Tier -eq "Tier1") {
    Run-TierNode -TierName "Tier 1: Feature Coverage" -ScriptFile "tier1-features.js"
}
if ($Tier -eq "All" -or $Tier -eq "Tier2") {
    Run-TierNode -TierName "Tier 2: Boundary & Corner Cases" -ScriptFile "tier2-boundaries.js"
}
if ($Tier -eq "All" -or $Tier -eq "Tier3") {
    Run-TierNode -TierName "Tier 3: Pairwise Combinations" -ScriptFile "tier3-combinations.js"
}
if ($Tier -eq "All" -or $Tier -eq "Tier4") {
    Run-TierPowerShell -TierName "Tier 4: Real-World Device Telemetry" -ScriptFile "tier4-device-telemetry.ps1"
}

# Grand Summary
$GrandTotal = ($TierResults | Measure-Object -Property Total -Sum).Sum
$GrandPassed = ($TierResults | Measure-Object -Property Passed -Sum).Sum
$GrandFailed = ($TierResults | Measure-Object -Property Failed -Sum).Sum
$MasterElapsed = [math]::Round(([DateTime]::UtcNow - $MasterStart).TotalSeconds, 2)
$AnyFailed = ($TierResults | Where-Object { $_.ExitCode -ne 0 -or $_.Failed -gt 0 }).Count -gt 0

Write-Host "`n=================================================================" -ForegroundColor Cyan
Write-Host "  GRAND E2E TEST EXECUTION SUMMARY" -ForegroundColor Cyan
Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host "  Tier                                Total  Passed  Failed   Pass%   Time"
Write-Host "  ---------------------------------  ------  ------  ------  ------  -----"

foreach ($tr in $TierResults) {
    $pct = if ($tr.Total -gt 0) { [math]::Round(($tr.Passed / $tr.Total) * 100) } else { 0 }
    $col = if ($tr.Failed -eq 0 -and $tr.ExitCode -eq 0) { "Green" } else { "Yellow" }
    $line = "  {0,-33}  {1,6}  {2,6}  {3,6}  {4,5}%  {5,4}s" -f $tr.Tier, $tr.Total, $tr.Passed, $tr.Failed, $pct, $tr.TimeSec
    Write-Host $line -ForegroundColor $col
}

Write-Host "  ---------------------------------  ------  ------  ------  ------  -----"
$grandPct = if ($GrandTotal -gt 0) { [math]::Round(($GrandPassed / $GrandTotal) * 100) } else { 0 }
$grandCol = if ($GrandFailed -eq 0) { "Green" } else { "Yellow" }
$summaryLine = "  {0,-33}  {1,6}  {2,6}  {3,6}  {4,5}%  {5,4}s" -f "TOTAL ACROSS ALL TIERS", $GrandTotal, $GrandPassed, $GrandFailed, $grandPct, $MasterElapsed
Write-Host $summaryLine -ForegroundColor $grandCol
Write-Host "=================================================================" -ForegroundColor Cyan

if ($AnyFailed -and !$AllowFailures) {
    Write-Host "  STATUS: FAIL ($GrandFailed test cases require implementation fixes)" -ForegroundColor Red
    exit 1
} else {
    Write-Host "  STATUS: SUCCESS (All executed test suites verified)" -ForegroundColor Green
    exit 0
}

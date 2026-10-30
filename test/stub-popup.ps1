#requires -Version 5.1
# Test double for popup.ps1: records the payload it received and returns a
# configurable action, so the Node wiring can be exercised without a real window.
param(
    [Parameter(Mandatory = $true)][string]$PayloadFile
)

$raw = [System.IO.File]::ReadAllText($PayloadFile, [System.Text.Encoding]::UTF8)
$capture = $env:DSH_NOTIFIER_CAPTURE
if ($capture) {
    [System.IO.File]::AppendAllText($capture, $raw + "`n", (New-Object System.Text.UTF8Encoding($false)))
}
$action = $env:DSH_NOTIFIER_ACTION
if (-not $action) {
    $payload = $raw | ConvertFrom-Json
    if ($payload.kind -eq 'question') { $action = 'opt-0' } else { $action = 'open' }
}
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::Out.WriteLine(('{"action":"' + $action + '","dismissed":true}'))

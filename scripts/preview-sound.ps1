#requires -Version 5.1
<#
    dsh-desktop-notifier sound preview.

    Speaks the same protocol as the card renderer: reads a JSON payload (UTF-8)
    from -PayloadFile, prints exactly one JSON result line. Used by the Settings
    page's "试听" button so a sound can be checked without showing a card.

    Payload: { "sound": "<preset>", "soundFile": "<optional .wav>" }
    Result:  { "action": "played" } | { "action": "error" }
#>
param(
    [Parameter(Mandatory = $true)][string]$PayloadFile
)

$ErrorActionPreference = 'Stop'

function Write-Result {
    param([string]$Action)
    try {
        [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
        [Console]::Out.WriteLine(([ordered]@{ action = $Action } | ConvertTo-Json -Compress))
        [Console]::Out.Flush()
    } catch { }
    [Environment]::Exit(0)
}

try {
    . (Join-Path $PSScriptRoot 'sound.ps1')
    $raw = [System.IO.File]::ReadAllText($PayloadFile, [System.Text.Encoding]::UTF8)
    $data = $raw | ConvertFrom-Json

    $sound = 'default'
    if ($null -ne $data.sound) {
        if ($data.sound -is [bool]) {
            if (-not $data.sound) { $sound = 'none' }
        } else {
            $sound = [string]$data.sound
        }
    }
    $file = ''
    if ($data.soundFile) { $file = [string]$data.soundFile }

    Play-NotifierSound -Name $sound -Kind 'question' -File $file
    Write-Result -Action 'played'
} catch {
    Write-Result -Action 'error'
}

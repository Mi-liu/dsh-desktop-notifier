#requires -Version 5.1
<#
    dsh-desktop-notifier sound helper.

    One place for "which sound plays for which card", shared by the card renderer
    (scripts/popup.ps1) and the Settings page's preview button
    (scripts/preview-sound.ps1).

    Name  = none | default | notify | ding | chimes | tada | question | asterisk |
            exclamation | critical | email | calendar | messaging | nudge | reminder
    Kind  = info | question | approval | ... (only consulted by "default")
    File  = optional .wav path; when it exists it is played instead of the preset
#>
function Play-NotifierSound {
    param(
        [string]$Name = 'default',
        [string]$Kind = 'info',
        [string]$File = ''
    )

    $name = ''
    if ($Name) { $name = $Name.ToLowerInvariant() }
    if (-not $name -or $name -eq 'none') { return }

    if ($File -and (Test-Path -LiteralPath $File)) {
        try {
            $player = New-Object System.Media.SoundPlayer $File
            $player.Play()
            return
        } catch { }
    }

    $playAs = $name
    if ($playAs -eq 'default') {
        switch ($Kind) {
            'question' { $playAs = 'question' }
            'approval' { $playAs = 'exclamation' }
            default { $playAs = 'asterisk' }
        }
    }

    $mediaNames = @{
        notify    = 'Windows Notify.wav'
        ding      = 'Windows Ding.wav'
        chimes    = 'chimes.wav'
        tada      = 'tada.wav'
        email     = 'Windows Notify Email.wav'
        calendar  = 'Windows Notify Calendar.wav'
        messaging = 'Windows Notify Messaging.wav'
        nudge     = 'Windows Message Nudge.wav'
        reminder  = 'Windows Notify System Generic.wav'
    }

    try {
        switch ($playAs) {
            'question'    { [System.Media.SystemSounds]::Question.Play(); return }
            'asterisk'    { [System.Media.SystemSounds]::Asterisk.Play(); return }
            'exclamation' { [System.Media.SystemSounds]::Exclamation.Play(); return }
            'critical'    { [System.Media.SystemSounds]::Hand.Play(); return }
        }
        if ($mediaNames.ContainsKey($playAs)) {
            $wav = Join-Path $env:WINDIR ('Media\' + $mediaNames[$playAs])
            if (Test-Path -LiteralPath $wav) {
                $player = New-Object System.Media.SoundPlayer $wav
                $player.Play()
            }
        }
    } catch { }
}

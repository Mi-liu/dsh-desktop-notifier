#requires -Version 5.1
# Bring the DeepSeek Harness desktop window to the foreground.
# Prints one JSON line: { "ok": true|false }
$ErrorActionPreference = 'Stop'

try {
    . (Join-Path $PSScriptRoot 'activate-window.ps1')
    $focused = Focus-HarnessWindow
    if ($focused) { '{"ok":true}' } else { '{"ok":false}' }
} catch {
    '{"ok":false}'
}

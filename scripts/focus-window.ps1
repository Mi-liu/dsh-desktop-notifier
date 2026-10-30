#requires -Version 5.1
# Bring the DeepSeek Harness desktop window to the foreground.
# Prints one JSON line: { "ok": true|false }
$ErrorActionPreference = 'Stop'

try {
    Add-Type -Namespace NotifierWin32 -Name Native -MemberDefinition @'
[DllImport("user32.dll")] public static extern bool SetForegroundWindow(System.IntPtr hWnd);
[DllImport("user32.dll")] public static extern bool ShowWindow(System.IntPtr hWnd, int nCmdShow);
[DllImport("user32.dll")] public static extern bool IsIconic(System.IntPtr hWnd);
'@

    $target = $null
    foreach ($name in @('DeepSeek Harness', 'dsh')) {
        $candidate = Get-Process -Name $name -ErrorAction SilentlyContinue |
            Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero } |
            Select-Object -First 1
        if ($candidate) { $target = $candidate; break }
    }
    if (-not $target) {
        $target = Get-Process -ErrorAction SilentlyContinue |
            Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero -and $_.MainWindowTitle -like '*DeepSeek Harness*' } |
            Select-Object -First 1
    }
    if (-not $target) {
        '{"ok":false}'
        exit 0
    }
    $handle = $target.MainWindowHandle
    if ([NotifierWin32.Native]::IsIconic($handle)) {
        [void][NotifierWin32.Native]::ShowWindow($handle, 9)
    }
    [void][NotifierWin32.Native]::ShowWindow($handle, 5)
    [void][NotifierWin32.Native]::SetForegroundWindow($handle)
    '{"ok":true}'
} catch {
    '{"ok":false}'
}

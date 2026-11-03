#requires -Version 5.1
<#
    Shared window activation helper.

    `Focus-HarnessWindow` brings the DeepSeek Harness desktop window to the
    foreground. Windows only lets a process change the foreground window when it
    already owns the foreground (or received the last input), so the reliable
    call site is the popup process itself: the card is the foreground window when
    the user clicks "view". A standalone caller (the host's fallback spawn) still
    works most of the time thanks to the AttachThreadInput + synthetic-Alt dance.

    Returns $true when the Harness window really ended up in the foreground.
#>
if (-not ('NotifierActivate' -as [type])) {
    Add-Type -Namespace NotifierActivate -Name Native -MemberDefinition @'
[DllImport("user32.dll")] public static extern bool SetForegroundWindow(System.IntPtr hWnd);
[DllImport("user32.dll")] public static extern bool ShowWindow(System.IntPtr hWnd, int nCmdShow);
[DllImport("user32.dll")] public static extern bool IsIconic(System.IntPtr hWnd);
[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(System.IntPtr hWnd, out uint pid);
[DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
[DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
[DllImport("user32.dll")] public static extern bool BringWindowToTop(System.IntPtr hWnd);
[DllImport("user32.dll")] public static extern bool SetWindowPos(System.IntPtr hWnd, System.IntPtr after, int x, int y, int cx, int cy, uint flags);
[DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, System.UIntPtr extra);
'@
}

function Get-HarnessWindow {
    $fallback = $null
    foreach ($p in @(Get-Process -ErrorAction SilentlyContinue)) {
        $handle = $p.MainWindowHandle
        if ($handle -eq [IntPtr]::Zero) { continue }
        $title = [string]$p.MainWindowTitle
        if (-not $title) { continue }
        if ($p.ProcessName -eq 'DeepSeek Harness' -and $title -like '*DeepSeek Harness*') { return $p }
        if (-not $fallback -and $title -like '*DeepSeek Harness*') { $fallback = $p }
    }
    return $fallback
}

function Test-IsForeground {
    param([System.IntPtr]$Handle)
    try {
        return ([NotifierActivate.Native]::GetForegroundWindow() -eq $Handle)
    } catch {
        return $false
    }
}

function Focus-HarnessWindow {
    [CmdletBinding()]
    param()

    $target = Get-HarnessWindow
    if (-not $target) { return $false }
    $handle = [System.IntPtr]$target.MainWindowHandle
    if ($handle -eq [IntPtr]::Zero) { return $false }

    if ([NotifierActivate.Native]::IsIconic($handle)) {
        [void][NotifierActivate.Native]::ShowWindow($handle, 9)
    } else {
        [void][NotifierActivate.Native]::ShowWindow($handle, 5)
    }
    if (Test-IsForeground -Handle $handle) { return $true }

    # Windows refuses SetForegroundWindow from a process that neither owns the
    # foreground nor saw the last input. Two well-known unlockers: a synthetic
    # Alt key press, and attaching to the foreground thread's input queue.
    try {
        [void][NotifierActivate.Native]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero)
        [void][NotifierActivate.Native]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)
    } catch { }

    $foreground = [NotifierActivate.Native]::GetForegroundWindow()
    $foregroundThread = 0
    if ($foreground -ne [IntPtr]::Zero) {
        [void][NotifierActivate.Native]::GetWindowThreadProcessId($foreground, [ref]$foregroundThread)
    }
    $ownThread = [NotifierActivate.Native]::GetCurrentThreadId()
    $attached = $false
    if ($foregroundThread -ne 0 -and $foregroundThread -ne $ownThread) {
        try { $attached = [NotifierActivate.Native]::AttachThreadInput($foregroundThread, $ownThread, $true) } catch { }
    }
    try {
        [void][NotifierActivate.Native]::BringWindowToTop($handle)
        [void][NotifierActivate.Native]::SetForegroundWindow($handle)
    } finally {
        if ($attached) {
            try { [void][NotifierActivate.Native]::AttachThreadInput($foregroundThread, $ownThread, $false) } catch { }
        }
    }
    Start-Sleep -Milliseconds 90
    if (Test-IsForeground -Handle $handle) { return $true }

    # Still not foreground: flip the window through the topmost band, which also
    # lifts it above other topmost windows, then drop the topmost flag again.
    try {
        $flags = 0x0001 -bor 0x0002 -bor 0x0040
        [void][NotifierActivate.Native]::SetWindowPos($handle, [IntPtr](-1), 0, 0, 0, 0, $flags)
        [void][NotifierActivate.Native]::SetWindowPos($handle, [IntPtr](-2), 0, 0, 0, 0, $flags)
        [void][NotifierActivate.Native]::SetForegroundWindow($handle)
    } catch { }
    Start-Sleep -Milliseconds 90
    if (Test-IsForeground -Handle $handle) { return $true }

    # Last resort: the Shell's activation API, which goes through a different path.
    try {
        $shell = New-Object -ComObject WScript.Shell
        [void]$shell.AppActivate($target.Id)
        Start-Sleep -Milliseconds 150
    } catch { }
    return (Test-IsForeground -Handle $handle)
}

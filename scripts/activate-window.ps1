#requires -Version 5.1
<#
    Shared window activation helper.

    `Focus-HarnessWindow` brings the DeepSeek Harness desktop window to the
    foreground, restoring it from the tray if the user had hidden it. Windows
    only lets a process change the foreground window when it already owns the
    foreground (or received the last input), so the reliable call site is the
    popup process itself: the card is the foreground window when the user clicks
    "view". A standalone caller (the host's fallback spawn) still works most of
    the time thanks to the AttachThreadInput + synthetic-Alt dance.

    Windows are enumerated instead of using Process.MainWindowHandle, because the
    main handle reads as zero once the window is hidden in the tray.

    Never pass SW_SHOW (5) to ShowWindow here: on this Electron build SW_SHOW on
    an already-visible window hides it (verified 2026-11-03: IsWindowVisible was
    true before the call and false right after it, which closed the app into the
    tray when the user clicked "view"). SW_RESTORE (9) for a minimised window and
    SW_SHOWNOACTIVATE (4) for a hidden one are safe, and a visible window needs no
    show-state call at all.

    Returns $true when the Harness window really ended up in the foreground.
#>
if (-not ('NotifierActivate' -as [type])) {
    Add-Type -Namespace NotifierActivate -Name Native -MemberDefinition @'
public delegate bool EnumWindowsProc(System.IntPtr hWnd, System.IntPtr lParam);
[DllImport("user32.dll")] public static extern bool SetForegroundWindow(System.IntPtr hWnd);
[DllImport("user32.dll")] public static extern bool ShowWindow(System.IntPtr hWnd, int nCmdShow);
[DllImport("user32.dll")] public static extern bool IsIconic(System.IntPtr hWnd);
[DllImport("user32.dll")] public static extern bool IsWindowVisible(System.IntPtr hWnd);
[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(System.IntPtr hWnd, out uint pid);
[DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
[DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
[DllImport("user32.dll")] public static extern bool BringWindowToTop(System.IntPtr hWnd);
[DllImport("user32.dll")] public static extern bool SetWindowPos(System.IntPtr hWnd, System.IntPtr after, int x, int y, int cx, int cy, uint flags);
[DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, System.UIntPtr extra);
[DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc callback, System.IntPtr lParam);
[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowTextW(System.IntPtr hWnd, System.Text.StringBuilder text, int max);
'@
}

$script:HarnessWindow = $null

function Find-HarnessWindow {
    $script:HarnessWindow = $null
    $fallback = $null
    $callback = [NotifierActivate.Native+EnumWindowsProc]{
        param($hWnd, $lParam)
        $owner = 0
        [void][NotifierActivate.Native]::GetWindowThreadProcessId($hWnd, [ref]$owner)
        $process = Get-Process -Id $owner -ErrorAction SilentlyContinue
        if (-not $process) { return $true }
        $builder = New-Object System.Text.StringBuilder 512
        [void][NotifierActivate.Native]::GetWindowTextW($hWnd, $builder, 512)
        $title = $builder.ToString()
        if (-not $title) { return $true }
        $item = [pscustomobject]@{ Handle = $hWnd; ProcessId = $owner; Title = $title; ProcessName = [string]$process.ProcessName }
        if ($item.ProcessName -eq 'DeepSeek Harness' -and $title -like '*DeepSeek Harness*') {
            $script:HarnessWindow = $item
            return $false
        }
        if (-not $fallback -and $title -like '*DeepSeek Harness*') {
            # EnumWindows callbacks cannot assign script-scope variables that stay
            # visible after the call, so record the fallback in the script scope too.
            if (-not $script:HarnessFallback) { $script:HarnessFallback = $item }
        }
        return $true
    }
    $script:HarnessFallback = $null
    [void][NotifierActivate.Native]::EnumWindows($callback, [IntPtr]::Zero)
    if ($script:HarnessWindow) { return $script:HarnessWindow }
    if ($script:HarnessFallback) { return $script:HarnessFallback }
    return $null
}

function Get-HarnessWindow {
    if ($script:HarnessWindow) { return $script:HarnessWindow }
    return (Find-HarnessWindow)
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

    $target = Find-HarnessWindow
    if (-not $target) { return $false }
    $handle = [System.IntPtr]$target.Handle
    if ($handle -eq [IntPtr]::Zero) { return $false }

    # Restore a minimised window, un-hide a tray-hidden one, and leave a visible
    # window's show state untouched (SW_SHOW would hide it on this Electron build).
    if ([NotifierActivate.Native]::IsIconic($handle)) {
        [void][NotifierActivate.Native]::ShowWindow($handle, 9)
    } elseif (-not [NotifierActivate.Native]::IsWindowVisible($handle)) {
        [void][NotifierActivate.Native]::ShowWindow($handle, 4)
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
        [void]$shell.AppActivate($target.ProcessId)
        Start-Sleep -Milliseconds 150
    } catch { }
    return (Test-IsForeground -Handle $handle)
}

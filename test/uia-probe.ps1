<#
  Probe the DeepSeek Harness window's UI Automation tree.

  Used to verify the plugin's Settings page without a human: lists the clickable
  elements (and optionally clicks one by name).

  Examples:
    powershell -NoProfile -File test/uia-probe.ps1
    powershell -NoProfile -File test/uia-probe.ps1 -Filter 设置
    powershell -NoProfile -File test/uia-probe.ps1 -Click 设置
#>
param(
    [string]$Filter = '',
    [string]$Click = '',
    [int]$MaxItems = 400,
    [int]$WaitSeconds = 0
)

$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms

# UI Automation reports physical pixels, so physical clicks must not be DPI-virtualized.
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class ProbeDpi {
    [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
}
"@
[void][ProbeDpi]::SetProcessDPIAware()

function Get-HarnessWindow {
    $root = [System.Windows.Automation.AutomationElement]::RootElement
    $cond = New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::ProcessIdProperty,
        (Get-Process -Name 'DeepSeek Harness' -ErrorAction Stop | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1).Id
    )
    $wins = $root.FindAll([System.Windows.Automation.TreeScope]::Children, $cond)
    foreach ($w in $wins) {
        if ($w.Current.Name -like '*DeepSeek Harness*') { return $w }
    }
    return $null
}

$proc = Get-Process -Name 'DeepSeek Harness' -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $proc) { throw 'DeepSeek Harness window not found' }

$win = Get-HarnessWindow
if (-not $win) { throw 'DeepSeek Harness automation window not found' }
if ($WaitSeconds -gt 0) { Start-Sleep -Seconds $WaitSeconds }

# Bring the window up so its accessibility tree is populated.
try { [void]$win.SetFocus() } catch {
    Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class ProbeForeground {
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
}
"@
    [void][ProbeForeground]::SetForegroundWindow($proc.MainWindowHandle)
}
Start-Sleep -Milliseconds 300

$all = $win.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
$items = @()
foreach ($el in $all) {
    $name = $el.Current.Name
    if ([string]::IsNullOrWhiteSpace($name)) { continue }
    if ($Filter -and $name -notlike "*$Filter*") { continue }
    $items += [pscustomobject]@{
        Name   = $name
        Type   = $el.Current.ControlType.ProgrammaticName -replace 'ControlType\.', ''
        Id     = $el.Current.AutomationId
        X      = [int]$el.Current.BoundingRectangle.X
        Y      = [int]$el.Current.BoundingRectangle.Y
        W      = [int]$el.Current.BoundingRectangle.Width
        H      = [int]$el.Current.BoundingRectangle.Height
        Element = $el
    }
    if ($items.Count -ge $MaxItems) { break }
}

foreach ($it in $items) {
    '{0,-12} {1,-28} id={2,-24} {3},{4} {5}x{6}' -f $it.Type, ($it.Name.Substring(0, [Math]::Min(26, $it.Name.Length))), $it.Id, $it.X, $it.Y, $it.W, $it.H
}

if ($Click) {
    $target = $items | Where-Object { $_.Name -eq $Click } | Select-Object -First 1
    if (-not $target) {
        $target = $items | Where-Object { $_.Name -like "*$Click*" } | Select-Object -First 1
    }
    if (-not $target) { Write-Output "NO TARGET: $Click"; exit 2 }
    $clicked = $false
    try {
        $pattern = $target.Element.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
        $pattern.Invoke()
        $clicked = $true
    } catch { }
    if (-not $clicked) {
        # Chromium often exposes only the legacy pattern; fall back to a physical click.
        Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class ProbeMouse {
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
}
"@
        $cx = $target.X + [int]($target.W / 2)
        $cy = $target.Y + [int]($target.H / 2)
        [void][ProbeMouse]::SetCursorPos($cx, $cy)
        Start-Sleep -Milliseconds 80
        [ProbeMouse]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)   # left down
        Start-Sleep -Milliseconds 40
        [ProbeMouse]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)   # left up
        $clicked = $true
    }
    if ($clicked) { Write-Output "CLICKED: $($target.Name) at $($target.X),$($target.Y)" } else { exit 3 }
}

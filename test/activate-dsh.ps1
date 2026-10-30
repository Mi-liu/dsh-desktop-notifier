param(
  [int]$ProcId = 0,
  [switch]$SendReload,
  [int]$WaitSec = 9
)

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

$AE = [System.Windows.Automation.AutomationElement]
$TS = [System.Windows.Automation.TreeScope]

if ($ProcId -eq 0) {
  $proc = Get-Process -Name 'DeepSeek Harness' -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
  if (-not $proc) { Write-Output 'NO_DSH_PROCESS'; exit 1 }
  $ProcId = $proc.Id
}

$root = $AE::RootElement
$cond = New-Object System.Windows.Automation.PropertyCondition($AE::ClassNameProperty, 'Shell_TrayWnd')
$tray = $root.FindFirst($TS::Children, $cond)
if (-not $tray) { Write-Output 'NO_TASKBAR'; exit 2 }

$btnCond = New-Object System.Windows.Automation.PropertyCondition($AE::ControlTypeProperty, [System.Windows.Automation.ControlType]::Button)
$buttons = $tray.FindAll($TS::Descendants, $btnCond)
$target = $null
foreach ($b in $buttons) {
  $n = $b.Current.Name
  if ($n -and $n -like '*DeepSeek*') { $target = $b; break }
}
if (-not $target) {
  Write-Output ('NO_BUTTON; buttons=' + (($buttons | ForEach-Object { $_.Current.Name }) -join ' | '))
  exit 3
}
Write-Output ('TARGET: ' + $target.Current.Name + ' @ ' + $target.Current.BoundingRectangle)
$pattern = $null
if ($target.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$pattern)) {
  $pattern.Invoke()
  Write-Output 'INVOKED'
} else {
  $legacy = $null
  if ($target.TryGetCurrentPattern([System.Windows.Automation.LegacyIAccessiblePattern]::Pattern, [ref]$legacy)) {
    $legacy.DoDefaultAction()
    Write-Output 'DEFAULT_ACTION'
  } else {
    $r = $target.Current.BoundingRectangle
    $cs = @"
using System;
using System.Runtime.InteropServices;
public class Mouse4 {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, UIntPtr e);
}
"@
    Add-Type -TypeDefinition $cs -ErrorAction SilentlyContinue
    [void][Mouse4]::SetCursorPos([int]($r.X + $r.Width / 2), [int]($r.Y + $r.Height / 2))
    Start-Sleep -Milliseconds 150
    [Mouse4]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 60
    [Mouse4]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
    Write-Output 'MOUSE_CLICKED'
  }
}

Start-Sleep -Milliseconds 1200
$cs2 = @"
using System;
using System.Runtime.InteropServices;
public class Fg4 {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern IntPtr GetParent(IntPtr h);
}
"@
Add-Type -TypeDefinition $cs2 -ErrorAction SilentlyContinue
$fg = [Fg4]::GetForegroundWindow(); $pp = 0; [void][Fg4]::GetWindowThreadProcessId($fg, [ref]$pp)
$owner = (Get-Process -Id $pp -ErrorAction SilentlyContinue)
Write-Output ('FOREGROUND pid=' + $pp + ' name=' + $owner.ProcessName)
if ($pp -ne $ProcId) { Write-Output 'FOCUS_WARN' }

if ($SendReload) {
  Add-Type -AssemblyName System.Windows.Forms
  Start-Sleep -Milliseconds 600
  [System.Windows.Forms.SendKeys]::SendWait('^r')
  Write-Output 'RELOAD_SENT'
  Start-Sleep -Seconds $WaitSec
  Write-Output 'WAITED'
}

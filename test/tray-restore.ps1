param(
  [string]$Match = 'DeepSeek'
)

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms

Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class TrayDpi {
    [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, UIntPtr e);
}
"@
[void][TrayDpi]::SetProcessDPIAware()

$AE = [System.Windows.Automation.AutomationElement]
$TS = [System.Windows.Automation.TreeScope]

function Click-Physical([int]$x, [int]$y, [int]$count = 1) {
  [void][TrayDpi]::SetCursorPos($x, $y)
  Start-Sleep -Milliseconds 150
  for ($i = 0; $i -lt $count; $i++) {
    [TrayDpi]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 40
    [TrayDpi]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 120
  }
}

$root = $AE::RootElement

# 1) open the tray overflow flyout
$trayCond = New-Object System.Windows.Automation.PropertyCondition($AE::ClassNameProperty, 'Shell_TrayWnd')
$tray = $root.FindFirst($TS::Children, $trayCond)
$all = $tray.FindAll($TS::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
$show = $null
foreach ($el in $all) { if ($el.Current.Name -like '*显示隐藏的图标*') { $show = $el; break } }
if ($show) {
  $r = $show.Current.BoundingRectangle
  Click-Physical ([int]($r.X + $r.Width / 2)) ([int]($r.Y + $r.Height / 2)) 1
  Write-Output 'OVERFLOW_OPENED'
} else {
  Write-Output 'NO_OVERFLOW_BUTTON'
}
Start-Sleep -Milliseconds 900

# 2) locate the overflow window and the target icon
$targets = @()
$wins = $root.FindAll($TS::Children, [System.Windows.Automation.Condition]::TrueCondition)
foreach ($w in $wins) {
  $n = $w.Current.Name
  $cn = $w.Current.ClassName
  if ($n -like '*overflow*' -or $cn -like '*Overflow*' -or $n -like '*通知*') {
    $targets += $w
    Write-Output ("OVERFLOW_WINDOW: name='$n' class='$cn'")
  }
}
$icon = $null
foreach ($w in $targets) {
  $desc = $w.FindAll($TS::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
  foreach ($el in $desc) {
    $nm = $el.Current.Name
    if ($nm -and $nm -like "*$Match*") { Write-Output ("ICON: '$nm' @ " + $el.Current.BoundingRectangle); $icon = $el; break }
  }
  if ($icon) { break }
}
if (-not $icon) { Write-Output 'NO_ICON'; exit 3 }

$r = $icon.Current.BoundingRectangle
Click-Physical ([int]($r.X + $r.Width / 2)) ([int]($r.Y + $r.Height / 2)) 2
Write-Output 'ICON_DOUBLE_CLICKED'
Start-Sleep -Milliseconds 1500

# 3) report whether the app window is back
$wins = (Get-Process -Name 'DeepSeek Harness' -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 })
if ($wins) { foreach ($w in $wins) { Write-Output ('WINDOW_BACK: ' + $w.MainWindowTitle) } } else { Write-Output 'WINDOW_STILL_HIDDEN' }

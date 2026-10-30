param([string]$TitlePart='DeepSeek Harness',[string]$Keys='^r')
Add-Type -Namespace W -Name N -MemberDefinition '
[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h,int c);
[DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
'
[void][W.N]::SetProcessDPIAware()
$p = Get-Process | Where-Object { $_.MainWindowTitle -like "*$TitlePart*" -and $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $p) { 'NO_WINDOW'; exit 1 }
[void][W.N]::ShowWindow($p.MainWindowHandle,9)
[void][W.N]::SetForegroundWindow($p.MainWindowHandle)
Start-Sleep -Milliseconds 700
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.SendKeys]::SendWait($Keys)
Start-Sleep -Milliseconds 400
"KEYS_SENT: $Keys to pid $($p.Id)"

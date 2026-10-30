param([string]$Title, [string]$ButtonName, [int]$WaitSeconds = 20)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$result = [ordered]@{ ok = $false; stage = 'start' }
try {
  $deadline = (Get-Date).AddSeconds($WaitSeconds)
  $win = $null
  while ((Get-Date) -lt $deadline -and $win -eq $null) {
    $root = [System.Windows.Automation.AutomationElement]::RootElement
    $childs = $root.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
    foreach ($c in $childs) {
      try { if ([string]$c.Current.Name -eq $Title) { $win = $c; break } } catch { }
    }
    if ($win -eq $null) { Start-Sleep -Milliseconds 400 }
  }
  if ($win -eq $null) { $result.stage = 'window-not-found'; }
  else {
    $result.stage = 'window-found'
    $btnCond = New-Object System.Windows.Automation.AndCondition(
      (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Button)),
      (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, $ButtonName)))
    $deadline = (Get-Date).AddSeconds(10)
    $btn = $null
    while ((Get-Date) -lt $deadline -and $btn -eq $null) {
      $btn = $win.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $btnCond)
      if ($btn -eq $null) { Start-Sleep -Milliseconds 300 }
    }
    if ($btn -eq $null) { $result.stage = 'button-not-found' }
    else {
      $pattern = $btn.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
      $pattern.Invoke()
      $result.ok = $true
      $result.stage = 'clicked'
    }
  }
} catch {
  $result.stage = 'error'
  $result.error = $_.Exception.Message
}
$result | ConvertTo-Json -Compress
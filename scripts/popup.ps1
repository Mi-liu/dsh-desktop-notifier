#requires -Version 5.1
<#
    dsh-desktop-notifier popup renderer.

    Shows one WPF card in the bottom-right corner of the primary work area.
    Reads a JSON payload (UTF-8) from -PayloadFile, writes exactly one JSON
    result line to stdout, then exits.

    Result shape: { "action": "<id>", "dismissed": <bool> }
      action = "timeout" | "dismissed" | "skipped" | "error" | one of payload.actions[].id
      "skipped" means notifyWhen = "unfocused" while the DSH window was in the
      foreground, so nothing was shown (and no sound played).
#>
param(
    [Parameter(Mandatory = $true)][string]$PayloadFile
)

$ErrorActionPreference = 'Stop'
$script:ResultAction = 'error'
$script:Timer = $null
$script:Window = $null

function Write-ResultAndExit {
    param([string]$Action, [string]$ErrorText)
    $payload = [ordered]@{ action = $Action; dismissed = ($Action -ne 'error') }
    if ($ErrorText) { $payload.error = $ErrorText }
    try {
        [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
        [Console]::Out.WriteLine(($payload | ConvertTo-Json -Compress))
        [Console]::Out.Flush()
    } catch { }
    [Environment]::Exit(0)
}

function Brush([string]$hex) {
    $b = New-Object System.Windows.Media.SolidColorBrush ([System.Windows.Media.ColorConverter]::ConvertFromString($hex))
    $b.Freeze()
    return $b
}

function Get-RoundedButtonTemplate {
    $xaml = @'
<ControlTemplate xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation" xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml" TargetType="Button">
  <Border x:Name="bd" CornerRadius="8" Background="{TemplateBinding Background}" Padding="{TemplateBinding Padding}">
    <ContentPresenter HorizontalAlignment="Center" VerticalAlignment="Center"/>
  </Border>
  <ControlTemplate.Triggers>
    <Trigger Property="IsMouseOver" Value="True">
      <Setter TargetName="bd" Property="Opacity" Value="0.82"/>
    </Trigger>
    <Trigger Property="IsPressed" Value="True">
      <Setter TargetName="bd" Property="Opacity" Value="0.65"/>
    </Trigger>
  </ControlTemplate.Triggers>
</ControlTemplate>
'@
    return [System.Windows.Markup.XamlReader]::Parse($xaml)
}

try {
    Add-Type -AssemblyName PresentationFramework, PresentationCore, WindowsBase, System.Xaml, System.Drawing

    $raw = [System.IO.File]::ReadAllText($PayloadFile, [System.Text.Encoding]::UTF8)
    if (-not $raw) { Write-ResultAndExit -Action 'error' -ErrorText 'empty payload' }
    $data = $raw | ConvertFrom-Json

    # ── notifyWhen：always（总是）/ unfocused（仅 DSH 未聚焦时）──────────────
    # 前台窗口属于 DeepSeek Harness 时，unfocused 模式直接跳过，不建窗口、
    # 不出声。payload.dshFocused 可显式覆盖检测结果（自动化测试用）。
    function Test-DshInForeground {
        try {
            if (-not ('NotifierFocus.Native' -as [type])) {
                Add-Type -Namespace NotifierFocus -Name Native -MemberDefinition @'
[DllImport("user32.dll")] public static extern System.IntPtr GetForegroundWindow();
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(System.IntPtr hWnd, out uint pid);
'@
            }
            $hWnd = [NotifierFocus.Native]::GetForegroundWindow()
            if ($hWnd -eq [System.IntPtr]::Zero) { return $false }
            $ownerPid = [uint32]0
            [void][NotifierFocus.Native]::GetWindowThreadProcessId($hWnd, [ref]$ownerPid)
            if ($ownerPid -eq 0) { return $false }
            $proc = Get-Process -Id $ownerPid -ErrorAction Stop
            if ($proc.ProcessName -eq 'DeepSeek Harness') { return $true }
            if ($proc.ProcessName -eq 'dsh') { return $true }
            if ($proc.MainWindowTitle -like '*DeepSeek Harness*') { return $true }
            return $false
        } catch {
            return $false
        }
    }

    $notifyWhen = 'always'
    if ($data.notifyWhen) { $notifyWhen = ([string]$data.notifyWhen).ToLowerInvariant() }
    if ($notifyWhen -eq 'unfocused') {
        $inForeground = $false
        if ($null -ne $data.dshFocused) { $inForeground = [bool]$data.dshFocused }
        else { $inForeground = Test-DshInForeground }
        if ($inForeground) { Write-ResultAndExit -Action 'skipped' }
    }

    # ── theme：与 DSH 外观一致（light / dark / system）────────────────────────
    # 取色自 DSH ui-theme 的 design-platform token：
    #   bg-layer-1 / label-primary / label-secondary / label-tertiary / border-l1-l2 /
    #   button-floating-fill / button-info-fill(#4176e6) / 状态色。
    function Get-SystemLightTheme {
        try {
            $path = 'Software\Microsoft\Windows\CurrentVersion\Themes\Personalize'
            $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($path)
            if ($key) {
                $value = $key.GetValue('AppsUseLightTheme', $null)
                $key.Close()
                if ($null -ne $value) { return ([int]$value -ne 0) }
            }
        } catch { }
        return $true    # Windows 默认是浅色
    }

    $themeMode = 'system'
    if ($data.theme) { $themeMode = ([string]$data.theme).ToLowerInvariant() }
    if ($themeMode -eq 'light') {
        $dark = $false
    } elseif ($themeMode -eq 'dark') {
        $dark = $true
    } else {
        $dark = -not (Get-SystemLightTheme)
    }

    if ($dark) {
        $bgColor = '#232324'; $borderColor = '#3a3a3b'; $titleColor = '#f9fafb'
        $bodyColor = '#cfd3d6'; $metaColor = '#adb2b8'
        $btnBg = '#2c2c2e'; $btnFg = '#cfd3d6'
        $closeFg = '#81858c'; $shadowOpacity = 0.55
    } else {
        $bgColor = '#ffffff'; $borderColor = '#e6e6e6'; $titleColor = '#0f1115'
        $bodyColor = '#61666b'; $metaColor = '#81858c'
        $btnBg = '#f1f3f5'; $btnFg = '#0f1115'
        $closeFg = '#81858c'; $shadowOpacity = 0.16
    }
    $accent = if ($data.accent) { [string]$data.accent } else { '#4176e6' }

    $work = [System.Windows.SystemParameters]::WorkArea
    $width = if ($data.width) { [double]$data.width } else { 384 }
    $margin = 12
    $slot = if ($null -ne $data.slot) { [int]$data.slot } else { 0 }

    # ── window ───────────────────────────────────────────────────────────────
    $win = New-Object System.Windows.Window
    $win.WindowStyle = 'None'
    $win.FontFamily = New-Object System.Windows.Media.FontFamily('Microsoft YaHei UI, Segoe UI')
    $win.AllowsTransparency = $true
    $win.Background = [System.Windows.Media.Brushes]::Transparent
    $win.Topmost = $true
    $win.ShowInTaskbar = $false
    $win.ShowActivated = $false
    $win.ResizeMode = 'NoResize'
    $win.SizeToContent = 'Height'
    $win.Width = $width
    $win.Title = [string]$data.title
    $win.Left = $work.Right - $width - $margin
    $win.Top = $work.Bottom - 80
    $win.WindowStartupLocation = 'Manual'
    $script:Window = $win

    # outer margin reserves room for the drop shadow
    $root = New-Object System.Windows.Controls.Grid
    $root.Margin = New-Object System.Windows.Thickness(18, 10, 18, 18)

    $card = New-Object System.Windows.Controls.Border
    $card.CornerRadius = New-Object System.Windows.CornerRadius(12)
    $card.Background = Brush $bgColor
    $card.BorderBrush = Brush $borderColor
    $card.BorderThickness = New-Object System.Windows.Thickness(1)
    $shadow = New-Object System.Windows.Media.Effects.DropShadowEffect
    $shadow.BlurRadius = 26; $shadow.ShadowDepth = 6; $shadow.Opacity = $shadowOpacity
    $shadow.Color = [System.Windows.Media.ColorConverter]::ConvertFromString('#000000')
    $card.Effect = $shadow
    [void]$root.Children.Add($card)

    $grid = New-Object System.Windows.Controls.Grid
    $colAccent = New-Object System.Windows.Controls.ColumnDefinition
    $colAccent.Width = New-Object System.Windows.GridLength(4)
    $colBody = New-Object System.Windows.Controls.ColumnDefinition
    $colBody.Width = New-Object System.Windows.GridLength(1, 'Star')
    [void]$grid.ColumnDefinitions.Add($colAccent)
    [void]$grid.ColumnDefinitions.Add($colBody)

    $bar = New-Object System.Windows.Controls.Border
    $bar.Background = Brush $accent
    $bar.CornerRadius = New-Object System.Windows.CornerRadius(12, 0, 0, 12)
    [System.Windows.Controls.Grid]::SetColumn($bar, 0)
    [void]$grid.Children.Add($bar)

    $content = New-Object System.Windows.Controls.StackPanel
    $content.Margin = New-Object System.Windows.Thickness(16, 14, 12, 14)
    [System.Windows.Controls.Grid]::SetColumn($content, 1)
    [void]$grid.Children.Add($content)

    # header: icon + title + close
    $header = New-Object System.Windows.Controls.Grid
    foreach ($w in @('Auto', '*', 'Auto')) {
        $col = New-Object System.Windows.Controls.ColumnDefinition
        if ($w -eq 'Auto') { $col.Width = [System.Windows.GridLength]::Auto }
        else { $col.Width = New-Object System.Windows.GridLength(1, 'Star') }
        [void]$header.ColumnDefinitions.Add($col)
    }

    $iconBlock = New-Object System.Windows.Controls.TextBlock
    $iconBlock.Text = if ($data.icon) { [string]$data.icon } else { '' }
    $iconBlock.FontSize = 16
    $iconBlock.VerticalAlignment = 'Center'
    $iconBlock.Margin = New-Object System.Windows.Thickness(0, 0, 9, 0)
    [System.Windows.Controls.Grid]::SetColumn($iconBlock, 0)
    [void]$header.Children.Add($iconBlock)

    $titleBlock = New-Object System.Windows.Controls.TextBlock
    $titleBlock.Text = [string]$data.title
    $titleBlock.FontSize = 14
    $titleBlock.FontWeight = 'SemiBold'
    $titleBlock.Foreground = Brush $titleColor
    $titleBlock.TextTrimming = 'CharacterEllipsis'
    $titleBlock.VerticalAlignment = 'Center'
    [System.Windows.Controls.Grid]::SetColumn($titleBlock, 1)
    [void]$header.Children.Add($titleBlock)

    $closeBtn = New-Object System.Windows.Controls.Button
    $closeBtn.Content = '✕'
    $closeBtn.FontSize = 12
    $closeBtn.Foreground = Brush $closeFg
    $closeBtn.Background = [System.Windows.Media.Brushes]::Transparent
    $closeBtn.BorderThickness = New-Object System.Windows.Thickness(0)
    $closeBtn.Padding = New-Object System.Windows.Thickness(4, 0, 0, 0)
    $closeBtn.Cursor = [System.Windows.Input.Cursors]::Hand
    $closeBtn.ToolTip = 'Esc'
    $closeBtn.VerticalAlignment = 'Center'
    $closeBtn.Template = Get-RoundedButtonTemplate
    [System.Windows.Controls.Grid]::SetColumn($closeBtn, 2)
    [void]$header.Children.Add($closeBtn)
    [void]$content.Children.Add($header)

    if ($data.body) {
        $bodyBlock = New-Object System.Windows.Controls.TextBlock
        $bodyBlock.Text = [string]$data.body
        $bodyBlock.FontSize = 12.5
        $bodyBlock.LineHeight = 19
        $bodyBlock.Foreground = Brush $bodyColor
        $bodyBlock.TextWrapping = 'Wrap'
        $bodyBlock.Margin = New-Object System.Windows.Thickness(0, 9, 0, 0)
        $bodyBlock.MaxHeight = 112
        $bodyBlock.TextTrimming = 'CharacterEllipsis'
        [void]$content.Children.Add($bodyBlock)
    }

    if ($data.meta) {
        $metaBlock = New-Object System.Windows.Controls.TextBlock
        $metaBlock.Text = [string]$data.meta
        $metaBlock.FontSize = 11
        $metaBlock.Foreground = Brush $metaColor
        $metaBlock.TextWrapping = 'Wrap'
        $metaBlock.Margin = New-Object System.Windows.Thickness(0, 8, 0, 0)
        [void]$content.Children.Add($metaBlock)
    }

    # action buttons (WrapPanel keeps 5 options on two rows)
    $actions = @()
    if ($data.actions) { $actions = @($data.actions) }
    if ($actions.Count -gt 0) {
        $panel = New-Object System.Windows.Controls.WrapPanel
        $panel.HorizontalAlignment = 'Right'
        $panel.Margin = New-Object System.Windows.Thickness(0, 12, 0, 0)
        $index = 0
        foreach ($action in $actions) {
            $btn = New-Object System.Windows.Controls.Button
            $btn.Content = [string]$action.label
            $btn.Tag = [string]$action.id
            $btn.FontSize = 12.5
            $btn.Padding = New-Object System.Windows.Thickness(14, 6, 14, 6)
            $btn.Margin = New-Object System.Windows.Thickness(8, 6, 0, 0)
            $btn.Cursor = [System.Windows.Input.Cursors]::Hand
            $primary = ($action.primary -eq $true) -or (($index -eq 0) -and ($data.kind -eq 'question'))
            if ($primary) {
                $btn.Background = Brush $accent
                $btn.Foreground = Brush '#ffffff'
            } else {
                $btn.Background = Brush $btnBg
                $btn.Foreground = Brush $btnFg
            }
            $btn.BorderThickness = New-Object System.Windows.Thickness(0)
            $btn.Template = Get-RoundedButtonTemplate
            $btn.Add_Click({
                param($sender, $eventArgs)
                $script:ResultAction = [string]$sender.Tag
                $script:Window.Close()
            })
            [void]$panel.Children.Add($btn)
            $index += 1
        }
        [void]$content.Children.Add($panel)
    }

    $card.Child = $grid
    $win.Content = $root

    $closeBtn.Add_Click({
        param($sender, $eventArgs)
        $script:ResultAction = 'dismissed'
        $script:Window.Close()
    })
    $win.Add_KeyDown({
        param($sender, $eventArgs)
        if ($eventArgs.Key -eq 'Escape') {
            $script:ResultAction = 'dismissed'
            $script:Window.Close()
        }
    })

    # SizeToContent makes the real height known only after layout.
    $win.Add_Loaded({
        $w = $script:Window
        $wa = [System.Windows.SystemParameters]::WorkArea
        $h = $w.ActualHeight
        $target = $wa.Bottom - $h - 12 - ($slot * ($h + 8))
        if ($target -lt $wa.Top) { $target = $wa.Top + 12 }
        $w.Left = $wa.Right - $w.Width - 12
        $w.Opacity = 0

        $slide = New-Object System.Windows.Media.Animation.DoubleAnimation
        $slide.From = $target + 22; $slide.To = $target
        $slide.Duration = [System.Windows.Duration]::new([TimeSpan]::FromMilliseconds(190))
        $ease = New-Object System.Windows.Media.Animation.CubicEase
        $ease.EasingMode = [System.Windows.Media.Animation.EasingMode]::EaseOut
        $slide.EasingFunction = $ease
        $w.BeginAnimation([System.Windows.Window]::TopProperty, $slide)

        $fade = New-Object System.Windows.Media.Animation.DoubleAnimation
        $fade.From = 0.0; $fade.To = 1.0
        $fade.Duration = [System.Windows.Duration]::new([TimeSpan]::FromMilliseconds(160))
        $w.BeginAnimation([System.Windows.Window]::OpacityProperty, $fade)
    })

    # ── sound：可配置提示音 ─────────────────────────────────────────────────
    # none = 静音；default = 按卡片类型（question → Question，其他 → Asterisk）；
    # 其余取值映射到系统音效（SystemSounds）或 C:\Windows\Media 下的 wav。
    $soundName = 'default'
    if ($null -ne $data.sound) {
        if ($data.sound -is [bool]) { if ($data.sound) { $soundName = 'default' } else { $soundName = 'none' } }
        else { $soundName = ([string]$data.sound).ToLowerInvariant() }
    }
    if ($soundName -and $soundName -ne 'none') {
        $playAs = $soundName
        if ($playAs -eq 'default') {
            if ($data.kind -eq 'question') { $playAs = 'question' } else { $playAs = 'asterisk' }
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
                'question'    { [System.Media.SystemSounds]::Question.Play() }
                'asterisk'    { [System.Media.SystemSounds]::Asterisk.Play() }
                'exclamation' { [System.Media.SystemSounds]::Exclamation.Play() }
                'critical'    { [System.Media.SystemSounds]::Hand.Play() }
                default {
                    if ($mediaNames.ContainsKey($playAs)) {
                        $wav = Join-Path $env:WINDIR ('Media\' + $mediaNames[$playAs])
                        if (Test-Path -LiteralPath $wav) {
                            $player = New-Object System.Media.SoundPlayer $wav
                            $player.Play()
                        }
                    }
                }
            }
        } catch { }
    }

    $timeoutMs = 0
    if ($null -ne $data.timeoutMs) { $timeoutMs = [int]$data.timeoutMs }
    if ($timeoutMs -gt 0) {
        $timer = New-Object System.Windows.Threading.DispatcherTimer
        $timer.Interval = [TimeSpan]::FromMilliseconds($timeoutMs)
        $timer.Add_Tick({
            $script:Timer.Stop()
            $script:ResultAction = 'timeout'
            $script:Window.Close()
        })
        $script:Timer = $timer
        $timer.Start()
    }

    [void]$win.ShowDialog()
    if ($script:Timer) { $script:Timer.Stop() }
    Write-ResultAndExit -Action $script:ResultAction
} catch {
    Write-ResultAndExit -Action 'error' -ErrorText ($_ | Out-String)
}

#requires -Version 5.1
<#
    dsh-desktop-notifier popup renderer.

    Shows one WPF card in the bottom-right corner of the work area. The target
    monitor is the one hosting the DSH window (so a second-monitor session gets
    its card there), falling back to the monitor under the cursor and finally to
    the primary one. The card follows the Windows 11 toast layout: a slim header
    with the app icon, the app name and a close button, then a body with the
    plugin glyph, a bold title, the message and a dimmed meta line, and finally
    the actions.

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
$script:ResultText = ''
$script:ResultFocused = $null
$script:FocusAfterClose = $false
$script:Timer = $null
$script:Window = $null
$script:CustomBox = $null
$script:Watermark = $null
$script:WorkArea = $null

# Sound presets live in one helper so the Settings page's preview button plays
# exactly what the cards play.
. (Join-Path $PSScriptRoot 'sound.ps1')
# The card is the foreground window when the user clicks an action, which is the
# only reliable moment to hand the foreground over to the Harness window.
. (Join-Path $PSScriptRoot 'activate-window.ps1')

function Write-ResultAndExit {
    param([string]$Action, [string]$ErrorText, [string]$Text)
    $payload = [ordered]@{ action = $Action; dismissed = ($Action -ne 'error') }
    if ($Text) { $payload.text = $Text }
    if ($null -ne $script:ResultFocused) { $payload.focused = [bool]$script:ResultFocused }
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
    param([int]$Radius = 8)
    $xaml = @'
<ControlTemplate xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation" xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml" TargetType="Button">
  <Border x:Name="bd" CornerRadius="__RADIUS__" Background="{TemplateBinding Background}" Padding="{TemplateBinding Padding}">
    <ContentPresenter HorizontalAlignment="{TemplateBinding HorizontalContentAlignment}" VerticalAlignment="Center"/>
  </Border>
  <ControlTemplate.Triggers>
    <Trigger Property="IsMouseOver" Value="True">
      <Setter TargetName="bd" Property="Opacity" Value="0.78"/>
    </Trigger>
    <Trigger Property="IsPressed" Value="True">
      <Setter TargetName="bd" Property="Opacity" Value="0.6"/>
    </Trigger>
  </ControlTemplate.Triggers>
</ControlTemplate>
'@
    $xaml = $xaml.Replace('__RADIUS__', [string]$Radius)
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
        $bodyColor = '#cfd3d6'; $metaColor = '#adb2b8'; $appNameColor = '#a9aeb6'
        $ghostBg = '#14FFFFFF'; $ghostFg = '#e7e9ec'; $closeFg = '#8e939b'
        $shadowOpacity = 0.5; $glyphName = 'glyph-dark.png'; $badgeEdge = '#14FFFFFF'
    } else {
        $bgColor = '#ffffff'; $borderColor = '#e6e7ea'; $titleColor = '#0f1115'
        $bodyColor = '#61666b'; $metaColor = '#81858c'; $appNameColor = '#5f646c'
        $ghostBg = '#f2f3f5'; $ghostFg = '#25292f'; $closeFg = '#6c7178'
        $shadowOpacity = 0.16; $glyphName = 'glyph-light.png'; $badgeEdge = '#14000000'
    }
    $accent = if ($data.accent) { [string]$data.accent } else { '#4176e6' }
    # 选项行首项用“强调色的浅色底 + 强调色文字”，比整块实心蓝更接近系统通知的观感。
    $accentSoft = if ($dark) { '#2E4176E6' } else { '#1F4176E6' }
    $accentText = if ($dark) { '#8fb6ff' } else { '#2563eb' }

    # ── target monitor ───────────────────────────────────────────────────────
    # Prefer the monitor that hosts the DSH window, then the monitor under the
    # cursor, then the primary one. WPF positions windows in device-independent
    # pixels of the *system* DPI, so a monitor's physical work area is divided by
    # the primary screen's DIP/physical ratio before it is used.
    function Get-TargetWorkArea {
        try {
            Add-Type -AssemblyName System.Windows.Forms
            $screens = [System.Windows.Forms.Screen]::AllScreens
            if (-not $screens -or $screens.Count -eq 0) { return [System.Windows.SystemParameters]::WorkArea }

            $target = $null
            try {
                foreach ($proc in @(Get-Process -Name 'DeepSeek Harness' -ErrorAction SilentlyContinue)) {
                    if ($proc.MainWindowHandle -eq [System.IntPtr]::Zero) { continue }
                    $target = [System.Windows.Forms.Screen]::FromHandle($proc.MainWindowHandle)
                    if ($target) { break }
                }
            } catch { }
            if (-not $target) {
                $cursor = [System.Windows.Forms.Cursor]::Position
                $target = $screens | Where-Object { $_.Bounds.Contains($cursor) } | Select-Object -First 1
            }
            if (-not $target) { $target = $screens[0] }

            $scale = 1.0
            $primary = $screens | Where-Object { $_.Primary } | Select-Object -First 1
            if ($primary -and $primary.Bounds.Width -gt 0) {
                $scale = [double][System.Windows.SystemParameters]::PrimaryScreenWidth / [double]$primary.Bounds.Width
                if ($scale -le 0) { $scale = 1.0 }
            }

            $r = $target.WorkingArea
            return [System.Windows.Rect]::new(
                ([double]$r.X / $scale),
                ([double]$r.Y / $scale),
                ([double]$r.Width / $scale),
                ([double]$r.Height / $scale))
        } catch {
            return [System.Windows.SystemParameters]::WorkArea
        }
    }

    $script:WorkArea = Get-TargetWorkArea
    $work = $script:WorkArea
    $width = if ($data.width) { [double]$data.width } else { 400 }
    $margin = 12
    $slot = if ($null -ne $data.slot) { [int]$data.slot } else { 0 }

    function Load-Bitmap([string]$path) {
        if (-not (Test-Path -LiteralPath $path)) { return $null }
        $bi = New-Object System.Windows.Media.Imaging.BitmapImage
        $bi.BeginInit()
        $bi.UriSource = New-Object System.Uri($path, [System.UriKind]::Absolute)
        $bi.CacheOption = [System.Windows.Media.Imaging.BitmapCacheOption]::OnLoad
        $bi.EndInit()
        $bi.Freeze()
        return $bi
    }

    $assetsDir = Join-Path $PSScriptRoot '..\assets'
    $glyphImage = Load-Bitmap (Join-Path $assetsDir $glyphName)
    $appImage = Load-Bitmap (Join-Path $assetsDir 'icon.png')

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
    $root.Margin = New-Object System.Windows.Thickness(20, 12, 20, 22)

    $card = New-Object System.Windows.Controls.Border
    $card.CornerRadius = New-Object System.Windows.CornerRadius(8)
    $card.Background = Brush $bgColor
    $card.BorderBrush = Brush $borderColor
    $card.BorderThickness = New-Object System.Windows.Thickness(1)
    $shadow = New-Object System.Windows.Media.Effects.DropShadowEffect
    $shadow.BlurRadius = 30; $shadow.ShadowDepth = 8; $shadow.Opacity = $shadowOpacity
    $shadow.Color = [System.Windows.Media.ColorConverter]::ConvertFromString('#000000')
    $card.Effect = $shadow
    [void]$root.Children.Add($card)

    $content = New-Object System.Windows.Controls.StackPanel
    $content.Margin = New-Object System.Windows.Thickness(16, 12, 14, 14)
    $card.Child = $content

    # ── header: app badge + app name + close (the Windows toast top strip) ───
    $header = New-Object System.Windows.Controls.Grid
    foreach ($w in @('Auto', '*', 'Auto')) {
        $col = New-Object System.Windows.Controls.ColumnDefinition
        if ($w -eq 'Auto') { $col.Width = [System.Windows.GridLength]::Auto }
        else { $col.Width = New-Object System.Windows.GridLength(1, 'Star') }
        [void]$header.ColumnDefinitions.Add($col)
    }

    $appBadge = New-Object System.Windows.Controls.Border
    $appBadge.Width = 18; $appBadge.Height = 18
    $appBadge.CornerRadius = New-Object System.Windows.CornerRadius(5)
    $appBadge.BorderThickness = New-Object System.Windows.Thickness(1)
    $appBadge.BorderBrush = Brush $badgeEdge
    $appBadge.VerticalAlignment = 'Center'
    if ($appImage) {
        $badgeBrush = New-Object System.Windows.Media.ImageBrush($appImage)
        $badgeBrush.Stretch = 'UniformToFill'
        $appBadge.Background = $badgeBrush
    } else {
        $appBadge.Background = Brush $ghostBg
    }
    [System.Windows.Controls.Grid]::SetColumn($appBadge, 0)
    [void]$header.Children.Add($appBadge)

    $appName = New-Object System.Windows.Controls.TextBlock
    $appName.Text = if ($data.appName) { [string]$data.appName } else { 'DeepSeek Harness' }
    $appName.FontSize = 11.5
    $appName.Foreground = Brush $appNameColor
    $appName.VerticalAlignment = 'Center'
    $appName.Margin = New-Object System.Windows.Thickness(8, 0, 8, 0)
    $appName.TextTrimming = 'CharacterEllipsis'
    [System.Windows.Controls.Grid]::SetColumn($appName, 1)
    [void]$header.Children.Add($appName)

    $closeBtn = New-Object System.Windows.Controls.Button
    $closeBtn.Content = '✕'
    $closeBtn.FontSize = 11
    $closeBtn.Foreground = Brush $closeFg
    $closeBtn.Background = [System.Windows.Media.Brushes]::Transparent
    $closeBtn.BorderThickness = New-Object System.Windows.Thickness(0)
    $closeBtn.Padding = New-Object System.Windows.Thickness(6, 2, 6, 2)
    $closeBtn.Cursor = [System.Windows.Input.Cursors]::Hand
    $closeBtn.ToolTip = 'Esc'
    $closeBtn.VerticalAlignment = 'Center'
    $closeBtn.Template = Get-RoundedButtonTemplate -Radius 6
    [System.Windows.Automation.AutomationProperties]::SetName($closeBtn, 'Close')
    [System.Windows.Controls.Grid]::SetColumn($closeBtn, 2)
    [void]$header.Children.Add($closeBtn)
    [void]$content.Children.Add($header)

    # ── body: glyph + (title / message / meta) ──────────────────────────────
    $bodyGrid = New-Object System.Windows.Controls.Grid
    $bodyGrid.Margin = New-Object System.Windows.Thickness(0, 12, 0, 0)
    $colGlyph = New-Object System.Windows.Controls.ColumnDefinition
    $colGlyph.Width = [System.Windows.GridLength]::Auto
    $colText = New-Object System.Windows.Controls.ColumnDefinition
    $colText.Width = New-Object System.Windows.GridLength(1, 'Star')
    [void]$bodyGrid.ColumnDefinitions.Add($colGlyph)
    [void]$bodyGrid.ColumnDefinitions.Add($colText)

    if ($glyphImage) {
        $glyph = New-Object System.Windows.Controls.Image
        $glyph.Source = $glyphImage
        $glyph.Width = 44; $glyph.Height = 44
        $glyph.Stretch = 'Uniform'
        $glyph.VerticalAlignment = 'Top'
        $glyph.Margin = New-Object System.Windows.Thickness(0, 2, 16, 0)
        [System.Windows.Media.RenderOptions]::SetBitmapScalingMode($glyph, [System.Windows.Media.BitmapScalingMode]::HighQuality)
        [void]$bodyGrid.Children.Add($glyph)
    } else {
        # fallback for a partial install: keep the old emoji glyph
        $glyph = New-Object System.Windows.Controls.TextBlock
        $glyph.Text = if ($data.icon) { [string]$data.icon } else { '' }
        $glyph.FontSize = 26
        $glyph.VerticalAlignment = 'Top'
        $glyph.Margin = New-Object System.Windows.Thickness(0, 0, 14, 0)
        [void]$bodyGrid.Children.Add($glyph)
    }

    $textCol = New-Object System.Windows.Controls.StackPanel
    [System.Windows.Controls.Grid]::SetColumn($textCol, 1)
    [void]$bodyGrid.Children.Add($textCol)

    $titleBlock = New-Object System.Windows.Controls.TextBlock
    $titleBlock.Text = [string]$data.title
    $titleBlock.FontSize = 15
    $titleBlock.FontWeight = 'SemiBold'
    $titleBlock.Foreground = Brush $titleColor
    $titleBlock.TextWrapping = 'Wrap'
    [void]$textCol.Children.Add($titleBlock)

    if ($data.body) {
        $bodyBlock = New-Object System.Windows.Controls.TextBlock
        $bodyBlock.Text = [string]$data.body
        $bodyBlock.FontSize = 12.5
        $bodyBlock.LineHeight = 18
        $bodyBlock.Foreground = Brush $bodyColor
        $bodyBlock.TextWrapping = 'Wrap'
        $bodyBlock.MaxHeight = 89
        $bodyBlock.TextTrimming = 'CharacterEllipsis'
        $bodyBlock.Margin = New-Object System.Windows.Thickness(0, 5, 0, 0)
        [void]$textCol.Children.Add($bodyBlock)
    }

    if ($data.meta) {
        $metaBlock = New-Object System.Windows.Controls.TextBlock
        $metaBlock.Text = [string]$data.meta
        $metaBlock.FontSize = 11.5
        $metaBlock.Foreground = Brush $metaColor
        $metaBlock.TextWrapping = 'Wrap'
        $metaBlock.Margin = New-Object System.Windows.Thickness(0, 6, 0, 0)
        [void]$textCol.Children.Add($metaBlock)
    }
    [void]$content.Children.Add($bodyGrid)

    # ── actions ─────────────────────────────────────────────────────────────
    # A question stacks its options one per row (full width, wrapping label);
    # a notice keeps two compact buttons on the right.
    $actions = @()
    if ($data.actions) { $actions = @($data.actions) }
    $isQuestion = ($data.kind -eq 'question')
    if ($actions.Count -gt 0) {
        if ($isQuestion) {
            $panel = New-Object System.Windows.Controls.StackPanel
            $panel.HorizontalAlignment = 'Stretch'
            $panel.Margin = New-Object System.Windows.Thickness(0, 14, 0, 0)
        } else {
            $panel = New-Object System.Windows.Controls.WrapPanel
            $panel.HorizontalAlignment = 'Right'
            $panel.Margin = New-Object System.Windows.Thickness(0, 14, 0, 0)
        }
        $index = 0
        foreach ($action in $actions) {
            $btn = New-Object System.Windows.Controls.Button
            $btn.Tag = [string]$action.id
            $btn.Cursor = [System.Windows.Input.Cursors]::Hand
            $btn.BorderThickness = New-Object System.Windows.Thickness(0)
            $primary = ($action.primary -eq $true) -or (($index -eq 0) -and $isQuestion)
            if ($isQuestion) {
                # One option per row: a quiet row that lights up in the accent
                # colour, with the accessible name kept equal to the label.
                $labelBlock = New-Object System.Windows.Controls.TextBlock
                $labelBlock.Text = [string]$action.label
                $labelBlock.TextWrapping = 'Wrap'
                $btn.Content = $labelBlock
                [System.Windows.Automation.AutomationProperties]::SetName($btn, [string]$action.label)
                $btn.HorizontalAlignment = 'Stretch'
                $btn.HorizontalContentAlignment = 'Left'
                $btn.Margin = New-Object System.Windows.Thickness(0, 6, 0, 0)
                $btn.Padding = New-Object System.Windows.Thickness(12, 9, 12, 9)
                $btn.Template = Get-RoundedButtonTemplate -Radius 6
                if ($primary) {
                    $btn.Background = Brush $accentSoft
                    $btn.Foreground = Brush $accentText
                } else {
                    $btn.Background = Brush $ghostBg
                    $btn.Foreground = Brush $ghostFg
                }
            } else {
                $btn.Content = [string]$action.label
                [System.Windows.Automation.AutomationProperties]::SetName($btn, [string]$action.label)
                $btn.Margin = New-Object System.Windows.Thickness(8, 0, 0, 0)
                $btn.Padding = New-Object System.Windows.Thickness(14, 6, 14, 6)
                $btn.FontSize = 12.5
                $btn.Template = Get-RoundedButtonTemplate -Radius 6
                if ($primary) {
                    $btn.Background = Brush $accent
                    $btn.Foreground = Brush '#ffffff'
                } else {
                    $btn.Background = Brush $ghostBg
                    $btn.Foreground = Brush $ghostFg
                }
            }
            $btn.Add_Click({
                param($sender, $eventArgs)
                $script:ResultAction = [string]$sender.Tag
                if ($script:ResultAction -eq 'open' -and ($data.focusOnOpen -ne $false)) {
                    # Focus after the card is gone: closing the foreground window
                    # would otherwise hand the foreground back to whatever was
                    # behind it, undoing the raise.
                    $script:FocusAfterClose = $true
                }
                $script:Window.Close()
            })
            [void]$panel.Children.Add($btn)
            $index += 1
        }
        [void]$content.Children.Add($panel)
    }

    # ── custom answer (question cards) ───────────────────────────────────────
    # The web card always offers free text next to the options; mirror it here so
    # a question can also be answered with something the options do not list.
    # For a single-choice question the host lets the text override the options,
    # so the answer is `{ id, selected: [], custom: <text> }`.
    if ($isQuestion -and ($data.allowCustom -ne $false)) {
        function Submit-CustomAnswer {
            if (-not $script:CustomBox) { return }
            $text = ([string]$script:CustomBox.Text).Trim()
            if ($text.Length -eq 0) { return }
            $script:ResultText = $text
            $script:ResultAction = 'custom'
            $script:Window.Close()
        }

        $placeholder = [string]$data.customPlaceholder
        if (-not $placeholder) { $placeholder = '输入自定义回答…' }
        $sendLabel = [string]$data.sendLabel
        if (-not $sendLabel) { $sendLabel = '发送' }

        $inputRow = New-Object System.Windows.Controls.Grid
        $inputRow.Margin = New-Object System.Windows.Thickness(0, 8, 0, 0)
        $colBox = New-Object System.Windows.Controls.ColumnDefinition
        $colBox.Width = New-Object System.Windows.GridLength(1, 'Star')
        $colSend = New-Object System.Windows.Controls.ColumnDefinition
        $colSend.Width = [System.Windows.GridLength]::Auto
        [void]$inputRow.ColumnDefinitions.Add($colBox)
        [void]$inputRow.ColumnDefinitions.Add($colSend)

        $boxBorder = New-Object System.Windows.Controls.Border
        $boxBorder.CornerRadius = New-Object System.Windows.CornerRadius(6)
        $boxBorder.Background = Brush $ghostBg
        $boxBorder.BorderBrush = Brush $borderColor
        $boxBorder.BorderThickness = New-Object System.Windows.Thickness(1)
        $boxGrid = New-Object System.Windows.Controls.Grid
        $boxBorder.Child = $boxGrid
        [void]$inputRow.Children.Add($boxBorder)

        $customBox = New-Object System.Windows.Controls.TextBox
        $customBox.Background = [System.Windows.Media.Brushes]::Transparent
        $customBox.BorderThickness = New-Object System.Windows.Thickness(0)
        $customBox.Foreground = Brush $titleColor
        $customBox.CaretBrush = Brush $accentText
        $customBox.FontSize = 12.5
        $customBox.Padding = New-Object System.Windows.Thickness(11, 7, 11, 7)
        $customBox.VerticalContentAlignment = 'Center'
        $customBox.TextWrapping = 'Wrap'
        $customBox.MaxHeight = 96
        [System.Windows.Automation.AutomationProperties]::SetName($customBox, $placeholder)
        [void]$boxGrid.Children.Add($customBox)

        $watermark = New-Object System.Windows.Controls.TextBlock
        $watermark.Text = $placeholder
        $watermark.Foreground = Brush $metaColor
        $watermark.FontSize = 12.5
        $watermark.Margin = New-Object System.Windows.Thickness(13, 0, 13, 0)
        $watermark.VerticalAlignment = 'Center'
        $watermark.IsHitTestVisible = $false
        [void]$boxGrid.Children.Add($watermark)

        $sendBtn = New-Object System.Windows.Controls.Button
        $sendBtn.Content = $sendLabel
        [System.Windows.Automation.AutomationProperties]::SetName($sendBtn, $sendLabel)
        $sendBtn.Cursor = [System.Windows.Input.Cursors]::Hand
        $sendBtn.Margin = New-Object System.Windows.Thickness(8, 0, 0, 0)
        $sendBtn.Padding = New-Object System.Windows.Thickness(14, 6, 14, 6)
        $sendBtn.FontSize = 12.5
        $sendBtn.BorderThickness = New-Object System.Windows.Thickness(0)
        $sendBtn.VerticalAlignment = 'Stretch'
        $sendBtn.Template = Get-RoundedButtonTemplate -Radius 6
        $sendBtn.Background = Brush $accent
        $sendBtn.Foreground = Brush '#ffffff'
        [System.Windows.Controls.Grid]::SetColumn($sendBtn, 1)
        [void]$inputRow.Children.Add($sendBtn)

        $script:CustomBox = $customBox
        $script:Watermark = $watermark

        $customBox.Add_TextChanged({
            param($sender, $eventArgs)
            if ([string]$sender.Text) { $script:Watermark.Visibility = 'Collapsed' }
            else { $script:Watermark.Visibility = 'Visible' }
        })
        $customBox.Add_KeyDown({
            param($sender, $eventArgs)
            if ($eventArgs.Key -eq 'Return') {
                $eventArgs.Handled = $true
                Submit-CustomAnswer
            }
        })
        $sendBtn.Add_Click({
            param($sender, $eventArgs)
            Submit-CustomAnswer
        })

        [void]$content.Children.Add($inputRow)
    }

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
        $wa = $script:WorkArea
        if ($null -eq $wa) { $wa = [System.Windows.SystemParameters]::WorkArea }
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

    # ── sound：可配置提示音（可自定义 wav 文件）──────────────────────────────
    # none = 静音；default = 按卡片类型（question → Question，approval →
    # Exclamation，其他 → Asterisk）；其余取值映射到系统音效或 Media 下的 wav；
    # payload.soundFile 是个存在的 .wav 时优先播放它。映射集中在 scripts/sound.ps1，
    # 设置页的“试听”按钮复用同一个函数。
    $soundName = 'default'
    if ($null -ne $data.sound) {
        if ($data.sound -is [bool]) { if ($data.sound) { $soundName = 'default' } else { $soundName = 'none' } }
        else { $soundName = ([string]$data.sound).ToLowerInvariant() }
    }
    $soundFile = ''
    if ($data.soundFile) { $soundFile = [string]$data.soundFile }
    Play-NotifierSound -Name $soundName -Kind ([string]$data.kind) -File $soundFile

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
    if ($script:FocusAfterClose) {
        try { $script:ResultFocused = [bool](Focus-HarnessWindow) } catch { $script:ResultFocused = $false }
    }
    Write-ResultAndExit -Action $script:ResultAction -Text $script:ResultText
} catch {
    Write-ResultAndExit -Action 'error' -ErrorText ($_ | Out-String)
}

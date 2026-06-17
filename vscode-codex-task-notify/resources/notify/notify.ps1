param(
  [string]$Title = "Done",
  [string]$Message = "Task completed",
  [ValidateSet("Info", "Warning", "Error")]
  [string]$Level = "Info",
  [int]$TimeoutSeconds = 5,
  [switch]$OpenVsCodeOnClick,
  [string]$WorkspacePath = ""
)

if ([System.Environment]::OSVersion.Platform -ne [System.PlatformID]::Win32NT) {
  Write-Error "This notification helper only works on Windows."
  exit 1
}

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class NativeWindowApi
{
    [DllImport("user32.dll")]
    public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);

    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool IsIconic(IntPtr hWnd);
}
"@

function Get-WorkspaceLeafName {
  param([string]$PathValue)

  if (-not $PathValue) {
    return ""
  }

  try {
    return Split-Path -Path (Resolve-Path -LiteralPath $PathValue).Path -Leaf
  } catch {
    return Split-Path -Path $PathValue -Leaf
  }
}

function Find-VsCodeWindowHandle {
  param([string]$WorkspacePath)

  $leaf = Get-WorkspaceLeafName $WorkspacePath
  if (-not $leaf) {
    return [IntPtr]::Zero
  }

  $match = Get-Process Code -ErrorAction SilentlyContinue |
    Where-Object {
      $_.MainWindowHandle -ne 0 -and
      $_.MainWindowTitle -and
      $_.MainWindowTitle.IndexOf($leaf, [System.StringComparison]::OrdinalIgnoreCase) -ge 0
    } |
    Select-Object -First 1

  if ($match) {
    return [IntPtr]$match.MainWindowHandle
  }

  return [IntPtr]::Zero
}

function Resolve-CodeCommand {
  $exePath = Join-Path $env:LOCALAPPDATA "Programs\Microsoft VS Code\Code.exe"
  if (Test-Path -LiteralPath $exePath) {
    return $exePath
  }

  $cmdPath = Join-Path $env:LOCALAPPDATA "Programs\Microsoft VS Code\bin\code.cmd"
  if (Test-Path -LiteralPath $cmdPath) {
    return $cmdPath
  }

  $command = Get-Command code -ErrorAction SilentlyContinue
  if ($command) {
    return $command.Source
  }

  return $null
}

function Open-VsCode {
  $handle = Find-VsCodeWindowHandle -WorkspacePath $WorkspacePath
  if ($handle -ne [IntPtr]::Zero) {
    if ([NativeWindowApi]::IsIconic($handle)) {
      [void][NativeWindowApi]::ShowWindowAsync($handle, 9)
    }
    [void][NativeWindowApi]::SetForegroundWindow($handle)
    return
  }

  $codeCommand = Resolve-CodeCommand
  if (-not $codeCommand) {
    return
  }

  $startArgs = @()
  if ($WorkspacePath -and (Test-Path -LiteralPath $WorkspacePath)) {
    $startArgs = @("--reuse-window", $WorkspacePath)
  }

  Start-Process -FilePath $codeCommand -ArgumentList $startArgs | Out-Null
}

$icon = New-Object System.Windows.Forms.NotifyIcon
$icon.Visible = $true
$icon.Text = "Codex Notify"
$form = New-Object System.Windows.Forms.Form
$form.ShowInTaskbar = $false
$form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None
$form.Opacity = 0
$form.StartPosition = [System.Windows.Forms.FormStartPosition]::Manual
$form.Location = New-Object System.Drawing.Point(-2000, -2000)
$form.Width = 1
$form.Height = 1
$script:form = $form

switch ($Level) {
  "Warning" {
    $icon.Icon = [System.Drawing.SystemIcons]::Warning
    $icon.BalloonTipIcon = [System.Windows.Forms.ToolTipIcon]::Warning
  }
  "Error" {
    $icon.Icon = [System.Drawing.SystemIcons]::Error
    $icon.BalloonTipIcon = [System.Windows.Forms.ToolTipIcon]::Error
  }
  default {
    $icon.Icon = [System.Drawing.SystemIcons]::Information
    $icon.BalloonTipIcon = [System.Windows.Forms.ToolTipIcon]::Info
  }
}

$icon.BalloonTipTitle = $Title
$icon.BalloonTipText = $Message
$script:timer = $null

if ($OpenVsCodeOnClick) {
  $icon.add_BalloonTipClicked({
    Open-VsCode
    if ($script:form) {
      $script:form.Close()
    }
  })
}

if ($OpenVsCodeOnClick) {
  $timer = New-Object System.Windows.Forms.Timer
  $script:timer = $timer
  $timer.Interval = [Math]::Max(1, $TimeoutSeconds) * 1000
  $timer.Add_Tick({
    if ($script:timer) {
      $script:timer.Stop()
    }
    if ($script:form) {
      $script:form.Close()
    }
  })

  $form.Add_Shown({
    $icon.ShowBalloonTip([Math]::Max(1, $TimeoutSeconds) * 1000)
    $timer.Start()
  })

  $form.Add_FormClosed({
    if ($script:timer) {
      $script:timer.Stop()
    }
    $icon.Visible = $false
    $icon.Dispose()
    if ($script:timer) {
      $script:timer.Dispose()
    }
  })

  [void][System.Windows.Forms.Application]::Run($form)
  return
}

$icon.ShowBalloonTip([Math]::Max(1, $TimeoutSeconds) * 1000)
Start-Sleep -Seconds ([Math]::Max(2, $TimeoutSeconds))
$icon.Dispose()

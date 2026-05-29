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
$clickSignal = New-Object System.Threading.ManualResetEventSlim($false)

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

if ($OpenVsCodeOnClick) {
  $icon.add_BalloonTipClicked({
    try {
      Open-VsCode
    } finally {
      $script:clickSignal.Set()
    }
  })
}

$icon.ShowBalloonTip([Math]::Max(1, $TimeoutSeconds) * 1000)

if ($OpenVsCodeOnClick) {
  [void]$clickSignal.Wait(2500)
} else {
  Start-Sleep -Seconds ([Math]::Max(2, $TimeoutSeconds))
}

$icon.Dispose()

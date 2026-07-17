param(
  [string]$Title = "Done",
  [string]$Message = "Task completed",
  [ValidateSet("Info", "Warning", "Error")]
  [string]$Level = "Info",
  [int]$TimeoutSeconds = 5,
  [switch]$OpenVsCodeOnClick,
  [string]$WorkspacePath = "",
  [string]$DiagnosticLogPath = "",
  [string]$NotificationId = "",
  [string]$ProjectHint = ""
)

if ([System.Environment]::OSVersion.Platform -ne [System.PlatformID]::Win32NT) {
  Write-Error "This notification helper only works on Windows."
  exit 1
}

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

Add-Type @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public sealed class EnumeratedWindowInfo
{
    public long Handle { get; set; }
    public uint ProcessId { get; set; }
    public string Title { get; set; }
    public string ClassName { get; set; }
}

public static class NativeWindowApi
{
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern int GetWindowTextLength(IntPtr hWnd);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);

    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern IntPtr GetShellWindow();

    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

    [DllImport("user32.dll")]
    public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);

    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool IsIconic(IntPtr hWnd);

    public static EnumeratedWindowInfo[] EnumerateTopLevelWindows()
    {
        var windows = new List<EnumeratedWindowInfo>();
        var shellWindow = GetShellWindow();

        EnumWindows(
            delegate (IntPtr hWnd, IntPtr lParam)
            {
                if (hWnd == shellWindow || !IsWindowVisible(hWnd))
                {
                    return true;
                }

                var titleLength = GetWindowTextLength(hWnd);
                if (titleLength <= 0)
                {
                    return true;
                }

                var titleBuilder = new StringBuilder(titleLength + 1);
                GetWindowText(hWnd, titleBuilder, titleBuilder.Capacity);
                var title = titleBuilder.ToString();
                if (string.IsNullOrWhiteSpace(title))
                {
                    return true;
                }

                uint processId;
                GetWindowThreadProcessId(hWnd, out processId);

                var classNameBuilder = new StringBuilder(256);
                GetClassName(hWnd, classNameBuilder, classNameBuilder.Capacity);

                windows.Add(
                    new EnumeratedWindowInfo
                    {
                        Handle = hWnd.ToInt64(),
                        ProcessId = processId,
                        Title = title,
                        ClassName = classNameBuilder.ToString()
                    });

                return true;
            },
            IntPtr.Zero);

        return windows.ToArray();
    }
}
"@

$script:diagnosticMaxLines = 200

function Trim-DiagnosticLog {
  if (-not $DiagnosticLogPath -or -not (Test-Path -LiteralPath $DiagnosticLogPath)) {
    return
  }

  try {
    $lines = [System.IO.File]::ReadAllLines($DiagnosticLogPath)
    if ($lines.Length -le $script:diagnosticMaxLines) {
      return
    }

    $startIndex = [Math]::Max(0, $lines.Length - $script:diagnosticMaxLines)
    $trimmedLines =
      if ($startIndex -eq 0) {
        $lines
      } else {
        $lines[$startIndex..($lines.Length - 1)]
      }

    [System.IO.File]::WriteAllLines($DiagnosticLogPath, $trimmedLines)
  } catch {
  }
}

function Write-DiagnosticEvent {
  param(
    [string]$Stage,
    [hashtable]$Data = @{}
  )

  if (-not $DiagnosticLogPath) {
    return
  }

  try {
    $directory = Split-Path -Path $DiagnosticLogPath -Parent
    if ($directory) {
      [void][System.IO.Directory]::CreateDirectory($directory)
    }

    $payload = [ordered]@{
      timestamp = (Get-Date).ToString("o")
      source = "windows-helper"
      stage = $Stage
      notificationId = $NotificationId
      details = $Data
    }

    Add-Content -LiteralPath $DiagnosticLogPath -Value ($payload | ConvertTo-Json -Compress -Depth 8) -Encoding UTF8
    Trim-DiagnosticLog
  } catch {
  }
}

function Format-ExceptionRecord {
  param($ErrorRecord)

  if (-not $ErrorRecord) {
    return ""
  }

  $message = ""
  if ($ErrorRecord.Exception -and $ErrorRecord.Exception.Message) {
    $message = $ErrorRecord.Exception.Message
  } elseif ($ErrorRecord.ToString) {
    $message = $ErrorRecord.ToString()
  }

  $scriptStack = ""
  try {
    if ($ErrorRecord.ScriptStackTrace) {
      $scriptStack = $ErrorRecord.ScriptStackTrace
    }
  } catch {
  }

  if ($scriptStack) {
    return "$message | $scriptStack"
  }

  return $message
}

function Get-WorkspaceMatchHint {
  if ($ProjectHint) {
    return $ProjectHint.Trim()
  }

  return Get-WorkspaceLeafName $WorkspacePath
}

function Get-WindowMatchScore {
  param(
    [string]$WindowTitle,
    [string]$WorkspaceHint
  )

  if (-not $WindowTitle -or -not $WorkspaceHint) {
    return 0
  }

  $title = $WindowTitle.ToLowerInvariant()
  $leaf = $WorkspaceHint.ToLowerInvariant()

  if ($title -eq $leaf) {
    return 400
  }

  if (
    $title.StartsWith("$leaf - ") -or
    $title.StartsWith("$leaf | ") -or
    $title.StartsWith("$leaf (") -or
    $title.StartsWith("$leaf [")
  ) {
    return 300
  }

  if (
    $title.Contains(" $leaf - ") -or
    $title.Contains(" $leaf | ") -or
    $title.Contains("($leaf)") -or
    $title.Contains("[$leaf]")
  ) {
    return 200
  }

  if ($title.Contains($leaf)) {
    return 100
  }

  return 0
}

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

function Get-VsCodeWindowCandidates {
  $codeProcesses = @(Get-Process Code -ErrorAction SilentlyContinue |
    Where-Object {
      $_.Id -ne $PID
    })

  if (-not $codeProcesses.Count) {
    return @()
  }

  $processById = @{}
  foreach ($process in $codeProcesses) {
    $processById[[int]$process.Id] = $process
  }

  return @([NativeWindowApi]::EnumerateTopLevelWindows() |
    Where-Object {
      $processById.ContainsKey([int]$_.ProcessId)
    } |
    ForEach-Object {
      $process = $processById[[int]$_.ProcessId]
      $startTime = [DateTime]::MinValue
      try {
        $startTime = $process.StartTime
      } catch {
      }

      [PSCustomObject]@{
        Process = $process
        ProcessId = [int]$_.ProcessId
        Handle = [IntPtr][Int64]$_.Handle
        WindowTitle = $_.Title
        WindowClassName = $_.ClassName
        StartTime = $startTime
      }
    })
}

function Resolve-VsCodeWindowCandidate {
  param([string]$WorkspacePath)

  $candidates = @(Get-VsCodeWindowCandidates)

  if (-not $candidates.Count) {
    Write-DiagnosticEvent -Stage "vscode-window-search-empty" -Data @{
      workspacePath = $WorkspacePath
      workspaceHint = Get-WorkspaceMatchHint
      projectHint = $ProjectHint
    }
    return $null
  }

  $leaf = Get-WorkspaceMatchHint
  if ($leaf) {
    $best = $candidates |
      ForEach-Object {
        [PSCustomObject]@{
          Candidate = $_
          Score = Get-WindowMatchScore -WindowTitle $_.WindowTitle -WorkspaceHint $leaf
          StartTime = $_.StartTime
        }
      } |
      Where-Object { $_.Score -gt 0 } |
      Sort-Object -Property @{ Expression = "Score"; Descending = $true }, @{ Expression = "StartTime"; Descending = $true } |
      Select-Object -First 1

    if ($best) {
      Write-DiagnosticEvent -Stage "vscode-window-matched" -Data @{
        workspacePath = $WorkspacePath
        workspaceHint = $leaf
        projectHint = $ProjectHint
        candidateCount = $candidates.Count
        processId = $best.Candidate.ProcessId
        windowTitle = $best.Candidate.WindowTitle
        windowClassName = $best.Candidate.WindowClassName
        score = $best.Score
      }
      return [PSCustomObject]@{
        Resolution = "matched"
        Candidate = $best.Candidate
      }
    }
  }

  if ($candidates.Count -eq 1) {
    Write-DiagnosticEvent -Stage "vscode-window-single-candidate-fallback" -Data @{
      workspacePath = $WorkspacePath
      workspaceHint = $leaf
      projectHint = $ProjectHint
      candidateCount = $candidates.Count
      processId = $candidates[0].ProcessId
      windowTitle = $candidates[0].WindowTitle
      windowClassName = $candidates[0].WindowClassName
    }
    return [PSCustomObject]@{
      Resolution = "single-candidate-fallback"
      Candidate = $candidates[0]
    }
  }

  Write-DiagnosticEvent -Stage "vscode-window-no-match" -Data @{
    workspacePath = $WorkspacePath
    workspaceHint = $leaf
    projectHint = $ProjectHint
    candidateCount = $candidates.Count
    windowTitles = @($candidates | Select-Object -ExpandProperty WindowTitle)
  }

  return $null
}

function Try-ActivateVsCodeWindow {
  param($WindowCandidate)

  if (-not $WindowCandidate) {
    return $false
  }

  $handle = [IntPtr]$WindowCandidate.Handle
  if ($handle -eq [IntPtr]::Zero) {
    Write-DiagnosticEvent -Stage "vscode-activate-failed" -Data @{
      processId = $WindowCandidate.ProcessId
      reason = "missing-window-handle"
      windowTitle = $WindowCandidate.WindowTitle
    }
    return $false
  }

  Write-DiagnosticEvent -Stage "vscode-activate-attempt" -Data @{
    processId = $WindowCandidate.ProcessId
    windowTitle = $WindowCandidate.WindowTitle
    handle = $handle.ToInt64()
    wasMinimized = [NativeWindowApi]::IsIconic($handle)
    windowClassName = $WindowCandidate.WindowClassName
  }

  if ([NativeWindowApi]::IsIconic($handle)) {
    [void][NativeWindowApi]::ShowWindowAsync($handle, 9)
    Start-Sleep -Milliseconds 120
  } else {
    [void][NativeWindowApi]::ShowWindowAsync($handle, 5)
  }

  if ([NativeWindowApi]::SetForegroundWindow($handle)) {
    Write-DiagnosticEvent -Stage "vscode-activate-succeeded" -Data @{
      processId = $WindowCandidate.ProcessId
      method = "set-foreground-window"
      windowTitle = $WindowCandidate.WindowTitle
    }
    return $true
  }

  try {
    if (-not $script:wshShell) {
      $script:wshShell = New-Object -ComObject WScript.Shell
    }
    if ($WindowCandidate.WindowTitle -and $script:wshShell.AppActivate($WindowCandidate.WindowTitle)) {
      Write-DiagnosticEvent -Stage "vscode-activate-succeeded" -Data @{
        processId = $WindowCandidate.ProcessId
        method = "app-activate-title"
        windowTitle = $WindowCandidate.WindowTitle
        }
      return $true
    }

    if ($WindowCandidate.ProcessId -and $script:wshShell.AppActivate($WindowCandidate.ProcessId)) {
      Write-DiagnosticEvent -Stage "vscode-activate-succeeded" -Data @{
        processId = $WindowCandidate.ProcessId
        method = "app-activate-process-id"
        windowTitle = $WindowCandidate.WindowTitle
      }
      return $true
    }
  } catch {
    Write-DiagnosticEvent -Stage "vscode-activate-app-activate-error" -Data @{
      processId = $WindowCandidate.ProcessId
      error = $_.Exception.Message
      windowTitle = $WindowCandidate.WindowTitle
    }
  }

  Start-Sleep -Milliseconds 120
  $retried = [NativeWindowApi]::SetForegroundWindow($handle)
  Write-DiagnosticEvent -Stage $(if ($retried) { "vscode-activate-succeeded" } else { "vscode-activate-failed" }) -Data @{
    processId = $WindowCandidate.ProcessId
    method = "retry-set-foreground-window"
    windowTitle = $WindowCandidate.WindowTitle
    handle = $handle.ToInt64()
  }
  return $retried
}

function Get-ActivationWatchdogSeconds {
  param([int]$NotificationTimeoutSeconds)

  $normalizedTimeout = [Math]::Max(1, $NotificationTimeoutSeconds)
  return [Math]::Min(120, [Math]::Max(60, $normalizedTimeout + 30))
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
  Write-DiagnosticEvent -Stage "open-vscode-requested" -Data @{
    workspacePath = $WorkspacePath
    workspaceHint = Get-WorkspaceMatchHint
    projectHint = $ProjectHint
  }

  $resolvedWindow = Resolve-VsCodeWindowCandidate -WorkspacePath $WorkspacePath
  if ($resolvedWindow -and (Try-ActivateVsCodeWindow -WindowCandidate $resolvedWindow.Candidate)) {
    $existingWindowStage =
      if ($resolvedWindow.Resolution -eq "matched") {
        "open-vscode-completed"
      } else {
        "open-vscode-partial"
      }

    Write-DiagnosticEvent -Stage $existingWindowStage -Data @{
      strategy = "existing-window"
      resolution = $resolvedWindow.Resolution
      processId = $resolvedWindow.Candidate.ProcessId
      windowTitle = $resolvedWindow.Candidate.WindowTitle
      windowClassName = $resolvedWindow.Candidate.WindowClassName
      workspacePath = $WorkspacePath
      projectHint = $ProjectHint
    }
    return
  }

  $codeCommand = Resolve-CodeCommand
  if (-not $codeCommand) {
    Write-DiagnosticEvent -Stage "open-vscode-failed" -Data @{
      reason = "code-command-not-found"
      workspacePath = $WorkspacePath
      projectHint = $ProjectHint
    }
    return
  }

  $startArgs = @()
  if ($WorkspacePath -and (Test-Path -LiteralPath $WorkspacePath)) {
    $startArgs = @("--reuse-window", $WorkspacePath)
  }

  Write-DiagnosticEvent -Stage "open-vscode-launching" -Data @{
    command = $codeCommand
    arguments = $startArgs
    workspacePath = $WorkspacePath
    projectHint = $ProjectHint
  }
  Start-Process -FilePath $codeCommand -ArgumentList $startArgs | Out-Null
  Start-Sleep -Milliseconds 500

  $launchedWindow = Resolve-VsCodeWindowCandidate -WorkspacePath $WorkspacePath
  if ($launchedWindow) {
    $activated = Try-ActivateVsCodeWindow -WindowCandidate $launchedWindow.Candidate
    $launchStage =
      if (-not $activated) {
        "open-vscode-partial"
      } elseif ($launchedWindow.Resolution -eq "matched") {
        "open-vscode-completed"
      } else {
        "open-vscode-partial"
      }

    Write-DiagnosticEvent -Stage $launchStage -Data @{
      strategy = "launch-and-activate"
      resolution = $launchedWindow.Resolution
      processId = $launchedWindow.Candidate.ProcessId
      windowTitle = $launchedWindow.Candidate.WindowTitle
      windowClassName = $launchedWindow.Candidate.WindowClassName
      workspacePath = $WorkspacePath
      projectHint = $ProjectHint
    }
    return
  }

  Write-DiagnosticEvent -Stage "open-vscode-partial" -Data @{
    strategy = "launch-no-window-detected"
    workspacePath = $WorkspacePath
    projectHint = $ProjectHint
  }
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

Write-DiagnosticEvent -Stage "helper-started" -Data @{
  title = $Title
  message = $Message
  level = $Level
  timeoutSeconds = $TimeoutSeconds
  openVsCodeOnClick = [bool]$OpenVsCodeOnClick
  workspacePath = $WorkspacePath
  projectHint = $ProjectHint
}

if ($OpenVsCodeOnClick) {
  $icon.add_BalloonTipClicked({
    try {
      Write-DiagnosticEvent -Stage "balloon-clicked" -Data @{
        workspacePath = $WorkspacePath
        projectHint = $ProjectHint
      }
      Write-DiagnosticEvent -Stage "balloon-click-handler-entered" -Data @{
        workspacePath = $WorkspacePath
        projectHint = $ProjectHint
      }
      Open-VsCode
      Write-DiagnosticEvent -Stage "balloon-click-handler-completed" -Data @{
        workspacePath = $WorkspacePath
        projectHint = $ProjectHint
      }
    } catch {
      Write-DiagnosticEvent -Stage "balloon-click-handler-error" -Data @{
        workspacePath = $WorkspacePath
        projectHint = $ProjectHint
        error = Format-ExceptionRecord $_
      }
    } finally {
      if ($script:form) {
        $script:form.Close()
      }
    }
  })
}

if ($OpenVsCodeOnClick) {
  $timer = New-Object System.Windows.Forms.Timer
  $script:timer = $timer
  $timer.Interval = (Get-ActivationWatchdogSeconds -NotificationTimeoutSeconds $TimeoutSeconds) * 1000
  $timer.Add_Tick({
    Write-DiagnosticEvent -Stage "helper-watchdog-expired" -Data @{
      watchdogSeconds = [int]($script:timer.Interval / 1000)
      workspacePath = $WorkspacePath
      projectHint = $ProjectHint
    }
    if ($script:timer) {
      $script:timer.Stop()
    }
    if ($script:form) {
      $script:form.Close()
    }
  })

  $form.Add_Shown({
    Write-DiagnosticEvent -Stage "balloon-shown" -Data @{
      timeoutSeconds = $TimeoutSeconds
      workspacePath = $WorkspacePath
      projectHint = $ProjectHint
    }
    $icon.ShowBalloonTip([Math]::Max(1, $TimeoutSeconds) * 1000)
    $timer.Start()
  })

  $icon.add_BalloonTipClosed({
    Write-DiagnosticEvent -Stage "balloon-closed" -Data @{
      workspacePath = $WorkspacePath
      projectHint = $ProjectHint
    }
    if ($script:form) {
      $script:form.Close()
    }
  })

  $form.Add_FormClosed({
    Write-DiagnosticEvent -Stage "helper-exiting" -Data @{
      workspacePath = $WorkspacePath
      projectHint = $ProjectHint
    }
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

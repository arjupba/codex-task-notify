param(
  [string]$Title = "Codex complete",
  [string]$Message = "Task completed",
  [ValidateSet("Auto", "WindowsToast", "VSCode")]
  [string]$Mode = "Auto",
  [ValidateSet("Info", "Warning", "Error")]
  [string]$Level = "Info",
  [int]$TimeoutSeconds = 5,
  [switch]$OpenVsCodeOnClick,
  [string]$WorkspacePath = "",
  [string]$WorkspaceRoot,
  [string]$EventDir
)

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

function Invoke-NotifyScript {
  param(
    [string]$ScriptName,
    [string[]]$Arguments
  )

  $scriptPath = Join-Path $scriptDir $ScriptName
  & powershell -NoProfile -ExecutionPolicy Bypass -File $scriptPath @Arguments
}

$targetMode = $Mode
if ($Mode -eq "Auto") {
  $targetMode = "WindowsToast"
}

if ($targetMode -eq "VSCode") {
  $args = @(
    "-Title", $Title,
    "-Message", $Message,
    "-Level", $Level.ToLowerInvariant()
  )

  if ($WorkspaceRoot) {
    $args += @("-WorkspaceRoot", $WorkspaceRoot)
  }

  if ($EventDir) {
    $args += @("-EventDir", $EventDir)
  }

  Invoke-NotifyScript -ScriptName "vscode-notify.ps1" -Arguments $args
  exit $LASTEXITCODE
}

$toastArgs = @(
  "-Title", $Title,
  "-Message", $Message,
  "-Level", $Level,
  "-TimeoutSeconds", $TimeoutSeconds
)

if ($OpenVsCodeOnClick) {
  $toastArgs += "-OpenVsCodeOnClick"
}

if ($WorkspacePath) {
  $toastArgs += @("-WorkspacePath", $WorkspacePath)
}

Invoke-NotifyScript -ScriptName "notify.ps1" -Arguments $toastArgs

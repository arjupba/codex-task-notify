param(
  [string]$Title = "Done",
  [string]$Message = "Task completed",
  [ValidateSet("Info", "Warning", "Error")]
  [string]$Level = "Info",
  [int]$TimeoutSeconds = 5
)

if ([System.Environment]::OSVersion.Platform -ne [System.PlatformID]::Win32NT) {
  Write-Error "This notification helper only works on Windows."
  exit 1
}

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$icon = New-Object System.Windows.Forms.NotifyIcon
$icon.Visible = $true
$icon.Text = "Codex Notify"

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
$icon.ShowBalloonTip([Math]::Max(1, $TimeoutSeconds) * 1000)

Start-Sleep -Seconds ([Math]::Max(2, $TimeoutSeconds))
$icon.Dispose()

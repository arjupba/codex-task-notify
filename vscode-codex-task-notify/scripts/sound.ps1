param(
  [ValidateSet("Info", "Warning", "Error")]
  [string]$Level = "Info",
  [ValidateSet("Notification.Default", "SystemAsterisk", "SystemExclamation", "SystemHand")]
  [string]$Sound = "Notification.Default"
)

if ([System.Environment]::OSVersion.Platform -ne [System.PlatformID]::Win32NT) {
  Write-Output "sound-notification-skipped: non-windows"
  exit 0
}

Add-Type -AssemblyName System.Media

switch ($Sound) {
  "SystemAsterisk" {
    [System.Media.SystemSounds]::Asterisk.Play()
  }
  "SystemExclamation" {
    [System.Media.SystemSounds]::Exclamation.Play()
  }
  "SystemHand" {
    [System.Media.SystemSounds]::Hand.Play()
  }
  default {
    switch ($Level) {
      "Warning" {
        [System.Media.SystemSounds]::Exclamation.Play()
      }
      "Error" {
        [System.Media.SystemSounds]::Hand.Play()
      }
      default {
        [System.Media.SystemSounds]::Asterisk.Play()
      }
    }
  }
}

Write-Output "sound-notification-delivered"

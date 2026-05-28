param(
  [string]$Title = "Codex complete",
  [string]$Message = "Task completed",
  [ValidateSet("info", "warning", "error", "Info", "Warning", "Error")]
  [string]$Level = "info",
  [string]$WorkspaceRoot,
  [string]$EventDir
)

function Get-WorkspaceRoot {
  param([string]$PreferredRoot)

  if ($PreferredRoot) {
    return (Resolve-Path -LiteralPath $PreferredRoot).Path
  }

  $gitRoot = git rev-parse --show-toplevel 2>$null
  if ($LASTEXITCODE -eq 0 -and $gitRoot) {
    return $gitRoot.Trim()
  }

  return (Get-Location).Path
}

function Get-EventDirectory {
  param(
    [string]$Root,
    [string]$PreferredEventDir
  )

  if (-not [string]::IsNullOrWhiteSpace($PreferredEventDir)) {
    if ([System.IO.Path]::IsPathRooted($PreferredEventDir)) {
      return $PreferredEventDir
    }

    return (Join-Path $Root $PreferredEventDir)
  }

  if (-not [string]::IsNullOrWhiteSpace($env:CODEX_NOTIFY_EVENT_DIR)) {
    if ([System.IO.Path]::IsPathRooted($env:CODEX_NOTIFY_EVENT_DIR)) {
      return $env:CODEX_NOTIFY_EVENT_DIR
    }

    return (Join-Path $Root $env:CODEX_NOTIFY_EVENT_DIR)
  }

  return (Join-Path $Root "tmp/codex-task-notify")
}

$root = Get-WorkspaceRoot -PreferredRoot $WorkspaceRoot
$notifyDir = Get-EventDirectory -Root $root -PreferredEventDir $EventDir
$notifyFile = Join-Path $notifyDir "task.json"

New-Item -ItemType Directory -Path $notifyDir -Force | Out-Null

$payload = [ordered]@{
  id = [guid]::NewGuid().ToString()
  title = $Title
  message = $Message
  level = $Level.ToLowerInvariant()
  createdAt = (Get-Date).ToString("o")
}

$json = $payload | ConvertTo-Json -Depth 4
[System.IO.File]::WriteAllText($notifyFile, $json, [System.Text.UTF8Encoding]::new($false))

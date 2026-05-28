param()

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$extensionInstaller = Join-Path $scriptDir "vscode-codex-task-notify\install.ps1"

& powershell -NoProfile -ExecutionPolicy Bypass -File $extensionInstaller
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}

Write-Host ""
Write-Host "Next step:"
Write-Host "  Reload VS Code once, then use .\notify\codex-notify.ps1 or ./notify/codex-notify.sh"

param(
  [string]$TargetRoot = (Join-Path $env:USERPROFILE ".vscode\extensions")
)

$sourceRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$packageJsonPath = Join-Path $sourceRoot "package.json"
$packageJson = [System.IO.File]::ReadAllText($packageJsonPath, [System.Text.Encoding]::UTF8)
$package = $packageJson | ConvertFrom-Json

$targetDirName = "{0}.{1}-{2}" -f $package.publisher, $package.name, $package.version
$targetDir = Join-Path $TargetRoot $targetDirName

New-Item -ItemType Directory -Path $TargetRoot -Force | Out-Null

Get-ChildItem -LiteralPath $TargetRoot -Directory |
  Where-Object {
    $_.Name -like "$($package.publisher).$($package.name)-*" -or
    $_.Name -like "codex.$($package.name)-*" -or
    $_.Name -like "codex-selfhosted.$($package.name)-*"
  } |
  Remove-Item -Recurse -Force

Copy-Item -LiteralPath $sourceRoot -Destination $targetDir -Recurse

Write-Host "Installed to $targetDir"
Write-Host "Reload VS Code to activate the updated extension."

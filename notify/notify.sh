#!/usr/bin/env bash
set -euo pipefail

title="Done"
message="Task completed"
level="Info"
timeout_seconds="5"
open_vscode_on_click="false"
workspace_path=""

while (($#)); do
  case "$1" in
    -Title)
      title="${2:-}"
      shift 2
      ;;
    -Message)
      message="${2:-}"
      shift 2
      ;;
    -Level)
      level="${2:-}"
      shift 2
      ;;
    -TimeoutSeconds)
      timeout_seconds="${2:-5}"
      shift 2
      ;;
    -OpenVsCodeOnClick)
      open_vscode_on_click="true"
      shift
      ;;
    -WorkspacePath)
      workspace_path="${2:-}"
      shift 2
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

if ! command -v powershell.exe >/dev/null 2>&1; then
  echo "powershell.exe not found. WSL interop may be disabled or PATH may be overwritten." >&2
  exit 1
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ps1_path="$(wslpath -w "$script_dir/notify.ps1")"

if [[ -n "$workspace_path" && ! "$workspace_path" =~ ^[A-Za-z]:[\\/] ]] && command -v wslpath >/dev/null 2>&1; then
  workspace_path="$(wslpath -w "$workspace_path")"
fi

args=(
  -NoProfile
  -ExecutionPolicy
  Bypass
  -File
  "$ps1_path"
  -Title
  "$title"
  -Message
  "$message"
  -Level
  "$level"
  -TimeoutSeconds
  "$timeout_seconds"
)

if [[ "$open_vscode_on_click" == "true" ]]; then
  args+=(-OpenVsCodeOnClick)
fi

if [[ -n "$workspace_path" ]]; then
  args+=(-WorkspacePath "$workspace_path")
fi

powershell.exe "${args[@]}"

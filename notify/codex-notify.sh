#!/usr/bin/env bash
set -euo pipefail

title="Codex complete"
message="Task completed"
mode="Auto"
level="Info"
timeout_seconds="5"
workspace_root=""
event_dir=""

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
    -Mode)
      mode="${2:-Auto}"
      shift 2
      ;;
    -Level)
      level="${2:-Info}"
      shift 2
      ;;
    -TimeoutSeconds)
      timeout_seconds="${2:-5}"
      shift 2
      ;;
    -WorkspaceRoot)
      workspace_root="${2:-}"
      shift 2
      ;;
    -EventDir)
      event_dir="${2:-}"
      shift 2
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

is_wsl="false"
if [[ -n "${WSL_DISTRO_NAME:-}" ]] || grep -qi microsoft /proc/version 2>/dev/null; then
  is_wsl="true"
fi

target_mode="$mode"
if [[ "$mode" == "Auto" ]]; then
  if [[ "$is_wsl" == "true" ]]; then
    target_mode="WindowsToast"
  else
    target_mode="VSCode"
  fi
fi

if [[ "$target_mode" == "VSCode" ]]; then
  args=(
    -Title "$title"
    -Message "$message"
    -Level "$level"
  )

  if [[ -n "$workspace_root" ]]; then
    args+=(-WorkspaceRoot "$workspace_root")
  fi

  if [[ -n "$event_dir" ]]; then
    args+=(-EventDir "$event_dir")
  fi

  bash "$script_dir/vscode-notify.sh" "${args[@]}"
  exit $?
fi

bash "$script_dir/notify.sh" \
  -Title "$title" \
  -Message "$message" \
  -Level "$level" \
  -TimeoutSeconds "$timeout_seconds"

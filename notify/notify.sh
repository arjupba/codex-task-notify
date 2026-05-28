#!/usr/bin/env bash
set -euo pipefail

title="Done"
message="Task completed"
level="Info"
timeout_seconds="5"

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

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$ps1_path" \
  -Title "$title" \
  -Message "$message" \
  -Level "$level" \
  -TimeoutSeconds "$timeout_seconds"

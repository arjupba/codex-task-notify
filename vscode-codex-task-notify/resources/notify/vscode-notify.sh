#!/usr/bin/env bash
set -euo pipefail

title="Codex complete"
message="Task completed"
level="info"
workspace_root=""
event_dir=""

json_escape() {
  local value="${1//\\/\\\\}"
  value="${value//\"/\\\"}"
  value="${value//$'\n'/\\n}"
  value="${value//$'\r'/\\r}"
  value="${value//$'\t'/\\t}"
  printf '"%s"' "$value"
}

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
      level="${2:-info}"
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

if [[ -n "$workspace_root" ]]; then
  root="$workspace_root"
elif git_root="$(git rev-parse --show-toplevel 2>/dev/null)"; then
  root="$git_root"
else
  root="$PWD"
fi

if [[ -n "$event_dir" ]]; then
  if [[ "$event_dir" = /* ]]; then
    notify_dir="$event_dir"
  else
    notify_dir="$root/$event_dir"
  fi
elif [[ -n "${CODEX_NOTIFY_EVENT_DIR:-}" ]]; then
  if [[ "$CODEX_NOTIFY_EVENT_DIR" = /* ]]; then
    notify_dir="$CODEX_NOTIFY_EVENT_DIR"
  else
    notify_dir="$root/$CODEX_NOTIFY_EVENT_DIR"
  fi
else
  notify_dir="$root/tmp/codex-task-notify"
fi

notify_file="$notify_dir/task.json"
mkdir -p "$notify_dir"

timestamp="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
event_id="$(date -u +"%Y%m%dT%H%M%SZ")-$$"

cat >"$notify_file" <<EOF
{
  "id": "$event_id",
  "title": $(json_escape "$title"),
  "message": $(json_escape "$message"),
  "level": $(json_escape "$level"),
  "createdAt": "$timestamp"
}
EOF

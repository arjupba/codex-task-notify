#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
bash "$script_dir/vscode-codex-task-notify/install.sh"

echo
echo "Next step:"
echo "  Reload VS Code once, then use ./notify/codex-notify.sh"

#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
target_root="${HOME}/.vscode/extensions"

if command -v jq >/dev/null 2>&1; then
  publisher="$(jq -r '.publisher' "$script_dir/package.json")"
  name="$(jq -r '.name' "$script_dir/package.json")"
  version="$(jq -r '.version' "$script_dir/package.json")"
else
  publisher="$(grep -m1 '"publisher"' "$script_dir/package.json" | sed -E 's/.*"publisher"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/')"
  name="$(grep -m1 '"name"' "$script_dir/package.json" | sed -E 's/.*"name"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/')"
  version="$(grep -m1 '"version"' "$script_dir/package.json" | sed -E 's/.*"version"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/')"
fi

target_dir="${target_root}/${publisher}.${name}-${version}"
mkdir -p "$target_root"
rm -rf "${target_root}/${publisher}.${name}-"* "${target_root}/codex.${name}-"* "${target_root}/codex-selfhosted.${name}-"*
cp -R "$script_dir" "$target_dir"

echo "Installed to $target_dir"
echo "Reload VS Code to activate the updated extension."

# Changelog

## 0.0.3

- Harden Windows notification click activation and diagnostics
- Add Chinese documentation for the repository and Marketplace listing

## 0.0.2

- Restore reliable Windows notification click handling by keeping the tray event loop alive
- Reopen or focus the matching VS Code workspace from Windows task notifications
- Pass workspace-path and click-through arguments through the bundled WSL and PowerShell notify scripts

## 0.0.1

- Initial release
- Local Windows notifications for Codex task completion
- Support for local folders, WSL, and Remote SSH
- Commands to export bundled CLI scripts to local or workspace paths

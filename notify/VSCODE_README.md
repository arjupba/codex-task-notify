# VS Code Notify

This path is for local VS Code UI notifications, including Remote SSH and WSL.

## Trigger from PowerShell

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\notify\vscode-notify.ps1 -Title "Codex complete" -Message "Task completed"
```

## Trigger from bash or WSL

```bash
bash ./notify/vscode-notify.sh -Title "Codex complete" -Message "Task completed"
```

## How it works

1. The trigger writes `.codex-notify/task.json` into the current workspace root.
2. The local VS Code extension watches that file in the open workspace.
3. The extension shows a local VS Code notification.

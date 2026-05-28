# Notify

Independent notification helpers for Windows, WSL, and VS Code remote workflows.

## Recommended unified entry points

Windows PowerShell:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\notify\codex-notify.ps1 -Title "Codex complete" -Message "Task completed"
```

WSL or Linux:

```bash
bash ./notify/codex-notify.sh -Title "Codex complete" -Message "Task completed"
```

Windows cmd:

```bat
notify\codex-notify.cmd -Title "Codex complete" -Message "Task completed"
```

`Auto` mode behavior:

- On Windows: send a Windows system notification.
- On WSL: send a Windows system notification via `powershell.exe`.
- On non-WSL Linux: write a VS Code workspace event for the local extension to show.

By default, VS Code mode writes events to `tmp/codex-task-notify/task.json` inside
the current workspace. This keeps runtime files out of the project root while
still allowing Remote SSH and WSL workspaces to work reliably.

## Usage

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\notify\notify.ps1 -Title "Done" -Message "Task completed"
```

From WSL:

```bash
bash ./notify/notify.sh -Title "Done" -Message "Task completed"
```

Or via the cmd wrapper:

```bat
notify\notify.cmd -Title "Done" -Message "Task completed"
```

## Parameters

- `-Title`
- `-Message`
- `-Level` `Info` / `Warning` / `Error`
- `-TimeoutSeconds`
- `-Mode` `Auto` / `WindowsToast` / `VSCode` for `codex-notify.*`
- `-EventDir` optional override for the VS Code event directory

## Notes

- WSL must have Windows interop enabled.
- If `powershell.exe` is not found in WSL, your shell may have overwritten `PATH`.
- You can also set `CODEX_NOTIFY_EVENT_DIR` to override the default event directory.

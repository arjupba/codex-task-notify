# Codex Task Notify

Local Windows notifications for Codex task completion, including support for:

- local Windows workspaces
- VS Code Remote WSL
- VS Code Remote SSH / remote Linux servers

## Repo layout

- `docs/` contains screenshots and documentation assets
- `notify/` contains the trigger scripts used by tasks
- `vscode-codex-task-notify/` contains the local VS Code extension
- `install.ps1` and `install.sh` install the extension into your local VS Code

## Default behavior

- Local / VS Code session monitoring: read real Codex session files under `.codex/sessions` and notify on `task_complete`
- Windows: show a Windows system notification
- WSL: forward to Windows via `powershell.exe`
- Remote Linux automatic mode: monitor Codex session files directly when the VS Code extension can see the remote filesystem
- Remote Linux bridge mode: write a workspace event to `tmp/codex-task-notify/task.json`, then let the local VS Code extension show the notification

## Install

Recommended when published to Marketplace:

1. Install the VS Code extension `rmargin.codex-task-notify`
2. Run `Codex Task Notify: Install Local CLI` or `Codex Task Notify: Install Workspace CLI`
3. Reload VS Code if prompted

Repo-based install for development or before Marketplace publishing:

Windows:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1
```

WSL or Linux:

```bash
bash ./install.sh
```

After install, reload VS Code once.

## Use

Windows:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\notify\codex-notify.ps1 -Title "Codex complete" -Message "Task completed"
```

WSL or Linux:

```bash
bash ./notify/codex-notify.sh -Title "Codex complete" -Message "Task completed"
```

## Automatic session monitoring

The VS Code extension now also watches real Codex session files and triggers
notifications when a session emits `task_complete`.

Default session root behavior:

- Local Windows: `%USERPROFILE%\\.codex\\sessions`
- Remote SSH / WSL: auto-detect the remote home directory and use `~/.codex/sessions`

If auto-detection is wrong in your environment, set these VS Code settings:

```json
{
  "codexTaskNotify.sessionsRoot": "",
  "codexTaskNotify.sessionPollMs": 1500,
  "codexTaskNotify.sessionLookbackDays": 7
}
```

Set `codexTaskNotify.sessionsRoot` explicitly when needed, for example:

- Windows: `C:\\Users\\you\\.codex\\sessions`
- Linux / Remote SSH: `/home/you/.codex/sessions`

## Quick setup on a new machine

Marketplace path:

```bash
code --install-extension rmargin.codex-task-notify
```

Then run one of these from the VS Code command palette:

- `Codex Task Notify: Show Diagnostics`
- `Codex Task Notify: Show Recent History`
- `Codex Task Notify: Install Local CLI`
- `Codex Task Notify: Install Workspace CLI`

Repo path:

Windows:

```powershell
git clone <repo-url> && cd codex-task-notify && powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1
```

WSL or Linux:

```bash
git clone <repo-url> && cd codex-task-notify && bash ./install.sh
```

## Publish later

This repo is ready for local side-loading now and for Marketplace packaging.
The extension publisher is currently set to `rmargin`. If you want to publish
under a different publisher later, update
`vscode-codex-task-notify/package.json` and follow [PUBLISHING.md](./PUBLISHING.md).

## Repository

- GitHub: https://github.com/Gtyro/codex-task-notify

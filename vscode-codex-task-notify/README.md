# Codex Task Notify

Local task-completion notifications for Codex across Windows, WSL, and Remote SSH.

为 Codex 提供跨 Windows、WSL 与 Remote SSH 的本地任务完成通知。

## What It Does

- Watches real Codex session files under `.codex/sessions` and notifies on `task_complete`
- Watches task-completion event files inside the current workspace
- Shows a local Windows system notification when possible
- Falls back to an in-app VS Code notification on non-Windows local hosts
- Exports bundled CLI scripts so you can trigger notifications without cloning a repo

## 功能概览

- 监听当前工作区中的任务完成事件文件
- 在本地 Windows 主机上优先弹出系统通知
- 当本地主机不是 Windows 时，回退为 VS Code 内通知
- 可直接导出内置 CLI 脚本，不必为了拿脚本而单独克隆仓库

## Supported Scenarios

- Local Windows workspace
- VS Code Remote WSL
- VS Code Remote SSH / remote Linux server

## 支持场景

- 本地 Windows 工作区
- VS Code Remote WSL
- VS Code Remote SSH / 远程 Linux 服务器

## Commands

- `Codex Task Notify: Test Notification`
- `Codex Task Notify: Show Diagnostics`
- `Codex Task Notify: Show Recent History`
- `Codex Task Notify: Install Local CLI`
- `Codex Task Notify: Install Workspace CLI`

## 命令

- `Codex Task Notify: Test Notification`
- `Codex Task Notify: Show Diagnostics`
- `Codex Task Notify: Show Recent History`
- `Codex Task Notify: Install Local CLI`
- `Codex Task Notify: Install Workspace CLI`

`Install Local CLI` exports the bundled scripts to a local user directory.

`Install Workspace CLI` exports the bundled scripts into the current workspace,
which is especially useful for WSL and Remote SSH sessions.

`Install Local CLI` 会把内置脚本导出到本机用户目录。

`Install Workspace CLI` 会把内置脚本导出到当前工作区，特别适合 WSL 和 Remote SSH 场景。

## Triggering Notifications

After exporting the CLI, you can trigger a notification like this:

Windows PowerShell:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\codex-notify.ps1 -Title "Codex complete" -Message "Task completed"
```

bash / WSL:

```bash
bash ./codex-notify.sh -Title "Codex complete" -Message "Task completed"
```

The extension also supports automatic session-based notifications by reading
Codex session files directly from `.codex/sessions`.

Useful built-in commands:

- `Show Diagnostics`: inspect the resolved sessions path, poll status, tracked files, latest completion, and latest `rate_limits` payload
- `Show Recent History`: inspect recently completed Codex turns and recent bridge notifications in the output panel

Useful settings:

```json
{
  "codexTaskNotify.sessionsRoot": "",
  "codexTaskNotify.sessionPollMs": 1500,
  "codexTaskNotify.sessionLookbackDays": 7
}
```

Set `codexTaskNotify.sessionsRoot` manually if your remote or local Codex
session directory is not in the default location.

导出 CLI 后，可以像下面这样触发通知：

Windows PowerShell:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\codex-notify.ps1 -Title "Codex complete" -Message "Task completed"
```

bash / WSL:

```bash
bash ./codex-notify.sh -Title "Codex complete" -Message "Task completed"
```

## Repository

- GitHub: https://github.com/Gtyro/codex-task-notify

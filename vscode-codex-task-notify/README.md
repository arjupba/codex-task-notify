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
- `Codex Task Notify: Debug Snapshot`
- `Codex Task Notify: Show Recent History`
- `Codex Task Notify: Show Recent Events`
- `Codex Task Notify: Install Local CLI`
- `Codex Task Notify: Install Workspace CLI`

## 命令

- `Codex Task Notify: Test Notification`
- `Codex Task Notify: Show Diagnostics`
- `Codex Task Notify: Debug Snapshot`
- `Codex Task Notify: Show Recent History`
- `Codex Task Notify: Show Recent Events`
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
- `Debug Snapshot`: dump a JSON snapshot of diagnostics, settings, and recent state
- `Show Recent History`: inspect recently completed Codex turns and recent bridge notifications in the output panel
- `Show Recent Events`: inspect the newest observed event entries in chronological order

Useful settings:

```json
{
  "codexTaskNotify.sessionsRoot": "",
  "codexTaskNotify.sessionPollMs": 1500,
  "codexTaskNotify.sessionLookbackDays": 7,
  "codexTaskNotify.windowsNotification.openVsCodeOnClick": true
}
```

Set `codexTaskNotify.sessionsRoot` manually if your remote or local Codex
session directory is not in the default location.

When `codexTaskNotify.windowsNotification.openVsCodeOnClick` is enabled,
clicking a local Windows notification will try to reopen or foreground VS Code.
For local Windows workspaces it also tries to reuse the related workspace path.

导出 CLI 后，可以像下面这样触发通知：

Windows PowerShell:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\codex-notify.ps1 -Title "Codex complete" -Message "Task completed"
```

bash / WSL:

```bash
bash ./codex-notify.sh -Title "Codex complete" -Message "Task completed"
```

## Android Push With ntfy

`ntfy` is the recommended Android push option for this extension because it can
start on the free hosted tier and only needs a simple HTTP request.

How to use it:

1. Install the `ntfy` Android app.
2. Create or subscribe to a topic, for example `codex-10941-demo`.
3. Put the publish URL into VS Code settings.
4. Turn on ntfy delivery in this extension.

Example settings:

```json
{
  "codexTaskNotify.notificationChannels.ntfy.enabled": true,
  "codexTaskNotify.notificationChannels.ntfy.topicUrl": "https://ntfy.sh/codex-10941-demo",
  "codexTaskNotify.notificationChannels.ntfy.priority": 3,
  "codexTaskNotify.notificationChannels.ntfy.tags": "computer"
}
```

If your ntfy topic is private or protected, also set:

```json
{
  "codexTaskNotify.notificationChannels.ntfy.accessToken": "YOUR_NTFY_ACCESS_TOKEN"
}
```

Hosted `ntfy.sh` free tier note:

- Official hosted free tier currently allows `250 messages/day`, which is
  typically enough for Codex task completion notifications.

## Sound Notification

If you want an extra local cue on Windows, you can enable a system sound:

```json
{
  "codexTaskNotify.notificationChannels.sound.enabled": true,
  "codexTaskNotify.notificationChannels.sound.windowsSound": "Notification.Default"
}
```

Supported sound values:

- `Notification.Default`
- `SystemAsterisk`
- `SystemExclamation`
- `SystemHand`

If you do not want sound, leave it disabled.

## Generic Webhook

If you want to connect your own push bridge or automation service, enable the
generic webhook channel:

```json
{
  "codexTaskNotify.notificationChannels.webhook.enabled": true,
  "codexTaskNotify.notificationChannels.webhook.url": "https://example.com/codex-notify",
  "codexTaskNotify.notificationChannels.webhook.headers": {
    "Authorization": "Bearer YOUR_TOKEN"
  }
}
```

Webhook payload shape:

```json
{
  "title": "Codex task complete",
  "message": "CNY 0.123 | fixed notification routing",
  "level": "info",
  "timestamp": "2026-05-28T10:00:00.000Z",
  "source": "codex-session",
  "sessionId": "session-id",
  "turnId": "turn-id",
  "projectName": "codex-task-notify",
  "cwd": "C:\\Users\\10941\\Documents\\Project\\codex-task-notify",
  "sessionFile": "file:///...jsonl",
  "model": "gpt-5.4",
  "tokenUsage": {},
  "costEstimate": {}
}
```

## Repository

- GitHub: https://github.com/Gtyro/codex-task-notify

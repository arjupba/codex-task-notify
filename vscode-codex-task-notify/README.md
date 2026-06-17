# Codex Task Notify

Local task-completion notifications for Codex across Windows, WSL, and Remote SSH.

为 Codex 提供跨 Windows、WSL 与 Remote SSH 的本地任务完成通知。

## What It Does

- Watches real Codex session files under `.codex/sessions` and notifies on `task_complete`
- Watches task-completion event files inside the current workspace
- Shows a local Windows system notification when possible
- Falls back to an in-app VS Code notification on non-Windows local hosts
- Exports bundled CLI scripts so you can trigger notifications without cloning a repo
- Supports optional cost estimation, sound alerts, ntfy push, and generic webhooks

## 功能概览

- 监听 `.codex/sessions` 下真实的 Codex 会话文件，并在出现 `task_complete` 时通知
- 监听当前工作区中的任务完成事件文件
- 在可用时优先显示本地 Windows 系统通知
- 在非 Windows 本地主机上回退为 VS Code 内通知
- 可导出内置 CLI 脚本，无需克隆仓库即可手动触发通知
- 支持可选的成本估算、声音提醒、ntfy 推送与通用 Webhook

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
- `Codex Task Notify: Show Debug Snapshot`
- `Codex Task Notify: Show Recent History`
- `Codex Task Notify: Show Recent Events`
- `Codex Task Notify: Show Recent Costs`
- `Codex Task Notify: Install Local CLI`
- `Codex Task Notify: Install Workspace CLI`

`Install Local CLI` exports the bundled scripts to a local user directory.

`Install Workspace CLI` exports the bundled scripts into the current workspace,
which is especially useful for WSL and Remote SSH sessions.

## 常用命令

- `Codex Task Notify: Test Notification`
- `Codex Task Notify: Show Diagnostics`
- `Codex Task Notify: Show Debug Snapshot`
- `Codex Task Notify: Show Recent History`
- `Codex Task Notify: Show Recent Events`
- `Codex Task Notify: Show Recent Costs`
- `Codex Task Notify: Install Local CLI`
- `Codex Task Notify: Install Workspace CLI`

其中：

- `Install Local CLI` 会把内置脚本导出到当前用户目录
- `Install Workspace CLI` 会把内置脚本导出到当前工作区，尤其适合 WSL 和 Remote SSH

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
- `Show Debug Snapshot`: dump a JSON snapshot of diagnostics, settings, and recent state
- `Show Recent History`: inspect recently completed Codex turns and recent bridge notifications in the output panel
- `Show Recent Events`: inspect the newest observed event entries in chronological order
- `Show Recent Costs`: inspect recent token usage and cost estimates when cost tracking is enabled

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

## 手动触发与自动监听

导出 CLI 后，可以这样手动触发通知：

Windows PowerShell：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\codex-notify.ps1 -Title "Codex complete" -Message "Task completed"
```

bash / WSL：

```bash
bash ./codex-notify.sh -Title "Codex complete" -Message "Task completed"
```

扩展也支持通过读取 `.codex/sessions` 中的真实会话文件来自动触发通知。

比较有用的内置命令：

- `Show Diagnostics`：查看解析出的 sessions 路径、轮询状态、跟踪文件数、最近完成事件和最新 `rate_limits`
- `Show Debug Snapshot`：导出当前诊断、设置和近期状态的 JSON 快照
- `Show Recent History`：查看最近完成的 Codex 轮次与桥接通知历史
- `Show Recent Events`：按时间顺序查看最近观察到的事件
- `Show Recent Costs`：在启用成本统计后查看最近的 token 使用量和成本估算

常用设置：

```json
{
  "codexTaskNotify.sessionsRoot": "",
  "codexTaskNotify.sessionPollMs": 1500,
  "codexTaskNotify.sessionLookbackDays": 7,
  "codexTaskNotify.windowsNotification.openVsCodeOnClick": true
}
```

如果你的本地或远程 Codex 会话目录不在默认位置，可以手动设置 `codexTaskNotify.sessionsRoot`。

启用 `codexTaskNotify.windowsNotification.openVsCodeOnClick` 后，点击本地 Windows 通知会尝试重新打开或前置 VS Code；对于本地 Windows 工作区，还会尽量复用对应的工作区路径。

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

## Android 推送：ntfy

如果你希望把完成通知推送到 Android 手机，推荐使用 `ntfy`。它的接入方式简单，只需要向一个 HTTP 地址发送请求。

使用方法：

1. 安装 `ntfy` Android App
2. 创建或订阅一个 topic，例如 `codex-10941-demo`
3. 把 publish URL 填进 VS Code 设置
4. 在本扩展中启用 ntfy 通知通道

示例设置：

```json
{
  "codexTaskNotify.notificationChannels.ntfy.enabled": true,
  "codexTaskNotify.notificationChannels.ntfy.topicUrl": "https://ntfy.sh/codex-10941-demo",
  "codexTaskNotify.notificationChannels.ntfy.priority": 3,
  "codexTaskNotify.notificationChannels.ntfy.tags": "computer"
}
```

如果你的 ntfy topic 是私有或受保护的，再额外设置：

```json
{
  "codexTaskNotify.notificationChannels.ntfy.accessToken": "YOUR_NTFY_ACCESS_TOKEN"
}
```

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

## Windows 声音通知

如果你希望在 Windows 本地额外播放系统提示音，可以启用声音通知：

```json
{
  "codexTaskNotify.notificationChannels.sound.enabled": true,
  "codexTaskNotify.notificationChannels.sound.windowsSound": "Notification.Default"
}
```

支持的声音值：

- `Notification.Default`
- `SystemAsterisk`
- `SystemExclamation`
- `SystemHand`

如果不需要声音提示，保持关闭即可。

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

## 通用 Webhook

如果你想接自己的推送桥接服务或自动化系统，可以启用通用 Webhook 通道：

```json
{
  "codexTaskNotify.notificationChannels.webhook.enabled": true,
  "codexTaskNotify.notificationChannels.webhook.url": "https://example.com/codex-notify",
  "codexTaskNotify.notificationChannels.webhook.headers": {
    "Authorization": "Bearer YOUR_TOKEN"
  }
}
```

Webhook 载荷示例：

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

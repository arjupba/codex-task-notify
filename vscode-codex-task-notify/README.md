# Codex Task Notify

Get a notification when a Codex task finishes, whether you are working on local Windows, in WSL, or over Remote SSH.

为 Codex 提供任务完成通知，支持本地 Windows、WSL 和 Remote SSH。

## Quick Start

1. Install the extension
2. Reload VS Code if prompted
3. Run `Codex Task Notify: Test Notification`
4. Run Codex as usual

## 快速开始

1. 安装扩展
2. 如果 VS Code 提示重载，按提示重载
3. 运行 `Codex Task Notify: Test Notification`
4. 像平时一样运行 Codex

## What You Get

- Shows a Windows desktop notification when available
- Falls back to a VS Code notification when desktop notification is unavailable
- Works with local Windows workspaces, Remote WSL, and Remote SSH
- Supports optional cost estimation, ntfy push, sound, and webhooks

## 你会得到什么

- 在可用时优先显示 Windows 桌面通知
- 当桌面通知不可用时，回退为 VS Code 内通知
- 支持本地 Windows 工作区、Remote WSL 和 Remote SSH
- 支持可选的成本估算、ntfy 推送、声音提醒和 Webhook

## Useful Commands

- `Codex Task Notify: Test Notification`
- `Codex Task Notify: Show Diagnostics`
- `Codex Task Notify: Show Recent History`
- `Codex Task Notify: Show Recent Costs`

## 常用命令

- `Codex Task Notify: Test Notification`
- `Codex Task Notify: Show Diagnostics`
- `Codex Task Notify: Show Recent History`
- `Codex Task Notify: Show Recent Costs`

## When You May Need Settings

- If your Codex session directory is not in the default location, set `codexTaskNotify.sessionsRoot`
- If you want notification clicks to bring VS Code to the front, keep `codexTaskNotify.windowsNotification.openVsCodeOnClick` enabled
- If you use custom pricing, add `codexTaskNotify.costEstimation.customModelPricing`

Default locations:

- Local Windows: `%USERPROFILE%\\.codex\\sessions`
- Remote SSH or WSL: `~/.codex/sessions`

Minimal example:

```json
{
  "codexTaskNotify.sessionsRoot": "",
  "codexTaskNotify.windowsNotification.openVsCodeOnClick": true
}
```

Cost estimation example:

```json
{
  "codexTaskNotify.costEstimation.enabled": true,
  "codexTaskNotify.costEstimation.customModelPricing": {
    "gpt-5.4": {
      "inputPerMillionUsd": 2.5,
      "cachedInputPerMillionUsd": 0.25,
      "outputPerMillionUsd": 15
    }
  }
}
```

## 什么时候你可能需要改设置

- 如果你的 Codex 会话目录不在默认位置，设置 `codexTaskNotify.sessionsRoot`
- 如果你希望点击通知时把 VS Code 切回前台，保持 `codexTaskNotify.windowsNotification.openVsCodeOnClick` 为启用状态
- 如果你使用自定义价格，设置 `codexTaskNotify.costEstimation.customModelPricing`

默认位置：

- 本地 Windows：`%USERPROFILE%\\.codex\\sessions`
- Remote SSH 或 WSL：`~/.codex/sessions`

最小示例：

```json
{
  "codexTaskNotify.sessionsRoot": "",
  "codexTaskNotify.windowsNotification.openVsCodeOnClick": true
}
```

成本估算示例：

```json
{
  "codexTaskNotify.costEstimation.enabled": true,
  "codexTaskNotify.costEstimation.customModelPricing": {
    "gpt-5.4": {
      "inputPerMillionUsd": 2.5,
      "cachedInputPerMillionUsd": 0.25,
      "outputPerMillionUsd": 15
    }
  }
}
```

## Optional Channels

### ntfy

```json
{
  "codexTaskNotify.notificationChannels.ntfy.enabled": true,
  "codexTaskNotify.notificationChannels.ntfy.topicUrl": "https://ntfy.sh/your-topic-name",
  "codexTaskNotify.notificationChannels.ntfy.priority": 3,
  "codexTaskNotify.notificationChannels.ntfy.tags": "computer"
}
```

If your topic is private or protected, also set:

```json
{
  "codexTaskNotify.notificationChannels.ntfy.accessToken": "YOUR_NTFY_ACCESS_TOKEN"
}
```

### Sound

```json
{
  "codexTaskNotify.notificationChannels.sound.enabled": true,
  "codexTaskNotify.notificationChannels.sound.windowsSound": "Notification.Default"
}
```

### Webhook

```json
{
  "codexTaskNotify.notificationChannels.webhook.enabled": true,
  "codexTaskNotify.notificationChannels.webhook.url": "https://example.com/your-notify-endpoint"
}
```

## 可选通知通道

### ntfy

```json
{
  "codexTaskNotify.notificationChannels.ntfy.enabled": true,
  "codexTaskNotify.notificationChannels.ntfy.topicUrl": "https://ntfy.sh/your-topic-name",
  "codexTaskNotify.notificationChannels.ntfy.priority": 3,
  "codexTaskNotify.notificationChannels.ntfy.tags": "computer"
}
```

如果 topic 是私有或受保护的，再额外设置：

```json
{
  "codexTaskNotify.notificationChannels.ntfy.accessToken": "YOUR_NTFY_ACCESS_TOKEN"
}
```

### 声音通知

```json
{
  "codexTaskNotify.notificationChannels.sound.enabled": true,
  "codexTaskNotify.notificationChannels.sound.windowsSound": "Notification.Default"
}
```

### Webhook

```json
{
  "codexTaskNotify.notificationChannels.webhook.enabled": true,
  "codexTaskNotify.notificationChannels.webhook.url": "https://example.com/your-notify-endpoint"
}
```

## Troubleshooting

- Run `Codex Task Notify: Test Notification` to verify the local notification path
- Run `Codex Task Notify: Show Diagnostics` if notifications do not appear
- If your Codex home is custom or remote detection is wrong, set `codexTaskNotify.sessionsRoot`

If you need script-based automation, the extension also provides:

- `Codex Task Notify: Install Local CLI`
- `Codex Task Notify: Install Workspace CLI`

## 排查问题

- 运行 `Codex Task Notify: Test Notification`，确认本地通知链路可用
- 如果通知没有出现，运行 `Codex Task Notify: Show Diagnostics`
- 如果你的 Codex 主目录是自定义位置，或者远程路径识别不对，手动设置 `codexTaskNotify.sessionsRoot`

如果你确实需要脚本化自动化，扩展也提供：

- `Codex Task Notify: Install Local CLI`
- `Codex Task Notify: Install Workspace CLI`

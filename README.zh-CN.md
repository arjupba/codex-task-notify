# Codex Task Notify

[English](./README.md) | [简体中文](./README.zh-CN.md)

为 Codex 提供跨 Windows、WSL 与 Remote SSH 的本地任务完成通知。

## 核心能力

- 自动监听 Codex 会话并在任务完成时通知
- 在可用时显示本地 Windows 桌面通知
- 支持本地 Windows 工作区、VS Code Remote WSL 与 Remote SSH / 远程 Linux 服务器
- 支持成本估算，以及可选的 ntfy、声音提醒与 Webhook 通道
- 仍然提供自动化脚本入口，但 CLI 不再作为主要用户路径

## 安装

推荐方式：

1. 安装 VS Code 扩展 `rmargin.codex-task-notify`
2. 如果 VS Code 提示重载，按提示重载
3. 运行一次 `Codex Task Notify: Test Notification`，确认本地通知路径可用

Marketplace 命令行安装：

```bash
code --install-extension rmargin.codex-task-notify
```

也可以直接从仓库侧载：

Windows：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1
```

WSL 或 Linux：

```bash
bash ./install.sh
```

## 快速开始

安装完成后，VS Code 命令面板里最常用的是：

- `Codex Task Notify: Test Notification`
- `Codex Task Notify: Show Diagnostics`
- `Codex Task Notify: Show Recent History`
- `Codex Task Notify: Show Recent Costs`

## 推荐使用方式

一般流程：

1. 安装扩展
2. 扩展自动监听 Codex 会话
3. 如果当前环境识别错误，再使用 `Show Diagnostics` 排查

## 配置

### 会话检测

默认会话根目录：

- 本地 Windows：`%USERPROFILE%\\.codex\\sessions`
- Remote SSH 或 WSL：扩展会尝试推断远程 home 目录，再使用 `~/.codex/sessions`

如果自动检测不符合环境，可以在 VS Code 设置中显式指定：

```json
{
  "codexTaskNotify.sessionsRoot": "",
  "codexTaskNotify.sessionPollMs": 1500,
  "codexTaskNotify.sessionLookbackDays": 7
}
```

必要时可以手动指定 `codexTaskNotify.sessionsRoot`，例如：

- Windows：`C:\\path\\to\\your-home\\.codex\\sessions`
- Linux 或 Remote SSH：`/path/to/your-home/.codex/sessions`

### 成本估算

最小自定义定价示例：

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

### Windows 通知点击

如果你希望点击 Windows 桌面通知时把 VS Code 切回前台，可以启用：

```json
{
  "codexTaskNotify.windowsNotification.openVsCodeOnClick": true
}
```

在本地 Windows 上启用后，点击桌面通知会尝试把 VS Code 切回相关工作区。

### 可选通知通道

#### ntfy

```json
{
  "codexTaskNotify.notificationChannels.ntfy.enabled": true,
  "codexTaskNotify.notificationChannels.ntfy.topicUrl": "https://ntfy.sh/your-topic-name",
  "codexTaskNotify.notificationChannels.ntfy.priority": 3,
  "codexTaskNotify.notificationChannels.ntfy.tags": "computer"
}
```

如果 topic 是私有或受保护的：

```json
{
  "codexTaskNotify.notificationChannels.ntfy.accessToken": "YOUR_NTFY_ACCESS_TOKEN"
}
```

#### 声音通知

```json
{
  "codexTaskNotify.notificationChannels.sound.enabled": true,
  "codexTaskNotify.notificationChannels.sound.windowsSound": "Notification.Default"
}
```

#### 通用 Webhook

```json
{
  "codexTaskNotify.notificationChannels.webhook.enabled": true,
  "codexTaskNotify.notificationChannels.webhook.url": "https://example.com/your-notify-endpoint",
  "codexTaskNotify.notificationChannels.webhook.headers": {
    "Authorization": "Bearer YOUR_TOKEN"
  }
}
```

Webhook 载荷示例：

```json
{
  "title": "Codex task complete",
  "message": "Estimated cost | task summary",
  "level": "info",
  "timestamp": "2026-01-01T00:00:00.000Z",
  "source": "codex-session",
  "sessionId": "session-id",
  "turnId": "turn-id",
  "projectName": "project-name",
  "cwd": "/path/to/workspace",
  "sessionFile": "file:///path/to/session.jsonl",
  "model": "gpt-5.4",
  "tokenUsage": {},
  "costEstimate": {}
}
```

### 高级自动化

项目仍然提供辅助脚本，但它们更适合自动化与集成场景，而不是普通用户的日常安装流程。

- `Codex Task Notify: Install Local CLI` 会把脚本导出到当前用户目录
- `Codex Task Notify: Install Workspace CLI` 会把脚本导出到当前工作区
- 当 Codex、任务运行器或 shell 脚本需要固定入口时，这些命令会比较有用
- 详细的 CLI 与 bridge 行为说明见 [notify/README.md](./notify/README.md)

## 仓库

- GitHub：https://github.com/Gtyro/codex-task-notify
- 文档索引：[docs/README.md](./docs/README.md)

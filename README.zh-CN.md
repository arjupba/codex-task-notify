# Codex Task Notify

[English](./README.md) | [简体中文](./README.zh-CN.md)

为 Codex 提供本地任务完成通知，支持以下场景：

- 本地 Windows 工作区
- VS Code Remote WSL
- VS Code Remote SSH / 远程 Linux 服务器

## 仓库结构

- `docs/`：文档资源与设计说明
- `notify/`：任务触发脚本与通知桥接脚本
- `vscode-codex-task-notify/`：本地 VS Code 扩展
- `install.ps1` 和 `install.sh`：将扩展安装到本机 VS Code

## 默认行为

- 本地 / VS Code 会话监听：读取 `.codex/sessions` 下真实的 Codex 会话文件，并在出现 `task_complete` 时通知
- Windows：显示系统桌面通知
- WSL：通过 `powershell.exe` 将通知转发到 Windows
- Remote Linux 自动模式：当 VS Code 扩展能够直接看到远程文件系统时，直接监听 Codex 会话文件
- Remote Linux bridge 模式：向 `tmp/codex-task-notify/task.json` 写入工作区事件，再由本地 VS Code 扩展展示通知
- Token 用量来自真实会话数据；成本估算为可选项，按你自己的价格配置计算

## 安装

推荐方式：从 Marketplace 安装

1. 安装 VS Code 扩展 `rmargin.codex-task-notify`
2. 运行 `Codex Task Notify: Install Local CLI` 或 `Codex Task Notify: Install Workspace CLI`
3. 如果 VS Code 提示重载，按提示重载一次

开发或 Marketplace 发布前，也可以直接从仓库安装：

Windows：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1
```

WSL 或 Linux：

```bash
bash ./install.sh
```

安装完成后，建议手动重载一次 VS Code。

## 手动触发通知

Windows：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\notify\codex-notify.ps1 -Title "Codex complete" -Message "Task completed"
```

WSL 或 Linux：

```bash
bash ./notify/codex-notify.sh -Title "Codex complete" -Message "Task completed"
```

## 自动会话监听

VS Code 扩展也会直接监听真实的 Codex 会话文件，并在会话中出现 `task_complete` 时触发通知。

默认会话根目录：

- 本地 Windows：`%USERPROFILE%\\.codex\\sessions`
- Remote SSH / WSL：自动检测远程 home 目录，并使用 `~/.codex/sessions`

如果你的环境里自动检测结果不对，可以在 VS Code 设置里显式指定：

```json
{
  "codexTaskNotify.sessionsRoot": "",
  "codexTaskNotify.sessionPollMs": 1500,
  "codexTaskNotify.sessionLookbackDays": 7,
  "codexTaskNotify.costEstimation.enabled": false,
  "codexTaskNotify.costEstimation.useBuiltInOpenAIPricing": false,
  "codexTaskNotify.costEstimation.includeInNotifications": false,
  "codexTaskNotify.costEstimation.outputCurrency": "USD",
  "codexTaskNotify.costEstimation.exchangeRate": 1,
  "codexTaskNotify.costEstimation.customModelPricing": {}
}
```

`customModelPricing` 示例：

```json
{
  "codexTaskNotify.costEstimation.enabled": true,
  "codexTaskNotify.costEstimation.useBuiltInOpenAIPricing": false,
  "codexTaskNotify.costEstimation.includeInNotifications": false,
  "codexTaskNotify.costEstimation.outputCurrency": "USD",
  "codexTaskNotify.costEstimation.exchangeRate": 1,
  "codexTaskNotify.costEstimation.customModelPricing": {
    "gpt-5.4": {
      "inputPerMillionUsd": 2.5,
      "cachedInputPerMillionUsd": 0.25,
      "outputPerMillionUsd": 15
    },
    "gpt-5.4-mini": {
      "inputPerMillionUsd": 0.75,
      "cachedInputPerMillionUsd": 0.075,
      "outputPerMillionUsd": 4.5
    },
    "gpt-5.5": {
      "inputPerMillionUsd": 5,
      "cachedInputPerMillionUsd": 0.5,
      "outputPerMillionUsd": 30
    }
  }
}
```

如果你的 Codex 会话主要使用 `gpt-5.4`，推荐的最小配置如下：

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

人民币显示示例：

```json
{
  "codexTaskNotify.costEstimation.enabled": true,
  "codexTaskNotify.costEstimation.outputCurrency": "CNY",
  "codexTaskNotify.costEstimation.exchangeRate": 7.2,
  "codexTaskNotify.costEstimation.customModelPricing": {
    "gpt-5.4": {
      "inputPerMillionUsd": 2.5,
      "cachedInputPerMillionUsd": 0.25,
      "outputPerMillionUsd": 15
    }
  }
}
```

Windows 通知点击行为：

```json
{
  "codexTaskNotify.windowsNotification.openVsCodeOnClick": true
}
```

在本地 Windows 上启用后，点击桌面通知会尝试把 VS Code 切回相关工作区。对于 Remote SSH / WSL 会话，这个行为属于尽力而为，某些情况下只能把 VS Code 前置，而不一定精确切到目标工作区。

价格字段说明：

- `inputPerMillionUsd`：未命中缓存的输入 token 单价
- `cachedInputPerMillionUsd`：命中缓存的输入 token 单价
- `outputPerMillionUsd`：输出 token 单价
- 模型名必须与会话数据中的模型名一致，例如 `gpt-5.4`

必要时可以手动指定 `codexTaskNotify.sessionsRoot`，例如：

- Windows：`C:\\Users\\you\\.codex\\sessions`
- Linux / Remote SSH：`/home/you/.codex/sessions`

## 常用命令

在 VS Code 命令面板中可以使用这些命令：

- `Codex Task Notify: Test Notification`
- `Codex Task Notify: Show Diagnostics`
- `Codex Task Notify: Show Debug Snapshot`
- `Codex Task Notify: Show Recent History`
- `Codex Task Notify: Show Recent Events`
- `Codex Task Notify: Show Recent Costs`
- `Codex Task Notify: Install Local CLI`
- `Codex Task Notify: Install Workspace CLI`

其中：

- `Install Local CLI` 会把内置脚本导出到当前用户的本地目录
- `Install Workspace CLI` 会把内置脚本导出到当前工作区，尤其适合 WSL 和 Remote SSH

## Android 推送：ntfy

如果你希望把完成通知推送到 Android 手机，推荐使用 `ntfy`。它的接入方式简单，只需要向一个 HTTP 地址发请求。

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

## 新机器快速开始

Marketplace 安装方式：

```bash
code --install-extension rmargin.codex-task-notify
```

安装后，在 VS Code 命令面板里运行其中一个：

- `Codex Task Notify: Show Diagnostics`
- `Codex Task Notify: Show Recent History`
- `Codex Task Notify: Install Local CLI`
- `Codex Task Notify: Install Workspace CLI`

如果你走仓库安装方式：

Windows：

```powershell
git clone <repo-url> && cd codex-task-notify && powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1
```

WSL 或 Linux：

```bash
git clone <repo-url> && cd codex-task-notify && bash ./install.sh
```

## 发布

这个仓库已经可以用于本地侧载，也可以打包发布到 VS Code Marketplace。当前扩展发布者是 `rmargin`。如果将来要改成别的 publisher，请修改 `vscode-codex-task-notify/package.json`，并按照 [PUBLISHING.md](./PUBLISHING.md) 中的步骤发布。

## 仓库

- GitHub：https://github.com/Gtyro/codex-task-notify
- 设计说明：[docs/windows-notification-click.md](./docs/windows-notification-click.md)

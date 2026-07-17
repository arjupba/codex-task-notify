# Codex Task Notify

[English](./README.md) | [简体中文](./README.zh-CN.md)

Local task-completion notifications for Codex across Windows, WSL, and Remote SSH.

## Core Features

- Automatically watches Codex sessions and notifies when tasks finish
- Shows local Windows desktop notifications when possible
- Supports local Windows workspaces, VS Code Remote WSL, and Remote SSH / remote Linux servers
- Can estimate cost and deliver optional ntfy, sound, and webhook notifications
- Can optionally export helper scripts for automation, without making CLI the primary user flow

## Install

Recommended:

1. Install the VS Code extension `rmargin.codex-task-notify`
2. Reload VS Code if prompted
3. Run `Codex Task Notify: Test Notification` once to verify the local notification path

Marketplace command line:

```bash
code --install-extension rmargin.codex-task-notify
```

Repo-based side-load:

Windows:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1
```

WSL or Linux:

```bash
bash ./install.sh
```

## Quick Setup

After installation, these command-palette entries are the most useful:

- `Codex Task Notify: Test Notification`
- `Codex Task Notify: Show Diagnostics`
- `Codex Task Notify: Show Recent History`
- `Codex Task Notify: Show Recent Costs`

## Recommended Use

For most users, the normal flow is:

1. Install the extension
2. Let the extension monitor Codex sessions automatically
3. Use `Show Diagnostics` if session detection is wrong in your environment

## Configuration

### Session Detection

Default session root behavior:

- Local Windows: `%USERPROFILE%\\.codex\\sessions`
- Remote SSH or WSL: the extension tries to infer the remote home directory and then uses `~/.codex/sessions`

If auto-detection is wrong in your environment, set these VS Code settings:

```json
{
  "codexTaskNotify.sessionsRoot": "",
  "codexTaskNotify.sessionPollMs": 1500,
  "codexTaskNotify.sessionLookbackDays": 7
}
```

Set `codexTaskNotify.sessionsRoot` explicitly when needed, for example:

- Windows: `C:\\path\\to\\your-home\\.codex\\sessions`
- Linux or Remote SSH: `/path/to/your-home/.codex/sessions`

### Cost Estimation

Minimal custom pricing example:

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

### Windows Notification Clicks

You can let a Windows desktop notification bring VS Code back to the front:

```json
{
  "codexTaskNotify.windowsNotification.openVsCodeOnClick": true
}
```

When enabled on local Windows, clicking the desktop notification will try to bring VS Code back to the relevant workspace.

### Optional Notification Channels

#### ntfy

```json
{
  "codexTaskNotify.notificationChannels.ntfy.enabled": true,
  "codexTaskNotify.notificationChannels.ntfy.topicUrl": "https://ntfy.sh/your-topic-name",
  "codexTaskNotify.notificationChannels.ntfy.priority": 3,
  "codexTaskNotify.notificationChannels.ntfy.tags": "computer"
}
```

If the topic is private or protected:

```json
{
  "codexTaskNotify.notificationChannels.ntfy.accessToken": "YOUR_NTFY_ACCESS_TOKEN"
}
```

#### Sound

```json
{
  "codexTaskNotify.notificationChannels.sound.enabled": true,
  "codexTaskNotify.notificationChannels.sound.windowsSound": "Notification.Default"
}
```

#### Generic Webhook

```json
{
  "codexTaskNotify.notificationChannels.webhook.enabled": true,
  "codexTaskNotify.notificationChannels.webhook.url": "https://example.com/your-notify-endpoint",
  "codexTaskNotify.notificationChannels.webhook.headers": {
    "Authorization": "Bearer YOUR_TOKEN"
  }
}
```

Webhook payload example:

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

### Advanced Automation

The project still ships helper scripts, but they are intended for automation and integration rather than everyday end-user setup.

- `Codex Task Notify: Install Local CLI` exports scripts to a per-user directory
- `Codex Task Notify: Install Workspace CLI` exports scripts into the current workspace
- This is useful when Codex, a task runner, or a shell script needs a stable entry point
- Detailed CLI and bridge behavior lives in [notify/README.md](./notify/README.md)

## Repository

- GitHub: https://github.com/Gtyro/codex-task-notify
- Docs: [docs/README.md](./docs/README.md)

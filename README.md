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
- Token usage is read from real session data; cost estimation is optional and based on your own pricing settings

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
  "codexTaskNotify.sessionLookbackDays": 7,
  "codexTaskNotify.costEstimation.enabled": false,
  "codexTaskNotify.costEstimation.useBuiltInOpenAIPricing": false,
  "codexTaskNotify.costEstimation.includeInNotifications": false,
  "codexTaskNotify.costEstimation.outputCurrency": "USD",
  "codexTaskNotify.costEstimation.exchangeRate": 1,
  "codexTaskNotify.costEstimation.customModelPricing": {}
}
```

`customModelPricing` example:

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

Recommended minimal setup if your Codex session mostly uses `gpt-5.4`:

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

Example with RMB display:

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

Windows notification click behavior:

```json
{
  "codexTaskNotify.windowsNotification.openVsCodeOnClick": true
}
```

When enabled on local Windows, clicking the desktop notification will try to
bring VS Code back to the relevant workspace. For Remote SSH / WSL sessions,
this is a best-effort fallback and may only bring VS Code to the foreground.

Notes:

- `inputPerMillionUsd`: uncached input token price
- `cachedInputPerMillionUsd`: cached input token price
- `outputPerMillionUsd`: output token price
- model names must match the session data, for example `gpt-5.4`

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
- Design note: [docs/windows-notification-click.md](./docs/windows-notification-click.md)

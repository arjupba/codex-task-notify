# Codex Task Notify

This VS Code extension runs on the local UI side and shows notifications when a
workspace file matching `tmp/codex-task-notify/*.json` is created or updated.

It is designed for local folders, WSL, and Remote SSH workspaces where the task
itself may run remotely but the notification should appear in the local VS Code
window.

On Windows, the extension prefers a local system notification so the alert can
still appear when VS Code is not the focused window. On other local operating
systems, it falls back to an in-app VS Code notification.

## Included commands

- `Codex Task Notify: Test Notification`
- `Codex Task Notify: Install Local CLI`
- `Codex Task Notify: Install Workspace CLI`

The install commands export the packaged `codex-notify` scripts so you do not
need to clone the repo just to get the CLI onto a new machine or into a remote
workspace.

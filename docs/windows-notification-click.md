# Windows Notification Click Behavior

## Current approach

The current implementation keeps using the existing PowerShell + WinForms
notification helper based on `System.Windows.Forms.NotifyIcon`.

When `codexTaskNotify.windowsNotification.openVsCodeOnClick` is enabled,
clicking a local Windows notification will try to:

1. open VS Code with `code --reuse-window <workspacePath>` when a local
   Windows workspace path is available
2. otherwise fall back to launching `code` with no workspace argument

This is intentionally a small, low-risk improvement over the existing helper.

## Why this is not the "full" Windows solution

`NotifyIcon.ShowBalloonTip()` is an older notification mechanism. It can react
to click events while the helper process is alive, but it does not provide the
same activation model as modern Windows toast/app notifications.

Known limits of the current approach:

- It cannot reliably target a specific existing VS Code window.
- It cannot carry rich action buttons.
- It is best-effort for Remote SSH / WSL workspaces because those are not plain
  local Windows folder paths.
- It depends on the helper PowerShell process staying alive during the balloon.

## Observed constraints from field testing

Recent real-world testing on July 16, 2026 exposed a few concrete constraints
that are worth keeping documented:

- In WSL and Remote SSH flows, `workspacePath` is often empty on the Windows
  helper side. The session payload usually carries a Linux path such as
  `/home/...`, not a local Windows folder path that can be passed to
  `code --reuse-window <workspacePath>`.
- Because `workspacePath` is often unavailable for remote sessions, the current
  click-through path falls back to matching visible VS Code window titles using
  a lightweight hint such as the project name.
- VS Code can expose multiple top-level windows from the same `Code.exe`
  process. Looking only at `Get-Process Code` plus `MainWindowTitle` is not
  enough to distinguish those windows reliably. The implementation now
  enumerates top-level windows instead, but the matching is still title-based.
- Title-based matching can still be ambiguous when a window is showing
  `Welcome`, an untitled file, or another editor title that does not include
  the target workspace hint. In that situation, the helper can only make a
  best-effort choice.

The future-path discussion around a native Windows activation chain is
captured separately as an ADR:

- [ADR 0001: Native Windows Notification Activation as a Future Path](./adr/0001-native-windows-notification-activation.md)

## More canonical future approach

If we later want a more robust Windows-native implementation, the better path
is to switch from WinForms balloon tips to modern Windows toast/app
notifications with activation support.

That future version would likely include:

- a real toast notification instead of `NotifyIcon.ShowBalloonTip()`
- explicit activation arguments
- either a protocol handler or an app/COM activation bridge
- optional mapping from notification payload to VS Code workspace or command

This would support cleaner click handling and richer actions, but it is more
complex than the current need.

## Why we are not doing that now

For this project, the immediate goal is simple:

- show reliable task-finished notifications
- allow one-click return to VS Code on Windows

The current small implementation is enough for that goal and avoids a much
heavier Windows integration layer.

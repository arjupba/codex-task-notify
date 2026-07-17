# ADR 0001: Native Windows Notification Activation as a Future Path

- Status: Proposed
- Date: 2026-07-16
- Decision owners: project maintainers

## Context

The current Windows click-through implementation uses a lightweight
PowerShell + WinForms helper built around `System.Windows.Forms.NotifyIcon`.

That approach keeps installation simple:

- the extension can be distributed as a normal VS Code Marketplace extension
- users do not need to install a separate desktop application
- the click-through logic ships as bundled scripts instead of a native
  Windows component

Field testing through July 2026 showed that the current approach is useful but
not fully stable in all environments, especially when:

- the notification is shown for WSL or Remote SSH workspaces
- the Windows-side helper does not have a local Windows workspace path
- the correct VS Code window must be distinguished from multiple open windows
- Windows foreground activation rules prevent a background helper from
  reliably forcing a specific window to the front

The project therefore needs a documented future direction in case the current
best-effort approach cannot be improved enough.

## Decision

We are not adopting a native Windows notification activation chain now.

We are recording it as a future option that can be revisited if the current
extension-only path remains operationally unstable.

The current product priority remains:

- keep Marketplace installation simple
- avoid requiring a separate user-visible desktop app
- prefer incremental hardening of the existing extension path first

## What "native Windows activation" means here

In this project, a native Windows activation chain would usually mean:

- using modern Windows toast/app notifications instead of
  `NotifyIcon.ShowBalloonTip()`
- attaching explicit activation arguments to the notification
- registering a Windows-recognized activation entry point
- handing the activation to a local helper/broker component
- using that helper to map the click back to the intended VS Code window or
  workspace

This does not necessarily mean a full standalone GUI application.

It more likely means an "extension + local headless helper" architecture:

- VS Code extension remains the user-facing install surface
- a local Windows component acts as the system-level activation target
- that helper may run hidden, on demand, or in a very small background role

## Why this is not the default path now

The main tradeoff is product simplicity versus activation reliability.

Benefits of the native path:

- notification click handling would no longer depend on a short-lived balloon
  helper process staying alive
- modern notification activation is a better fit for Windows than WinForms
  balloon callbacks
- activation arguments can carry a stronger identity token than a title-based
  window guess
- richer actions become possible later

Costs of the native path:

- the implementation becomes materially heavier than a pure extension
- the Windows integration surface becomes larger and more brittle
- testing and support burden increases across Windows versions and VS Code
  distributions
- installation is likely no longer "install extension and forget about it"

## Likely building blocks

If this path is revisited, the design will likely need some combination of:

- protocol activation, for example a custom URI such as
  `codex-task-notify://open?...`
- a Windows application identity such as an `AppUserModelID`
- a Start Menu shortcut or another registered shell entry point that Windows
  can associate with notifications
- a small local helper or broker executable
- an activation token store that maps a notification click back to:
  a workspace, a VS Code window, or a VS Code command

## What the helper / broker would do

The local helper would act as a system-facing bridge.

Its responsibilities would likely include:

- receive notification activation from Windows
- parse activation arguments or a token
- resolve that token to the original VS Code context
- find the intended VS Code window, workspace, or command target
- request foreground activation or otherwise reopen/focus the target
- return useful diagnostics if activation fails

This helper would probably be headless:

- no main window
- no direct user workflow
- only a local integration component

## Main engineering questions to answer first

Before taking this path, the project should answer these questions clearly:

- Can the helper be installed and updated entirely through the VS Code
  extension experience, or would an extra bootstrap step be required?
- Is a protocol handler sufficient, or is a richer COM/app-notification
  activation model needed?
- How will activation tokens be stored and expired safely?
- How will the helper identify the right VS Code window when multiple windows
  or multiple channels are open?
- How will this work for local Windows workspaces versus WSL and Remote SSH?
- What happens when Windows refuses foreground activation even after the helper
  is invoked correctly?
- How much native code, packaging, and code-signing overhead is acceptable for
  this project?

## Distribution and installation concerns

This is the main product risk for the native path.

The extension could still be listed and installed from the VS Code Marketplace,
but the total user experience would likely become one of these:

- install the extension, then let first-run setup register local activation
  components automatically
- install the extension, then run one explicit setup command once
- install the extension, but accept that some Windows capabilities require a
  bundled local helper to be registered on the machine

That is still Marketplace distribution, but it is no longer the same as a
pure extension-only workflow.

## Triggers for revisiting this ADR

This ADR should be reconsidered if one or more of these become true:

- the current click-through path remains unreliable after incremental fixes
- WSL / Remote SSH click-through remains a frequent support issue
- users need stronger guarantees about returning to the exact originating
  VS Code window
- richer Windows notification actions become a product requirement

## Current recommendation

Until those triggers are met, the recommended strategy is:

- keep the existing extension-only implementation
- continue improving diagnostics and window matching
- continue documenting real-world failure modes
- defer the native activation architecture unless reliability data justifies
  the extra complexity

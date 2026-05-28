# Publishing

This project is ready for Marketplace packaging and public release.

Before publishing to the VS Code Marketplace:

1. Confirm the Marketplace publisher exists and matches `rmargin`.
2. Create an Azure DevOps Personal Access Token with `Marketplace > Manage`.
3. Install `vsce`.
4. Run packaging or publishing commands from `vscode-codex-task-notify/`.

## Typical commands

```bash
npm install -g @vscode/vsce
cd vscode-codex-task-notify
vsce login rmargin
vsce package
vsce publish
```

If you want to test the exact artifact before public release:

```bash
cd vscode-codex-task-notify
vsce package
code --install-extension rmargin.codex-task-notify-0.0.1.vsix
```

After users install the extension from Marketplace, they can export the bundled
CLI scripts by running one of these VS Code commands:

- `Codex Task Notify: Install Local CLI`
- `Codex Task Notify: Install Workspace CLI`

## Official docs

- https://code.visualstudio.com/api/working-with-extensions/publishing-extension
- https://code.visualstudio.com/api/advanced-topics/remote-extensions
- https://learn.microsoft.com/en-us/azure/devops/organizations/accounts/use-personal-access-tokens-to-authenticate

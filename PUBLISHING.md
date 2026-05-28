# Publishing

This project currently works as a local side-loaded VS Code extension.

Before publishing to the VS Code Marketplace:

1. Create your own Marketplace publisher.
2. Confirm the `publisher` value in `vscode-codex-task-notify/package.json` matches your Marketplace publisher, currently `rmargin`.
3. Optionally update the extension `name`, `description`, `repository`, and `license`.
4. Install `vsce`.
5. Run packaging or publishing commands from `vscode-codex-task-notify/`.

## Typical commands

```bash
npm install -g @vscode/vsce
cd vscode-codex-task-notify
vsce package
vsce publish
```

After users install the extension from Marketplace, they can export the bundled
CLI scripts by running one of these VS Code commands:

- `Codex Task Notify: Install Local CLI`
- `Codex Task Notify: Install Workspace CLI`

## Official docs

- https://code.visualstudio.com/api/working-with-extensions/publishing-extension
- https://code.visualstudio.com/api/advanced-topics/remote-extensions

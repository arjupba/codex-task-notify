const childProcess = require("child_process");
const path = require("path");
const vscode = require("vscode");
const {
  appendWindowsNotificationDiagnostic,
  getWindowsNotificationDiagnosticsLogPath
} = require("./windowsNotificationDiagnostics");

function tryShowLocalWindowsNotification(context, payload) {
  if (process.platform !== "win32") {
    return Promise.resolve(false);
  }

  const scriptPath = path.join(context.extensionPath, "scripts", "notify.ps1");
  const notificationSettings = getWindowsNotificationSettings();
  const levelMap = {
    info: "Info",
    warning: "Warning",
    warn: "Warning",
    error: "Error"
  };
  const notificationId =
    typeof payload.id === "string" && payload.id.trim()
      ? payload.id.trim()
      : `notification-${Date.now()}`;
  const workspacePath = notificationSettings.openVsCodeOnClick
    ? resolveWindowsNotificationWorkspacePath(payload)
    : "";
  const projectHint =
    typeof payload.projectName === "string" && payload.projectName.trim()
      ? payload.projectName.trim()
      : "";
  const diagnosticsLogPath = getWindowsNotificationDiagnosticsLogPath(context);
  const commandArguments = [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    scriptPath,
    "-Title",
    payload.title,
    "-Message",
    payload.message,
    "-Level",
    levelMap[payload.level] || "Info",
    "-TimeoutSeconds",
    "5"
  ];

  if (notificationId) {
    commandArguments.push("-NotificationId", notificationId);
  }

  if (diagnosticsLogPath) {
    commandArguments.push("-DiagnosticLogPath", diagnosticsLogPath);
  }

  if (projectHint) {
    commandArguments.push("-ProjectHint", projectHint);
  }

  if (notificationSettings.openVsCodeOnClick) {
    commandArguments.push("-OpenVsCodeOnClick");

    if (workspacePath) {
      commandArguments.push("-WorkspacePath", workspacePath);
    }
  }

  return new Promise((resolve) => {
    void appendWindowsNotificationDiagnostic(context, {
      source: "extension",
      stage: "desktop-notification-requested",
      notificationId,
      details: {
        workspacePath,
        projectHint,
        openVsCodeOnClick: notificationSettings.openVsCodeOnClick,
        title: payload.title,
        level: payload.level || "info"
      }
    });

    let resolved = false;
    const child = childProcess.spawn("powershell.exe", commandArguments, {
      windowsHide: true,
      stdio: "ignore"
    });

    child.once("error", (error) => {
      if (resolved) {
        return;
      }

      resolved = true;
      console.error("[codex-task-notify] Failed to launch local Windows notification", {
        error: error.message
      });
      void appendWindowsNotificationDiagnostic(context, {
        source: "extension",
        stage: "desktop-notification-spawn-error",
        notificationId,
        details: {
          error: error.message,
          workspacePath,
          projectHint
        }
      });
      resolve(false);
    });

    child.once("spawn", () => {
      if (resolved) {
        return;
      }

      resolved = true;
      child.unref();
      void appendWindowsNotificationDiagnostic(context, {
        source: "extension",
        stage: "desktop-notification-helper-spawned",
        notificationId,
        details: {
          helperPid: child.pid,
          workspacePath,
          projectHint
        }
      });
      resolve(true);
    });

    child.once("exit", (code, signal) => {
      if (code === 0 || code === null) {
        return;
      }

      console.error("[codex-task-notify] Local Windows notification helper exited abnormally", {
        code,
        signal
      });
      void appendWindowsNotificationDiagnostic(context, {
        source: "extension",
        stage: "desktop-notification-helper-exit-abnormal",
        notificationId,
        details: {
          code,
          signal,
          helperPid: child.pid,
          workspacePath,
          projectHint
        }
      });
    });
  });
}

function getWindowsNotificationSettings() {
  const config = vscode.workspace.getConfiguration("codexTaskNotify");
  return {
    openVsCodeOnClick: Boolean(config.get("windowsNotification.openVsCodeOnClick", true))
  };
}

function resolveWindowsNotificationWorkspacePath(payload) {
  if (typeof payload.cwd === "string" && /^[A-Za-z]:[\\/]/.test(payload.cwd.trim())) {
    return payload.cwd.trim();
  }

  for (const folder of vscode.workspace.workspaceFolders || []) {
    if (folder.uri.scheme === "file" && folder.uri.fsPath) {
      return folder.uri.fsPath;
    }
  }

  return "";
}

module.exports = {
  tryShowLocalWindowsNotification
};

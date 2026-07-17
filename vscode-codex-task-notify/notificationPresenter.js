const vscode = require("vscode");
const { deliverExternalNotifications } = require("./notificationChannels");
const { claimNotificationDelivery, getNotificationDedupeDir } = require("./notificationDeduper");
const { tryShowLocalWindowsNotification } = require("./windowsNotificationPresenter");
const { appendWindowsNotificationDiagnostic } = require("./windowsNotificationDiagnostics");

async function showNotification(context, payload) {
  const title =
    typeof payload.title === "string" && payload.title.trim()
      ? payload.title.trim()
      : "Codex task complete";
  const message =
    typeof payload.message === "string" && payload.message.trim()
      ? payload.message.trim()
      : "Task completed";
  const text = `${title}: ${message}`;
  const level = String(payload.level || "info").toLowerCase();
  const claimed = await claimNotificationDelivery(context, {
    ...payload,
    title,
    message,
    level
  });

  if (!claimed) {
    return false;
  }

  try {
    const delivery = await deliverExternalNotifications(context, {
      ...payload,
      title,
      message,
      level
    });
    payload.delivery = delivery;
  } catch (error) {
    console.error("[codex-task-notify] Failed to deliver external notifications", error);
  }

  if (
    await tryShowLocalWindowsNotification(context, {
      id: payload.id,
      title,
      message,
      level,
      cwd: payload.cwd,
      projectName: payload.projectName
    })
  ) {
    return true;
  }

  void appendWindowsNotificationDiagnostic(context, {
    source: "extension",
    stage: "desktop-notification-fallback-in-app",
    notificationId: typeof payload.id === "string" ? payload.id : "",
    details: {
      title,
      level
    }
  });

  await showInAppNotification(text, level);
  return true;
}
async function showInAppNotification(text, level) {
  if (level === "error") {
    await vscode.window.showErrorMessage(text);
    return;
  }

  if (level === "warning" || level === "warn") {
    await vscode.window.showWarningMessage(text);
    return;
  }

  await vscode.window.showInformationMessage(text);
}

module.exports = {
  getNotificationDedupeDir,
  showNotification
};

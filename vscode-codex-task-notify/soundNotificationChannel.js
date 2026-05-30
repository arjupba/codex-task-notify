const childProcess = require("child_process");
const path = require("path");

async function playSoundNotification(context, payload, settings) {
  if (!settings.enabled) {
    return createSkippedResult("sound", "disabled");
  }

  if (process.platform !== "win32") {
    return createSkippedResult("sound", "unsupported-platform");
  }

  const scriptPath = path.join(context.extensionPath, "scripts", "sound.ps1");
  const levelMap = {
    info: "Info",
    warning: "Warning",
    warn: "Warning",
    error: "Error"
  };

  return new Promise((resolve) => {
    childProcess.execFile(
      "powershell.exe",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        scriptPath,
        "-Level",
        levelMap[payload.level] || "Info",
        "-Sound",
        settings.windowsSound
      ],
      {
        windowsHide: true,
        timeout: 10000,
        maxBuffer: 1024 * 64
      },
      (error, stdout, stderr) => {
        if (error) {
          resolve(createFailedResult("sound", summarizeProcessError(error, stdout, stderr)));
          return;
        }

        resolve({
          channel: "sound",
          attempted: true,
          delivered: true,
          status: "delivered",
          detail: typeof stdout === "string" ? stdout.trim() : ""
        });
      }
    );
  });
}

function createSkippedResult(channel, reason) {
  return {
    channel,
    attempted: false,
    delivered: false,
    status: "skipped",
    reason,
    error: ""
  };
}

function createFailedResult(channel, error) {
  return {
    channel,
    attempted: true,
    delivered: false,
    status: "failed",
    error,
    detail: error
  };
}

function summarizeProcessError(error, stdout, stderr) {
  const parts = [];
  if (error instanceof Error && error.message) {
    parts.push(error.message);
  }
  if (typeof stdout === "string" && stdout.trim()) {
    parts.push(`stdout=${truncateValue(stdout.trim(), 120)}`);
  }
  if (typeof stderr === "string" && stderr.trim()) {
    parts.push(`stderr=${truncateValue(stderr.trim(), 120)}`);
  }
  return parts.join(" | ") || "process-failed";
}

function truncateValue(value, maxLength) {
  if (typeof value !== "string") {
    return "";
  }

  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}

module.exports = {
  playSoundNotification
};

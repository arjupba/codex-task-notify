const http = require("http");
const https = require("https");
const { URL } = require("url");

const DEFAULT_TIMEOUT_MS = 10000;

function sendHttpRequest(urlValue, options, body) {
  return new Promise((resolve, reject) => {
    let parsedUrl;
    try {
      parsedUrl = new URL(urlValue);
    } catch (error) {
      reject(new Error(`invalid-url: ${formatError(error)}`));
      return;
    }

    const client = selectHttpClient(parsedUrl.protocol);
    if (!client) {
      reject(new Error(`unsupported-protocol: ${parsedUrl.protocol || "(empty)"}`));
      return;
    }

    const bodyBuffer = Buffer.from(typeof body === "string" ? body : "", "utf8");
    const headers = {
      ...options.headers,
      "Content-Length": String(bodyBuffer.byteLength)
    };

    const request = client.request(
      {
        protocol: parsedUrl.protocol,
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || undefined,
        path: `${parsedUrl.pathname}${parsedUrl.search}`,
        method: options.method || "POST",
        headers
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        response.on("end", () => {
          resolve({
            statusCode: Number.isFinite(response.statusCode) ? response.statusCode : 0,
            body: Buffer.concat(chunks).toString("utf8")
          });
        });
      }
    );

    request.setTimeout(options.timeoutMs || DEFAULT_TIMEOUT_MS, () => {
      request.destroy(new Error(`timeout-after-${options.timeoutMs || DEFAULT_TIMEOUT_MS}ms`));
    });
    request.on("error", reject);

    if (bodyBuffer.length) {
      request.write(bodyBuffer);
    }
    request.end();
  });
}

function createHttpResult(channel, response) {
  const delivered = response.statusCode >= 200 && response.statusCode < 300;
  const responseBody = truncateValue(response.body, 300);
  return {
    channel,
    attempted: true,
    delivered,
    status: delivered ? "delivered" : "failed",
    statusCode: response.statusCode,
    statusMessage: typeof response.statusMessage === "string" ? response.statusMessage : "",
    responseBody,
    error: delivered
      ? ""
      : response.statusMessage
        ? `http-${response.statusCode} ${response.statusMessage}`
        : `http-${response.statusCode}`,
    detail: responseBody
  };
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

function selectHttpClient(protocol) {
  if (protocol === "https:") {
    return https;
  }
  if (protocol === "http:") {
    return http;
  }
  return undefined;
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

function formatError(error) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return String(error);
}

module.exports = {
  createFailedResult,
  createHttpResult,
  createSkippedResult,
  sendHttpRequest
};

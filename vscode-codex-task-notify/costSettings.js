const vscode = require("vscode");

function getCostSettings() {
  const config = vscode.workspace.getConfiguration("codexTaskNotify");
  const currencyRaw = String(config.get("costEstimation.outputCurrency", "USD") || "USD").trim();
  const exchangeRateRaw = config.get("costEstimation.exchangeRate", 1);

  return {
    enabled: Boolean(config.get("costEstimation.enabled", false)),
    includeInNotifications: Boolean(config.get("costEstimation.includeInNotifications", false)),
    useBuiltInOpenAIPricing: Boolean(config.get("costEstimation.useBuiltInOpenAIPricing", false)),
    outputCurrency: currencyRaw ? currencyRaw.toUpperCase() : "USD",
    exchangeRate: Number.isFinite(exchangeRateRaw) && exchangeRateRaw > 0 ? exchangeRateRaw : 1,
    customModelPricing: normalizePricingMap(config.get("costEstimation.customModelPricing", {}))
  };
}

function normalizePricingMap(rawValue) {
  if (!rawValue || typeof rawValue !== "object") {
    return {};
  }

  const normalized = {};
  for (const [rawModel, rawPricing] of Object.entries(rawValue)) {
    const model = normalizeModelId(rawModel);
    if (!model || !rawPricing || typeof rawPricing !== "object") {
      continue;
    }

    const pricing = {
      inputPerMillionUsd: finiteOrUndefined(rawPricing.inputPerMillionUsd),
      cachedInputPerMillionUsd: finiteOrUndefined(rawPricing.cachedInputPerMillionUsd),
      outputPerMillionUsd: finiteOrUndefined(rawPricing.outputPerMillionUsd)
    };

    if (
      pricing.inputPerMillionUsd === undefined &&
      pricing.cachedInputPerMillionUsd === undefined &&
      pricing.outputPerMillionUsd === undefined
    ) {
      continue;
    }

    normalized[model] = pricing;
  }

  return normalized;
}

function normalizeModelId(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim().toLowerCase();
}

function finiteOrUndefined(value) {
  return Number.isFinite(value) ? value : undefined;
}

module.exports = {
  getCostSettings
};

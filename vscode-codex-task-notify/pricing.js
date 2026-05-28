const vscode = require("vscode");

const BUILT_IN_PRICING_VERIFIED_AT = "2026-05-28";
const BUILT_IN_PRICING_SOURCE_URLS = [
  "https://openai.com/api/pricing/",
  "https://developers.openai.com/api/docs/pricing"
];

// Standard short-context API prices, verified from the official pricing pages above.
const BUILT_IN_OPENAI_PRICING = Object.freeze({
  "gpt-5.5": Object.freeze({
    inputPerMillionUsd: 5,
    cachedInputPerMillionUsd: 0.5,
    outputPerMillionUsd: 30
  }),
  "gpt-5.4": Object.freeze({
    inputPerMillionUsd: 2.5,
    cachedInputPerMillionUsd: 0.25,
    outputPerMillionUsd: 15
  }),
  "gpt-5.4-mini": Object.freeze({
    inputPerMillionUsd: 0.75,
    cachedInputPerMillionUsd: 0.075,
    outputPerMillionUsd: 4.5
  }),
  "gpt-5.4-nano": Object.freeze({
    inputPerMillionUsd: 0.2,
    cachedInputPerMillionUsd: 0.02,
    outputPerMillionUsd: 1.25
  }),
  "gpt-5.3-codex": Object.freeze({
    inputPerMillionUsd: 1.75,
    cachedInputPerMillionUsd: 0.175,
    outputPerMillionUsd: 14
  }),
  "gpt-5": Object.freeze({
    inputPerMillionUsd: 1.25,
    cachedInputPerMillionUsd: 0.125,
    outputPerMillionUsd: 10
  }),
  "gpt-5-mini": Object.freeze({
    inputPerMillionUsd: 0.25,
    cachedInputPerMillionUsd: 0.025,
    outputPerMillionUsd: 2
  }),
  "gpt-5-nano": Object.freeze({
    inputPerMillionUsd: 0.05,
    cachedInputPerMillionUsd: 0.005,
    outputPerMillionUsd: 0.4
  })
});

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

function getBuiltInPricingReference() {
  return {
    verifiedAt: BUILT_IN_PRICING_VERIFIED_AT,
    sourceUrls: [...BUILT_IN_PRICING_SOURCE_URLS],
    models: copyPlainObject(BUILT_IN_OPENAI_PRICING)
  };
}

function estimateCompletionCost(completion, settings = getCostSettings()) {
  if (!settings.enabled) {
    return {
      enabled: false,
      available: false,
      reason: "disabled"
    };
  }

  const model = normalizeModelId(completion?.model);
  if (!model) {
    return {
      enabled: true,
      available: false,
      reason: "missing-model"
    };
  }

  const tokenUsage = completion?.tokenUsage;
  if (!tokenUsage || typeof tokenUsage !== "object") {
    return {
      enabled: true,
      available: false,
      model,
      reason: "missing-token-usage"
    };
  }

  const pricingResolution = resolveModelPricing(model, settings);
  if (!pricingResolution) {
    return {
      enabled: true,
      available: false,
      model,
      reason: "missing-pricing"
    };
  }

  const inputTokens = finiteOrZero(tokenUsage.inputTokens);
  const cachedInputTokens = finiteOrZero(tokenUsage.cachedInputTokens);
  const outputTokens = finiteOrZero(tokenUsage.outputTokens);
  const uncachedInputTokens = Math.max(0, inputTokens - cachedInputTokens);

  const inputPerMillionUsd = pricingResolution.pricing.inputPerMillionUsd;
  const cachedInputPerMillionUsd =
    pricingResolution.pricing.cachedInputPerMillionUsd !== undefined
      ? pricingResolution.pricing.cachedInputPerMillionUsd
      : inputPerMillionUsd;
  const outputPerMillionUsd = pricingResolution.pricing.outputPerMillionUsd;

  const inputUsd = (uncachedInputTokens * inputPerMillionUsd) / 1_000_000;
  const cachedInputUsd = (cachedInputTokens * cachedInputPerMillionUsd) / 1_000_000;
  const outputUsd = (outputTokens * outputPerMillionUsd) / 1_000_000;
  const totalUsd = inputUsd + cachedInputUsd + outputUsd;
  const convertedTotal = totalUsd * settings.exchangeRate;

  return {
    enabled: true,
    available: true,
    model,
    pricingSource: pricingResolution.source,
    verifiedAt:
      pricingResolution.source === "built-in-openai"
        ? BUILT_IN_PRICING_VERIFIED_AT
        : undefined,
    pricing: copyPlainObject(pricingResolution.pricing),
    currency: settings.outputCurrency,
    exchangeRate: settings.exchangeRate,
    usdTotal: totalUsd,
    convertedTotal,
    breakdown: {
      inputTokens,
      uncachedInputTokens,
      cachedInputTokens,
      outputTokens,
      reasoningOutputTokens: finiteOrUndefined(tokenUsage.reasoningOutputTokens),
      inputUsd,
      cachedInputUsd,
      outputUsd
    }
  };
}

function formatCostEstimate(estimate, options = {}) {
  if (!estimate || !estimate.available) {
    return "";
  }

  const includeUsd = Boolean(options.includeUsd);
  const includeSource = Boolean(options.includeSource);
  const parts = [];
  const primaryAmount =
    estimate.currency === "USD"
      ? formatMoney(estimate.usdTotal, "USD")
      : formatMoney(estimate.convertedTotal, estimate.currency);
  parts.push(primaryAmount);

  if (includeUsd && estimate.currency !== "USD") {
    parts.push(`USD ${formatCostAmount(estimate.usdTotal)}`);
  }

  if (estimate.currency !== "USD") {
    parts.push(`rate=${formatDecimal(estimate.exchangeRate)}`);
  }

  if (includeSource) {
    parts.push(`source=${estimate.pricingSource}`);
  }

  return parts.join(" | ");
}

function formatPricingEntry(model, pricing) {
  const parts = [];
  if (pricing.inputPerMillionUsd !== undefined) {
    parts.push(`in=$${formatDecimal(pricing.inputPerMillionUsd)}/1M`);
  }
  if (pricing.cachedInputPerMillionUsd !== undefined) {
    parts.push(`cached=$${formatDecimal(pricing.cachedInputPerMillionUsd)}/1M`);
  }
  if (pricing.outputPerMillionUsd !== undefined) {
    parts.push(`out=$${formatDecimal(pricing.outputPerMillionUsd)}/1M`);
  }
  return `${model}: ${parts.join(", ")}`;
}

function resolveModelPricing(model, settings) {
  const custom = settings.customModelPricing[model];
  if (custom) {
    return {
      source: "custom",
      pricing: custom
    };
  }

  if (!settings.useBuiltInOpenAIPricing) {
    return undefined;
  }

  const builtIn = BUILT_IN_OPENAI_PRICING[model];
  if (!builtIn) {
    return undefined;
  }

  return {
    source: "built-in-openai",
    pricing: builtIn
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

function finiteOrZero(value) {
  return Number.isFinite(value) ? value : 0;
}

function finiteOrUndefined(value) {
  return Number.isFinite(value) ? value : undefined;
}

function formatMoney(amount, currency) {
  const prefix = currency === "USD" ? "$" : `${currency} `;
  return `${prefix}${formatCostAmount(amount)}`;
}

function formatCostAmount(value) {
  if (!Number.isFinite(value)) {
    return "0.000";
  }

  return (Math.round((value + Number.EPSILON) * 1000) / 1000).toFixed(3);
}

function formatDecimal(value) {
  if (!Number.isFinite(value)) {
    return "0";
  }

  if (value >= 100) {
    return value.toFixed(2);
  }
  if (value >= 1) {
    return value.toFixed(4);
  }
  if (value >= 0.01) {
    return value.toFixed(5);
  }
  return value.toFixed(6);
}

function copyPlainObject(value) {
  return JSON.parse(JSON.stringify(value));
}

module.exports = {
  estimateCompletionCost,
  formatCostEstimate,
  formatPricingEntry,
  getBuiltInPricingReference,
  getCostSettings
};

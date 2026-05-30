const {
  BUILT_IN_PRICING_VERIFIED_AT,
  getBuiltInModelPricing,
  getBuiltInPricingReference
} = require("./builtInPricingReference");
const { getCostSettings } = require("./costSettings");

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

  const builtIn = getBuiltInModelPricing(model);
  if (!builtIn) {
    return undefined;
  }

  return {
    source: "built-in-openai",
    pricing: builtIn
  };
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

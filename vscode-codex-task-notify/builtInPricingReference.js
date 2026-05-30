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

function getBuiltInPricingReference() {
  return {
    verifiedAt: BUILT_IN_PRICING_VERIFIED_AT,
    sourceUrls: [...BUILT_IN_PRICING_SOURCE_URLS],
    models: copyPlainObject(BUILT_IN_OPENAI_PRICING)
  };
}

function getBuiltInModelPricing(model) {
  return BUILT_IN_OPENAI_PRICING[model];
}

function copyPlainObject(value) {
  return JSON.parse(JSON.stringify(value));
}

module.exports = {
  BUILT_IN_PRICING_VERIFIED_AT,
  getBuiltInModelPricing,
  getBuiltInPricingReference
};

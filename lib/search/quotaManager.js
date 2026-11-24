import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Multi-provider quota protection, error classification, circuit breaker,
 * monthly credit budget tracking, and secret-safe diagnostics for LuxeIndex.
 */

export const ERROR_TYPES = Object.freeze({
  TIMEOUT: "TIMEOUT",
  RATE_LIMITED: "RATE_LIMITED",
  AUTH_ERROR: "AUTH_ERROR",
  CAPTCHA_BLOCKED: "CAPTCHA_BLOCKED",
  PROVIDER_UNAVAILABLE: "PROVIDER_UNAVAILABLE",
  INVALID_RESPONSE: "INVALID_RESPONSE",
  EMPTY_RESULTS: "EMPTY_RESULTS",
  // Apify-specific: the Actor run was accepted and started, then failed/aborted at
  // execution time. This is a real provider failure, never a valid empty answer.
  ACTOR_RUN_FAILED: "ACTOR_RUN_FAILED",
});

export const PROVIDER_IDS = Object.freeze({
  SERPAPI: "serpapi",
  SERPER: "serper",
  SEARCHAPI: "searchapi",
  APIFY: "apify",
  BRIGHTDATA: "brightdata",
  HASDATA: "hasdata",
});

const DEFAULT_BRIGHTDATA_LEDGER_FILE = path.join(
  os.tmpdir(),
  "luxeindex-brightdata-budget.json"
);

const DEFAULT_APIFY_LEDGER_FILE = path.join(
  os.tmpdir(),
  "luxeindex-apify-budget.json"
);

const APIFY_FREE_ALLOWANCE_USD = 0.25;
const APIFY_DEFAULT_BUDGET_USD = 0.2;
const APIFY_SAFETY_MARGIN_USD = 0.05;
const APIFY_COST_PER_RESULT_USD = 0.0024;
const APIFY_MIN_RUN_COST_USD = 0.003;

const PROVIDER_ENV_CONFIG = {
  [PROVIDER_IDS.SERPAPI]: {
    enabledKey: "SERPAPI_ENABLED",
    defaultEnabled: true,
    apiKeyEnv: "SERPAPI_KEY",
    requiredEnvKeys: ["SERPAPI_KEY"],
    maxCallsKey: "SERPAPI_MAX_CALLS",
    defaultMaxCalls: 500,
    cooldownMs: 120_000,
    rateLimitCooldownMs: 300_000,
    authCooldownMs: 900_000,
    captchaCooldownMs: 900_000,
    captchaFailureThreshold: 2,
    failureThreshold: 3,
  },
  [PROVIDER_IDS.SERPER]: {
    enabledKey: "SERPER_ENABLED",
    defaultEnabled: true,
    apiKeyEnv: "SERPER_API_KEY",
    requiredEnvKeys: ["SERPER_API_KEY"],
    maxCallsKey: "SERPER_MAX_CALLS",
    defaultMaxCalls: 1000,
    cooldownMs: 120_000,
    rateLimitCooldownMs: 300_000,
    authCooldownMs: 900_000,
    captchaCooldownMs: 900_000,
    captchaFailureThreshold: 2,
    failureThreshold: 3,
  },
  [PROVIDER_IDS.SEARCHAPI]: {
    enabledKey: "SEARCHAPI_ENABLED",
    defaultEnabled: true,
    apiKeyEnv: "SEARCHAPI_API_KEY",
    requiredEnvKeys: ["SEARCHAPI_API_KEY"],
    maxCallsKey: "SEARCHAPI_MAX_CALLS",
    defaultMaxCalls: 500,
    cooldownMs: 120_000,
    rateLimitCooldownMs: 300_000,
    authCooldownMs: 900_000,
    captchaCooldownMs: 900_000,
    captchaFailureThreshold: 2,
    failureThreshold: 3,
  },
  [PROVIDER_IDS.APIFY]: {
    enabledKey: "APIFY_ENABLED",
    defaultEnabled: false, // Disabled by default until APIFY_ENABLED=true and APIFY_API_TOKEN is configured
    apiKeyEnv: "APIFY_API_TOKEN",
    requiredEnvKeys: ["APIFY_API_TOKEN"],
    maxCallsKey: "APIFY_MAX_CALLS",
    defaultMaxCalls: 60,
    monthlyUsdBudgetControlled: true,
    cooldownMs: 300_000,
    rateLimitCooldownMs: 900_000,
    authCooldownMs: 3_600_000,
    captchaCooldownMs: 900_000,
    captchaFailureThreshold: 1,
    failureThreshold: 1,
  },
  [PROVIDER_IDS.BRIGHTDATA]: {
    enabledKey: "BRIGHTDATA_ENABLED",
    defaultEnabled: false, // Keep fail-closed until explicitly enabled
    apiKeyEnv: "BRIGHTDATA_API_KEY",
    requiredEnvKeys: ["BRIGHTDATA_API_KEY", "BRIGHTDATA_SERP_ZONE"],
    maxCallsKey: "BRIGHTDATA_MAX_CALLS",
    defaultMaxCalls: 4500,
    monthlyBudgetCredits: 5000,
    safetyReserveCredits: 500,
    cooldownMs: 120_000,
    rateLimitCooldownMs: 300_000,
    authCooldownMs: 900_000,
    captchaCooldownMs: 900_000,
    captchaFailureThreshold: 2,
    failureThreshold: 3,
  },
  [PROVIDER_IDS.HASDATA]: {
    enabledKey: "HASDATA_ENABLED",
    defaultEnabled: false,
    apiKeyEnv: "HASDATA_API_KEY",
    requiredEnvKeys: ["HASDATA_API_KEY"],
    maxCallsKey: "HASDATA_MAX_CALLS",
    defaultMaxCalls: 0,
    cooldownMs: 600_000,
    rateLimitCooldownMs: 600_000,
    authCooldownMs: 3_600_000,
    failureThreshold: 1,
    forcedDisabledReason: "account_under_review",
  },
};

function getGlobalQuotaStore() {
  if (!globalThis.__luxeQuotaManagerStore) {
    globalThis.__luxeQuotaManagerStore = {
      providers: {},
      logs: [],
      apifyRuntime: {
        activeConcurrentRuns: 0,
        inFlightReservedUsd: 0,
        budgetBlockedRequests: 0,
        ledgerWriteFailed: false,
      },
    };
  }
  if (!globalThis.__luxeQuotaManagerStore.apifyRuntime) {
    globalThis.__luxeQuotaManagerStore.apifyRuntime = {
      activeConcurrentRuns: 0,
      inFlightReservedUsd: 0,
      budgetBlockedRequests: 0,
      ledgerWriteFailed: false,
    };
  }
  return globalThis.__luxeQuotaManagerStore;
}

function getProviderState(providerId) {
  const store = getGlobalQuotaStore();
  if (!store.providers[providerId]) {
    store.providers[providerId] = {
      callsMade: 0,
      successfulCalls: 0,
      failedCalls: 0,
      consecutiveFailures: 0,
      consecutiveCaptchaFailures: 0,
      lastCreditsUsed: 0,
      totalCreditsUsed: 0,
      lastLatencyMs: null,
      lastErrorType: null,
      lastErrorMessage: null,
      lastErrorAt: null,
      lastSuccessAt: null,
      circuitOpenUntil: 0,
      rateLimitHeaders: null,
    };
  }
  return store.providers[providerId];
}

function parseBoolEnv(value, fallback = true) {
  if (value === undefined || value === null || value === "") return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (["0", "false", "no", "off", "disabled"].includes(normalized)) return false;
  if (["1", "true", "yes", "on", "enabled"].includes(normalized)) return true;
  return fallback;
}

function parseIntEnv(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number.parseInt(String(value).trim(), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

/**
 * Redacts any configured API keys, Bearer tokens, or query-string credentials
 * before logging or surfacing diagnostic error messages.
 */
export function redactSecrets(input) {
  if (input === null || input === undefined) return "";
  let text = String(input);

  const secretValues = [
    process.env.SERPAPI_KEY,
    process.env.NEXT_PUBLIC_SERPAPI_KEY,
    process.env.SERPER_API_KEY,
    process.env.SEARCHAPI_API_KEY,
    process.env.APIFY_API_TOKEN,
    process.env.BRIGHTDATA_API_KEY,
    process.env.HASDATA_API_KEY,
  ].filter((v) => typeof v === "string" && v.trim().length >= 6);

  for (const secret of secretValues) {
    text = text.split(secret).join("[REDACTED]");
  }

  text = text
    .replace(/([?&](?:api_key|apikey|key|token|access_token)=)[^&\s]+/gi, "$1[REDACTED]")
    .replace(/(Bearer\s+)[A-Za-z0-9._-]+/gi, "$1[REDACTED]")
    .replace(/(X-API-KEY[:=]\s*)\S+/gi, "$1[REDACTED]");

  return text;
}

function getCurrentMonthKey() {
  return new Date().toISOString().slice(0, 7);
}

function getLedgerFilePath(providerId) {
  if (providerId === PROVIDER_IDS.BRIGHTDATA && process.env.BRIGHTDATA_LEDGER_PATH?.trim()) {
    return process.env.BRIGHTDATA_LEDGER_PATH.trim();
  }
  if (providerId === PROVIDER_IDS.APIFY && process.env.APIFY_LEDGER_PATH?.trim()) {
    return process.env.APIFY_LEDGER_PATH.trim();
  }
  if (providerId === PROVIDER_IDS.APIFY) {
    return DEFAULT_APIFY_LEDGER_FILE;
  }
  return providerId === PROVIDER_IDS.BRIGHTDATA ? DEFAULT_BRIGHTDATA_LEDGER_FILE : null;
}

function roundUsd(amount) {
  const num = Number(amount);
  if (!Number.isFinite(num) || num <= 0) return 0;
  return Math.round(num * 10000) / 10000;
}

export function getApifyBudgetConfig() {
  const rawBudget = process.env.APIFY_MONTHLY_BUDGET_USD;
  let configuredBudgetUsd = APIFY_DEFAULT_BUDGET_USD;

  if (rawBudget !== undefined && rawBudget !== null && String(rawBudget).trim() !== "") {
    const parsed = Number(String(rawBudget).trim());
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return {
        valid: false,
        reason: "budget_config_invalid",
        configuredBudgetUsd: 0,
        usableBudgetUsd: 0,
        safetyReserveUsd: APIFY_SAFETY_MARGIN_USD,
        freeAllowanceUsd: APIFY_FREE_ALLOWANCE_USD,
        maxConcurrentRuns: 1,
      };
    }
    configuredBudgetUsd = roundUsd(parsed);
  }

  // Reserve $0.05 out of the $0.25 monthly Free allowance when operating on Free allowance tier.
  const usableBudgetUsd =
    configuredBudgetUsd <= APIFY_FREE_ALLOWANCE_USD
      ? roundUsd(Math.min(configuredBudgetUsd, APIFY_FREE_ALLOWANCE_USD - APIFY_SAFETY_MARGIN_USD))
      : roundUsd(configuredBudgetUsd - APIFY_SAFETY_MARGIN_USD);

  const safetyReserveUsd =
    configuredBudgetUsd <= APIFY_FREE_ALLOWANCE_USD
      ? roundUsd(Math.max(APIFY_SAFETY_MARGIN_USD, APIFY_FREE_ALLOWANCE_USD - usableBudgetUsd))
      : APIFY_SAFETY_MARGIN_USD;

  const rawConcurrency = parseIntEnv(process.env.APIFY_MAX_CONCURRENT_RUNS, 1);
  // Hard cap to avoid uncontrolled parallel Actor jobs even if misconfigured.
  const maxConcurrentRuns = Math.max(1, Math.min(rawConcurrency, 1));

  return {
    valid: true,
    reason: "ok",
    configuredBudgetUsd,
    usableBudgetUsd,
    safetyReserveUsd,
    freeAllowanceUsd: APIFY_FREE_ALLOWANCE_USD,
    maxConcurrentRuns,
    costPerResultUsd: APIFY_COST_PER_RESULT_USD,
    minRunCostUsd: APIFY_MIN_RUN_COST_USD,
  };
}

function createEmptyApifyLedger(monthKey) {
  return {
    corrupted: false,
    provider: PROVIDER_IDS.APIFY,
    monthKey,
    requestsAttempted: 0,
    requestsSucceeded: 0,
    requestsFailed: 0,
    budgetBlockedRequests: 0,
    estimatedSpendUsd: 0,
    lastSuccessfulRun: null,
    lastErrorCategory: null,
    lastUpdatedAt: null,
  };
}

function loadApifyBudgetLedger() {
  const monthKey = getCurrentMonthKey();
  const filePath = getLedgerFilePath(PROVIDER_IDS.APIFY);
  if (!filePath) {
    return {
      ...createEmptyApifyLedger(monthKey),
      corrupted: true,
      corruptionReason: "budget_ledger_unavailable",
    };
  }

  try {
    if (!fs.existsSync(filePath)) {
      return createEmptyApifyLedger(monthKey);
    }
    const raw = fs.readFileSync(filePath, "utf8");
    if (!raw || !raw.trim()) {
      return {
        ...createEmptyApifyLedger(monthKey),
        corrupted: true,
        corruptionReason: "budget_ledger_corrupted",
      };
    }
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {
        ...createEmptyApifyLedger(monthKey),
        corrupted: true,
        corruptionReason: "budget_ledger_corrupted",
      };
    }
    if (
      parsed.provider !== PROVIDER_IDS.APIFY ||
      typeof parsed.monthKey !== "string" ||
      !/^\d{4}-\d{2}$/.test(parsed.monthKey)
    ) {
      return {
        ...createEmptyApifyLedger(monthKey),
        corrupted: true,
        corruptionReason: "budget_ledger_corrupted",
      };
    }
    const numericFields = [
      "requestsAttempted",
      "requestsSucceeded",
      "requestsFailed",
      "estimatedSpendUsd",
    ];
    for (const field of numericFields) {
      const val = parsed[field];
      if (typeof val !== "number" || !Number.isFinite(val) || val < 0) {
        return {
          ...createEmptyApifyLedger(monthKey),
          corrupted: true,
          corruptionReason: "budget_ledger_corrupted",
        };
      }
    }
    const blockedCount =
      parsed.budgetBlockedRequests === undefined ? 0 : parsed.budgetBlockedRequests;
    if (typeof blockedCount !== "number" || !Number.isFinite(blockedCount) || blockedCount < 0) {
      return {
        ...createEmptyApifyLedger(monthKey),
        corrupted: true,
        corruptionReason: "budget_ledger_corrupted",
      };
    }

    // Calendar month rollover resets monthly counters cleanly.
    if (parsed.monthKey !== monthKey) {
      return createEmptyApifyLedger(monthKey);
    }

    return {
      corrupted: false,
      provider: PROVIDER_IDS.APIFY,
      monthKey: parsed.monthKey,
      requestsAttempted: parsed.requestsAttempted,
      requestsSucceeded: parsed.requestsSucceeded,
      requestsFailed: parsed.requestsFailed,
      budgetBlockedRequests: blockedCount,
      estimatedSpendUsd: roundUsd(parsed.estimatedSpendUsd),
      lastSuccessfulRun: parsed.lastSuccessfulRun || null,
      lastErrorCategory: parsed.lastErrorCategory || null,
      lastUpdatedAt: parsed.lastUpdatedAt || null,
    };
  } catch {
    return {
      ...createEmptyApifyLedger(monthKey),
      corrupted: true,
      corruptionReason: "budget_ledger_corrupted",
    };
  }
}

function saveApifyBudgetLedger(ledger) {
  const filePath = getLedgerFilePath(PROVIDER_IDS.APIFY);
  const store = getGlobalQuotaStore();
  if (!filePath) {
    store.apifyRuntime.ledgerWriteFailed = true;
    return false;
  }
  try {
    const clean = {
      provider: PROVIDER_IDS.APIFY,
      monthKey: ledger.monthKey,
      requestsAttempted: ledger.requestsAttempted,
      requestsSucceeded: ledger.requestsSucceeded,
      requestsFailed: ledger.requestsFailed,
      budgetBlockedRequests: ledger.budgetBlockedRequests || 0,
      estimatedSpendUsd: roundUsd(ledger.estimatedSpendUsd),
      lastSuccessfulRun: ledger.lastSuccessfulRun || null,
      lastErrorCategory: ledger.lastErrorCategory || null,
      lastUpdatedAt: ledger.lastUpdatedAt || new Date().toISOString(),
    };
    const tmpPath = `${filePath}.${process.pid}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(clean, null, 2), "utf8");
    fs.renameSync(tmpPath, filePath);
    store.apifyRuntime.ledgerWriteFailed = false;
    return true;
  } catch {
    store.apifyRuntime.ledgerWriteFailed = true;
    return false;
  }
}

export function estimateApifyRunCostUsd({
  resultItemCount = 0,
  rawRowCount = 0,
  maxProductsPerSearch = 5,
  authRejectedBeforeRun = false,
  isEstimateUpperBound = false,
} = {}) {
  if (authRejectedBeforeRun) return 0;
  if (isEstimateUpperBound) {
    const maxItems = Math.max(1, Number(maxProductsPerSearch) || 5);
    return roundUsd(APIFY_MIN_RUN_COST_USD + maxItems * APIFY_COST_PER_RESULT_USD);
  }
  const billableRows = Math.max(0, Number(rawRowCount) || 0, Number(resultItemCount) || 0);
  return roundUsd(APIFY_MIN_RUN_COST_USD + billableRows * APIFY_COST_PER_RESULT_USD);
}

export function getApifyMonthlyBudgetStatus() {
  const cfg = getApifyBudgetConfig();
  const runtime = getGlobalQuotaStore().apifyRuntime;
  const ledger = loadApifyBudgetLedger();
  const ledgerUnavailable = Boolean(ledger.corrupted || runtime.ledgerWriteFailed);
  const effectiveSpendUsd = roundUsd(
    ledger.estimatedSpendUsd + (runtime.inFlightReservedUsd || 0)
  );
  const remainingBudgetUsd = ledgerUnavailable
    ? 0
    : roundUsd(Math.max(0, cfg.usableBudgetUsd - effectiveSpendUsd));
  const budgetExhausted =
    ledgerUnavailable ||
    !cfg.valid ||
    effectiveSpendUsd >= cfg.usableBudgetUsd ||
    remainingBudgetUsd < APIFY_MIN_RUN_COST_USD;

  return {
    monthKey: ledger.monthKey,
    monthlyBudgetUsd: cfg.usableBudgetUsd,
    configuredBudgetUsd: cfg.configuredBudgetUsd,
    safetyReserveUsd: cfg.safetyReserveUsd,
    freeAllowanceUsd: cfg.freeAllowanceUsd,
    estimatedMonthlySpendUsd: ledger.estimatedSpendUsd,
    inFlightReservedUsd: roundUsd(runtime.inFlightReservedUsd || 0),
    remainingBudgetUsd,
    requestsAttempted: ledger.requestsAttempted,
    requestsSucceeded: ledger.requestsSucceeded,
    requestsFailed: ledger.requestsFailed,
    budgetBlockedRequests: Math.max(
      ledger.budgetBlockedRequests || 0,
      runtime.budgetBlockedRequests || 0
    ),
    lastSuccessfulRun: ledger.lastSuccessfulRun,
    lastErrorCategory: ledger.lastErrorCategory,
    lastUpdatedAt: ledger.lastUpdatedAt,
    activeConcurrentRuns: runtime.activeConcurrentRuns || 0,
    maxConcurrentRuns: cfg.maxConcurrentRuns,
    ledgerCorrupted: Boolean(ledger.corrupted),
    ledgerUnavailable: Boolean(runtime.ledgerWriteFailed),
    failClosedReason: !cfg.valid
      ? cfg.reason
      : ledger.corrupted
      ? ledger.corruptionReason || "budget_ledger_corrupted"
      : runtime.ledgerWriteFailed
      ? "budget_ledger_unavailable"
      : budgetExhausted
      ? "monthly_budget_exhausted"
      : null,
    budgetExhausted,
  };
}

export function recordApifyBudgetBlocked() {
  const store = getGlobalQuotaStore();
  store.apifyRuntime.budgetBlockedRequests += 1;
  const ledger = loadApifyBudgetLedger();
  if (!ledger.corrupted && !store.apifyRuntime.ledgerWriteFailed) {
    ledger.budgetBlockedRequests = (ledger.budgetBlockedRequests || 0) + 1;
    ledger.lastUpdatedAt = new Date().toISOString();
    saveApifyBudgetLedger(ledger);
  }
}

export function tryAcquireApifyRunSlot({ maxProductsPerSearch = 5 } = {}) {
  const gate = canCallProvider(PROVIDER_IDS.APIFY);
  if (!gate.allowed) {
    if (
      gate.reason === "monthly_budget_exhausted" ||
      gate.reason === "budget_ledger_corrupted" ||
      gate.reason === "budget_ledger_unavailable" ||
      gate.reason === "budget_config_invalid"
    ) {
      recordApifyBudgetBlocked();
    }
    return { acquired: false, reason: gate.reason, gate };
  }

  const store = getGlobalQuotaStore();
  const runtime = store.apifyRuntime;
  const status = getApifyMonthlyBudgetStatus();
  const maxEstimatedRunUsd = estimateApifyRunCostUsd({
    maxProductsPerSearch,
    isEstimateUpperBound: true,
  });
  const reservedUsd = roundUsd(Math.min(maxEstimatedRunUsd, status.remainingBudgetUsd));

  if (reservedUsd < APIFY_MIN_RUN_COST_USD) {
    recordApifyBudgetBlocked();
    return {
      acquired: false,
      reason: "monthly_budget_exhausted",
      gate: { allowed: false, reason: "monthly_budget_exhausted" },
    };
  }

  // Synchronous atomic reservation before awaiting any network I/O.
  runtime.activeConcurrentRuns += 1;
  runtime.inFlightReservedUsd = roundUsd(runtime.inFlightReservedUsd + reservedUsd);

  const state = getProviderState(PROVIDER_IDS.APIFY);
  state.callsMade += 1;

  const ledger = loadApifyBudgetLedger();
  if (ledger.corrupted) {
    runtime.activeConcurrentRuns = Math.max(0, runtime.activeConcurrentRuns - 1);
    runtime.inFlightReservedUsd = roundUsd(Math.max(0, runtime.inFlightReservedUsd - reservedUsd));
    state.callsMade = Math.max(0, state.callsMade - 1);
    recordApifyBudgetBlocked();
    return {
      acquired: false,
      reason: "budget_ledger_corrupted",
      gate: { allowed: false, reason: "budget_ledger_corrupted" },
    };
  }

  ledger.requestsAttempted += 1;
  ledger.lastUpdatedAt = new Date().toISOString();
  if (!saveApifyBudgetLedger(ledger)) {
    runtime.activeConcurrentRuns = Math.max(0, runtime.activeConcurrentRuns - 1);
    runtime.inFlightReservedUsd = roundUsd(Math.max(0, runtime.inFlightReservedUsd - reservedUsd));
    state.callsMade = Math.max(0, state.callsMade - 1);
    recordApifyBudgetBlocked();
    return {
      acquired: false,
      reason: "budget_ledger_unavailable",
      gate: { allowed: false, reason: "budget_ledger_unavailable" },
    };
  }

  return {
    acquired: true,
    reservedUsd,
    maxTotalChargeUsd: roundUsd(Math.min(status.remainingBudgetUsd, maxEstimatedRunUsd, 0.05)),
    remainingBudgetAfterReserveUsd: roundUsd(Math.max(0, status.remainingBudgetUsd - reservedUsd)),
  };
}

export function settleApifyRunSlot({
  reservedUsd = 0,
  succeeded = false,
  classifiedError = null,
  resultItemCount = 0,
  rawRowCount = 0,
  latencyMs = null,
} = {}) {
  const store = getGlobalQuotaStore();
  const runtime = store.apifyRuntime;
  runtime.activeConcurrentRuns = Math.max(0, runtime.activeConcurrentRuns - 1);
  runtime.inFlightReservedUsd = roundUsd(Math.max(0, runtime.inFlightReservedUsd - reservedUsd));

  const state = getProviderState(PROVIDER_IDS.APIFY);
  const errorType = classifiedError?.errorType || null;
  const authRejectedBeforeRun = errorType === ERROR_TYPES.AUTH_ERROR;
  const actualCostUsd = estimateApifyRunCostUsd({
    resultItemCount,
    rawRowCount,
    authRejectedBeforeRun,
    isEstimateUpperBound: false,
  });

  if (typeof latencyMs === "number" && Number.isFinite(latencyMs)) {
    state.lastLatencyMs = Math.round(latencyMs);
  }

  const nowIso = new Date().toISOString();
  const ledger = loadApifyBudgetLedger();
  if (!ledger.corrupted) {
    ledger.estimatedSpendUsd = roundUsd(ledger.estimatedSpendUsd + actualCostUsd);
    if (succeeded && errorType !== ERROR_TYPES.EMPTY_RESULTS) {
      ledger.requestsSucceeded += 1;
      ledger.lastSuccessfulRun = nowIso;
      ledger.lastErrorCategory = null;
    } else if (errorType === ERROR_TYPES.EMPTY_RESULTS) {
      ledger.requestsSucceeded += 1;
      ledger.lastSuccessfulRun = nowIso;
      ledger.lastErrorCategory = ERROR_TYPES.EMPTY_RESULTS;
    } else {
      ledger.requestsFailed += 1;
      ledger.lastErrorCategory = errorType || ERROR_TYPES.PROVIDER_UNAVAILABLE;
    }
    ledger.lastUpdatedAt = nowIso;
    saveApifyBudgetLedger(ledger);
  }

  if (succeeded && errorType !== ERROR_TYPES.EMPTY_RESULTS) {
    state.successfulCalls += 1;
    state.consecutiveFailures = 0;
    state.consecutiveCaptchaFailures = 0;
    state.circuitOpenUntil = 0;
    state.lastSuccessAt = nowIso;
    state.lastCreditsUsed = actualCostUsd;
    state.totalCreditsUsed = roundUsd(state.totalCreditsUsed + actualCostUsd);
    state.lastErrorType = null;
    state.lastErrorMessage = null;
  } else {
    state.lastCreditsUsed = actualCostUsd;
    state.totalCreditsUsed = roundUsd(state.totalCreditsUsed + actualCostUsd);
    recordProviderFailure(PROVIDER_IDS.APIFY, classifiedError || {
      errorType: ERROR_TYPES.PROVIDER_UNAVAILABLE,
      message: "Apify Actor execution failed.",
    }, { latencyMs });
  }

  return actualCostUsd;
}

function getBrightDataBudgetLimits() {
  const cfg = PROVIDER_ENV_CONFIG[PROVIDER_IDS.BRIGHTDATA];
  const rawMonthly = parseIntEnv(
    process.env.BRIGHTDATA_MONTHLY_BUDGET,
    cfg.monthlyBudgetCredits
  );
  // Hard cap at 5,000 monthly free credits; never exceed free allowance.
  const monthlyBudgetCredits = Math.min(rawMonthly, cfg.monthlyBudgetCredits);
  const rawReserve = parseIntEnv(
    process.env.BRIGHTDATA_SAFETY_RESERVE,
    cfg.safetyReserveCredits
  );
  const safetyReserveCredits = Math.max(
    Math.min(rawReserve, monthlyBudgetCredits),
    Math.min(cfg.safetyReserveCredits, monthlyBudgetCredits)
  );
  const usableBudgetCredits = Math.max(0, monthlyBudgetCredits - safetyReserveCredits);

  return {
    monthlyBudgetCredits,
    safetyReserveCredits,
    usableBudgetCredits,
  };
}

function loadMonthlyLedger(providerId) {
  const monthKey = getCurrentMonthKey();
  const emptyLedger = {
    provider: providerId,
    monthKey,
    requestsAttempted: 0,
    successfulRequests: 0,
    failedRequests: 0,
    creditsConsumed: 0,
    lastUpdatedAt: null,
  };

  const filePath = getLedgerFilePath(providerId);
  if (!filePath) return emptyLedger;

  try {
    if (!fs.existsSync(filePath)) return emptyLedger;
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.monthKey !== monthKey) {
      return emptyLedger;
    }
    return {
      ...emptyLedger,
      requestsAttempted: Number(parsed.requestsAttempted || 0),
      successfulRequests: Number(parsed.successfulRequests || 0),
      failedRequests: Number(parsed.failedRequests || 0),
      creditsConsumed: Number(parsed.creditsConsumed || 0),
      lastUpdatedAt: parsed.lastUpdatedAt || null,
    };
  } catch {
    return emptyLedger;
  }
}

function saveMonthlyLedger(providerId, ledger) {
  const filePath = getLedgerFilePath(providerId);
  if (!filePath) return;
  try {
    fs.writeFileSync(filePath, JSON.stringify(ledger, null, 2), "utf8");
  } catch {
    // Non-fatal on read-only filesystems
  }
}

export function getMonthlyCreditStatus(providerId = PROVIDER_IDS.BRIGHTDATA) {
  const cfg = PROVIDER_ENV_CONFIG[providerId];
  if (!cfg?.monthlyBudgetCredits) return null;

  const limits = getBrightDataBudgetLimits();
  const ledger = loadMonthlyLedger(providerId);
  const usableRemaining = Math.max(
    0,
    limits.usableBudgetCredits - ledger.creditsConsumed
  );
  const hardRemaining = Math.max(
    0,
    limits.monthlyBudgetCredits - ledger.creditsConsumed
  );

  return {
    monthKey: ledger.monthKey,
    monthlyBudgetCredits: limits.monthlyBudgetCredits,
    safetyReserveCredits: limits.safetyReserveCredits,
    usableBudgetCredits: limits.usableBudgetCredits,
    creditsConsumed: ledger.creditsConsumed,
    usableCreditsRemaining: usableRemaining,
    hardCreditsRemaining: hardRemaining,
    requestsAttempted: ledger.requestsAttempted,
    successfulRequests: ledger.successfulRequests,
    failedRequests: ledger.failedRequests,
    reserveReached: ledger.creditsConsumed >= limits.usableBudgetCredits,
    hardExhausted: ledger.creditsConsumed >= limits.monthlyBudgetCredits,
    lastUpdatedAt: ledger.lastUpdatedAt,
  };
}

export function isProviderEnabled(providerId) {
  const cfg = PROVIDER_ENV_CONFIG[providerId];
  if (!cfg) return false;
  if (cfg.forcedDisabledReason) return false;

  const requiredKeys = cfg.requiredEnvKeys || [cfg.apiKeyEnv];
  for (const keyName of requiredKeys) {
    if (!String(process.env[keyName] || "").trim()) {
      return false;
    }
  }

  return parseBoolEnv(process.env[cfg.enabledKey], cfg.defaultEnabled ?? true);
}

export function getProviderMaxCalls(providerId) {
  const cfg = PROVIDER_ENV_CONFIG[providerId];
  if (!cfg) return 0;
  return parseIntEnv(process.env[cfg.maxCallsKey], cfg.defaultMaxCalls);
}

function readHeaderInsensitive(headers, name) {
  if (!headers) return null;
  if (typeof headers.get === "function") return headers.get(name);
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name.toLowerCase());
  return key ? headers[key] : null;
}

/**
 * Classifies HTTP status codes, provider error payloads, Bright Data proxy headers,
 * or thrown exceptions into LuxeIndex's canonical error taxonomy.
 */
export function classifyProviderError({ status, error, message, headers } = {}) {
  const brdStatusRaw = readHeaderInsensitive(headers, "x-brd-status-code");
  const brdStatus = brdStatusRaw ? Number.parseInt(String(brdStatusRaw).trim(), 10) : null;
  const brdError = String(readHeaderInsensitive(headers, "x-brd-error") || "").trim();
  const brdErrorCode = String(
    readHeaderInsensitive(headers, "x-brd-error-code") ||
      readHeaderInsensitive(headers, "x-brd-err-code") ||
      ""
  ).trim();

  const effectiveStatus =
    Number.isFinite(brdStatus) && brdStatus >= 400 ? brdStatus : status;

  const brdDetailParts = [
    message || error?.message || error || "",
    brdStatus ? `x-brd-status-code=${brdStatus}` : "",
    brdErrorCode ? `x-brd-error-code=${brdErrorCode}` : "",
    brdError ? `x-brd-error=${brdError}` : "",
  ].filter(Boolean);

  const rawMessage = redactSecrets(brdDetailParts.join(" | "));
  const lower = rawMessage.toLowerCase();
  const brdCodeLower = brdErrorCode.toLowerCase();

  if (
    error?.name === "AbortError" ||
    error?.code === "ETIMEDOUT" ||
    effectiveStatus === 408 ||
    effectiveStatus === 504 ||
    lower.includes("timeout") ||
    lower.includes("aborted")
  ) {
    return {
      errorType: ERROR_TYPES.TIMEOUT,
      message: rawMessage || "Provider request timed out.",
      retryable: true,
    };
  }

  if (
    brdCodeLower.includes("captcha") ||
    lower.includes("captcha") ||
    lower.includes("redirect location was rejected")
  ) {
    return {
      errorType: ERROR_TYPES.CAPTCHA_BLOCKED,
      message:
        rawMessage ||
        "Bright Data upstream request was blocked by CAPTCHA or redirect rejection.",
      retryable: false,
    };
  }

  if (
    effectiveStatus === 401 ||
    effectiveStatus === 403 ||
    lower.includes("invalid api key") ||
    lower.includes("unauthorized") ||
    lower.includes("forbidden") ||
    lower.includes("account is under review") ||
    // Apify platform returns HTTP 200 with {error:{type:"user-or-token-not-found"}} on auth failures
    lower.includes("user was not found") ||
    lower.includes("token is not valid") ||
    lower.includes("token is invalid")
  ) {
    return {
      errorType: ERROR_TYPES.AUTH_ERROR,
      message: rawMessage || "Provider authentication failed.",
      retryable: false,
    };
  }

  if (
    effectiveStatus === 402 ||
    effectiveStatus === 429 ||
    lower.includes("rate limit") ||
    lower.includes("too many requests") ||
    lower.includes("quota") ||
    lower.includes("credits exhausted") ||
    lower.includes("payment required") ||
    lower.includes("run out of searches")
  ) {
    return {
      errorType: ERROR_TYPES.RATE_LIMITED,
      message: rawMessage || "Provider rate limit or credit cap reached.",
      retryable: false,
    };
  }

  if (
    lower.includes("invalid json") ||
    lower.includes("unexpected token") ||
    lower.includes("malformed")
  ) {
    return {
      errorType: ERROR_TYPES.INVALID_RESPONSE,
      message: rawMessage || "Provider returned an invalid response payload.",
      retryable: false,
    };
  }

  // Apify Actor run failures must be classified BEFORE the generic "empty" match.
  // A failed run can legitimately mention an empty dataset in its status message,
  // and treating that as EMPTY_RESULTS would count it as a healthy negative answer
  // (no failure streak, no circuit breaker) while the provider is actually broken.
  const structuredActorStatus = String(
    error?.status || error?.runStatus || error?.actorRun?.status || ""
  )
    .trim()
    .toUpperCase();
  const structuredActorType = String(
    error?.type || error?.errorType || ""
  )
    .trim()
    .toLowerCase();
  const isActorRunFailure =
    structuredActorType === "actor-run-failed" ||
    structuredActorType === "actor_run_failed" ||
    structuredActorStatus === "FAILED" ||
    structuredActorStatus === "ABORTED" ||
    structuredActorStatus === "TIMED-OUT" ||
    structuredActorStatus === "TIMED_OUT" ||
    lower.includes("actor-run-failed") ||
    lower.includes("actor run failed") ||
    lower.includes("actor run did not finish") ||
    lower.includes("run did not succeed") ||
    lower.includes("actor execution failed");

  if (isActorRunFailure) {
    return {
      errorType: ERROR_TYPES.ACTOR_RUN_FAILED,
      message:
        rawMessage || "Apify Actor run failed before producing a usable dataset.",
      retryable: false,
    };
  }

  if (lower.includes("no shopping results") || lower.includes("empty")) {
    return {
      errorType: ERROR_TYPES.EMPTY_RESULTS,
      message: rawMessage || "Provider returned zero matching items.",
      retryable: false,
    };
  }

  const hasBrdBlockHeader = Boolean(brdError || brdErrorCode || (Number.isFinite(brdStatus) && brdStatus >= 400));
  return {
    errorType: ERROR_TYPES.PROVIDER_UNAVAILABLE,
    message: rawMessage || "Provider upstream service is unavailable.",
    retryable: !hasBrdBlockHeader,
  };
}

/**
 * Parses Serper / SearchApi / SerpApi usage and rate-limit headers cleanly
 * without fabricating reset timestamps when headers omit them.
 */
export function extractUsageMetadata(providerId, { headers, payload, latencyMs } = {}) {
  const getHeader = (name) => {
    if (!headers) return null;
    if (typeof headers.get === "function") return headers.get(name);
    const key = Object.keys(headers).find((k) => k.toLowerCase() === name.toLowerCase());
    return key ? headers[key] : null;
  };

  const toNum = (val) => {
    if (val === null || val === undefined || val === "") return null;
    const n = Number(val);
    return Number.isFinite(n) ? n : null;
  };

  const rateLimitLimit = toNum(getHeader("x-ratelimit-limit"));
  const rateLimitRemaining = toNum(getHeader("x-ratelimit-remaining"));
  const rateLimitReset = getHeader("x-ratelimit-reset") || null;

  let creditsUsed = 1;
  if (typeof payload?.credits === "number" && Number.isFinite(payload.credits)) {
    creditsUsed = payload.credits;
  }

  return {
    provider: providerId,
    creditsUsed,
    latencyMs: typeof latencyMs === "number" ? Math.round(latencyMs) : null,
    rateLimitLimit,
    rateLimitRemaining,
    rateLimitReset,
    serpApiTimeTaken:
      typeof payload?.search_metadata?.total_time_taken === "number"
        ? payload.search_metadata.total_time_taken
        : null,
  };
}

export function canCallProvider(providerId) {
  const cfg = PROVIDER_ENV_CONFIG[providerId];
  if (!cfg) {
    return { allowed: false, reason: "unknown_provider" };
  }
  if (cfg.forcedDisabledReason) {
    return { allowed: false, reason: cfg.forcedDisabledReason };
  }

  const requiredKeys = cfg.requiredEnvKeys || [cfg.apiKeyEnv];
  for (const keyName of requiredKeys) {
    if (!String(process.env[keyName] || "").trim()) {
      const reason =
        keyName === "BRIGHTDATA_SERP_ZONE"
          ? "missing_serp_zone"
          : "missing_api_key";
      return { allowed: false, reason };
    }
  }

  if (!parseBoolEnv(process.env[cfg.enabledKey], cfg.defaultEnabled ?? true)) {
    return { allowed: false, reason: "disabled_by_env" };
  }

  if (cfg.monthlyUsdBudgetControlled) {
    const apifyBudget = getApifyMonthlyBudgetStatus();
    if (apifyBudget.failClosedReason) {
      return { allowed: false, reason: apifyBudget.failClosedReason };
    }
    if (apifyBudget.activeConcurrentRuns >= apifyBudget.maxConcurrentRuns) {
      return { allowed: false, reason: "max_concurrent_runs_reached" };
    }
  }

  if (cfg.monthlyBudgetCredits) {
    const budget = getMonthlyCreditStatus(providerId);
    if (budget?.hardExhausted) {
      return { allowed: false, reason: "monthly_budget_exhausted" };
    }
    if (budget?.reserveReached) {
      return { allowed: false, reason: "monthly_safety_reserve_reached" };
    }
  }

  const state = getProviderState(providerId);
  const maxCalls = getProviderMaxCalls(providerId);
  if (maxCalls > 0 && state.callsMade >= maxCalls) {
    return { allowed: false, reason: "session_max_calls_reached" };
  }

  const now = Date.now();
  if (state.circuitOpenUntil && now < state.circuitOpenUntil) {
    return {
      allowed: false,
      reason: "circuit_open",
      retryAfterSeconds: Math.max(1, Math.ceil((state.circuitOpenUntil - now) / 1000)),
    };
  }

  return { allowed: true, reason: "ok" };
}

export function recordProviderCallStart(providerId) {
  const state = getProviderState(providerId);
  state.callsMade += 1;

  if (PROVIDER_ENV_CONFIG[providerId]?.monthlyBudgetCredits) {
    const ledger = loadMonthlyLedger(providerId);
    ledger.requestsAttempted += 1;
    ledger.lastUpdatedAt = new Date().toISOString();
    saveMonthlyLedger(providerId, ledger);
  }
}

export function recordProviderSuccess(providerId, usageMeta = null) {
  const state = getProviderState(providerId);
  state.successfulCalls += 1;
  state.consecutiveFailures = 0;
  state.consecutiveCaptchaFailures = 0;
  state.circuitOpenUntil = 0;
  state.lastSuccessAt = new Date().toISOString();

  const credits = Number(usageMeta?.creditsUsed ?? 1);
  if (usageMeta) {
    state.lastCreditsUsed = credits;
    state.totalCreditsUsed += credits;
    if (usageMeta.latencyMs !== null && usageMeta.latencyMs !== undefined) {
      state.lastLatencyMs = usageMeta.latencyMs;
    }
    if (
      usageMeta.rateLimitLimit !== null ||
      usageMeta.rateLimitRemaining !== null ||
      usageMeta.rateLimitReset !== null
    ) {
      state.rateLimitHeaders = {
        limit: usageMeta.rateLimitLimit,
        remaining: usageMeta.rateLimitRemaining,
        reset: usageMeta.rateLimitReset,
      };
    }
  }

  if (PROVIDER_ENV_CONFIG[providerId]?.monthlyBudgetCredits) {
    const ledger = loadMonthlyLedger(providerId);
    ledger.successfulRequests += 1;
    ledger.creditsConsumed += credits > 0 ? credits : 1;
    ledger.lastUpdatedAt = new Date().toISOString();
    saveMonthlyLedger(providerId, ledger);
  }
}

export function recordProviderFailure(providerId, classifiedError, usageMeta = null) {
  const cfg = PROVIDER_ENV_CONFIG[providerId] || {
    cooldownMs: 120_000,
    rateLimitCooldownMs: 300_000,
    authCooldownMs: 900_000,
    failureThreshold: 3,
  };
  const state = getProviderState(providerId);
  const errorType = classifiedError?.errorType || ERROR_TYPES.PROVIDER_UNAVAILABLE;
  const safeMessage = redactSecrets(classifiedError?.message || "Provider request failed.");

  state.failedCalls += 1;
  state.lastErrorType = errorType;
  state.lastErrorMessage = safeMessage;
  state.lastErrorAt = new Date().toISOString();

  if (PROVIDER_ENV_CONFIG[providerId]?.monthlyBudgetCredits) {
    const ledger = loadMonthlyLedger(providerId);
    // Empty query results consume 1 billed SERP request ONLY when upstream returned HTTP 200 without errors.
    if (errorType === ERROR_TYPES.EMPTY_RESULTS && usageMeta?.creditsUsed !== 0) {
      const credits = Number(usageMeta?.creditsUsed ?? 1);
      ledger.successfulRequests += 1;
      ledger.creditsConsumed += credits > 0 ? credits : 1;
    } else {
      ledger.failedRequests += 1;
    }
    ledger.lastUpdatedAt = state.lastErrorAt;
    saveMonthlyLedger(providerId, ledger);
  }

  if (usageMeta?.latencyMs !== null && usageMeta?.latencyMs !== undefined) {
    state.lastLatencyMs = usageMeta.latencyMs;
  }

  if (errorType === ERROR_TYPES.EMPTY_RESULTS) {
    // Empty query results are valid negative answers, not broken upstream circuits.
    state.consecutiveFailures = 0;
    return;
  }

  state.consecutiveFailures += 1;
  if (errorType === ERROR_TYPES.CAPTCHA_BLOCKED) {
    state.consecutiveCaptchaFailures = (state.consecutiveCaptchaFailures || 0) + 1;
  }

  const now = Date.now();
  if (errorType === ERROR_TYPES.RATE_LIMITED) {
    state.circuitOpenUntil = now + cfg.rateLimitCooldownMs;
  } else if (errorType === ERROR_TYPES.AUTH_ERROR) {
    state.circuitOpenUntil = now + cfg.authCooldownMs;
  } else if (
    errorType === ERROR_TYPES.CAPTCHA_BLOCKED &&
    state.consecutiveCaptchaFailures >= (cfg.captchaFailureThreshold || 2)
  ) {
    state.circuitOpenUntil = now + (cfg.captchaCooldownMs || 900_000);
  } else if (state.consecutiveFailures >= cfg.failureThreshold) {
    state.circuitOpenUntil = now + cfg.cooldownMs;
  }

  const store = getGlobalQuotaStore();
  store.logs.unshift({
    at: state.lastErrorAt,
    provider: providerId,
    errorType,
    message: safeMessage,
  });
  if (store.logs.length > 40) {
    store.logs.length = 40;
  }
}

export function resetQuotaState(providerId = null, { clearMonthlyLedger = false } = {}) {
  const store = getGlobalQuotaStore();
  if (providerId) {
    delete store.providers[providerId];
    if (providerId === PROVIDER_IDS.APIFY && store.apifyRuntime) {
      store.apifyRuntime = {
        activeConcurrentRuns: 0,
        inFlightReservedUsd: 0,
        budgetBlockedRequests: 0,
        ledgerWriteFailed: false,
      };
      if (clearMonthlyLedger) {
        const apifyPath = getLedgerFilePath(PROVIDER_IDS.APIFY);
        try {
          if (apifyPath && fs.existsSync(apifyPath)) {
            fs.unlinkSync(apifyPath);
          }
        } catch {
          // Non-fatal in read-only environments
        }
      }
    } else if (clearMonthlyLedger && PROVIDER_ENV_CONFIG[providerId]?.monthlyBudgetCredits) {
      saveMonthlyLedger(providerId, {
        provider: providerId,
        monthKey: getCurrentMonthKey(),
        requestsAttempted: 0,
        successfulRequests: 0,
        failedRequests: 0,
        creditsConsumed: 0,
        lastUpdatedAt: null,
      });
    }
  } else {
    store.providers = {};
    store.logs = [];
    store.apifyRuntime = {
      activeConcurrentRuns: 0,
      inFlightReservedUsd: 0,
      budgetBlockedRequests: 0,
      ledgerWriteFailed: false,
    };
    if (clearMonthlyLedger) {
      const apifyPath = getLedgerFilePath(PROVIDER_IDS.APIFY);
      try {
        if (apifyPath && fs.existsSync(apifyPath)) {
          fs.unlinkSync(apifyPath);
        }
      } catch {
        // Non-fatal in read-only environments
      }
      for (const id of Object.keys(PROVIDER_ENV_CONFIG)) {
        if (PROVIDER_ENV_CONFIG[id]?.monthlyBudgetCredits) {
          saveMonthlyLedger(id, {
            provider: id,
            monthKey: getCurrentMonthKey(),
            requestsAttempted: 0,
            successfulRequests: 0,
            failedRequests: 0,
            creditsConsumed: 0,
            lastUpdatedAt: null,
          });
        }
      }
    }
  }
}

export function getQuotaDiagnostics() {
  const now = Date.now();
  const providers = {};

  for (const providerId of Object.values(PROVIDER_IDS)) {
    const cfg = PROVIDER_ENV_CONFIG[providerId];
    const state = getProviderState(providerId);
    const gate = canCallProvider(providerId);
    const requiredKeys = cfg.requiredEnvKeys || [cfg.apiKeyEnv];
    const configured = requiredKeys.every((k) =>
      Boolean(String(process.env[k] || "").trim())
    );
    const monthlyBudget = cfg.monthlyUsdBudgetControlled
      ? getApifyMonthlyBudgetStatus()
      : cfg.monthlyBudgetCredits
      ? getMonthlyCreditStatus(providerId)
      : null;

    providers[providerId] = {
      enabled: isProviderEnabled(providerId),
      configured,
      callable: gate.allowed,
      gateReason: gate.reason,
      maxCalls: getProviderMaxCalls(providerId),
      callsMade: state.callsMade,
      successfulCalls: state.successfulCalls,
      failedCalls: state.failedCalls,
      consecutiveFailures: state.consecutiveFailures,
      consecutiveCaptchaFailures: state.consecutiveCaptchaFailures || 0,
      lastCreditsUsed: state.lastCreditsUsed,
      totalCreditsUsed: state.totalCreditsUsed,
      lastLatencyMs: state.lastLatencyMs,
      circuitOpen: Boolean(state.circuitOpenUntil && now < state.circuitOpenUntil),
      retryAfterSeconds:
        state.circuitOpenUntil && now < state.circuitOpenUntil
          ? Math.max(1, Math.ceil((state.circuitOpenUntil - now) / 1000))
          : 0,
      lastErrorType: state.lastErrorType,
      lastErrorMessage: state.lastErrorMessage,
      lastErrorAt: state.lastErrorAt,
      lastSuccessAt: state.lastSuccessAt,
      rateLimitHeaders: state.rateLimitHeaders,
      ...(cfg.monthlyUsdBudgetControlled && monthlyBudget
        ? {
            requestsAttempted: monthlyBudget.requestsAttempted,
            requestsSucceeded: monthlyBudget.requestsSucceeded,
            requestsFailed: monthlyBudget.requestsFailed,
            estimatedMonthlySpendUsd: monthlyBudget.estimatedMonthlySpendUsd,
            remainingBudgetUsd: monthlyBudget.remainingBudgetUsd,
            budgetBlockedRequests: monthlyBudget.budgetBlockedRequests,
            lastSuccessfulRun: monthlyBudget.lastSuccessfulRun,
            lastErrorCategory: monthlyBudget.lastErrorCategory || state.lastErrorType,
            activeConcurrentRuns: monthlyBudget.activeConcurrentRuns,
            maxConcurrentRuns: monthlyBudget.maxConcurrentRuns,
            ledgerCorrupted: monthlyBudget.ledgerCorrupted,
          }
        : {}),
      ...(monthlyBudget ? { monthlyBudget } : {}),
    };
  }

  return providers;
}


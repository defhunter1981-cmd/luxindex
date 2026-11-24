import {
  normalizeProviderResults,
  validateImageUrl,
} from "@/lib/search/productNormalizer";
import {
  ERROR_TYPES,
  PROVIDER_IDS,
  canCallProvider,
  classifyProviderError,
  getApifyMonthlyBudgetStatus,
  getQuotaDiagnostics,
  recordApifyBudgetBlocked,
  redactSecrets,
  settleApifyRunSlot,
  tryAcquireApifyRunSlot,
} from "@/lib/search/quotaManager";
import { validateRetailerProductUrl } from "@/lib/urlValidator";
import { normalizeText } from "@/lib/utils";

const APIFY_ENDPOINT =
  "https://api.apify.com/v2/actors/cheapapi~google-shopping-scraper/run-sync-get-dataset-items";

function parseIntBounded(value, fallback, min, max) {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number.parseInt(String(value).trim(), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function getApifyInFlightMap() {
  if (!globalThis.__luxeApifyInFlightMap) {
    globalThis.__luxeApifyInFlightMap = new Map();
  }
  return globalThis.__luxeApifyInFlightMap;
}

function cleanString(value) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed || trimmed.toLowerCase() === "[object object]") return "";
  return trimmed;
}

function isGoogleShoppingHost(rawUrl = "") {
  try {
    const host = new URL(rawUrl).hostname.toLowerCase();
    return (
      host === "google.com" ||
      host.endsWith(".google.com") ||
      host.includes(".google.") ||
      host === "goo.gl"
    );
  } catch {
    return false;
  }
}

function extractApifySeller(rawSeller) {
  if (typeof rawSeller === "string") {
    return cleanString(rawSeller);
  }
  if (rawSeller && typeof rawSeller === "object" && !Array.isArray(rawSeller)) {
    for (const key of ["name", "displayName", "display_name", "title", "source", "domain"]) {
      const val = cleanString(rawSeller[key]);
      if (val) return val;
    }
  }
  return "";
}

function sanitizeHttpUrl(rawUrl) {
  const s = cleanString(rawUrl);
  if (!s || !/^https?:\/\//i.test(s)) return null;
  try {
    const parsed = new URL(s);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function extractSafeLinks(row = {}, sellerName = "") {
  const candidateUrl = sanitizeHttpUrl(row.url);
  const candidateGoogleUrl = sanitizeHttpUrl(row.googleShoppingUrl);

  let directLink = null;
  let shoppingLink = candidateGoogleUrl;

  if (candidateUrl) {
    if (isGoogleShoppingHost(candidateUrl)) {
      shoppingLink = shoppingLink || candidateUrl;
    } else {
      const validation = validateRetailerProductUrl(candidateUrl, sellerName, {
        allowSearchUrl: false,
      });
      if (validation.valid && validation.url) {
        directLink = validation.url;
      }
    }
  }

  return {
    directLink,
    shoppingLink,
  };
}

function normalizeApifyCurrency(row = {}, fallbackCountry = "IN") {
  const explicit = cleanString(row.currency);
  if (explicit) return explicit;
  const rowCountry = cleanString(row.country).toUpperCase();
  if (rowCountry === "US") return "USD";
  if (rowCountry === "IN") return "INR";
  return fallbackCountry === "US" ? "USD" : "INR";
}

function unwrapApifyDatasetRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === "object") {
    if (Array.isArray(payload.items)) return payload.items;
    if (Array.isArray(payload.results)) return payload.results;
    if (Array.isArray(payload.data?.items)) return payload.data.items;
  }
  return [];
}

const APIFY_RUN_FAILURE_STATUSES = new Set([
  "FAILED",
  "ABORTED",
  "TIMED-OUT",
  "TIMED_OUT",
]);

function readApifyHeader(headers, name) {
  if (!headers) return null;
  if (typeof headers.get === "function") return headers.get(name);
  const key = Object.keys(headers).find(
    (k) => k.toLowerCase() === name.toLowerCase()
  );
  return key ? headers[key] : null;
}

function coerceExitCode(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number.parseInt(value.trim(), 10);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

/**
 * Extracts only non-secret Apify Actor run identifiers from a response payload or
 * headers, so failures can be reported with actionable context. The API token and
 * the full upstream body are never included.
 */
export function extractApifyRunMetadata(payload, headers = null) {
  const isObj =
    payload && typeof payload === "object" && !Array.isArray(payload);
  const errorObj =
    isObj && payload.error && typeof payload.error === "object"
      ? payload.error
      : null;
  const runObj = isObj
    ? payload.run || payload.actorRun || payload.data?.run || payload.meta || null
    : null;

  const pick = (...candidates) => {
    for (const candidate of candidates) {
      const value = cleanString(candidate);
      if (value) return value;
    }
    return null;
  };

  const runId = pick(
    errorObj?.runId,
    runObj?.runId,
    runObj?.id,
    isObj ? payload.runId : null,
    readApifyHeader(headers, "x-apify-actor-run-id")
  );
  const status = pick(
    errorObj?.status,
    errorObj?.runStatus,
    runObj?.status,
    isObj ? payload.status : null,
    readApifyHeader(headers, "x-apify-actor-run-status")
  );
  const exitCode = coerceExitCode(
    errorObj?.exitCode ??
      runObj?.exitCode ??
      (isObj ? payload.exitCode : null) ??
      readApifyHeader(headers, "x-apify-actor-exit-code")
  );
  const statusMessage = pick(
    errorObj?.message,
    runObj?.statusMessage,
    isObj ? payload.statusMessage : null
  );

  if (!runId && !status && exitCode === null && !statusMessage) return null;

  return {
    runId: runId || null,
    status: status ? status.toUpperCase() : null,
    exitCode,
    statusMessage: statusMessage ? redactSecrets(statusMessage) : null,
  };
}

function isApifyRunFailure(runMetadata) {
  if (!runMetadata?.status) return false;
  return APIFY_RUN_FAILURE_STATUSES.has(
    String(runMetadata.status).toUpperCase()
  );
}

/** Compact, secret-free suffix describing the failed run, e.g. " [run abc, status FAILED, exit 1]". */
function formatApifyRunContext(runMetadata) {
  if (!runMetadata) return "";
  const parts = [];
  if (runMetadata.runId) parts.push(`run ${runMetadata.runId}`);
  if (runMetadata.status) parts.push(`status ${runMetadata.status}`);
  if (runMetadata.exitCode !== null && runMetadata.exitCode !== undefined) {
    parts.push(`exit ${runMetadata.exitCode}`);
  }
  return parts.length ? ` [${parts.join(", ")}]` : "";
}

/**
 * Builds the conservative CheapAPI Google Shopping Actor input payload.
 * Enforces 1 search term, 1 page, conservative product cap, and zero add-on scrapers.
 */
export function buildApifyActorInput({
  query,
  gl = "in",
  hl = "en",
  maxProductsPerSearch = process.env.APIFY_MAX_PRODUCTS_PER_SEARCH,
  maxPages = process.env.APIFY_MAX_PAGES,
} = {}) {
  const trimmedQuery = cleanString(query);
  const effectiveMaxProducts = parseIntBounded(maxProductsPerSearch, 5, 1, 10);
  // Never increase result pages automatically.
  const effectiveMaxPages = parseIntBounded(maxPages, 1, 1, 1);

  return {
    mode: "search",
    searchTerms: [trimmedQuery],
    country: gl === "us" ? "US" : "IN",
    language: cleanString(hl) || "en",
    maxProductsPerSearch: effectiveMaxProducts,
    maxPages: effectiveMaxPages,
    sortBy: "relevance",
    offersForTopProducts: 0,
    includeSponsored: false,
    includeCarousels: false,
    monitorPrices: false,
  };
}

/**
 * Maps a validated `rowType === "product"` Apify row into LuxeIndex's pre-normalizer shape.
 * Rejects `offer` / `productDetails` rows, Google-hosted redirect URLs as direct links,
 * malformed images, and invalid/unconvertible prices or currencies.
 */
export function mapApifyProductRow(row = {}, index = 0, defaultCountry = "IN") {
  if (!row || typeof row !== "object" || row.rowType !== "product") {
    return null;
  }

  const title = cleanString(row.title);
  if (!title) return null;

  const sellerName = extractApifySeller(row.seller);
  const { directLink, shoppingLink } = extractSafeLinks(row, sellerName);
  const safeImage = validateImageUrl(row.image);
  const safeCurrency = normalizeApifyCurrency(row, defaultCountry);

  const rating =
    typeof row.rating === "number" &&
    Number.isFinite(row.rating) &&
    row.rating >= 0 &&
    row.rating <= 5
      ? row.rating
      : null;

  const reviewsCount =
    typeof row.reviewsCount === "number" &&
    Number.isFinite(row.reviewsCount) &&
    row.reviewsCount >= 0
      ? Math.round(row.reviewsCount)
      : null;

  const scrapedDate = cleanString(row.scrapedAt);
  const validScrapedAt =
    scrapedDate && !Number.isNaN(Date.parse(scrapedDate))
      ? new Date(scrapedDate).toISOString()
      : null;

  return {
    title,
    price: row.price ?? null,
    old_price: row.oldPrice ?? null,
    currency: safeCurrency,
    source: sellerName || undefined,
    rating,
    reviews: reviewsCount,
    delivery: cleanString(row.delivery) || null,
    product_id: cleanString(row.productId) || cleanString(row.gid) || null,
    gid: cleanString(row.gid) || null,
    direct_link: directLink,
    product_link: shoppingLink,
    link: directLink || shoppingLink || null,
    imageUrl: safeImage,
    thumbnail: safeImage,
    isSponsored: Boolean(row.isSponsored) || cleanString(row.resultType) === "sponsored",
    resultType: cleanString(row.resultType) || null,
    searchTerm: cleanString(row.searchTerm) || null,
    country: cleanString(row.country) || defaultCountry,
    scrapedAt: validScrapedAt,
    position: index + 1,
  };
}

export const ApifyProvider = {
  id: PROVIDER_IDS.APIFY,
  name: "Apify Google Shopping (CheapAPI)",
  role: "controlled_fallback_discovery",

  getProviderStatus() {
    const diag = getQuotaDiagnostics()[PROVIDER_IDS.APIFY];
    return {
      id: "apify_google_shopping",
      providerKey: PROVIDER_IDS.APIFY,
      name: this.name,
      role: this.role,
      ...diag,
    };
  },

  getUsageMetadata(meta = {}) {
    const budget = getApifyMonthlyBudgetStatus();
    return {
      provider: PROVIDER_IDS.APIFY,
      creditsUsed: typeof meta?.estimatedCostUsd === "number" ? meta.estimatedCostUsd : 0,
      estimatedCostUsd: typeof meta?.estimatedCostUsd === "number" ? meta.estimatedCostUsd : 0,
      remainingBudgetUsd: budget.remainingBudgetUsd,
      latencyMs: typeof meta?.latencyMs === "number" ? Math.round(meta.latencyMs) : null,
      rateLimitLimit: null,
      rateLimitRemaining: null,
      rateLimitReset: null,
      runMetadata: meta?.runMetadata || null,
    };
  },

  getCreditStatus() {
    return getApifyMonthlyBudgetStatus();
  },

  normalizeResults(response, context = {}) {
    const country = context.gl === "us" ? "US" : "IN";
    const rows = Array.isArray(response?.rawItems)
      ? response.rawItems
      : unwrapApifyDatasetRows(response);

    const mapped = [];
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      if (!row || typeof row !== "object") continue;
      // Only process `rowType === "product"`; ignore `offer` and `productDetails`.
      if (row.rowType !== "product") continue;
      const mappedRow = mapApifyProductRow(row, mapped.length, country);
      if (mappedRow) mapped.push(mappedRow);
    }

    const normalized = normalizeProviderResults(mapped, {
      provider: PROVIDER_IDS.APIFY,
      queryHint: context.query || "",
      gl: context.gl || "in",
    });

    // Attach validated Apify discovery metadata without ever treating shoppingUrl as a verified merchant PDP.
    return normalized.map((item, idx) => {
      const src = mapped[idx];
      return {
        ...item,
        gid: src?.gid || null,
        isSponsored: Boolean(src?.isSponsored),
        resultType: src?.resultType || null,
        searchTerm: src?.searchTerm || context.query || null,
        country: src?.country || country,
        scrapedAt: src?.scrapedAt || item.lastCheckedAt,
      };
    });
  },

  async searchProducts(query, options = {}) {
    const {
      gl = "in",
      hl = "en",
      maxProductsPerSearch = process.env.APIFY_MAX_PRODUCTS_PER_SEARCH,
      maxPages = process.env.APIFY_MAX_PAGES,
      timeoutMs = parseIntBounded(process.env.APIFY_TIMEOUT_MS, 120000, 1000, 300000),
      apiToken = process.env.APIFY_API_TOKEN,
    } = options;

    const cleanQuery = cleanString(query);
    if (!cleanQuery || normalizeText(cleanQuery).length < 2) {
      return {
        provider: PROVIDER_IDS.APIFY,
        ok: false,
        skipped: true,
        gateReason: "invalid_query",
        errorType: ERROR_TYPES.INVALID_RESPONSE,
        errorMessage: "Empty or malformed search query rejected before Apify dispatch.",
        rawItems: [],
        items: [],
        usageMetadata: null,
      };
    }

    const actorInput = buildApifyActorInput({
      query: cleanQuery,
      gl,
      hl,
      maxProductsPerSearch,
      maxPages,
    });
    const inFlightKey = [
      normalizeText(cleanQuery),
      actorInput.country,
      actorInput.language,
      actorInput.maxProductsPerSearch,
      actorInput.maxPages,
    ].join("|");

    const inFlightMap = getApifyInFlightMap();
    if (inFlightMap.has(inFlightKey)) {
      return inFlightMap.get(inFlightKey);
    }

    const runPromise = (async () => {
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
        return {
          provider: PROVIDER_IDS.APIFY,
          ok: false,
          skipped: true,
          gateReason: gate.reason,
          errorType: "PROVIDER_UNAVAILABLE",
          errorMessage: `Apify skipped (${gate.reason})`,
          rawItems: [],
          items: [],
          usageMetadata: this.getUsageMetadata({ estimatedCostUsd: 0 }),
        };
      }

      const effectiveToken = cleanString(apiToken);
      if (!effectiveToken) {
        return {
          provider: PROVIDER_IDS.APIFY,
          ok: false,
          skipped: true,
          gateReason: "missing_api_key",
          errorType: ERROR_TYPES.AUTH_ERROR,
          errorMessage: "Apify API token missing.",
          rawItems: [],
          items: [],
          usageMetadata: this.getUsageMetadata({ estimatedCostUsd: 0 }),
        };
      }

      const slot = tryAcquireApifyRunSlot({
        maxProductsPerSearch: actorInput.maxProductsPerSearch,
      });
      if (!slot.acquired) {
        return {
          provider: PROVIDER_IDS.APIFY,
          ok: false,
          skipped: true,
          gateReason: slot.reason,
          errorType:
            slot.reason === "max_concurrent_runs_reached" || slot.reason === "monthly_budget_exhausted"
              ? ERROR_TYPES.RATE_LIMITED
              : "PROVIDER_UNAVAILABLE",
          errorMessage: `Apify skipped (${slot.reason})`,
          rawItems: [],
          items: [],
          usageMetadata: this.getUsageMetadata({ estimatedCostUsd: 0 }),
        };
      }

      const startedAt = Date.now();
      let settled = false;

      try {
        const timeoutSeconds = Math.max(10, Math.min(300, Math.ceil(timeoutMs / 1000)));
        const reqUrl = new URL(APIFY_ENDPOINT);
        reqUrl.searchParams.set("timeout", String(timeoutSeconds));
        if (typeof slot.maxTotalChargeUsd === "number" && slot.maxTotalChargeUsd > 0) {
          reqUrl.searchParams.set("maxTotalChargeUsd", String(slot.maxTotalChargeUsd));
        }

        const response = await fetch(reqUrl.toString(), {
          method: "POST",
          headers: {
            Authorization: `Bearer ${effectiveToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(actorInput),
          cache: "no-store",
          signal: AbortSignal.timeout(timeoutMs),
        });

        const latencyMs = Date.now() - startedAt;
        const rawText = await response.text();
        let payload = null;
        let parseFailed = false;

        try {
          payload = rawText && rawText.trim() ? JSON.parse(rawText) : null;
        } catch {
          parseFailed = true;
        }

        // Non-secret run identifiers (runId/status/exitCode) for actionable failure reports.
        const runMetadata = parseFailed
          ? extractApifyRunMetadata(null, response.headers)
          : extractApifyRunMetadata(payload, response.headers);

        if (response.status === 401 || response.status === 403) {
          const classified = classifyProviderError({
            status: response.status,
            message: redactSecrets(
              payload?.error?.message || payload?.message || `Apify HTTP ${response.status}`
            ),
          });
          const actualCostUsd = settleApifyRunSlot({
            reservedUsd: slot.reservedUsd,
            succeeded: false,
            classifiedError: classified,
            latencyMs,
          });
          settled = true;
          return {
            provider: PROVIDER_IDS.APIFY,
            ok: false,
            status: response.status,
            errorType: classified.errorType,
            errorMessage: classified.message,
            rawItems: [],
            items: [],
            runMetadata,
            usageMetadata: this.getUsageMetadata({
              estimatedCostUsd: actualCostUsd,
              latencyMs,
              runMetadata,
            }),
          };
        }

        if (response.status === 429 || response.status === 402) {
          const classified = classifyProviderError({
            status: response.status,
            headers: response.headers,
            message: redactSecrets(
              payload?.error?.message || payload?.message || `Apify HTTP ${response.status}`
            ),
          });
          const actualCostUsd = settleApifyRunSlot({
            reservedUsd: slot.reservedUsd,
            succeeded: false,
            classifiedError: classified,
            latencyMs,
          });
          settled = true;
          return {
            provider: PROVIDER_IDS.APIFY,
            ok: false,
            status: response.status,
            errorType: classified.errorType,
            errorMessage: classified.message,
            rawItems: [],
            items: [],
            runMetadata,
            usageMetadata: this.getUsageMetadata({
              estimatedCostUsd: actualCostUsd,
              latencyMs,
              runMetadata,
            }),
          };
        }

        if (parseFailed) {
          const classified = classifyProviderError({
            status: response.status,
            message: response.ok
              ? "Apify returned invalid JSON dataset payload."
              : `Apify HTTP ${response.status}`,
          });
          const actualCostUsd = settleApifyRunSlot({
            reservedUsd: slot.reservedUsd,
            succeeded: false,
            classifiedError: classified,
            latencyMs,
          });
          settled = true;
          return {
            provider: PROVIDER_IDS.APIFY,
            ok: false,
            status: response.status,
            errorType: classified.errorType,
            errorMessage: classified.message,
            rawItems: [],
            items: [],
            runMetadata,
            usageMetadata: this.getUsageMetadata({
              estimatedCostUsd: actualCostUsd,
              latencyMs,
              runMetadata,
            }),
          };
        }

        const rawRows = unwrapApifyDatasetRows(payload);
        const actorErrorObj =
          !Array.isArray(payload) && (payload?.error || payload?.errorMessage)
            ? payload.error || { message: payload.errorMessage }
            : null;

        // Parse partial results if usable `rowType === "product"` rows arrived alongside 206 or partial condition (non-401/403/429).
        const isPartialSuccessStatus =
          response.ok || response.status === 206 || ((response.status === 408 || response.status >= 500) && rawRows.length > 0 && !actorErrorObj);

        if (!isPartialSuccessStatus || actorErrorObj) {
          const errMessage = redactSecrets(
            actorErrorObj?.message ||
              payload?.message ||
              `Apify HTTP ${response.status}`
          );
          const classified = classifyProviderError({
            status: response.status,
            headers: response.headers,
            message: errMessage,
            // Surface structured Actor run failures even when the human-readable
            // message omits the words "actor run failed".
            error: {
              type: actorErrorObj?.type || null,
              status: runMetadata?.status || null,
            },
          });
          const actualCostUsd = settleApifyRunSlot({
            reservedUsd: slot.reservedUsd,
            succeeded: false,
            classifiedError: classified,
            rawRowCount: rawRows.length,
            latencyMs,
          });
          settled = true;
          return {
            provider: PROVIDER_IDS.APIFY,
            ok: false,
            status: response.status,
            errorType: classified.errorType,
            errorMessage: `${classified.message}${formatApifyRunContext(runMetadata)}`,
            rawItems: [],
            items: [],
            runMetadata,
            usageMetadata: this.getUsageMetadata({
              estimatedCostUsd: actualCostUsd,
              latencyMs,
              runMetadata,
            }),
          };
        }

        const productRows = rawRows.filter(
          (row) => row && typeof row === "object" && row.rowType === "product"
        );
        const normalizedItems = this.normalizeResults(
          { rawItems: productRows },
          { query: cleanQuery, gl }
        );

        if (normalizedItems.length === 0) {
          // A failed/aborted run with no usable rows is NOT a healthy empty answer.
          const runFailed = isApifyRunFailure(runMetadata);
          const classified = classifyProviderError({
            status: response.status,
            message: runFailed
              ? "Apify Actor run produced no usable dataset rows."
              : rawRows.length === 0
              ? "Apify returned empty dataset."
              : "Apify dataset contained no valid product rows.",
            error: runFailed ? { status: runMetadata.status } : null,
          });
          const actualCostUsd = settleApifyRunSlot({
            reservedUsd: slot.reservedUsd,
            succeeded: !runFailed,
            classifiedError: classified,
            rawRowCount: rawRows.length,
            resultItemCount: 0,
            latencyMs,
          });
          settled = true;
          return {
            provider: PROVIDER_IDS.APIFY,
            ok: !runFailed,
            status: response.status,
            partialRun: !response.ok || response.status === 206,
            errorType: classified.errorType,
            errorMessage: `${classified.message}${formatApifyRunContext(runMetadata)}`,
            rawItems: runFailed ? [] : productRows,
            items: [],
            runMetadata,
            usageMetadata: this.getUsageMetadata({
              estimatedCostUsd: actualCostUsd,
              latencyMs,
              runMetadata,
            }),
          };
        }

        const actualCostUsd = settleApifyRunSlot({
          reservedUsd: slot.reservedUsd,
          succeeded: true,
          classifiedError: null,
          rawRowCount: rawRows.length,
          resultItemCount: normalizedItems.length,
          latencyMs,
        });
        settled = true;

        return {
          provider: PROVIDER_IDS.APIFY,
          ok: true,
          status: response.status,
          partialRun: !response.ok || response.status === 206,
          rawItems: productRows,
          items: normalizedItems,
          runMetadata,
          usageMetadata: this.getUsageMetadata({
            estimatedCostUsd: actualCostUsd,
            latencyMs,
            runMetadata,
          }),
          errorType: null,
          errorMessage: null,
        };
      } catch (err) {
        const latencyMs = Date.now() - startedAt;
        const classified = classifyProviderError({ error: err });
        if (!settled) {
          const actualCostUsd = settleApifyRunSlot({
            reservedUsd: slot.reservedUsd,
            succeeded: false,
            classifiedError: classified,
            latencyMs,
          });
          settled = true;
          return {
            provider: PROVIDER_IDS.APIFY,
            ok: false,
            status: null,
            errorType: classified.errorType,
            errorMessage: classified.message,
            rawItems: [],
            items: [],
            runMetadata: null,
            usageMetadata: this.getUsageMetadata({ estimatedCostUsd: actualCostUsd, latencyMs }),
          };
        }
        throw err;
      } finally {
        if (!settled) {
          settleApifyRunSlot({
            reservedUsd: slot.reservedUsd,
            succeeded: false,
            classifiedError: {
              errorType: ERROR_TYPES.PROVIDER_UNAVAILABLE,
              message: "Apify Actor execution aborted unexpectedly.",
            },
          });
        }
      }
    })().finally(() => {
      inFlightMap.delete(inFlightKey);
    });

    inFlightMap.set(inFlightKey, runPromise);
    return runPromise;
  },
};

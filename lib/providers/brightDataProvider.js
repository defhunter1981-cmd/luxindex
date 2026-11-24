import { normalizeProviderResults } from "@/lib/search/productNormalizer";
import {
  ERROR_TYPES,
  PROVIDER_IDS,
  canCallProvider,
  classifyProviderError,
  extractUsageMetadata,
  getMonthlyCreditStatus,
  getQuotaDiagnostics,
  recordProviderCallStart,
  recordProviderFailure,
  recordProviderSuccess,
} from "@/lib/search/quotaManager";

const BRIGHTDATA_REQUEST_ENDPOINT = "https://api.brightdata.com/request";

function isGoogleHost(hostname = "") {
  const host = String(hostname || "").toLowerCase();
  return (
    host === "google.com" ||
    host.endsWith(".google.com") ||
    host.includes("google.co.") ||
    host === "goo.gl"
  );
}

/**
 * Unwraps Google `/url?q=...` redirect links returned by Bright Data `parsed_light`
 * into clean direct merchant destinations while preserving Google Shopping links
 * strictly as fallback `shoppingUrl` references.
 */
export function extractBrightDataLinks(rawItem = {}) {
  const rawLink =
    typeof rawItem?.link === "string"
      ? rawItem.link.trim()
      : typeof rawItem?.url === "string"
      ? rawItem.url.trim()
      : "";
  const explicitDirect =
    typeof rawItem?.merchant_link === "string"
      ? rawItem.merchant_link.trim()
      : typeof rawItem?.direct_link === "string"
      ? rawItem.direct_link.trim()
      : "";

  let directLink = explicitDirect || null;
  let shoppingLink = null;

  const inspectUrl = (candidate) => {
    if (!candidate || !/^https?:\/\//i.test(candidate)) return;
    try {
      const parsed = new URL(candidate);
      if (isGoogleHost(parsed.hostname)) {
        const embedded =
          parsed.searchParams.get("q") ||
          parsed.searchParams.get("url") ||
          parsed.searchParams.get("adurl");
        if (embedded && /^https?:\/\//i.test(embedded.trim())) {
          const inner = new URL(embedded.trim());
          if (!isGoogleHost(inner.hostname)) {
            directLink = directLink || inner.toString();
            return;
          }
        }
        shoppingLink = shoppingLink || candidate;
      } else {
        directLink = directLink || candidate;
      }
    } catch {
      // Ignore malformed URLs cleanly
    }
  };

  inspectUrl(rawLink);
  if (typeof rawItem?.product_link === "string") {
    inspectUrl(rawItem.product_link.trim());
  }

  return {
    directLink,
    shoppingLink,
  };
}

/**
 * Builds the Bright Data SERP API Google Shopping URL localized for India (`gl=in`, `hl=en`).
 * Supports `udm=28` (default) and configurable `tbm=shop` (`mode: "tbm_shop"`).
 */
export function buildBrightDataShoppingUrl({
  query,
  gl = "in",
  hl = "en",
  start = 0,
  mode = process.env.BRIGHTDATA_SHOPPING_MODE || "udm28",
} = {}) {
  const targetUrl = new URL("https://www.google.com/search");
  targetUrl.searchParams.set("q", String(query || "").trim());

  const normalizedMode = String(mode || "udm28").trim().toLowerCase();
  if (normalizedMode === "tbm_shop" || normalizedMode === "tbm=shop") {
    targetUrl.searchParams.set("tbm", "shop");
  } else {
    targetUrl.searchParams.set("udm", "28");
  }

  targetUrl.searchParams.set("gl", gl === "us" ? "us" : "in");
  targetUrl.searchParams.set("hl", hl || "en");
  targetUrl.searchParams.set("brd_json", "1");
  if (Number.isFinite(start) && start > 0) {
    targetUrl.searchParams.set("start", String(start));
  }
  return targetUrl.toString();
}

function getHeaderCaseInsensitive(headers, name) {
  if (!headers) return null;
  if (typeof headers.get === "function") return headers.get(name);
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name.toLowerCase());
  return key ? headers[key] : null;
}

function extractBrightDataErrorHeaders(headers) {
  const brdStatusRaw = getHeaderCaseInsensitive(headers, "x-brd-status-code");
  const brdStatusNum = brdStatusRaw ? Number.parseInt(String(brdStatusRaw).trim(), 10) : null;
  const brdError = String(getHeaderCaseInsensitive(headers, "x-brd-error") || "").trim();
  const brdErrorCode = String(
    getHeaderCaseInsensitive(headers, "x-brd-error-code") ||
      getHeaderCaseInsensitive(headers, "x-brd-err-code") ||
      ""
  ).trim();

  const hasUpstreamBlock =
    (Number.isFinite(brdStatusNum) && brdStatusNum >= 400) ||
    Boolean(brdError) ||
    Boolean(brdErrorCode);

  return {
    brdStatusCode: brdStatusRaw ? String(brdStatusRaw).trim() : null,
    brdStatusNum: Number.isFinite(brdStatusNum) ? brdStatusNum : null,
    brdError: brdError || null,
    brdErrorCode: brdErrorCode || null,
    hasUpstreamBlock,
  };
}

function unwrapRawShoppingArray(payload) {
  if (!payload || typeof payload !== "object") return [];
  if (Array.isArray(payload.shopping)) return payload.shopping;
  if (Array.isArray(payload.shopping_results)) return payload.shopping_results;
  if (Array.isArray(payload.organic_shopping)) return payload.organic_shopping;
  if (payload.body && typeof payload.body === "object") {
    return unwrapRawShoppingArray(payload.body);
  }
  return [];
}

function extractMerchantString(val) {
  if (typeof val === "string" && val.trim()) return val.trim();
  if (val && typeof val === "object" && !Array.isArray(val)) {
    for (const k of ["name", "display_name", "title", "source"]) {
      if (typeof val[k] === "string" && val[k].trim()) return val[k].trim();
    }
  }
  return "";
}

function mapBrightDataRawItem(item = {}, index = 0) {
  const { directLink, shoppingLink } = extractBrightDataLinks(item);
  const merchantName =
    extractMerchantString(item.shop) ||
    extractMerchantString(item.source) ||
    extractMerchantString(item.seller) ||
    extractMerchantString(item.merchant) ||
    "";

  const extensions = [];
  if (Array.isArray(item.extensions)) {
    for (const ext of item.extensions) {
      if (typeof ext === "string" && ext.trim()) extensions.push(ext.trim());
    }
  }
  if (typeof item.badge === "string" && item.badge.trim()) {
    extensions.push(item.badge.trim());
  }
  if (typeof item.tag === "string" && item.tag.trim()) {
    extensions.push(item.tag.trim());
  }

  return {
    ...item,
    title: typeof item.title === "string" ? item.title.trim() : "",
    source: merchantName || undefined,
    price: item.price ?? item.extracted_price ?? null,
    old_price: item.old_price ?? item.base_price ?? null,
    direct_link: directLink,
    link: directLink || shoppingLink || item.link || null,
    product_link: shoppingLink || null,
    imageUrl: item.image || item.thumbnail || null,
    thumbnail: item.thumbnail || item.image || null,
    rating: typeof item.rating === "number" ? item.rating : null,
    reviews:
      typeof item.reviews_cnt === "number"
        ? item.reviews_cnt
        : typeof item.reviews === "number"
        ? item.reviews
        : null,
    delivery: item.delivery || item.shipping || null,
    extensions,
    position: Number(item.global_rank || item.position || index + 1),
  };
}

export const BrightDataProvider = {
  id: PROVIDER_IDS.BRIGHTDATA,
  name: "Bright Data Google Shopping SERP",
  role: "budget_protected_discovery",

  getProviderStatus() {
    const diag = getQuotaDiagnostics()[PROVIDER_IDS.BRIGHTDATA];
    return {
      id: "brightdata_serp_google_shopping",
      providerKey: PROVIDER_IDS.BRIGHTDATA,
      name: this.name,
      role: this.role,
      ...diag,
    };
  },

  getUsageMetadata(responseMeta) {
    return extractUsageMetadata(PROVIDER_IDS.BRIGHTDATA, responseMeta);
  },

  getCreditStatus() {
    return getMonthlyCreditStatus(PROVIDER_IDS.BRIGHTDATA);
  },

  normalizeResults(response, context = {}) {
    const rawItems = Array.isArray(response?.rawItems)
      ? response.rawItems
      : unwrapRawShoppingArray(response).map((entry, idx) =>
          mapBrightDataRawItem(entry, idx)
        );

    return normalizeProviderResults(rawItems, {
      provider: PROVIDER_IDS.BRIGHTDATA,
      queryHint: context.query || "",
      gl: context.gl || "in",
    });
  },

  async searchProducts(query, options = {}) {
    const {
      gl = "in",
      hl = "en",
      start = 0,
      mode = process.env.BRIGHTDATA_SHOPPING_MODE || "udm28",
      timeoutMs = 12000,
      maxRetries = 1,
      apiKey = process.env.BRIGHTDATA_API_KEY,
      zone = process.env.BRIGHTDATA_SERP_ZONE,
    } = options;

    const gate = canCallProvider(PROVIDER_IDS.BRIGHTDATA);
    if (!gate.allowed) {
      return {
        provider: PROVIDER_IDS.BRIGHTDATA,
        ok: false,
        skipped: true,
        gateReason: gate.reason,
        errorType: "PROVIDER_UNAVAILABLE",
        errorMessage: `Bright Data skipped (${gate.reason})`,
        rawItems: [],
        items: [],
        usageMetadata: null,
      };
    }

    const effectiveKey = String(apiKey || "").trim();
    const effectiveZone = String(zone || "").trim();
    if (!effectiveKey || !effectiveZone) {
      return {
        provider: PROVIDER_IDS.BRIGHTDATA,
        ok: false,
        skipped: true,
        gateReason: !effectiveKey ? "missing_api_key" : "missing_serp_zone",
        errorType: ERROR_TYPES.AUTH_ERROR,
        errorMessage: "Bright Data credentials or SERP zone missing.",
        rawItems: [],
        items: [],
        usageMetadata: null,
      };
    }

    const targetUrl = buildBrightDataShoppingUrl({ query, gl, hl, start, mode });
    let attempt = 0;

    while (attempt <= maxRetries) {
      if (attempt > 0) {
        const retryGate = canCallProvider(PROVIDER_IDS.BRIGHTDATA);
        if (!retryGate.allowed) {
          return {
            provider: PROVIDER_IDS.BRIGHTDATA,
            ok: false,
            skipped: true,
            gateReason: retryGate.reason,
            errorType: ERROR_TYPES.RATE_LIMITED,
            errorMessage: `Bright Data retry aborted (${retryGate.reason})`,
            rawItems: [],
            items: [],
            usageMetadata: null,
          };
        }
      }

      attempt += 1;
      const startedAt = Date.now();
      recordProviderCallStart(PROVIDER_IDS.BRIGHTDATA);

      try {
        const response = await fetch(BRIGHTDATA_REQUEST_ENDPOINT, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${effectiveKey}`,
            "Content-Type": "application/json",
            "x-unblock-data-format": "parsed_light",
          },
          body: JSON.stringify({
            zone: effectiveZone,
            url: targetUrl,
            format: "raw",
            data_format: "parsed_light",
          }),
          cache: "no-store",
          signal: AbortSignal.timeout(timeoutMs),
        });

        const latencyMs = Date.now() - startedAt;
        const brdHeaders = extractBrightDataErrorHeaders(response.headers);

        if (brdHeaders.hasUpstreamBlock) {
          const classified = classifyProviderError({
            status: brdHeaders.brdStatusNum || response.status,
            headers: response.headers,
            message: `Bright Data upstream error (${brdHeaders.brdErrorCode || brdHeaders.brdStatusCode || response.status})`,
          });
          const usageMetadata = extractUsageMetadata(PROVIDER_IDS.BRIGHTDATA, {
            headers: response.headers,
            latencyMs,
          });
          // Never bill/charge failed CAPTCHA, redirect-rejected, or upstream 502 responses.
          usageMetadata.creditsUsed = 0;
          recordProviderFailure(PROVIDER_IDS.BRIGHTDATA, classified, usageMetadata);

          // Disable retries for CAPTCHA and blocked responses.
          return {
            provider: PROVIDER_IDS.BRIGHTDATA,
            ok: false,
            status: brdHeaders.brdStatusNum || response.status,
            xBrdStatusCode: brdHeaders.brdStatusCode,
            xBrdError: brdHeaders.brdError,
            xBrdErrorCode: brdHeaders.brdErrorCode,
            errorType: classified.errorType,
            errorMessage: classified.message,
            rawItems: [],
            items: [],
            usageMetadata,
          };
        }

        const rawText = await response.text();
        let payload = null;
        try {
          payload = rawText ? JSON.parse(rawText) : null;
          if (typeof payload === "string") {
            payload = JSON.parse(payload);
          }
        } catch (parseErr) {
          const classified = classifyProviderError({
            status: response.status,
            headers: response.headers,
            error: parseErr,
            message: response.ok
              ? "Bright Data returned invalid JSON response."
              : `Bright Data HTTP ${response.status}`,
          });
          const usageMetadata = extractUsageMetadata(PROVIDER_IDS.BRIGHTDATA, {
            headers: response.headers,
            latencyMs,
          });
          usageMetadata.creditsUsed = 0;
          recordProviderFailure(PROVIDER_IDS.BRIGHTDATA, classified, usageMetadata);

          if (
            classified.retryable &&
            classified.errorType !== ERROR_TYPES.CAPTCHA_BLOCKED &&
            attempt <= maxRetries &&
            response.status >= 500
          ) {
            continue;
          }
          return {
            provider: PROVIDER_IDS.BRIGHTDATA,
            ok: false,
            status: response.status,
            errorType: classified.errorType,
            errorMessage: classified.message,
            rawItems: [],
            items: [],
            usageMetadata,
          };
        }

        const usageMetadata = extractUsageMetadata(PROVIDER_IDS.BRIGHTDATA, {
          headers: response.headers,
          payload,
          latencyMs,
        });
        usageMetadata.creditsUsed = response.ok ? 1 : 0;

        if (!response.ok || payload?.error || payload?.error_code) {
          const errMessage =
            payload?.error ||
            payload?.message ||
            `Bright Data HTTP ${response.status}`;
          const classified = classifyProviderError({
            status: response.status,
            headers: response.headers,
            message: errMessage,
          });
          usageMetadata.creditsUsed = 0; // Failed/blocked requests are not billed
          recordProviderFailure(PROVIDER_IDS.BRIGHTDATA, classified, usageMetadata);

          if (
            classified.retryable &&
            classified.errorType !== ERROR_TYPES.CAPTCHA_BLOCKED &&
            attempt <= maxRetries &&
            response.status >= 500
          ) {
            continue;
          }
          return {
            provider: PROVIDER_IDS.BRIGHTDATA,
            ok: false,
            status: response.status,
            errorType: classified.errorType,
            errorMessage: classified.message,
            rawItems: [],
            items: [],
            usageMetadata,
          };
        }

        const rawShopping = unwrapRawShoppingArray(payload);
        if (rawShopping.length === 0) {
          const classified = classifyProviderError({
            status: response.status,
            message: "Bright Data returned no shopping results.",
          });
          recordProviderFailure(PROVIDER_IDS.BRIGHTDATA, classified, usageMetadata);
          return {
            provider: PROVIDER_IDS.BRIGHTDATA,
            ok: true,
            status: response.status,
            errorType: classified.errorType,
            errorMessage: classified.message,
            rawItems: [],
            items: [],
            usageMetadata,
          };
        }

        const mappedRaw = rawShopping.map((entry, idx) =>
          mapBrightDataRawItem(entry, idx)
        );
        const items = this.normalizeResults(
          { rawItems: mappedRaw },
          { query, gl }
        );
        recordProviderSuccess(PROVIDER_IDS.BRIGHTDATA, usageMetadata);

        return {
          provider: PROVIDER_IDS.BRIGHTDATA,
          ok: true,
          status: response.status,
          rawItems: mappedRaw,
          items,
          usageMetadata,
          errorType: null,
          errorMessage: null,
        };
      } catch (err) {
        const latencyMs = Date.now() - startedAt;
        const classified = classifyProviderError({ error: err });
        const usageMetadata = extractUsageMetadata(PROVIDER_IDS.BRIGHTDATA, {
          latencyMs,
        });
        usageMetadata.creditsUsed = 0;
        recordProviderFailure(PROVIDER_IDS.BRIGHTDATA, classified, usageMetadata);

        if (
          classified.retryable &&
          classified.errorType !== ERROR_TYPES.TIMEOUT &&
          attempt <= maxRetries
        ) {
          continue;
        }
        return {
          provider: PROVIDER_IDS.BRIGHTDATA,
          ok: false,
          status: null,
          errorType: classified.errorType,
          errorMessage: classified.message,
          rawItems: [],
          items: [],
          usageMetadata,
        };
      }
    }
  },
};

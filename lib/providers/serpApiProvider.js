import { normalizeProviderResults } from "@/lib/search/productNormalizer";
import {
  PROVIDER_IDS,
  canCallProvider,
  classifyProviderError,
  extractUsageMetadata,
  getQuotaDiagnostics,
  recordProviderCallStart,
  recordProviderFailure,
  recordProviderSuccess,
} from "@/lib/search/quotaManager";
import { normalizeText } from "@/lib/utils";

export function classifySerpProviderError(err) {
  const msg = String(err?.message || "");
  const lower = msg.toLowerCase();
  if (
    lower.includes("429") ||
    lower.includes("quota") ||
    lower.includes("run out of searches")
  ) {
    return {
      errorType: "QUOTA_EXHAUSTED",
      reason: "Live search quota temporarily exhausted on Google Shopping provider.",
    };
  }
  if (
    err?.name === "TimeoutError" ||
    lower.includes("timeout") ||
    lower.includes("abort")
  ) {
    return {
      errorType: "TIMEOUT",
      reason: "Live shopping provider timed out before completing aggregation.",
    };
  }
  return {
    errorType: "PROVIDER_ERROR",
    reason: msg || "Live shopping feed unavailable for this request.",
  };
}

/**
 * Primary multi-product discovery query against SerpApi Google Shopping (`gl=in`, `hl=en` default).
 * Executes ONE search request without eagerly crawling immersive product detail endpoints.
 */
export async function discoverWithSerpApi({
  query,
  gl = "in",
  hl = "en",
  start = 0,
  apiKey,
}) {
  if (!apiKey) {
    throw new Error("SERPAPI_KEY not configured");
  }

  const url = new URL("https://serpapi.com/search.json");
  url.searchParams.set("engine", "google_shopping");
  url.searchParams.set("q", query);
  url.searchParams.set("gl", gl === "us" ? "us" : "in");
  url.searchParams.set("hl", hl || "en");
  url.searchParams.set("direct_link", "true");
  if (Number.isFinite(start) && start > 0) {
    url.searchParams.set("start", String(start));
  }
  url.searchParams.set("api_key", apiKey);

  const response = await fetch(url.toString(), {
    method: "GET",
    cache: "no-store",
    signal: AbortSignal.timeout(10000),
  });

  if (!response.ok) {
    throw new Error(`SerpApi responded with status ${response.status}`);
  }

  const data = await response.json();
  if (data.error) {
    throw new Error(data.error);
  }

  const shoppingResults = Array.isArray(data.shopping_results)
    ? data.shopping_results
    : [];

  // Categorized blocks (e.g. Deals / Under ₹350) occasionally surface extra distinct listings; merge cleanly without duplicating product_id
  const categorizedFlat = [];
  if (Array.isArray(data.categorized_shopping_results)) {
    const seenIds = new Set(
      shoppingResults.map((r) => r.product_id || normalizeText(r.title || ""))
    );
    for (const group of data.categorized_shopping_results) {
      for (const item of group.shopping_results || []) {
        const key = item.product_id || normalizeText(item.title || "");
        if (!seenIds.has(key)) {
          seenIds.add(key);
          categorizedFlat.push(item);
        }
      }
    }
  }

  const combined = [...shoppingResults, ...categorizedFlat];

  return {
    providerId: "serpapi_google_shopping",
    providerLabel: "SerpApi Google Shopping",
    market: { gl: gl === "us" ? "us" : "in", hl: hl || "en" },
    rawCount: combined.length,
    items: combined,
    serpFilters: Array.isArray(data.filters) ? data.filters : [],
    hasNextProviderPage: shoppingResults.length >= 30,
    nextStart: shoppingResults.length >= 30 ? start + shoppingResults.length : null,
    fetchedAt: new Date().toISOString(),
  };
}

/**
 * Lazy Mode B detail fetcher: resolves specific `google_immersive_product` page tokens
 * only after a user selects a single product (or launches an exact comparison).
 */
export async function fetchImmersiveStoresByTokens({
  pageTokens = [],
  apiKey,
  limit = 6,
}) {
  const uniqueTokens = [...new Set(pageTokens.filter(Boolean))].slice(0, limit);
  if (!apiKey || uniqueTokens.length === 0) return [];

  const settled = await Promise.allSettled(
    uniqueTokens.map(async (pageToken) => {
      const immUrl = new URL("https://serpapi.com/search.json");
      immUrl.searchParams.set("engine", "google_immersive_product");
      immUrl.searchParams.set("page_token", pageToken);
      immUrl.searchParams.set("api_key", apiKey);

      const res = await fetch(immUrl.toString(), {
        method: "GET",
        cache: "no-store",
        signal: AbortSignal.timeout(7500),
      });
      if (!res.ok) return [];
      const data = await res.json();
      if (data.error) return [];

      const pr = data?.product_results;
      const stores = Array.isArray(pr?.stores) ? pr.stores : [];
      const fallbackTitle = pr?.title || "";

      return stores.map((store) => ({
        ...store,
        source: store.name || store.source || "",
        title: store.title || fallbackTitle,
        delivery: store.shipping || store.delivery || null,
        old_price: store.base_price || store.original_price || store.old_price,
        extracted_old_price:
          store.extracted_base_price ?? store.extracted_old_price,
        rating:
          typeof store.rating === "number"
            ? store.rating
            : typeof pr?.rating === "number"
            ? pr.rating
            : null,
        gtin: pr?.gtin || store.gtin || null,
        sku: pr?.sku || pr?.product_id || null,
        provider: PROVIDER_IDS.SERPAPI,
      }));
    })
  );

  const flattened = [];
  for (const res of settled) {
    if (res.status === "fulfilled" && Array.isArray(res.value)) {
      flattened.push(...res.value);
    }
  }
  return flattened;
}

export const SerpApiProvider = {
  id: PROVIDER_IDS.SERPAPI,
  name: "SerpApi Google Shopping",
  role: "primary_comparison_and_discovery",

  getProviderStatus() {
    const diag = getQuotaDiagnostics()[PROVIDER_IDS.SERPAPI];
    return {
      id: "serpapi_google_shopping",
      providerKey: PROVIDER_IDS.SERPAPI,
      name: this.name,
      role: this.role,
      ...diag,
    };
  },

  getUsageMetadata(responseMeta) {
    return extractUsageMetadata(PROVIDER_IDS.SERPAPI, responseMeta);
  },

  normalizeResults(response, context = {}) {
    const rawItems = Array.isArray(response?.items)
      ? response.items
      : Array.isArray(response?.rawItems)
      ? response.rawItems
      : Array.isArray(response?.shopping_results)
      ? response.shopping_results
      : [];
    return normalizeProviderResults(rawItems, {
      provider: PROVIDER_IDS.SERPAPI,
      queryHint: context.query || "",
      gl: context.gl || "in",
    });
  },

  async searchProducts(query, options = {}) {
    const {
      gl = "in",
      hl = "en",
      start = 0,
      apiKey = process.env.SERPAPI_KEY,
    } = options;

    const gate = canCallProvider(PROVIDER_IDS.SERPAPI);
    if (!gate.allowed) {
      return {
        provider: PROVIDER_IDS.SERPAPI,
        ok: false,
        skipped: true,
        gateReason: gate.reason,
        errorType: "PROVIDER_UNAVAILABLE",
        errorMessage: `SerpApi skipped (${gate.reason})`,
        rawItems: [],
        items: [],
        usageMetadata: null,
      };
    }

    const startedAt = Date.now();
    recordProviderCallStart(PROVIDER_IDS.SERPAPI);

    try {
      const result = await discoverWithSerpApi({ query, gl, hl, start, apiKey });
      const latencyMs = Date.now() - startedAt;
      const usageMetadata = extractUsageMetadata(PROVIDER_IDS.SERPAPI, { latencyMs });

      const rawItems = Array.isArray(result?.items) ? result.items : [];
      if (rawItems.length === 0) {
        const classified = classifyProviderError({
          status: 200,
          message: "SerpApi returned no shopping results.",
        });
        recordProviderFailure(PROVIDER_IDS.SERPAPI, classified, usageMetadata);
        return {
          provider: PROVIDER_IDS.SERPAPI,
          ok: true,
          status: 200,
          errorType: classified.errorType,
          errorMessage: classified.message,
          rawItems: [],
          items: [],
          serpFilters: result?.serpFilters || [],
          hasNextProviderPage: false,
          nextStart: null,
          usageMetadata,
        };
      }

      const items = this.normalizeResults({ rawItems }, { query, gl });
      recordProviderSuccess(PROVIDER_IDS.SERPAPI, usageMetadata);

      return {
        provider: PROVIDER_IDS.SERPAPI,
        ok: true,
        status: 200,
        rawItems,
        items,
        serpFilters: result?.serpFilters || [],
        hasNextProviderPage: Boolean(result?.hasNextProviderPage),
        nextStart: result?.nextStart ?? null,
        usageMetadata,
        errorType: null,
        errorMessage: null,
      };
    } catch (err) {
      const latencyMs = Date.now() - startedAt;
      const classified = classifyProviderError({ error: err });
      const usageMetadata = extractUsageMetadata(PROVIDER_IDS.SERPAPI, { latencyMs });
      recordProviderFailure(PROVIDER_IDS.SERPAPI, classified, usageMetadata);
      return {
        provider: PROVIDER_IDS.SERPAPI,
        ok: false,
        status: null,
        errorType: classified.errorType,
        errorMessage: classified.message,
        rawItems: [],
        items: [],
        usageMetadata,
      };
    }
  },
};


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

const SEARCHAPI_ENDPOINT = "https://www.searchapi.io/api/v1/search";

function pickStringField(obj, keys) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return "";
  for (const key of keys) {
    const val = obj[key];
    if (typeof val === "string") {
      const trimmed = val.trim();
      if (trimmed && trimmed.toLowerCase() !== "[object object]") {
        return trimmed;
      }
    }
  }
  return "";
}

function extractDomainLabel(rawUrl) {
  if (typeof rawUrl !== "string" || !rawUrl.trim()) return "";
  try {
    const parsed = new URL(rawUrl.trim());
    const targetParam = parsed.searchParams.get("url");
    const effective = targetParam && /^https?:\/\//i.test(targetParam)
      ? new URL(targetParam)
      : parsed;
    const host = effective.hostname.replace(/^www\./i, "").toLowerCase();
    const core = host.split(".")[0];
    if (!core || core === "google" || core === "encrypted-tbn0") return "";
    return core.charAt(0).toUpperCase() + core.slice(1);
  } catch {
    return "";
  }
}

/**
 * Safely normalizes heterogeneous SearchApi `merchant`, `seller`, and `source`
 * fields (string or nested object like `{ name, favicon, link }`) while
 * preserving the offer destination URL independently.
 */
export function extractSearchApiMerchantInfo(rawOffer = {}) {
  const offerUrlCandidates = [
    rawOffer?.link,
    rawOffer?.direct_link,
    rawOffer?.merchant_link,
    rawOffer?.url,
    rawOffer?.merchant?.link,
    rawOffer?.seller?.link,
  ];
  const merchantUrl =
    offerUrlCandidates.find(
      (u) => typeof u === "string" && /^https?:\/\//i.test(u.trim())
    )?.trim() || null;

  const candidates = [
    rawOffer?.merchant,
    rawOffer?.seller,
    rawOffer?.source,
    rawOffer?.store,
  ];

  let merchantName = "";
  for (const candidate of candidates) {
    if (!candidate) continue;
    if (typeof candidate === "string") {
      const trimmed = candidate.trim();
      if (trimmed && trimmed.toLowerCase() !== "[object object]") {
        merchantName = trimmed;
        break;
      }
      continue;
    }
    if (typeof candidate === "object" && !Array.isArray(candidate)) {
      const direct = pickStringField(candidate, [
        "name",
        "display_name",
        "title",
        "merchant_name",
        "seller_name",
        "store_name",
        "source",
        "store",
        "domain",
      ]);
      if (direct) {
        merchantName = direct;
        break;
      }
      const nestedFavicon = extractDomainLabel(candidate.favicon);
      if (nestedFavicon) {
        merchantName = nestedFavicon;
        break;
      }
    }
  }

  if (!merchantName && merchantUrl) {
    merchantName = extractDomainLabel(merchantUrl);
  }

  return {
    merchantName: merchantName || "Online Store",
    merchantUrl,
  };
}

/**
 * Fallback Mode B offer fetcher using SearchApi's `engine=google_product_offers`
 * and a valid `product_token`. Executed strictly when primary SerpApi offers
 * cannot resolve direct merchant listings for a selected SKU.
 */
export async function fetchOffersByProductToken({
  productToken,
  gl = "in",
  hl = "en",
  apiKey = process.env.SEARCHAPI_API_KEY,
  timeoutMs = 8000,
}) {
  if (!productToken || !apiKey) return [];

  const gate = canCallProvider(PROVIDER_IDS.SEARCHAPI);
  if (!gate.allowed) return [];

  const startedAt = Date.now();
  recordProviderCallStart(PROVIDER_IDS.SEARCHAPI);

  try {
    const url = new URL(SEARCHAPI_ENDPOINT);
    url.searchParams.set("engine", "google_product_offers");
    url.searchParams.set("product_token", productToken);
    url.searchParams.set("gl", gl === "us" ? "us" : "in");
    url.searchParams.set("hl", hl || "en");

    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });

    const latencyMs = Date.now() - startedAt;
    const payload = await response.json().catch(() => null);
    const usageMetadata = extractUsageMetadata(PROVIDER_IDS.SEARCHAPI, {
      headers: response.headers,
      payload,
      latencyMs,
    });

    if (!response.ok || payload?.error) {
      const classified = classifyProviderError({
        status: response.status,
        message: payload?.error || `SearchApi offers HTTP ${response.status}`,
      });
      recordProviderFailure(PROVIDER_IDS.SEARCHAPI, classified, usageMetadata);
      return [];
    }

    const offers = Array.isArray(payload?.offers) ? payload.offers : [];
    const fallbackTitle = payload?.product?.title || "";
    recordProviderSuccess(PROVIDER_IDS.SEARCHAPI, usageMetadata);

    return offers.map((offer) => {
      const { merchantName, merchantUrl } = extractSearchApiMerchantInfo(offer);
      const deliveryText =
        typeof offer.delivery_price === "string" && offer.delivery_price.trim()
          ? `Delivery: ${offer.delivery_price.trim()}`
          : Array.isArray(offer.details)
          ? offer.details.filter((d) => typeof d === "string").join(" · ") || null
          : typeof offer.details === "string"
          ? offer.details
          : null;

      return {
        source: merchantName,
        title: typeof offer.title === "string" && offer.title.trim() ? offer.title.trim() : fallbackTitle,
        link: merchantUrl,
        direct_link: merchantUrl,
        price: offer.price || offer.total_price || null,
        extracted_price:
          typeof offer.extracted_price === "number"
            ? offer.extracted_price
            : typeof offer.extracted_total_price === "number"
            ? offer.extracted_total_price
            : null,
        delivery: deliveryText,
        rating:
          typeof payload?.product?.rating === "number"
            ? payload.product.rating
            : null,
        reviews:
          typeof payload?.product?.reviews === "number"
            ? payload.product.reviews
            : null,
        thumbnail: payload?.product?.thumbnail || null,
        provider: PROVIDER_IDS.SEARCHAPI,
      };
    });
  } catch (err) {
    const latencyMs = Date.now() - startedAt;
    const classified = classifyProviderError({ error: err });
    const usageMetadata = extractUsageMetadata(PROVIDER_IDS.SEARCHAPI, {
      latencyMs,
    });
    recordProviderFailure(PROVIDER_IDS.SEARCHAPI, classified, usageMetadata);
    return [];
  }
}

export const SearchApiProvider = {
  id: PROVIDER_IDS.SEARCHAPI,
  name: "SearchApi Google Shopping",
  role: "secondary_discovery_fallback",

  getProviderStatus() {
    const diag = getQuotaDiagnostics()[PROVIDER_IDS.SEARCHAPI];
    return {
      id: "searchapi_google_shopping",
      providerKey: PROVIDER_IDS.SEARCHAPI,
      name: this.name,
      role: this.role,
      ...diag,
    };
  },

  getUsageMetadata(responseMeta) {
    return extractUsageMetadata(PROVIDER_IDS.SEARCHAPI, responseMeta);
  },

  normalizeResults(response, context = {}) {
    const rawItems = Array.isArray(response?.rawItems)
      ? response.rawItems
      : Array.isArray(response?.shopping_results)
      ? response.shopping_results
      : [];
    return normalizeProviderResults(rawItems, {
      provider: PROVIDER_IDS.SEARCHAPI,
      queryHint: context.query || "",
      gl: context.gl || "in",
    });
  },

  async searchProducts(query, options = {}) {
    const {
      gl = "in",
      hl = "en",
      num = 40,
      timeoutMs = 10000,
      apiKey = process.env.SEARCHAPI_API_KEY,
    } = options;

    const gate = canCallProvider(PROVIDER_IDS.SEARCHAPI);
    if (!gate.allowed) {
      return {
        provider: PROVIDER_IDS.SEARCHAPI,
        ok: false,
        skipped: true,
        gateReason: gate.reason,
        errorType: "PROVIDER_UNAVAILABLE",
        errorMessage: `SearchApi skipped (${gate.reason})`,
        rawItems: [],
        items: [],
        usageMetadata: null,
      };
    }

    const startedAt = Date.now();
    recordProviderCallStart(PROVIDER_IDS.SEARCHAPI);

    try {
      const url = new URL(SEARCHAPI_ENDPOINT);
      url.searchParams.set("engine", "google_shopping");
      url.searchParams.set("q", query);
      url.searchParams.set("gl", gl === "us" ? "us" : "in");
      url.searchParams.set("hl", hl || "en");
      url.searchParams.set("num", String(Math.min(Math.max(Number(num) || 40, 10), 100)));
      // Never pass `link=resolved`: verified in live benchmark to stall brand queries.

      const response = await fetch(url.toString(), {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        cache: "no-store",
        signal: AbortSignal.timeout(timeoutMs),
      });

      const latencyMs = Date.now() - startedAt;
      let payload = null;
      try {
        payload = await response.json();
      } catch (parseErr) {
        const classified = classifyProviderError({
          status: response.status,
          error: parseErr,
          message: "SearchApi returned invalid JSON response.",
        });
        const usageMetadata = extractUsageMetadata(PROVIDER_IDS.SEARCHAPI, {
          headers: response.headers,
          latencyMs,
        });
        recordProviderFailure(PROVIDER_IDS.SEARCHAPI, classified, usageMetadata);
        return {
          provider: PROVIDER_IDS.SEARCHAPI,
          ok: false,
          status: response.status,
          ...classified,
          rawItems: [],
          items: [],
          usageMetadata,
        };
      }

      const usageMetadata = extractUsageMetadata(PROVIDER_IDS.SEARCHAPI, {
        headers: response.headers,
        payload,
        latencyMs,
      });

      if (!response.ok || payload?.error) {
        const classified = classifyProviderError({
          status: response.status,
          message: payload?.error || `SearchApi HTTP ${response.status}`,
        });
        recordProviderFailure(PROVIDER_IDS.SEARCHAPI, classified, usageMetadata);
        return {
          provider: PROVIDER_IDS.SEARCHAPI,
          ok: false,
          status: response.status,
          ...classified,
          rawItems: [],
          items: [],
          usageMetadata,
        };
      }

      const rawItems = Array.isArray(payload?.shopping_results)
        ? payload.shopping_results
        : [];
      if (rawItems.length === 0) {
        const classified = classifyProviderError({
          status: response.status,
          message: "SearchApi returned no shopping results.",
        });
        recordProviderFailure(PROVIDER_IDS.SEARCHAPI, classified, usageMetadata);
        return {
          provider: PROVIDER_IDS.SEARCHAPI,
          ok: true,
          status: response.status,
          errorType: classified.errorType,
          errorMessage: classified.message,
          rawItems: [],
          items: [],
          usageMetadata,
        };
      }

      const items = this.normalizeResults(
        { rawItems },
        { query, gl }
      );
      recordProviderSuccess(PROVIDER_IDS.SEARCHAPI, usageMetadata);

      return {
        provider: PROVIDER_IDS.SEARCHAPI,
        ok: true,
        status: response.status,
        rawItems,
        items,
        usageMetadata,
        errorType: null,
        errorMessage: null,
      };
    } catch (err) {
      const latencyMs = Date.now() - startedAt;
      const classified = classifyProviderError({ error: err });
      const usageMetadata = extractUsageMetadata(PROVIDER_IDS.SEARCHAPI, {
        latencyMs,
      });
      recordProviderFailure(PROVIDER_IDS.SEARCHAPI, classified, usageMetadata);
      return {
        provider: PROVIDER_IDS.SEARCHAPI,
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


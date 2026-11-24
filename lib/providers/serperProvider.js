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

const SERPER_SHOPPING_ENDPOINT = "https://google.serper.dev/shopping";

export const SerperProvider = {
  id: PROVIDER_IDS.SERPER,
  name: "Serper Google Shopping",
  role: "secondary_discovery",

  getProviderStatus() {
    const diag = getQuotaDiagnostics()[PROVIDER_IDS.SERPER];
    return {
      id: "serper_google_shopping",
      providerKey: PROVIDER_IDS.SERPER,
      name: this.name,
      role: this.role,
      ...diag,
    };
  },

  getUsageMetadata(responseMeta) {
    return extractUsageMetadata(PROVIDER_IDS.SERPER, responseMeta);
  },

  normalizeResults(response, context = {}) {
    const rawItems = Array.isArray(response?.rawItems)
      ? response.rawItems
      : Array.isArray(response?.shopping)
      ? response.shopping
      : [];
    return normalizeProviderResults(rawItems, {
      provider: PROVIDER_IDS.SERPER,
      queryHint: context.query || "",
      gl: context.gl || "in",
    });
  },

  async searchProducts(query, options = {}) {
    const {
      gl = "in",
      hl = "en",
      num = 40,
      timeoutMs = 9000,
      apiKey = process.env.SERPER_API_KEY,
    } = options;

    const gate = canCallProvider(PROVIDER_IDS.SERPER);
    if (!gate.allowed) {
      return {
        provider: PROVIDER_IDS.SERPER,
        ok: false,
        skipped: true,
        gateReason: gate.reason,
        errorType: "PROVIDER_UNAVAILABLE",
        errorMessage: `Serper skipped (${gate.reason})`,
        rawItems: [],
        items: [],
        usageMetadata: null,
      };
    }

    const startedAt = Date.now();
    recordProviderCallStart(PROVIDER_IDS.SERPER);

    try {
      const response = await fetch(SERPER_SHOPPING_ENDPOINT, {
        method: "POST",
        headers: {
          "X-API-KEY": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          q: query,
          gl: gl === "us" ? "us" : "in",
          hl: hl || "en",
          num: Math.min(Math.max(Number(num) || 40, 10), 100),
        }),
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
          message: "Serper returned invalid JSON response.",
        });
        const usageMetadata = extractUsageMetadata(PROVIDER_IDS.SERPER, {
          headers: response.headers,
          latencyMs,
        });
        recordProviderFailure(PROVIDER_IDS.SERPER, classified, usageMetadata);
        return {
          provider: PROVIDER_IDS.SERPER,
          ok: false,
          status: response.status,
          ...classified,
          rawItems: [],
          items: [],
          usageMetadata,
        };
      }

      const usageMetadata = extractUsageMetadata(PROVIDER_IDS.SERPER, {
        headers: response.headers,
        payload,
        latencyMs,
      });

      if (!response.ok || payload?.message?.toLowerCase?.().includes("unauthorized")) {
        const classified = classifyProviderError({
          status: response.status,
          message: payload?.message || `Serper HTTP ${response.status}`,
        });
        recordProviderFailure(PROVIDER_IDS.SERPER, classified, usageMetadata);
        return {
          provider: PROVIDER_IDS.SERPER,
          ok: false,
          status: response.status,
          ...classified,
          rawItems: [],
          items: [],
          usageMetadata,
        };
      }

      const rawItems = Array.isArray(payload?.shopping) ? payload.shopping : [];
      if (rawItems.length === 0) {
        const classified = classifyProviderError({
          status: response.status,
          message: "Serper returned no shopping results.",
        });
        recordProviderFailure(PROVIDER_IDS.SERPER, classified, usageMetadata);
        return {
          provider: PROVIDER_IDS.SERPER,
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
      recordProviderSuccess(PROVIDER_IDS.SERPER, usageMetadata);

      return {
        provider: PROVIDER_IDS.SERPER,
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
      const usageMetadata = extractUsageMetadata(PROVIDER_IDS.SERPER, { latencyMs });
      recordProviderFailure(PROVIDER_IDS.SERPER, classified, usageMetadata);
      return {
        provider: PROVIDER_IDS.SERPER,
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

